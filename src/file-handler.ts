import { MarkdownView, TFile, TFolder } from 'obsidian';
import { CloudinaryUploader } from './cloudinary';
import { CloudinaryCache } from './cache';

// Track warnings shown per runtime session to avoid spamming the user on startup
let shownMissingAutoUploadWarning = false;

// Track files the plugin created during this session to avoid re-processing them
const pluginCreatedFiles = new Set<string>();

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

interface UploadResult {
  url?: string;
  fromCache: boolean;
  hash: string;
}

/**
 * Reset warning flags (useful for tests)
 */
export function resetAutoUploadWarnings() {
  shownMissingAutoUploadWarning = false;
  pluginCreatedFiles.clear();
  try {
    (processFileCreate as any).uploadingPaths = new Set<string>();
  } catch (e) {
    // noop
  }
}

/**
 * Mark a path as created by the plugin for a short window so the create handler ignores it.
 */
export function markPluginCreatedPath(path: string) {
  const normalized = path.replace(/\\/g, '/');
  pluginCreatedFiles.add(normalized);
  // Remove after 10 seconds to be safe
  setTimeout(() => pluginCreatedFiles.delete(normalized), 10000);
}

export async function processFileCreate(
  app: any,
  settings: any,
  file: TFile,
  uploaderCtor: any = CloudinaryUploader,
  options: { notify?: (msg: string) => void; saveSettings?: (s?: any) => Promise<void> } = {}
) {
  const notify = options.notify ?? (() => {});
  const saveSettings = options.saveSettings ?? (async () => {});

  if (!file || !file.extension) return;
  const ext = file.extension.toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return;

  // 1. STARTUP PROTECTION: Ignore files created more than 5 seconds ago
  const now = Date.now();
  const fileAgeMs = now - (file.stat?.ctime || now);
  if (fileAgeMs > 5000) {
    if (settings?.debugLogs) console.log('[img_upload] skipping old file (startup indexing):', file.path);
    return;
  }

  // 2. LOOP PROTECTION: Ignore files created by the plugin itself
  const normalizedPath = file.path.replace(/\\/g, '/');
  if (pluginCreatedFiles.has(normalizedPath)) {
    if (settings?.debugLogs) {
      console.log('[img_upload] skipping: file was created by the plugin itself', {
        path: file.path,
        normalizedPath,
        pluginCreatedFiles: Array.from(pluginCreatedFiles),
      });
    }
    return;
  }

  // 3. RE-ENTRY PROTECTION
  (processFileCreate as any).uploadingPaths = (processFileCreate as any).uploadingPaths || new Set<string>();
  if ((processFileCreate as any).uploadingPaths.has(file.path)) {
    if (settings?.debugLogs) console.log('[img_upload] skipping: already processing this path', file.path);
    return;
  }
  (processFileCreate as any).uploadingPaths.add(file.path);

  try {
    // 4. REFERENCE CHECK: Only process if the file is referenced in the ACTIVE markdown note
    let isReferenced = false;
    let attempts = 0;

    if (settings?.debugLogs) console.log('[img_upload] Waiting for reference in active note for:', file.path);

    while (attempts < 30) {
      const activeView = app.workspace.getActiveViewOfType?.(MarkdownView) as any;
      if (activeView && activeView.editor) {
        const content = activeView.editor.getValue() || '';
        const fileName = file.name;
        const baseName = file.basename;
        const path = file.path;

        // Check various ways Obsidian might link the file
        if (
          content.includes(path) ||
          content.includes(fileName) ||
          content.includes(`[[${fileName}]]`) ||
          content.includes(`[[${baseName}]]`) ||
          content.includes(`(${encodeURIComponent(path)})`) ||
          content.includes(`(${encodeURIComponent(fileName)})`) ||
          content.includes(`![[${fileName}]]`) ||
          content.includes(`![[${baseName}]]`)
        ) {
          isReferenced = true;
          if (settings?.debugLogs) console.log('[img_upload] Reference found for:', file.path, 'after', attempts, 'attempts');
          break;
        }
      }
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!isReferenced) {
      if (settings?.debugLogs) console.log('[img_upload] skipping: file not referenced in active note after 3s', file.path);
      return;
    }

    const data = await app.vault.readBinary(file);
    const fileHash = await computeSha1(new Uint8Array(data));

    // 5. UPLOAD LOGIC
    let uploadedUrl: string | undefined;
    let uploadResult: UploadResult | undefined;
    if (settings.autoUploadOnFileAdd && settings.cloudName) {
      if (settings?.debugLogs) console.log('[img_upload] Triggering handleUpload for:', file.path);
      uploadResult = await handleUpload(app, settings, file, data, uploaderCtor, notify, saveSettings, fileHash);
      uploadedUrl = uploadResult?.url;
    }

    // 6. LOCAL COPY LOGIC
    let localFile: TFile | undefined;
    if (settings.localCopyEnabled && settings.localCopyFolder) {
      const rawFolder = settings.localCopyFolder;
      let folder = '';
      try {
        folder = sanitizeFolderPath(rawFolder);
      } catch (e) {
        // Fallback: try a lenient normalization so we still attempt the copy instead of silently skipping
        folder = String(rawFolder || '')
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, '');
        if (settings?.debugLogs) console.error('[img_upload] Invalid local copy folder path, using fallback normalization', e);
      }

      if (folder) {
        const duplicateIllustrationFile = await findExistingIllustration(app, fileHash, folder, settings);
        if (duplicateIllustrationFile) {
          localFile = duplicateIllustrationFile;
          if (settings?.debugLogs) console.log('[img_upload] Local copy: identical file already present in destination folder, skipping new copy');
        }

        const normalizedFilePath = file.path.replace(/\\/g, '/');
        // Only copy if it's not already in the destination folder and no identical file exists there
        if (!normalizedFilePath.startsWith(`${folder}/`) && !duplicateIllustrationFile) {
          if (settings?.debugLogs) console.log('[img_upload] Triggering handleLocalCopy for:', file.path, 'to folder:', folder);
          const newPath = await handleLocalCopy(app, settings, file, data, notify);
          if (newPath) {
            localFile = app.vault.getAbstractFileByPath(newPath) as TFile;
          }
        } else if (settings?.debugLogs) {
          console.log('[img_upload] Skipping local copy: destination already satisfied', {
            file: file.path,
            folder,
            reason: duplicateIllustrationFile ? 'duplicate-in-destination' : 'already-in-destination',
          });
        }
      }
    }

    // 7. REFERENCE REPLACEMENT
    if (uploadedUrl) {
      // If we uploaded, replace the reference with the URL
      replaceImageReference(app, file, uploadedUrl, settings, notify, 'replaced');

      // If we made a local copy AND uploaded, we should also replace the reference to the local copy
      if (localFile) {
        replaceImageReference(app, localFile, uploadedUrl, settings, notify, 'replaced-local');
      }
    } else if (localFile) {
      // If we didn't upload but we made a local copy, replace the reference with the new local path
      replaceImageReference(app, file, localFile.path, settings, notify, 'copied');
    }

    if (settings.deleteSourceAfterUpload && uploadedUrl) {
      const localCopySatisfied = !settings.localCopyEnabled || !!localFile;
      if (localCopySatisfied && file.path !== localFile?.path) {
        try {
          await app.vault.delete(file);
          if (settings?.debugLogs) console.log('[img_upload] Deleted original file after upload', file.path);
        } catch (e) {
          if (settings?.debugLogs) console.error('[img_upload] Failed to delete original file', file.path, e);
        }
      }
    }
  } catch (err) {
    if (settings?.debugLogs) console.error('[img_upload] processFileCreate error', err);
  } finally {
    // Keep the path in uploadingPaths for a bit to prevent re-entry
    setTimeout(() => (processFileCreate as any).uploadingPaths?.delete(file.path), 2000);
  }
}

async function handleUpload(
  app: any,
  settings: any,
  file: TFile,
  data: ArrayBuffer,
  uploaderCtor: any,
  notify: (msg: string) => void,
  saveSettings: (s: any) => Promise<void>,
  precomputedHash?: string
): Promise<UploadResult> {
  const fileHash = precomputedHash ?? (await computeSha1(new Uint8Array(data)));

  if (settings?.debugLogs) console.log('[img_upload] Checking cache for:', file.path, 'hash:', fileHash);

  // 1. Check shared cache first (if configured)
  if (settings.cacheFilePath) {
    const sharedCache = new CloudinaryCache(app, settings.cacheFilePath);
    const entry = await sharedCache.getEntry(fileHash);
    if (entry) {
      if (settings?.debugLogs) console.log('[img_upload] Shared cache hit:', entry.url);
      return { url: entry.url, fromCache: true, hash: fileHash };
    }
  }

  const canUnsigned = !!settings.uploadPreset;
  const canSigned = !!(settings.allowStoreApiSecret && settings.apiSecret && settings.apiKey);
  if (!canUnsigned && !canSigned) {
    if (!shownMissingAutoUploadWarning) {
      notify('⚠️ Auto-upload skipped: configure an Upload preset or API Secret in settings.');
      shownMissingAutoUploadWarning = true;
    }
    return { url: undefined, fromCache: false, hash: fileHash };
  }

  const maxMB = settings.maxAutoUploadSizeMB ?? 0;
  if (maxMB > 0 && data.byteLength > maxMB * 1024 * 1024) {
    notify(`⚠️ Skipping auto-upload: file exceeds ${maxMB} MB`);
    return { url: undefined, fromCache: false, hash: fileHash };
  }

  try {
    const uploader = new uploaderCtor({
      cloud_name: settings.cloudName,
      api_key: settings.apiKey,
      upload_preset: settings.uploadPreset,
      api_secret: settings.allowStoreApiSecret ? settings.apiSecret : undefined,
    });

    if (settings?.debugLogs) console.log('[img_upload] Starting upload to Cloudinary for:', file.path);
    notify('⏳ Auto uploading image...');

    const url = await uploader.upload(new Blob([data], { type: getMimeFromExt(file.extension) }), file.name);

    if (settings?.debugLogs) console.log('[img_upload] Upload successful:', url);

    // Persist only to shared cache (if configured) — settings no longer stores per-plugin cache entries.
    // Update shared cache (if configured)
    if (settings.cacheFilePath) {
      const sharedCache = new CloudinaryCache(app, settings.cacheFilePath);
      await sharedCache.addEntry(fileHash, {
        url,
        public_id: null,
        filename: file.name,
        uploader: 'obsidian-plugin',
        uploaded_at: new Date().toISOString(),
      });
    }

    notify(`✅ Image uploaded: ${url}`);
    return { url, fromCache: false, hash: fileHash };
  } catch (e: any) {
    console.error('[img_upload] Upload failed:', e);
    notify(`❌ Upload failed: ${e.message || String(e)}`);
    return { url: undefined, fromCache: false, hash: fileHash };
  }
}

async function ensureFolderExists(app: any, folderPath: string) {
  const normalized = folderPath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  let currentPath = '';
  for (const part of parts) {
    if (!part) continue;
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    if (!(await app.vault.adapter.exists(currentPath))) {
      await app.vault.createFolder(currentPath);
    }
  }
}

async function handleLocalCopy(app: any, settings: any, file: TFile, data: ArrayBuffer, notify: (msg: string) => void) {
  try {
    const folder = sanitizeFolderPath(settings.localCopyFolder);

    if (folder) {
      await ensureFolderExists(app, folder);
    }

    const destPath = folder ? `${folder}/${file.name}` : file.name;
    const normalizedDest = destPath.replace(/\\/g, '/');

    if (await app.vault.adapter.exists(normalizedDest)) {
      // Check if the existing file has the same content to avoid unnecessary duplicates
      const existingFile = app.vault.getAbstractFileByPath(normalizedDest);
      if (existingFile instanceof TFile) {
        const existingData = await app.vault.readBinary(existingFile);
        const existingHash = await computeSha1(new Uint8Array(existingData));
        const newHash = await computeSha1(new Uint8Array(data));
        if (existingHash === newHash) {
          if (settings?.debugLogs) console.log('[img_upload] Local copy: identical file already exists at:', normalizedDest);
          return normalizedDest;
        }
      }

      const timestamp = Date.now();
      const finalPath = normalizedDest.replace(`.${file.extension}`, `-${timestamp}.${file.extension}`);
      if (settings?.debugLogs) console.log('[img_upload] Local copy: file exists but different content, using timestamped path:', finalPath);
      markPluginCreatedPath(finalPath);
      await app.vault.createBinary(finalPath, data);
      return finalPath;
    } else {
      if (settings?.debugLogs) console.log('[img_upload] Local copy: creating file at:', normalizedDest);
      markPluginCreatedPath(normalizedDest);
      await app.vault.createBinary(normalizedDest, data);
      return normalizedDest;
    }
  } catch (e) {
    if (settings?.debugLogs) console.error('[img_upload] handleLocalCopy error', e);
    return undefined;
  }
}

async function findExistingIllustration(app: any, targetHash: string, folderPath: string, settings: any): Promise<TFile | undefined> {
  if (!folderPath) return undefined;

  try {
    const exists = await app.vault.adapter.exists(folderPath);
    if (!exists) {
      await ensureFolderExists(app, folderPath);
    }
  } catch (e) {
    if (settings?.debugLogs) console.error('[img_upload] Failed to ensure local copy folder exists', e);
    return undefined;
  }

  const illustrationFolder = app.vault.getAbstractFileByPath(folderPath) as any;
  const children = illustrationFolder && (illustrationFolder as any).children;
  if (!children || !Array.isArray(children)) return undefined;

  for (const child of children) {
    if (child instanceof TFile && IMAGE_EXTENSIONS.has(child.extension?.toLowerCase?.())) {
      try {
        const existingData = await app.vault.readBinary(child);
        const existingHash = await computeSha1(new Uint8Array(existingData));
        if (existingHash === targetHash) return child;
      } catch (e) {
        if (settings?.debugLogs) console.error('[img_upload] Failed to inspect _Illustrations file', child?.path, e);
      }
    }
  }

  return undefined;
}

async function computeSha1(buf: Uint8Array): Promise<string> {
  const cryptoApi = getWebCrypto();
  if (!cryptoApi?.subtle) throw new Error('WebCrypto not available');
  const hashed = await cryptoApi.subtle.digest('SHA-1', buf as any);
  return Array.from(new Uint8Array(hashed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getWebCrypto(): Crypto | undefined {
  const gc = (globalThis as any).crypto;
  if (gc?.subtle) return gc as Crypto;
  try {
    // Avoid bundler resolution by constructing require at runtime
    const req = (globalThis as any).require ?? (0, (globalThis as any).eval)('require');
    const nodeCrypto = req ? req('node:crypto') ?? req('crypto') : undefined;
    return nodeCrypto?.webcrypto as Crypto | undefined;
  } catch (e) {
    return undefined;
  }
}

function getMimeFromExt(ext: string): string {
  switch ((ext || '').toLowerCase()) {
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

function escapeRegExp(str: string) {
  if (!str) return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceImageReference(
  app: any,
  file: TFile,
  replacementUrl: string,
  settings: any,
  notify: (msg: string) => void,
  logPrefix: string
): boolean {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || !view.editor || typeof (view as any).editor.setValue !== 'function') return false;

  const content = view.editor.getValue();
  const escPath = escapeRegExp(file.path);
  const escName = escapeRegExp(file.name);
  const escBase = escapeRegExp(file.basename);

  // Also handle encoded versions (spaces -> %20, etc)
  const encPath = escapeRegExp(encodeURI(file.path));
  const encName = escapeRegExp(encodeURI(file.name));

  let newContent = content;

  // 1. Standard Markdown links: ![alt](path)
  const markdownRegexes = [
    new RegExp(`!\\[([^\\]]*)\\]\\(${escPath}\\)`, 'g'),
    new RegExp(`!\\[([^\\]]*)\\]\\(${escName}\\)`, 'g'),
    new RegExp(`!\\[([^\\]]*)\\]\\(${encPath}\\)`, 'g'),
    new RegExp(`!\\[([^\\]]*)\\]\\(${encName}\\)`, 'g'),
    new RegExp(`!\\[([^\\]]*)\\]\\([^)]*${escName}[^)]*\\)`, 'g'),
  ];

  // 2. Wikilinks: ![[path]] or ![[name]] or ![[name|alt]]
  const wikiRegexes = [
    new RegExp(`!\\[\\[${escPath}(\\|[^\\]]*)?\\]\\]`, 'g'),
    new RegExp(`!\\[\\[${escName}(\\|[^\\]]*)?\\]\\]`, 'g'),
    new RegExp(`!\\[\\[${escBase}(\\|[^\\]]*)?\\]\\]`, 'g'),
    new RegExp(`!\\[\\[${encPath}(\\|[^\\]]*)?\\]\\]`, 'g'),
    new RegExp(`!\\[\\[${encName}(\\|[^\\]]*)?\\]\\]`, 'g'),
  ];

  for (const regex of [...markdownRegexes, ...wikiRegexes]) {
    if (newContent.match(regex)) {
      if (settings?.debugLogs) console.log(`[img_upload] ${logPrefix}: found match with regex:`, regex.source);
      // For wikilinks, we replace the whole ![[...]] with ![alt](url)
      // If there's an alt text in wikilink ![[name|alt]], we try to preserve it
      newContent = newContent.replace(regex, (match: string, alt: string) => {
        const altText = alt ? alt.replace(/^\|/, '') : '';
        return `![${altText}](${replacementUrl})`;
      });
    }
  }

  if (newContent !== content) {
    view.editor.setValue(newContent);
    if (settings?.debugLogs) console.log(`[img_upload] ${logPrefix}: replaced reference in note`);
    return true;
  }

  if (settings?.debugLogs) console.log(`[img_upload] ${logPrefix}: no reference found in note for`, file.path);
  return false;
}

function sanitizeFolderPath(value: string): string {
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/');
  if (/\.\.|^[A-Za-z]:[/\\]|^[/\\]/.test(normalized)) throw new Error('Invalid folder path');
  return normalized.replace(/^[/\\]+|[/\\]+$/g, '');
}
