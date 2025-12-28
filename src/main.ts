import { Plugin, PluginSettingTab, App, Setting, Notice, MarkdownView, TFile, Modal } from 'obsidian';
import { BUILD_INFO } from './generated-build-info';
import CloudinarySettingTab from './settings';
import { CloudinaryUploader } from './cloudinary';
import { pasteClipboardImage } from './paste';
import { processFileCreate } from './file-handler';
import { CloudinaryCache } from './cache';

interface CloudinaryPluginSettings {
  cloudName: string;
  apiKey: string;
  apiSecret?: string;
  uploadPreset?: string;
  autoUploadOnFileAdd?: boolean;
  localCopyEnabled?: boolean;
  localCopyFolder?: string;
  maxAutoUploadSizeMB?: number;
  allowStoreApiSecret?: boolean;
  debugLogs?: boolean;
  cacheFilePath?: string;
}

export { processFileCreate } from './file-handler';

const DEFAULT_SETTINGS: CloudinaryPluginSettings = {
  cloudName: '',
  apiKey: '',
  apiSecret: '',
  uploadPreset: '',
  autoUploadOnFileAdd: false,
  localCopyEnabled: false,
  localCopyFolder: '',
  maxAutoUploadSizeMB: 10,
  debugLogs: false,
  cacheFilePath: '_Helpers/cloudinary_cache.json',
};

export default class CloudinaryPlugin extends Plugin {
  settings: CloudinaryPluginSettings = DEFAULT_SETTINGS;
  private uploader?: CloudinaryUploader;
  private buildInfo = { version: '1.0.0', buildNumber: 0 };

  async onload() {
    await this.loadSettings();
    await this.loadBuildInfo();

    this.addCommand({ id: 'cloudinary-paste-image', name: 'Paste image to Cloudinary', callback: () => this.pasteImage() });

    this.addCommand({
      id: 'cloudinary-paste-hotkey',
      name: 'Paste image (Quick)',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'v' }],
      callback: () => this.pasteImage(),
    });

    this.addSettingTab(new CloudinarySettingTab(this.app, this));

    this.addCommand({
      id: 'img-upload-clear-shared-cache',
      name: 'Clear shared cache (Image Upload)',
      callback: async () => {
        if (!this.settings.cacheFilePath) {
          new Notice('⚠️ No shared cache configured. Set "Shared cache file path" in settings.');
          return;
        }
        const sharedCache = new CloudinaryCache(this.app, this.settings.cacheFilePath);
        await sharedCache.writeCache({});
        new Notice('✅ Shared cache cleared');
      },
    });

    this.addCommand({
      id: 'img-upload-export-shared-cache',
      name: 'Export shared cache (copy JSON to clipboard)',
      callback: async () => {
        if (!this.settings.cacheFilePath) {
          new Notice('⚠️ No shared cache configured. Set "Shared cache file path" in settings.');
          return;
        }
        const sharedCache = new CloudinaryCache(this.app, this.settings.cacheFilePath);
        const cache = await sharedCache.readCache();
        const json = JSON.stringify(cache || {}, null, 2);
        try {
          await (navigator as any).clipboard.writeText(json);
          new Notice('✅ Shared cache copied to clipboard');
        } catch (e) {
          new ExportModal(this.app, json).open();
        }
      },
    });

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        (this as any).handleFileCreate?.(file);
      })
    );
  }

  async pasteImage() {
    if (!this.settings.cloudName || (!this.settings.apiKey && !this.settings.uploadPreset)) {
      new Notice('❌ Configure Cloudinary credentials first! (Cloud name + API key or upload preset)');
      return;
    }
    try {
      if (this.settings.debugLogs) console.log('[img_upload] pasteImage: starting paste upload', { settings: this.settings });
      new Notice('⏳ Uploading...');
      const cache = this.settings.cacheFilePath ? new CloudinaryCache(this.app, this.settings.cacheFilePath) : undefined;
      const { url } = await pasteClipboardImage(this.settings, undefined, (navigator as any).clipboard, cache);
      if (this.settings.debugLogs) console.log('[img_upload] pasteImage: upload result', url);
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view && (view as any).editor) (view as any).editor.replaceSelection(`![image](${url})`);
      else new Notice(`✅ Image uploaded: ${url}`);
      new Notice('✅ Image uploaded!');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`❌ Error: ${message}`);
    }
  }

  private static _triedAutoCreatePreset = false;
  private static _shownAutoCreatePresetWarning = false;
  static resetAutoCreatePresetState() {
    CloudinaryPlugin._triedAutoCreatePreset = false;
    CloudinaryPlugin._shownAutoCreatePresetWarning = false;
  }

  async handleFileCreate(file: TFile) {
    try {
      if (this.settings.debugLogs) console.log('[img_upload] handleFileCreate called', file);
      const { tryAutoCreatePresetOnce } = await import('./auto-create');
      await tryAutoCreatePresetOnce(
        this.settings,
        CloudinaryUploader as any,
        this.saveSettings.bind(this),
        (m: string) => new Notice(m),
        this.settings.debugLogs
      );
      const notifyFn = (m: string) => {
        if (this.settings.debugLogs) console.log('[img_upload] notice:', m);
        new Notice(m);
      };
      await processFileCreate(this.app, this.settings, file, CloudinaryUploader, { notify: notifyFn, saveSettings: this.saveSettings.bind(this) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`❌ Auto-upload error: ${msg}`);
      if (this.settings.debugLogs) console.error('[img_upload] handleFileCreate error', err);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  async loadBuildInfo() {
    try {
      try {
        if (typeof BUILD_INFO !== 'undefined' && BUILD_INFO && BUILD_INFO.version) {
          this.buildInfo = BUILD_INFO as any;
          if (this.settings?.debugLogs) console.log('[img_upload] loaded build info from embedded BUILD_INFO', this.buildInfo);
          return;
        }
      } catch (e) {
        /* ignore */
      }
      const possiblePaths = ['/build-info.json', './build-info.json', 'build-info.json'];
      for (const path of possiblePaths) {
        try {
          const response = await fetch(path);
          if (response.ok) {
            const data = await response.json();
            if (data && data.version && data.buildNumber !== undefined) {
              this.buildInfo = data;
              if (this.settings?.debugLogs) console.log('[img_upload] loaded build info from', path, ':', this.buildInfo);
              return;
            }
          }
        } catch (e) {
          if (this.settings?.debugLogs) console.log('[img_upload] could not load build info from', path, e);
        }
      }
      if (this.settings?.debugLogs) console.log('[img_upload] build-info.json not found, using defaults');
    } catch (e) {
      if (this.settings?.debugLogs) console.log('[img_upload] error loading build info:', e);
    }
  }
  getBuildString() {
    return `build v${this.buildInfo.version} #${this.buildInfo.buildNumber}`;
  }
}

class ExportModal extends Modal {
  private readonly text: string;
  constructor(app: App, text: string) {
    super(app);
    this.text = text;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Export upload cache (JSON)' });
    const pre = contentEl.createEl('pre');
    pre.setText(this.text);
    const row = contentEl.createDiv({ cls: 'setting-item' });
    const copyBtn = row.createEl('button', { text: 'Copy to clipboard' });
    copyBtn.addEventListener('click', async () => {
      try {
        await (navigator as any).clipboard.writeText(this.text);
        new Notice('✅ Copied to clipboard');
      } catch (e) {
        new Notice('❌ Could not copy to clipboard');
      }
    });
  }
  onClose() {
    this.contentEl.empty();
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
