import { CloudinaryUploader } from './cloudinary';
import { CloudinaryCache } from './cache';

export interface PasteResult {
  url: string;
  filename: string;
}

/**
 * Read image from clipboard and upload using CloudinaryUploader.
 * - `uploader` can be injected for testing.
 * - `clipboard` can be injected for testing or environments where navigator.clipboard is not available.
 * - `cache` can be injected to use a shared cache.
 */
export async function pasteClipboardImage(
  settings: any,
  uploader?: { upload: (fileOrBlob: File | Blob, filename?: string) => Promise<string> },
  clipboard?: any,
  cache?: CloudinaryCache
): Promise<PasteResult> {
  const clipboardAPI = clipboard ?? (typeof navigator !== 'undefined' ? (navigator as any).clipboard : undefined);
  if (!clipboardAPI || !clipboardAPI.read) throw new Error('Clipboard read not supported');

  if (settings?.debugLogs) console.log('[img_upload] pasteClipboardImage: attempting to read clipboard');

  const items: any[] = await clipboardAPI.read();
  const clipboardItem = items.find((item) => item.types && item.types.some((t: string) => t.startsWith('image/')));
  if (!clipboardItem) throw new Error('No image in clipboard');

  const mime = clipboardItem.types.find((t: string) => t.startsWith('image/'));
  const blob: Blob = await clipboardItem.getType(mime);
  const ext = mime.split('/')[1] || 'png';
  const filename = `image-${Date.now()}.${ext}`;
  // Some environments (Node in CI) don't expose `File`; fall back to Blob and pass filename to uploader
  const fileOrBlob: File | Blob = typeof File !== 'undefined' ? new File([blob], filename, { type: mime }) : blob;

  const uploaderInstance =
    uploader ??
    new CloudinaryUploader({
      cloud_name: settings.cloudName || settings.cloud_name,
      api_key: settings.apiKey || settings.api_key,
      upload_preset: settings.uploadPreset || settings.upload_preset,
      api_secret: settings.allowStoreApiSecret ? settings.apiSecret || settings.api_secret : undefined,
    });

  // Check cache if available
  let hash = '';
  if (cache) {
    const arrayBuffer = await blob.arrayBuffer();
    hash = await CloudinaryCache.calculateHash(arrayBuffer);
    const entry = await cache.getEntry(hash);
    if (entry) {
      if (settings?.debugLogs) console.log('[img_upload] Cache hit for clipboard image:', hash);
      return { url: entry.url, filename: `cached-${hash}.${ext}` };
    }
  }

  const url = await uploaderInstance.upload(fileOrBlob, filename);

  // Update cache if available
  if (cache && hash) {
    await cache.addEntry(hash, {
      url,
      public_id: null,
      filename,
      uploader: 'obsidian-plugin',
      uploaded_at: new Date().toISOString(),
    });
  }

  return { url, filename };
}
