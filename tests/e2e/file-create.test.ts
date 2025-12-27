import { describe, it, expect, vi } from 'vitest';
import { processFileCreate } from '../../src/file-handler';

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
      workspace: { getActiveViewOfType: vi.fn().mockReturnValue(undefined) },
    };

    const url = 'https://res.cloudinary.com/demo/image/upload/v12345/image.png';

    class MockUploader {
      constructor() {}
      upload = vi.fn().mockResolvedValue(url);
    }

    const settings: any = { autoUploadOnFileAdd: true, cloudName: 'demo', apiKey: 'key', maxAutoUploadSizeMB: 2 };

    const result: any = await processFileCreate(app, settings, file as any, MockUploader as any);

    expect(result).toBeTruthy();
    expect(result.uploadedUrl).toBe(url);
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
      workspace: { getActiveViewOfType: vi.fn().mockReturnValue(undefined) },
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
      workspace: { getActiveViewOfType: vi.fn().mockReturnValue(undefined) },
    };

    const url = 'https://res.cloudinary.com/demo/image/upload/v12345/image.png';

    class MockUploader {
      constructor() {}
      upload = vi.fn().mockResolvedValue(url);
    }

    const settings: any = { autoUploadOnFileAdd: true, cloudName: 'demo', apiKey: 'key', maxAutoUploadSizeMB: 2, debugLogs: true };

    const spy = vi.spyOn(console, 'log');

    const result: any = await processFileCreate(app, settings, file as any, MockUploader as any);

    expect(result).toBeTruthy();
    expect(result.uploadedUrl).toBe(url);
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});
