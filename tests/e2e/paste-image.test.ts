import { describe, it, expect, vi } from 'vitest';
import { pasteClipboardImage } from '../../src/paste';

describe('pasteClipboardImage', () => {
  it('uploads image from clipboard using provided uploader', async () => {
    const blob = new Blob(['dummy'], { type: 'image/png' });
    const clipboardItem = {
      types: ['image/png'],
      getType: async (mime: string) => blob,
    };
    const clipboard = { read: async () => [clipboardItem] };

    const uploadMock = vi.fn().mockResolvedValue('https://res.cloudinary.com/demo/image/upload/v12345/image.png');
    const uploader = { upload: uploadMock };

    const settings = { cloudName: 'demo', apiKey: 'key', uploadPreset: 'preset', debugLogs: true };

    const result = await pasteClipboardImage(settings, uploader as any, clipboard as any);

    expect(uploadMock).toHaveBeenCalled();
    expect(result.url).toBe('https://res.cloudinary.com/demo/image/upload/v12345/image.png');
    expect(result.filename).toMatch(/^image-\d+\.png$/);
  });

  it('throws when clipboard not supported', async () => {
    await expect(pasteClipboardImage({ debugLogs: true }, undefined, undefined)).rejects.toThrow('Clipboard read not supported');
  });

  it('throws when no image in clipboard', async () => {
    const clipboard = { read: async () => [{ types: ['text/plain'], getType: async () => new Blob(['a'], { type: 'text/plain' }) }] };
    await expect(pasteClipboardImage({ debugLogs: true }, undefined, clipboard as any)).rejects.toThrow('No image in clipboard');
  });
});
