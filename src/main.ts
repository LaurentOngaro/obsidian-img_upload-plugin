import { Plugin, PluginSettingTab, App, Setting, Notice, MarkdownView, TFile } from 'obsidian';
import { CloudinaryUploader } from './cloudinary';
import { pasteClipboardImage } from './paste';
import { processFileCreate } from './file-handler';

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
};

export default class CloudinaryPlugin extends Plugin {
  settings: CloudinaryPluginSettings = DEFAULT_SETTINGS;
  private uploader?: CloudinaryUploader;

  async onload() {
    await this.loadSettings();

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

      const { url } = await pasteClipboardImage(this.settings, undefined, (navigator as any).clipboard);

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
  async handleFileCreate(file: TFile) {
    try {
      if (this.settings.debugLogs) console.log('[img_upload] handleFileCreate called', file);

      // If auto-upload is enabled but no uploadPreset is configured, and the user allows storing API secret,
      // try to create an unsigned upload preset automatically for convenience.
      if (
        this.settings.autoUploadOnFileAdd &&
        !this.settings.uploadPreset &&
        this.settings.allowStoreApiSecret &&
        this.settings.apiKey &&
        this.settings.apiSecret
      ) {
        try {
          const uploader = new CloudinaryUploader({
            cloud_name: this.settings.cloudName,
            api_key: this.settings.apiKey,
            api_secret: this.settings.apiSecret,
          });
          const presetName = 'obsidian_auto_unsigned';
          const res = await uploader.createUploadPreset(presetName);
          // If API returns created preset object, use its name; otherwise fall back to requested name
          this.settings.uploadPreset = (res && res.name) || presetName;
          await this.saveSettings();
          new Notice(`✅ Created unsigned upload preset '${this.settings.uploadPreset}' and saved to settings`);
        } catch (e: any) {
          // If preset already exists (some accounts), we'll attempt to use the same name
          const msg = e instanceof Error ? e.message : String(e);
          if (/already exists|already/i.test(String(msg))) {
            this.settings.uploadPreset = 'obsidian_auto_unsigned';
            await this.saveSettings();
            new Notice(`⚠️ Using existing upload preset 'obsidian_auto_unsigned'`);
          } else {
            new Notice(`⚠️ Could not create upload preset automatically: ${msg}`);
            if (this.settings.debugLogs) console.error('[img_upload] createUploadPreset error', e);
          }
        }
      }

      const notifyFn = (m: string) => {
        if (this.settings.debugLogs) console.log('[img_upload] notice:', m);
        new Notice(m);
      };

      await processFileCreate(this.app, this.settings, file, CloudinaryUploader, { notify: notifyFn });
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

    containerEl.createEl('h2', { text: '☁️ Cloudinary Settings' });

    new Setting(containerEl)
      .setName('Cloud Name')
      .setDesc('Your Cloudinary cloud name')
      .addText((text: any) =>
        text
          .setPlaceholder('my-cloud')
          .setValue(this.plugin.settings.cloudName)
          .onChange(async (value: string) => {
            this.plugin.settings.cloudName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Your Cloudinary API key (public)')
      .addText((text: any) =>
        text
          .setPlaceholder('abc123...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value: string) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      );

    // Toggle: allow storing API Secret (dangerous)
    new Setting(containerEl)
      .setName('Allow storing API Secret (dangerous)')
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
      .addText((text: any) =>
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
          })
      );

    new Setting(containerEl)
      .setName('Upload preset (Optional)')
      .setDesc('Use upload preset for unsigned uploads (recommended instead of exposing secret)')
      .addText((text: any) =>
        text
          .setPlaceholder('my_unsigned_preset')
          .setValue(this.plugin.settings.uploadPreset || '')
          .onChange(async (value: string) => {
            this.plugin.settings.uploadPreset = value;
            await this.plugin.saveSettings();
          })
      );

    // Max auto-upload size
    new Setting(containerEl)
      .setName('Max auto-upload size (MB)')
      .setDesc('Maximum file size (in MB) allowed for automatic uploads. Files larger will not be uploaded automatically.')
      .addText((text: any) =>
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
          })
      );

    // -- Auto-upload & local copy settings

    // -- Auto-upload & local copy settings
    new Setting(containerEl)
      .setName('Auto upload on file add')
      .setDesc('When enabled, new image files added to the vault will be uploaded automatically to Cloudinary.')
      .addToggle((toggle: any) =>
        toggle.setValue(!!this.plugin.settings.autoUploadOnFileAdd).onChange(async (value: boolean) => {
          this.plugin.settings.autoUploadOnFileAdd = value;
          await this.plugin.saveSettings();
          // Warn user when enabling Auto Upload but neither upload preset nor signed credentials are configured
          if (value && !this.plugin.settings.uploadPreset && !(this.plugin.settings.allowStoreApiSecret && this.plugin.settings.apiSecret)) {
            new Notice('⚠️ Auto upload enabled but no Upload preset or API Secret configured. Uploads will fail unless you add an upload preset or set an API Secret.');
          }
        })
      );

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

    new Setting(containerEl)
      .setName('Local copy folder (relative to vault root)')
      .setDesc('Example: assets/images — leave empty to use vault root. Only used when local copy is enabled.')
      .addText((text: any) => {
        folderText = text;
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

    containerEl.createEl('hr');
    containerEl.createEl('p', {
      text: '📝 Get credentials: https://cloudinary.com/console/settings/api-keys',
    });
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
