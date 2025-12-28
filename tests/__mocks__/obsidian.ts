// Mock for Obsidian API types
export class MarkdownView {
  editor: any;
}

export class Plugin {
  app: any;
  manifest: any;
}

export class PluginSettingTab {
  app: any;
  plugin: any;
}

export class App {}

export class Setting {
  constructor(containerEl: any) {}
  setName(name: string) {
    return this;
  }
  setDesc(desc: string) {
    return this;
  }
  addText(cb: any) {
    return this;
  }
  addToggle(cb: any) {
    return this;
  }
  addButton(cb: any) {
    return this;
  }
}

export class Notice {
  constructor(message: string) {}
}

export class TFile {
  path: string = '';
  name: string = '';
  extension: string = '';
  basename: string = '';
}

export class Modal {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}
