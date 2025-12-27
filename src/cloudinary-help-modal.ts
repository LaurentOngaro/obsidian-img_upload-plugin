import { App, Modal } from 'obsidian';

export class CloudinaryHelpModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Create an unsigned upload preset' });
    contentEl.createEl('p', {
      text: 'To enable Auto Upload without exposing your API secret, create an unsigned upload preset in the Cloudinary Console. Follow these steps:',
    });

    const ul = contentEl.createEl('ol');
    ul.createEl('li', { text: 'Open Cloudinary Console → Settings → Upload presets' });
    ul.createEl('li', { text: 'Click "Create preset"' });
    ul.createEl('li', { text: 'Give the preset a name and uncheck "Signed only" (make it unsigned)' });
    ul.createEl('li', { text: 'Save and paste the preset name into the plugin settings' });

    contentEl.createEl('p', { text: 'You can also use the "Create preset (auto)" button in the plugin settings if you enabled storing API Secret.' });
    contentEl.createEl('p', {
      text: 'Note: Cloudinary management endpoints are not always callable from a browser due to CORS restrictions. If you see CORS errors, create the preset in the Cloudinary Console (recommended) or use a short server-side script to create the preset.',
    });
    contentEl.createEl('p', { text: 'See Cloudinary docs for screenshots and more details.' });

    const link = contentEl.createEl('a', { text: 'Open Cloudinary docs', href: 'https://cloudinary.com/documentation/upload_presets' });
    link.setAttr('target', '_blank');

    // Link to the repository README section with example server instructions
    contentEl.createEl('p', { text: 'If creating a preset from the plugin fails due to CORS, you can run the included example server locally to create the preset from a trusted environment.' });
    contentEl.createEl('p', { text: 'The example server script is located at `src/server/create-preset-example.js` in this repository.' });
    const serverLink = contentEl.createEl('a', { text: 'Open example server instructions', href: 'https://github.com/LaurentOngaro/obsidian-img_upload-plugin#dealing-with-cors-when-creating-upload-presets' });
    serverLink.setAttr('target', '_blank');
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
