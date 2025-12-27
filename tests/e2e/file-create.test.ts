import { describe, it, expect, vi } from 'vitest';
import { processFileCreate, resetAutoUploadWarnings } from '../../src/file-handler';

describe('processFileCreate', () => {
  it('copies file locally when enabled and folder valid', async () => {
    const file = { extension: 'png', name: 'image.png', path: 'notes/image.png' } as any;

    const created: Record<string, Uint8Array> = {};
    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        createBinary: vi.fn().mockImplementation(async (path: string, data: any) => {
          created[path] = data as Uint8Array;
        }),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
      },
      workspace: { getActiveViewOfType: vi.fn().mockReturnValue(undefined) },
    };

    const settings: any = { localCopyEnabled: true, localCopyFolder: 'assets/images' };

    await processFileCreate(app, settings, file as any);

    expect(Object.keys(created).length).toBe(1);
    expect(created['assets/images/image.png']).toBeTruthy();
  });

  it('uploads file when auto-upload enabled and below size limit', async () => {
    const file = { extension: 'png', name: 'image.png', path: 'notes/image.png' } as any;

    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new Uint8Array(1000)),
        createBinary: vi.fn(),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
      },
      workspace: { getActiveViewOfType: vi.fn().mockReturnValue({ editor: { getValue: () => `![](${file.path})`, setValue: vi.fn() } }) },
    };

    const url = 'https://res.cloudinary.com/demo/image/upload/v12345/image.png';

    class MockUploader {
      constructor() {}
      upload = vi.fn().mockResolvedValue(url);
    }

    const settings: any = { autoUploadOnFileAdd: true, cloudName: 'demo', apiKey: 'key', uploadPreset: 'preset', maxAutoUploadSizeMB: 2 };

    const result: any = await processFileCreate(app, settings, file as any, MockUploader as any);

    expect(result).toBeTruthy();
    expect(result.uploadedUrl).toBe(url);

    // cached mapping should now exist in-memory
    expect(settings.uploadedFiles).toBeTruthy();
    expect(settings.uploadedFiles[file.path]).toBeTruthy();
  });

  it('skips upload when file exceeds size limit', async () => {
    const file = { extension: 'png', name: 'big.png', path: 'notes/big.png' } as any;

    const bigData = new Uint8Array(5 * 1024 * 1024); // 5 MB
    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(bigData),
        createBinary: vi.fn(),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
      },
      workspace: { getActiveViewOfType: vi.fn().mockReturnValue({ editor: { getValue: () => `![](${file.path})`, setValue: vi.fn() } }) },
    };

    class MockUploader {
      constructor() {}
      upload = vi.fn();
    }

    const settings: any = { autoUploadOnFileAdd: true, cloudName: 'demo', apiKey: 'key', maxAutoUploadSizeMB: 1 };

    const result: any = await processFileCreate(app, settings, file as any, MockUploader as any);

    expect(result).toBeUndefined();
  });

  it('works with debugLogs enabled and still uploads', async () => {
    const file = { extension: 'png', name: 'image.png', path: 'notes/image.png' } as any;

    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new Uint8Array(1000)),
        createBinary: vi.fn(),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
      },
      workspace: { getActiveViewOfType: vi.fn().mockReturnValue({ editor: { getValue: () => `![](${file.path})`, setValue: vi.fn() } }) },
    };

    // also ensure settings persists uploadedFiles when saveSettings is provided
    const persisted: any = {};
    const saveSettings = vi.fn().mockImplementation(async (s: any) => {
      Object.assign(persisted, s);
    });

    const url = 'https://res.cloudinary.com/demo/image/upload/v12345/image.png';

    class MockUploader {
      constructor() {}
      upload = vi.fn().mockResolvedValue(url);
    }

    const settings: any = {
      autoUploadOnFileAdd: true,
      cloudName: 'demo',
      apiKey: 'key',
      uploadPreset: 'preset',
      maxAutoUploadSizeMB: 2,
      debugLogs: true,
    };

    const spy = vi.spyOn(console, 'log');

    const result: any = await processFileCreate(app, settings, file as any, MockUploader as any, { saveSettings });

    expect(result).toBeTruthy();
    expect(result.uploadedUrl).toBe(url);
    expect(spy).toHaveBeenCalled();

    // ensure saveSettings persisted the uploadedFiles cache
    expect(saveSettings).toHaveBeenCalled();
    expect(persisted.uploadedFiles).toBeTruthy();
    expect(persisted.uploadedFiles[file.path]).toBeTruthy();

    spy.mockRestore();
  });

  it('shows missing preset notice only once per session', async () => {
    const file = { extension: 'png', name: 'image.png', path: 'notes/image.png' } as any;

    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new Uint8Array(100)),
        createBinary: vi.fn(),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
      },
      workspace: { getActiveViewOfType: vi.fn().mockReturnValue({ editor: { getValue: () => `![](${file.path})`, setValue: vi.fn() } }) },
    };

    const settings: any = { autoUploadOnFileAdd: true, cloudName: 'demo', maxAutoUploadSizeMB: 2 };

    // Ensure clean session state
    resetAutoUploadWarnings();

    const notify = vi.fn();

    await processFileCreate(app, settings, file as any, undefined, { notify });
    await processFileCreate(app, settings, file as any, undefined, { notify });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Auto-upload skipped'));

    // Reset and ensure it shows again
    resetAutoUploadWarnings();
    await processFileCreate(app, settings, file as any, undefined, { notify });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('uses cached url when file already uploaded', async () => {
    const file = { extension: 'png', name: 'image.png', path: 'notes/image.png' } as any;

    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new Uint8Array(0)),
        createBinary: vi.fn(),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
      },
      workspace: { getActiveViewOfType: vi.fn().mockReturnValue({ editor: { getValue: () => `![](${file.path})`, setValue: vi.fn() } }) },
    };

    // SHA1 of empty buffer
    const emptySha1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';

    const settings: any = {
      autoUploadOnFileAdd: true,
      cloudName: 'demo',
      apiKey: 'key',
      uploadPreset: 'preset',
      uploadedFiles: { [file.path]: { url: 'https://cached.example/image.png', hash: emptySha1, updatedAt: Date.now() } },
    };

    class MockUploader {
      constructor() {}
      upload = vi.fn();
    }

    const result: any = await processFileCreate(app, settings, file as any, MockUploader as any);

    expect(result).toBeTruthy();
    expect(result.cachedUrl).toBe('https://cached.example/image.png');
  });
});
