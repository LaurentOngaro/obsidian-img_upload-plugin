import { PluginSettingTab, App, Setting, Notice } from 'obsidian';
import { CloudinaryHelpModal } from './cloudinary-help-modal';
import { CloudinaryUploader } from './cloudinary';
import { CloudinaryCache } from './cache';

export default class CloudinarySettingTab extends PluginSettingTab {
  plugin: any;

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Cloudinary Settings Header
    containerEl.createEl('h3', { text: '☁️ Cloudinary Settings' });

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

    new Setting(containerEl)
      .setName('Cloudinary credentials')
      .setDesc('Open Cloudinary API Keys to create or view your API credentials')
      .addButton((btn: any) => {
        const b = btn
          .setButtonText('🔗 Open Cloudinary API Keys')
          .onClick(() => window.open('https://cloudinary.com/console/settings/api-keys', '_blank', 'noopener'));
        // best-effort styling (some Button objects expose buttonEl)
        try {
          (b as any).buttonEl.classList.add('mod-cta');
        } catch (e) {
          /* ignore if not available */
        }
        return b;
      });

    // Signed uploads section
    containerEl.createEl('h3', { text: '🔐 Settings for Signed uploads (not recommended)' });

    new Setting(containerEl)
      .setName('Allow storing API Secret (not recommended)')
      .setDesc(
        'When enabled, you may store your Cloudinary API secret in the plugin (NOT RECOMMENDED). This will enable signed uploads from the plugin.'
      )
      .addToggle((toggle: any) =>
        toggle.setValue(!!this.plugin.settings.allowStoreApiSecret).onChange(async (value: boolean) => {
          this.plugin.settings.allowStoreApiSecret = value;
          if (!value) {
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

    // Upload preset settings
    containerEl.createEl('h3', { text: 'Upload settings' });

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

    // Others
    containerEl.createEl('h3', { text: 'Others settings' });

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

    // Maintenance tools: clear or export shared cache (operates on `Shared cache file path`)
    new Setting(containerEl)
      .setName('Maintenance')
      .setDesc('Tools to manage the shared Cloudinary cache (if configured via Shared cache file path)')
      .addButton((btn: any) =>
        btn.setButtonText('Clear shared cache').onClick(async () => {
          if (!this.plugin.settings.cacheFilePath) {
            new Notice('⚠️ No shared cache configured. Set "Shared cache file path" in settings.');
            return;
          }
          const sharedCache = new CloudinaryCache(this.app, this.plugin.settings.cacheFilePath);
          await sharedCache.writeCache({});
          new Notice('✅ Shared cache cleared');
        })
      )
      .addButton((btn: any) =>
        btn.setButtonText('Export shared cache').onClick(async () => {
          if (!this.plugin.settings.cacheFilePath) {
            new Notice('⚠️ No shared cache configured. Set "Shared cache file path" in settings.');
            return;
          }
          const sharedCache = new CloudinaryCache(this.app, this.plugin.settings.cacheFilePath);
          const cache = await sharedCache.readCache();
          const json = JSON.stringify(cache || {}, null, 2);
          try {
            await (navigator as any).clipboard.writeText(json);
            new Notice('✅ Shared cache copied to clipboard');
          } catch (e) {
            new Notice('❌ Could not copy to clipboard');
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
            // Validate folder path: disallow .., absolute paths (starting with /) and Windows drive letters like C:\\
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
