import { CloudinaryUploader } from './cloudinary';

// Track warnings shown per runtime session to avoid spamming the user on startup
let shownMissingAutoUploadWarning = false;
let shownInvalidUploadPresetWarning = false;

// Track files the plugin created during this session to avoid re-processing them
const pluginCreatedFiles = new Set<string>();

/**
 * Reset warning flags (useful for tests)
 */
export function resetAutoUploadWarnings() {
  shownMissingAutoUploadWarning = false;
  shownInvalidUploadPresetWarning = false;
  pluginCreatedFiles.clear();
}

/**
 * Mark a path as created by the plugin for a short window so the create handler ignores it.
 */
export function markPluginCreatedPath(path: string) {
  pluginCreatedFiles.add(path);
  // Remove after 30s to avoid memory growth and to only ignore immediate re-creates
  setTimeout(() => pluginCreatedFiles.delete(path), 30 * 1000);
}

export async function processFileCreate(
  app: any,
  settings: any,
  file: any,
  uploaderCtor: any = CloudinaryUploader,
  options: { notify?: (msg: string) => void } = {}
) {
  const notify = options.notify ?? (() => {});

  if (settings?.debugLogs) console.log('[img_upload] processFileCreate called', { file, settings });

  if (!file || !file.extension) {
    if (settings?.debugLogs) console.log('[img_upload] skipping: missing extension or file', file);
    return;
  }
  const ext = (file.extension || '').toLowerCase();
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
  if (!imageExts.includes(ext)) {
    if (settings?.debugLogs) console.log('[img_upload] skipping: unsupported extension', ext);
    return;
  }

  const data = await app.vault.readBinary(file);
  const sizeBytes = (data as any)?.byteLength ?? (data as any)?.length ?? 0;
  if (settings?.debugLogs) console.log('[img_upload] file size bytes:', sizeBytes, 'maxMB:', settings.maxAutoUploadSizeMB);

  // Ignore files the plugin just created to avoid infinite loops where a copied file triggers another copy/upload
  if (pluginCreatedFiles.has(file.path)) {
    if (settings?.debugLogs) console.log('[img_upload] skipping: file created by plugin itself', file.path);
    return;
  }

  // If a local copy folder is configured, skip files created inside that folder (we don't want to act on our own copies)
  if (settings.localCopyEnabled && settings.localCopyFolder) {
    try {
      const folder = sanitizeFolderPath(settings.localCopyFolder);
      if (folder && file.path.startsWith(`${folder}/`)) {
        if (settings?.debugLogs) console.log('[img_upload] skipping: file is inside localCopyFolder', file.path);
        return;
      }
    } catch (e) {
      // invalid folder path will be handled later when attempting to write, ignore here
    }
  }

  // Local copy will be performed after a successful upload. If auto-upload is disabled we'll perform the copy later in the function.

  // Auto-upload guard: only attempt auto-upload if we have an upload preset (unsigned) or signed credentials (api_secret + api_key)
  // Auto-upload guard: only attempt auto-upload if we have an upload preset (unsigned) or signed credentials (api_secret + api_key)
  if (settings.autoUploadOnFileAdd && settings.cloudName) {
    // Only attempt auto-upload for files that are referenced in an open note or the active editor. This keeps uploads scoped to
    // files you're actually editing or adding to notes (prevents mass uploads during vault indexing).
    try {
      const leaves = (app.workspace.getLeavesOfType && app.workspace.getLeavesOfType('markdown')) || [];
      const activeView = app.workspace.getActiveViewOfType?.(null) as any;
      const hasOpenNotes = leaves.length > 0 || (!!activeView && activeView.editor);

      if (hasOpenNotes) {
        let referenced = false;
        for (const leaf of leaves) {
          const view = (leaf.view as any);
          if (view && view.editor) {
            const content = view.editor.getValue() || '';
            if (content.includes(file.path) || content.includes(file.name)) {
              referenced = true;
              break;
            }
          }
        }

        // Also check the active view just in case
        if (!referenced && activeView && activeView.editor) {
          const content = activeView.editor.getValue() || '';
          if (content.includes(file.path) || content.includes(file.name)) referenced = true;
        }

        if (!referenced) {
          if (settings?.debugLogs) console.log('[img_upload] skipping upload: file not referenced in open notes or active editor', file.path);
          return;
        }
      } else {
        // No open notes (e.g., user added files while not viewing notes): proceed with upload
        if (settings?.debugLogs) console.log('[img_upload] no open notes found; proceeding with upload for', file.path);
      }
    } catch (e) {
      if (settings?.debugLogs) console.error('[img_upload] reference check error', e);
      // If reference check fails for any reason, do not block auto-upload; fall through to existing checks
    }
    const canUnsigned = !!settings.uploadPreset;
    const canSigned = !!(settings.allowStoreApiSecret && settings.apiSecret && settings.apiKey);
    if (!canUnsigned && !canSigned) {
      if (settings?.debugLogs) console.error('[img_upload] auto-upload skipped: missing upload_preset and API secret for signed uploads');
      // Notify only once per session to avoid repeated notices on startup
      if (!shownMissingAutoUploadWarning) {
        notify(
          '⚠️ Auto-upload skipped: configure an Upload preset (for unsigned uploads) or enable & set API Secret (for signed uploads) in plugin settings.'
        );
        shownMissingAutoUploadWarning = true;
      }
      return;
    }
    const maxMB = settings.maxAutoUploadSizeMB ?? 0;
    if (maxMB > 0 && sizeBytes > maxMB * 1024 * 1024) {
      if (settings?.debugLogs) console.log('[img_upload] skipping upload: exceeds size limit', { sizeBytes, maxMB });
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

      if (settings?.debugLogs) console.log('[img_upload] starting upload for', file.name);
      notify('⏳ Auto uploading image...');
      const url = await uploader.upload(blob, file.name);
      if (settings?.debugLogs) console.log('[img_upload] upload success', url);
      notify(`✅ Image uploaded: ${url}`);
      // After successful upload, perform local copy if enabled
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

          // Mark the path as created by the plugin before creating it to avoid our create handler re-processing this file
          try {
            markPluginCreatedPath(finalPath);
          } catch (err) {
            // best-effort; ignore errors in marking
            if (settings?.debugLogs) console.error('[img_upload] markPluginCreatedPath error', err);
          }

          await app.vault.createBinary(finalPath, data as any);
          if (settings?.debugLogs) console.log('[img_upload] copied local file to', finalPath);
          notify(`✅ Copied image to ${finalPath}`);
        } catch (e) {
          if (settings?.debugLogs) console.error('[img_upload] copy local error after upload', e);
          notify('❌ Could not copy image locally after upload: invalid folder path or permission error.');
        }
      }
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
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e);
      if (settings?.debugLogs) console.error('[img_upload] upload error', e);

      // Common Cloudinary guidance
      if (typeof message === 'string' && /upload preset|unsigned/i.test(message)) {
        // Show this guidance only once per session to avoid repeated notices when a preset exists but is not
        // configured for unsigned uploads (Cloudinary returns 400 for each attempted file upload).
        if (!shownInvalidUploadPresetWarning) {
          shownInvalidUploadPresetWarning = true;
          notify(
            '❌ Upload failed: Upload preset is missing or unsigned upload not allowed. Check Settings → Upload preset or use the "Create preset (auto)" button (requires API Key & Secret).'
          );
        } else if (settings?.debugLogs) {
          console.error('[img_upload] upload error (invalid preset) - repeated error suppressed', e);
        }
      } else if (typeof message === 'string' && /signature|api_secret/i.test(message)) {
        notify('❌ Upload failed: signature error. Verify API Key/API Secret and signing configuration.');
      } else {
        notify(`❌ Upload failed: ${message}`);
      }
      return;
    } finally {
      concurrentUploads--;
    }
  }

  // If auto-upload is disabled but localCopy is enabled, perform local copy
  if (!settings.autoUploadOnFileAdd && settings.localCopyEnabled && settings.localCopyFolder) {
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
      if (settings?.debugLogs) console.log('[img_upload] copied local file to', finalPath);
      notify(`✅ Copied image to ${finalPath}`);
    } catch (e) {
      if (settings?.debugLogs) console.error('[img_upload] copy local error', e);
      notify('❌ Could not copy image locally: invalid folder path or permission error.');
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
