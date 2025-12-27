import { describe, it, expect, vi } from 'vitest';
import { CloudinaryUploader, ensureUploadPreset } from '../../src/cloudinary';
import * as fileHandler from '../../src/file-handler';

describe('createUploadPreset flow', () => {
  it('creates an unsigned preset when settings allow and no preset exists', async () => {
    // Arrange: fake plugin instance with minimal required fields
    const file = { extension: 'png', name: 'image.png', path: 'notes/image.png' } as any;

    const plugin: any = {
      settings: {
        autoUploadOnFileAdd: true,
        cloudName: 'demo',
        apiKey: 'key',
        apiSecret: 'secret',
        allowStoreApiSecret: true,
        uploadPreset: '',
      },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      app: {
        vault: { readBinary: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) },
        workspace: { getActiveViewOfType: vi.fn().mockReturnValue(undefined) },
      },
    };

    // Mock CloudinaryUploader.createUploadPreset to succeed
    const presetSpy = vi.spyOn(CloudinaryUploader.prototype as any, 'createUploadPreset').mockResolvedValue({ name: 'obsidian_auto_unsigned' });

    // Spy processFileCreate so handleFileCreate doesn't attempt to actually upload
    const processSpy = vi.spyOn(fileHandler, 'processFileCreate').mockResolvedValue({ uploadedUrl: 'https://example.com/image.png' } as any);

    // Act
    const res = await ensureUploadPreset(plugin.settings as any, CloudinaryUploader as any);

    // Assert
    expect(presetSpy).toHaveBeenCalled();
    expect(res).toBe('obsidian_auto_unsigned');

    // Cleanup
    processSpy.mockRestore();
    presetSpy.mockRestore();

    // Cleanup
    presetSpy.mockRestore();
    processSpy.mockRestore();
  });

  it('only attempts auto-create once per session when using plugin handleFileCreate', async () => {
    // Reset auto-create state
    const { resetAutoCreatePresetState } = await import('../../src/auto-create');
    resetAutoCreatePresetState();

    const settings: any = {
      autoUploadOnFileAdd: true,
      cloudName: 'demo',
      apiKey: 'key',
      apiSecret: 'secret',
      allowStoreApiSecret: true,
      uploadPreset: '',
      debugLogs: false,
    };

    // Make createUploadPreset throw (e.g., CORS or network error)
    const spy = vi.spyOn(CloudinaryUploader.prototype as any, 'createUploadPreset').mockRejectedValue(new Error('Failed to fetch'));

    const pluginLike: any = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      app: {
        vault: {
          readBinary: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
          createBinary: vi.fn(),
          adapter: { exists: vi.fn().mockResolvedValue(false) },
        },
        workspace: { getActiveViewOfType: vi.fn().mockReturnValue(undefined) },
      },
    };

    // Call the helper directly to simulate plugin behaviour (it uses a per-session guard)
    const { tryAutoCreatePresetOnce } = await import('../../src/auto-create');
    const notify = vi.fn();

    await tryAutoCreatePresetOnce(settings, CloudinaryUploader as any, async () => {}, notify, false);
    await tryAutoCreatePresetOnce(settings, CloudinaryUploader as any, async () => {}, notify, false);

    // createUploadPreset should only have been attempted once (guarded inside the helper)
    expect(spy).toHaveBeenCalledTimes(1);

    // Reset session state and ensure another attempt will call again
    resetAutoCreatePresetState();
    spy.mockClear();

    await tryAutoCreatePresetOnce(
      settings,
      CloudinaryUploader as any,
      async () => {},
      (m: string) => notify(m),
      false
    );
    expect(spy).toHaveBeenCalledTimes(1);

    // Cleanup
    spy.mockRestore();
  });
});
