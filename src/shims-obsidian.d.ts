declare module 'obsidian' {
  export class Plugin {
    app: App;
    onload(): void | Promise<void>;
    onunload(): void | Promise<void>;
    loadData(): Promise<any>;
    saveData(data: any): Promise<void>;
    addCommand(options: any): void;
    addSettingTab(tab: PluginSettingTab): void;
  }

  export class PluginSettingTab {
    constructor(app: App, plugin: Plugin);
    containerEl: any;
    display(): void;
  }

  export class App {
    workspace: Workspace;
  }

  export class Workspace {
    getActiveViewOfType<T = any>(c: any): T | null;
  }

  export class Setting {
    constructor(containerEl: any);
    setName(name: string): this;
    setDesc(desc: string): this;
    addText(cb: any): this;
  }

  export class Notice {
    constructor(message?: string, timeout?: number);
  }

  export class MarkdownView {
    editor: any;
  }
}
