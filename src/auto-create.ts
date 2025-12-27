import { CloudinaryUploader, ensureUploadPreset } from './cloudinary';

// Per-session guard to avoid repeated network attempts
let triedAutoCreatePreset = false;
let shownAutoCreatePresetWarning = false;

export function resetAutoCreatePresetState() {
  triedAutoCreatePreset = false;
  shownAutoCreatePresetWarning = false;
}

/**
 * Try to auto-create an upload preset at most once per session. Designed to be small and testable
 * without importing the entire Plugin class. Returns the preset name if created or available.
 */
export async function tryAutoCreatePresetOnce(
  settings: any,
  uploaderCtor: any = CloudinaryUploader,
  saveSettings: (s?: any) => Promise<void> = async () => {},
  notify: (msg: string) => void = () => {},
  debugLogs = false
): Promise<string | undefined> {
  if (triedAutoCreatePreset) return undefined;

  // Only attempt when auto-upload is enabled and credentials look present and no preset is configured
  if (!settings?.autoUploadOnFileAdd || !settings?.cloudName || settings.uploadPreset) return undefined;
  if (!(settings.allowStoreApiSecret && settings.apiKey && settings.apiSecret)) return undefined;

  triedAutoCreatePreset = true;
  try {
    if (debugLogs) console.log('[img_upload] tryAutoCreatePresetOnce: attempting to create preset');
    const res = await ensureUploadPreset(settings, uploaderCtor);
    if (res) {
      settings.uploadPreset = res;
      await saveSettings(settings);
      notify(`✅ Created/Retrieved unsigned upload preset '${res}' and saved to settings`);
      return res;
    }
    return undefined;
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!shownAutoCreatePresetWarning) {
      shownAutoCreatePresetWarning = true;
      notify(`⚠️ Could not auto-create upload preset: ${msg}`);
    }
    if (debugLogs) console.error('[img_upload] tryAutoCreatePresetOnce error', e);
    return undefined;
  }
}
