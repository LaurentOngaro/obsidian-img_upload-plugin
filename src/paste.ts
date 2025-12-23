import { CloudinaryUploader } from './cloudinary';

export interface PasteResult {
  url: string;
  filename: string;
}

/**
 * Read image from clipboard and upload using CloudinaryUploader.
 * - `uploader` can be injected for testing.
 * - `clipboard` can be injected for testing or environments where navigator.clipboard is not available.
 */
export async function pasteClipboardImage(
  settings: any,
  uploader?: { upload: (fileOrBlob: File | Blob, filename?: string) => Promise<string> },
  clipboard?: any
): Promise<PasteResult> {
  const clipboardAPI = clipboard ?? (navigator.clipboard as any);
  if (!clipboardAPI || !clipboardAPI.read) throw new Error('Clipboard read not supported');

  const items: any[] = await clipboardAPI.read();
  const clipboardItem = items.find((item) => item.types && item.types.some((t: string) => t.startsWith('image/')));
  if (!clipboardItem) throw new Error('No image in clipboard');

  const mime = clipboardItem.types.find((t: string) => t.startsWith('image/'));
  const blob: Blob = await clipboardItem.getType(mime);
  const ext = mime.split('/')[1] || 'png';
  const filename = `image-${Date.now()}.${ext}`;
  const file = new File([blob], filename, { type: mime });

  const uploaderInstance =
    uploader ??
    new CloudinaryUploader({
      cloud_name: settings.cloudName || settings.cloud_name,
      api_key: settings.apiKey || settings.api_key,
      upload_preset: settings.uploadPreset || settings.upload_preset,
      api_secret: settings.allowStoreApiSecret ? settings.apiSecret || settings.api_secret : undefined,
    });

  const url = await uploaderInstance.upload(file, filename);
  return { url, filename };
}
