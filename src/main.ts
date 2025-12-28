import { Plugin, PluginSettingTab, App, Setting, Notice, MarkdownView, TFile, Modal } from 'obsidian';
import { BUILD_INFO } from './generated-build-info';
import { CloudinaryHelpModal } from './cloudinary-help-modal';
import { CloudinaryUploader, ensureUploadPreset } from './cloudinary';
import { pasteClipboardImage } from './paste';
import { processFileCreate } from './file-handler';
import { CloudinaryCache } from './cache';

interface CloudinaryPluginSettings {
  cloudName: string;
  apiKey: string;
  apiSecret?: string;
  uploadPreset?: string;
  // New options
  autoUploadOnFileAdd?: boolean;
  localCopyEnabled?: boolean;
  localCopyFolder?: string;
  // Security settings
  maxAutoUploadSizeMB?: number;
  // Whether storing API secret locally is allowed (dangerous)
  allowStoreApiSecret?: boolean;
  // Enable verbose debug logging and Notices for troubleshooting
  debugLogs?: boolean;
  // Shared cache file path (relative to vault root)
  cacheFilePath?: string;
  // Cache of uploaded files: path -> { url, hash, updatedAt }
  uploadedFiles?: Record<string, { url: string; hash: string; updatedAt: number }>;
}

// Re-export helpers from file-handler (for tests)
export { processFileCreate } from './file-handler';

const DEFAULT_SETTINGS: CloudinaryPluginSettings = {
  cloudName: '',
  apiKey: '',
  apiSecret: '',
  uploadPreset: '',
  autoUploadOnFileAdd: false,
  localCopyEnabled: false,
  localCopyFolder: '',
  maxAutoUploadSizeMB: 10, // default 10 MB
  debugLogs: false,
  cacheFilePath: '_Helpers/cloudinary_cache.json',
  uploadedFiles: {},
};

export default class CloudinaryPlugin extends Plugin {
  settings: CloudinaryPluginSettings = DEFAULT_SETTINGS;
  private uploader?: CloudinaryUploader;
  private buildInfo: { version: string; buildNumber: number; buildTime?: string } = { version: '1.0.0', buildNumber: 0 };

  async onload() {
    await this.loadSettings();
    await this.loadBuildInfo();

    // Commande: Coller image depuis le presse-papiers
    this.addCommand({
      id: 'cloudinary-paste-image',
      name: 'Paste image to Cloudinary',
      callback: () => this.pasteImage(),
    });

    // Shortcut: Ctrl+Shift+V (Windows/Linux) ou Cmd+Shift+V (Mac)
    this.addCommand({
      id: 'cloudinary-paste-hotkey',
      name: 'Paste image (Quick)',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'v' }],
      callback: () => this.pasteImage(),
    });

    this.addSettingTab(new CloudinarySettingTab(this.app, this));

    // Commands for cache maintenance
    this.addCommand({
      id: 'img-upload-clear-cache',
      name: 'Clear upload cache (Image Upload)',
      callback: async () => {
        this.settings.uploadedFiles = {};
        await this.saveSettings();
        new Notice('✅ Upload cache cleared');
      },
    });

    this.addCommand({
      id: 'img-upload-export-cache',
      name: 'Export upload cache (copy JSON to clipboard)',
      callback: async () => {
        const json = JSON.stringify(this.settings.uploadedFiles || {}, null, 2);
        try {
          await (navigator as any).clipboard.writeText(json);
          new Notice('✅ Upload cache copied to clipboard');
        } catch (e) {
          // Fallback to modal viewer
          new ExportModal(this.app, json).open();
        }
      },
    });

    // Listen for newly created files in the vault to optionally auto-upload images
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        // Fire-and-forget
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
      if (this.settings.debugLogs) {
        console.log('[img_upload] pasteImage: starting paste upload', { settings: this.settings });
      }
      new Notice('⏳ Uploading...');

      const cache = this.settings.cacheFilePath ? new CloudinaryCache(this.app, this.settings.cacheFilePath) : undefined;
      const { url } = await pasteClipboardImage(this.settings, undefined, (navigator as any).clipboard, cache);

      if (this.settings.debugLogs) {
        console.log('[img_upload] pasteImage: upload result', url);
      }

      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view && (view as any).editor) {
        (view as any).editor.replaceSelection(`![image](${url})`);
      } else {
        // If no editor is available, at least show the URL
        new Notice(`✅ Image uploaded: ${url}`);
      }

      new Notice('✅ Image uploaded!');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`❌ Error: ${message}`);
    }
  }

  // Handle new files created in the vault: delegate to exported helper
  // Per-session state to avoid repeated auto-create attempts and noisy network errors
  private static _triedAutoCreatePreset = false;
  private static _shownAutoCreatePresetWarning = false;

  /**
   * Reset per-session auto-create state (useful for tests)
   */
  static resetAutoCreatePresetState() {
    CloudinaryPlugin._triedAutoCreatePreset = false;
    CloudinaryPlugin._shownAutoCreatePresetWarning = false;
  }

  async handleFileCreate(file: TFile) {
    try {
      if (this.settings.debugLogs) console.log('[img_upload] handleFileCreate called', file);

      // Attempt to auto-create the unsigned preset at most once per plugin session.
      // This prevents repeated network attempts (and CORS preflight failures) when the vault
      // is loaded and many files trigger this handler.
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
      // Prefer embedded build info generated at build time
      try {
        if (typeof BUILD_INFO !== 'undefined' && BUILD_INFO && BUILD_INFO.version) {
          this.buildInfo = BUILD_INFO as any;
          if (this.settings?.debugLogs) console.log('[img_upload] loaded build info from embedded BUILD_INFO', this.buildInfo);
          return;
        }
      } catch (e) {
        /* ignore if not available */
      }

      // Fallback: try to load build-info.json via fetch
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

  getBuildString(): string {
    return `build v${this.buildInfo.version} #${this.buildInfo.buildNumber}`;
  }
}

class CloudinarySettingTab extends PluginSettingTab {
  plugin: CloudinaryPlugin;

  constructor(app: App, plugin: CloudinaryPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Cloudinary Settings Header
    containerEl.createEl('h3', { text: '☁️ Cloudinary Settings' });
    // ---
    containerEl.createEl('p', {
      text: '📝 To get Cloudinary credentials (mandatory), see https://cloudinary.com/console/settings/api-keys',
    });
    new Setting(containerEl)
      .setName('Cloud Name')
      .setDesc('Your Cloudinary cloud name')
      .addText((text: any) => {
        text.inputEl.style.width = '150px';
        text
          .setPlaceholder('my-cloud')
          .setValue(this.plugin.settings.cloudName)
          .onChange(async (value: string) => {
            this.plugin.settings.cloudName = value;
            await this.plugin.saveSettings();
          });
      });
    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your Cloudinary API key (public)')
      .addText((text: any) => {
        text.inputEl.style.width = '200px';
        text
          .setPlaceholder('abc123...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value: string) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
      });

    // Signed upload settings header
    containerEl.createEl('h3', { text: '🔐 Settings for Signed uploads (not recommended)' });
    // ---
    // Toggle: allow storing API Secret (not recommended)
    new Setting(containerEl)
      .setName('Allow storing API Secret (not recommended)')
      .setDesc(
        'When enabled, you may store your Cloudinary API secret in the plugin (NOT RECOMMENDED). This will enable signed uploads from the plugin.'
      )
      .addToggle((toggle: any) =>
        toggle.setValue(!!this.plugin.settings.allowStoreApiSecret).onChange(async (value: boolean) => {
          this.plugin.settings.allowStoreApiSecret = value;
          if (!value) {
            // Clear secret when disabling option
            this.plugin.settings.apiSecret = '';
          }
          await this.plugin.saveSettings();
          if (!value) new Notice('⚠️ Storing API secret is disabled. Use unsigned uploads or server-side signing.');
        })
      );

    let secretText: any;
    new Setting(containerEl)
      .setName('API Secret (Optional)')
      .setDesc(
        'If you enabled storing API Secret above, enter it here. Storing the secret is dangerous — prefer unsigned uploads or server-side signing.'
      )
      .addText((text: any) => {
        text.inputEl.style.width = '200px';
        text
          .setPlaceholder('xyz789...')
          .setValue(this.plugin.settings.apiSecret)
          .setDisabled(!this.plugin.settings.allowStoreApiSecret)
          .onChange(async (value: string) => {
            if (!this.plugin.settings.allowStoreApiSecret) {
              new Notice('Enable "Allow storing API Secret" before entering a secret.');
              return;
            }
            this.plugin.settings.apiSecret = value;
            await this.plugin.saveSettings();
          });
      });

    // Upload preset settings header
    containerEl.createEl('h3', { text: 'Upload settings' });
    // ---

    // Status indicator element
    const statusRow = containerEl.createDiv({ cls: 'setting-item' });
    statusRow.createEl('div', { text: 'Auto-upload status:' });
    const statusEl = statusRow.createDiv({ cls: 'setting-item-control' });
    const updateStatusIndicator = () => {
      const hasPreset = !!(this.plugin && this.plugin.settings && this.plugin.settings.uploadPreset);
      const hasSigned = !!(
        this.plugin &&
        this.plugin.settings &&
        this.plugin.settings.allowStoreApiSecret &&
        this.plugin.settings.apiKey &&
        this.plugin.settings.apiSecret
      );
      if (hasPreset || hasSigned) {
        statusEl.innerText = ' Ready (green)';
        statusEl.style.color = '#0b8457';
      } else if (
        this.plugin &&
        this.plugin.settings &&
        this.plugin.settings.allowStoreApiSecret &&
        (this.plugin.settings.apiKey || this.plugin.settings.apiSecret)
      ) {
        statusEl.innerText = ' Partial (yellow) — provide API Key & Secret';
        statusEl.style.color = '#b8860b';
      } else {
        statusEl.innerText = ' Not configured (red) — add Upload preset or API Secret';
        statusEl.style.color = '#c92c2c';
      }
    };
    // run once to initialize
    updateStatusIndicator();
    new Setting(containerEl)
      .setName('Upload preset (recommended)')
      .setDesc(
        'Use an unsigned upload preset for unsigned uploads (recommended) or a signed upload preset (you must provide your API Secret) or use a server-side signer. If the plugin cannot create a preset due to CORS, create it manually in the Cloudinary Console or use the example server (Help).'
      )
      .addText((text: any) => {
        text.inputEl.style.width = '180px';
        text
          .setPlaceholder('my_unsigned_preset')
          .setValue(this.plugin.settings.uploadPreset || '')
          .onChange(async (value: string) => {
            this.plugin.settings.uploadPreset = value;
            await this.plugin.saveSettings();
            updateStatusIndicator();
          });
      })
      .addButton((btn: any) =>
        btn
          .setButtonText('Create unsigned preset (auto)')
          .setDisabled(!(this.plugin.settings.allowStoreApiSecret && this.plugin.settings.apiKey && this.plugin.settings.apiSecret))
          .onClick(async () => {
            try {
              const uploader = new CloudinaryUploader({
                cloud_name: this.plugin.settings.cloudName,
                api_key: this.plugin.settings.apiKey,
                api_secret: this.plugin.settings.apiSecret,
              });
              const name = 'obsidian_auto_unsigned';
              const res = await uploader.createUploadPreset(name);
              this.plugin.settings.uploadPreset = (res && res.name) || name;
              await this.plugin.saveSettings();
              new Notice(`✅ Created unsigned upload preset '${this.plugin.settings.uploadPreset}'`);
              updateStatusIndicator();
            } catch (e: any) {
              const msg = e instanceof Error ? e.message : String(e);
              if (/already exists|already/i.test(String(msg))) {
                this.plugin.settings.uploadPreset = 'obsidian_auto_unsigned';
                await this.plugin.saveSettings();
                new Notice(`⚠️ Using existing unsigned upload preset 'obsidian_auto_unsigned'`);
                updateStatusIndicator();
              } else {
                new Notice(`❌ Could not create unsigned preset: ${msg}`);
                if (this.plugin.settings.debugLogs) console.error('[img_upload] createUploadPreset error', e);
              }
            }
          })
      );

    const presetHelp = containerEl.createDiv({ cls: 'setting-item' });
    const presetHelpText = presetHelp.createEl('div', {
      text: '⚠️ Note: An upload preset is required for uploads. It can be signed or unsigned (recommended for safety). If the plugin cannot create the unsigned preset via the button above due to CORS error, create it via the Cloudinary Console or use the example server (Help). If you prefer not to use an unsigned preset, you must enable signed uploads or configure a server-side signer.',
    });
    presetHelpText.style.fontSize = '0.85em';
    presetHelpText.style.color = 'var(--text-muted)';
    const presetHelpRow = presetHelp.createDiv({ cls: 'setting-item-control' });
    const helpBtn2 = presetHelpRow.createEl('button', { text: 'Learn More' });
    helpBtn2.addEventListener('click', () => {
      // eslint-disable-next-line no-new
      new (CloudinaryHelpModal as any)(this.app).open();
    });
    presetHelpRow.createEl('span', { text: ' ' });
    const serverBtn2 = presetHelpRow.createEl('button', { text: 'Create via example server' });
    serverBtn2.addEventListener('click', () => {
      // eslint-disable-next-line no-new
      new (CloudinaryHelpModal as any)(this.app).open();
    });

    new Setting(containerEl)
      .setName('Auto upload on file add')
      .setDesc('When enabled, new image files added to the vault will be uploaded automatically to Cloudinary.')
      .addToggle((toggle: any) =>
        toggle.setValue(!!this.plugin.settings.autoUploadOnFileAdd).onChange(async (value: boolean) => {
          this.plugin.settings.autoUploadOnFileAdd = value;
          await this.plugin.saveSettings();
          // Warn user when enabling Auto Upload but neither upload preset nor signed credentials are configured
          if (value && !this.plugin.settings.uploadPreset && !(this.plugin.settings.allowStoreApiSecret && this.plugin.settings.apiSecret)) {
            new Notice(
              '⚠️ Auto upload enabled but no Upload preset or API Secret configured. Uploads will fail unless you add an upload preset or set an API Secret.'
            );
          }
        })
      );

    // Short note under Auto upload to clarify scope
    const autoUploadNote = containerEl.createDiv({ cls: 'setting-item' });
    const autoUploadNoteText = autoUploadNote.createEl('div', {
      text: '⚠️ Note: Only files **referenced in an open note** are automatically uploaded.',
    });
    autoUploadNoteText.style.fontSize = '0.85em';
    autoUploadNoteText.style.color = 'var(--text-muted)';

    // Max auto-upload size
    new Setting(containerEl)
      .setName('Max auto-upload size (MB)')
      .setDesc('Maximum file size (in MB) allowed for automatic uploads. Files larger will not be uploaded automatically.')
      .addText((text: any) => {
        text.inputEl.style.width = '50px';
        text
          .setPlaceholder('10')
          .setValue(String(this.plugin.settings.maxAutoUploadSizeMB ?? 10))
          .onChange(async (value: string) => {
            const num = Number(value);
            if (!isFinite(num) || num <= 0) {
              new Notice('Please enter a positive number for max upload size (MB)');
              return;
            }
            this.plugin.settings.maxAutoUploadSizeMB = num;
            await this.plugin.saveSettings();
          });
      });

    //
    containerEl.createEl('h3', { text: 'Others settings' });
    // ---
    // Shared cache file path
    new Setting(containerEl)
      .setName('Shared cache file path')
      .setDesc('Path to the shared JSON cache file (relative to vault root). Used to synchronize with other tools like updateArtIndex.py.')
      .addText((text: any) => {
        text.inputEl.style.width = '350px';
        text
          .setPlaceholder('_Helpers/cloudinary_cache.json')
          .setValue(this.plugin.settings.cacheFilePath || '')
          .onChange(async (value: string) => {
            this.plugin.settings.cacheFilePath = value;
            await this.plugin.saveSettings();
          });
      });
    // Maintenance tools: clear or export upload cache
    new Setting(containerEl)
      .setName('Maintenance')
      .setDesc('Tools to manage the upload cache (uploaded image URL + file hash)')
      .addButton((btn: any) =>
        btn.setButtonText('Clear upload cache').onClick(async () => {
          this.plugin.settings.uploadedFiles = {};
          await this.plugin.saveSettings();
          new Notice('✅ Upload cache cleared');
        })
      )
      .addButton((btn: any) =>
        btn.setButtonText('Export upload cache').onClick(async () => {
          const json = JSON.stringify(this.plugin.settings.uploadedFiles || {}, null, 2);
          try {
            await (navigator as any).clipboard.writeText(json);
            new Notice('✅ Upload cache copied to clipboard');
          } catch (e) {
            new ExportModal(this.app, json).open();
          }
        })
      );
    // Local copy settings
    let folderText: any;
    new Setting(containerEl)
      .setName('Enable local copy')
      .setDesc('If enabled, a local copy of new images will be made into the folder below (optional).')
      .addToggle((toggle: any) =>
        toggle.setValue(!!this.plugin.settings.localCopyEnabled).onChange(async (value: boolean) => {
          this.plugin.settings.localCopyEnabled = value;
          await this.plugin.saveSettings();
          if (folderText) folderText.setDisabled(!value);
        })
      );
    // Local copy folder
    new Setting(containerEl)
      .setName('Local copy folder (relative to vault root)')
      .setDesc('Example: assets/images — leave empty to use vault root. Only used when local copy is enabled.')
      .addText((text: any) => {
        folderText = text;
        text.inputEl.style.width = '350px';
        text
          .setPlaceholder('assets/images')
          .setValue(this.plugin.settings.localCopyFolder || '')
          .setDisabled(!this.plugin.settings.localCopyEnabled)
          .onChange(async (value: string) => {
            // Validate folder path: disallow .., absolute paths (starting with /) and Windows drive letters like C:\
            if (value && /\.\.|^[A-Za-z]:\\\\|^\//.test(value)) {
              new Notice('Invalid folder path: do not use ".." or absolute paths. Please use a relative path like "assets/images".');
              return;
            }

            // Normalize (remove leading/trailing slashes)
            const sanitized = value.replace(/^\/+|\/+$/g, '');
            this.plugin.settings.localCopyFolder = sanitized;
            await this.plugin.saveSettings();
          });
      });
    // Debug logging toggle
    new Setting(containerEl)
      .setName('Debug logs')
      .setDesc('When enabled, verbose logs will be written to the console and additional Notices will be shown to help debugging.')
      .addToggle((toggle: any) =>
        toggle.setValue(!!this.plugin.settings.debugLogs).onChange(async (value: boolean) => {
          this.plugin.settings.debugLogs = value;
          await this.plugin.saveSettings();
          new Notice(`Debug logs ${value ? 'enabled' : 'disabled'}`);
        })
      );

    // Display build version at the bottom
    const versionContainer = containerEl.createDiv({ cls: 'setting-item' });
    versionContainer.style.marginTop = '2em';
    versionContainer.style.textAlign = 'center';
    versionContainer.style.fontSize = '0.85em';
    versionContainer.style.color = 'var(--text-muted)';
    versionContainer.createEl('p', {
      text: this.plugin.getBuildString(),
    });
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

// Helper to map file extensions to mime types
function getMimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
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
