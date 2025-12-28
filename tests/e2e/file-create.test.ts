import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFileCreate, resetAutoUploadWarnings } from '../../src/file-handler';

describe('processFileCreate', () => {
  beforeEach(() => {
    // Reset all session state before each test
    resetAutoUploadWarnings();
  });

  it('copies file locally when enabled and folder valid', async () => {
    const file = {
      extension: 'png',
      name: 'image.png',
      basename: 'image',
      path: 'notes/image.png',
      stat: { ctime: Date.now() },
    } as any;

    const created: Record<string, Uint8Array> = {};
    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        createBinary: vi.fn().mockImplementation(async (path: string, data: any) => {
          created[path] = data as Uint8Array;
        }),
        createFolder: vi.fn().mockResolvedValue(undefined),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
        getAbstractFileByPath: vi.fn().mockImplementation((path: string) => ({
          path,
          name: path.split('/').pop(),
          basename: path.split('/').pop()?.split('.').shift(),
          extension: path.split('.').pop(),
        })),
      },
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue({
          editor: { getValue: () => `![image](${file.path})` },
        }),
      },
    };

    const settings: any = { localCopyEnabled: true, localCopyFolder: 'assets/images' };

    await processFileCreate(app, settings, file as any);

    expect(Object.keys(created).length).toBe(1);
    expect(created['assets/images/image.png']).toBeTruthy();
  });

  it('uploads file when auto-upload enabled and below size limit', async () => {
    const file = {
      extension: 'png',
      name: 'image.png',
      basename: 'image',
      path: 'notes/image.png',
      stat: { ctime: Date.now() },
    } as any;

    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new Uint8Array(1000)),
        createBinary: vi.fn(),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
      },
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue({
          editor: { getValue: () => `![](${file.path})`, setValue: vi.fn() },
        }),
      },
    };

    const url = 'https://res.cloudinary.com/demo/image/upload/v12345/image.png';

    class MockUploader {
      constructor() {}
      upload = vi.fn().mockResolvedValue(url);
    }

    const settings: any = { autoUploadOnFileAdd: true, cloudName: 'demo', apiKey: 'key', uploadPreset: 'preset', maxAutoUploadSizeMB: 2 };

    const result: any = await processFileCreate(app, settings, file as any, MockUploader as any);

    // result is now undefined because processFileCreate doesn't return anything anymore (it's fire-and-forget)
    // but we can check if settings.uploadedFiles was updated
    expect(settings.uploadedFiles).toBeTruthy();
    expect(settings.uploadedFiles[file.path]).toBeTruthy();
    expect(settings.uploadedFiles[file.path].url).toBe(url);
  });

  it('skips upload when file exceeds size limit', async () => {
    const file = {
      extension: 'png',
      name: 'big.png',
      basename: 'big',
      path: 'notes/big.png',
      stat: { ctime: Date.now() },
    } as any;

    const bigData = new Uint8Array(5 * 1024 * 1024); // 5 MB
    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(bigData),
        createBinary: vi.fn(),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
      },
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue({
          editor: { getValue: () => `![](${file.path})`, setValue: vi.fn() },
        }),
      },
    };

    class MockUploader {
      constructor() {}
      upload = vi.fn();
    }

    const settings: any = { autoUploadOnFileAdd: true, cloudName: 'demo', apiKey: 'key', uploadPreset: 'preset', maxAutoUploadSizeMB: 1 };

    await processFileCreate(app, settings, file as any, MockUploader as any);

    expect(settings.uploadedFiles).toBeUndefined();
  });

  it('works with debugLogs enabled and still uploads', async () => {
    const file = {
      extension: 'png',
      name: 'image.png',
      basename: 'image',
      path: 'notes/image.png',
      stat: { ctime: Date.now() },
    } as any;

    const app: any = {
      vault: {
        readBinary: vi.fn().mockResolvedValue(new Uint8Array(1000)),
        createBinary: vi.fn(),
        adapter: { exists: vi.fn().mockResolvedValue(false) },
      },
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue({
          editor: { getValue: () => `![](${file.path})`, setValue: vi.fn() },
        }),
      },
    };

    const url = 'https://res.cloudinary.com/demo/image/upload/v12345/image.png';
    class MockUploader {
      constructor() {}
      upload = vi.fn().mockResolvedValue(url);
    }

    const settings: any = { autoUploadOnFileAdd: true, cloudName: 'demo', apiKey: 'key', uploadPreset: 'preset', debugLogs: true };

    await processFileCreate(app, settings, file as any, MockUploader as any);

    expect(settings.uploadedFiles[file.path].url).toBe(url);
  });
});
