import { CloudinaryUploader } from './cloudinary';

export async function processFileCreate(
  app: any,
  settings: any,
  file: any,
  uploaderCtor: any = CloudinaryUploader,
  options: { notify?: (msg: string) => void } = {}
) {
  const notify = options.notify ?? (() => {});

  if (!file || !file.extension) return;
  const ext = (file.extension || '').toLowerCase();
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
  if (!imageExts.includes(ext)) return;

  const data = await app.vault.readBinary(file);
  const sizeBytes = (data as any)?.byteLength ?? (data as any)?.length ?? 0;

  if (settings.localCopyEnabled && settings.localCopyFolder) {
    try {
      const folder = sanitizeFolderPath(settings.localCopyFolder);
      const destPath = folder ? `${folder}/${file.name}` : file.name;

      const exists = await app.vault.adapter.exists(destPath);
      let finalPath = destPath;
      if (exists) {
        const timestamp = Date.now();
        finalPath = destPath.replace(`.${ext}`, `-${timestamp}.${ext}`);
      }

      await app.vault.createBinary(finalPath, data as any);
      notify(`✅ Copied image to ${finalPath}`);
    } catch (e) {
      notify('❌ Could not copy image locally: invalid folder path or permission error.');
    }
  }

  if (settings.autoUploadOnFileAdd && settings.cloudName && (settings.apiKey || settings.uploadPreset)) {
    const maxMB = settings.maxAutoUploadSizeMB ?? 0;
    if (maxMB > 0 && sizeBytes > maxMB * 1024 * 1024) {
      notify(`⚠️ Skipping auto-upload: file exceeds max size (${maxMB} MB)`);
      return;
    }

    const mime = getMimeFromExt(ext);
    const blob = new Blob([data], { type: mime });

    function getMimeFromExt(ext2: string): string {
      switch ((ext2 || '').toLowerCase()) {
        case 'jpg':
        case 'jpeg':
          return 'image/jpeg';
        case 'png':
          return 'image/png';
        case 'gif':
          return 'image/gif';
        case 'webp':
          return 'image/webp';
        case 'svg':
          return 'image/svg+xml';
        default:
          return 'application/octet-stream';
      }
    }

    while (concurrentUploads >= MAX_CONCURRENT_UPLOADS) {
      // simple backoff
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 200));
    }

    concurrentUploads++;
    try {
      const uploader = new uploaderCtor({
        cloud_name: settings.cloudName,
        api_key: settings.apiKey,
        upload_preset: settings.uploadPreset,
      });

      notify('⏳ Auto uploading image...');
      const url = await uploader.upload(blob, file.name);
      notify(`✅ Image uploaded: ${url}`);

      const view = app.workspace.getActiveViewOfType?.(null);
      if (view && view.editor) {
        const content = view.editor.getValue();
        const esc = escapeRegExp(file.path);
        const imageRegex = new RegExp(`!\\[([^\\]]*)\\]\\(${esc}\\)`, 'g');
        if (imageRegex.test(content)) {
          const newContent = content.replace(imageRegex, `![$1](${url})`);
          view.editor.setValue(newContent);
          notify('🔁 Replaced local image reference with Cloudinary URL in the current editor.');
        }
      }

      return { uploadedUrl: url };
    } finally {
      concurrentUploads--;
    }
  }
}

let concurrentUploads = 0;
const MAX_CONCURRENT_UPLOADS = 3;

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeFolderPath(value: string): string {
  if (!value) return '';
  if (/\.\.|^[A-Za-z]:\\\\|^\//.test(value)) {
    throw new Error('Invalid folder path');
  }
  return value.replace(/^\/+|\/+$/g, '');
}
