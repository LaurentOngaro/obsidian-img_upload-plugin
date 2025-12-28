import { App, TFile, Notice } from 'obsidian';

export interface CacheEntry {
  url: string;
  public_id: string | null;
  filename: string | null;
  uploaded_at: string | null;
  uploader: string;
}

export interface SharedCache {
  [hash: string]: CacheEntry | string;
}

export class CloudinaryCache {
  private app: App;
  private cachePath: string;

  constructor(app: App, cachePath: string) {
    this.app = app;
    this.cachePath = cachePath;
  }

  async readCache(): Promise<Record<string, CacheEntry>> {
    if (!this.cachePath) return {};

    try {
      const exists = await this.app.vault.adapter.exists(this.cachePath);
      if (!exists) return {};

      const content = await this.app.vault.adapter.read(this.cachePath);
      const data = JSON.parse(content) as SharedCache;

      return this.migrateCache(data);
    } catch (e) {
      console.error('Failed to read Cloudinary cache:', e);
      return {};
    }
  }

  private async migrateCache(data: SharedCache): Promise<Record<string, CacheEntry>> {
    let needsWrite = false;
    const migrated: Record<string, CacheEntry> = {};
    const now = new Date().toISOString();

    for (const [hash, entry] of Object.entries(data)) {
      if (typeof entry === 'string') {
        migrated[hash] = {
          url: entry,
          public_id: null,
          filename: null,
          uploaded_at: now,
          uploader: 'migrated',
        };
        needsWrite = true;
      } else {
        // Ensure all required fields are present
        const e = entry as any;
        if (e.url && (e.public_id === undefined || e.filename === undefined || e.uploaded_at === undefined || e.uploader === undefined)) {
          migrated[hash] = {
            url: e.url,
            public_id: e.public_id ?? null,
            filename: e.filename ?? null,
            uploaded_at: e.uploaded_at ?? now,
            uploader: e.uploader ?? 'unknown',
          };
          needsWrite = true;
        } else {
          migrated[hash] = entry as CacheEntry;
        }
      }
    }

    if (needsWrite) {
      await this.writeCache(migrated);
    }

    return migrated;
  }

  async writeCache(cache: Record<string, CacheEntry>): Promise<void> {
    if (!this.cachePath) return;

    try {
      const content = JSON.stringify(cache, null, 2);
      // Atomic write: write to temp then rename
      const tempPath = this.cachePath + '.tmp';
      await this.app.vault.adapter.write(tempPath, content);

      // In Obsidian, we can just use write which is usually safe enough,
      // but for true shared access we might want to be careful.
      // However, vault.adapter.write is what we have.
      await this.app.vault.adapter.remove(this.cachePath).catch(() => {});
      await this.app.vault.adapter.copy(tempPath, this.cachePath);
      await this.app.vault.adapter.remove(tempPath);
    } catch (e) {
      console.error('Failed to write Cloudinary cache:', e);
      new Notice('Error saving Cloudinary cache');
    }
  }

  async getEntry(hash: string): Promise<CacheEntry | null> {
    const cache = await this.readCache();
    return cache[hash] || null;
  }

  async addEntry(hash: string, entry: CacheEntry): Promise<void> {
    const cache = await this.readCache();
    cache[hash] = entry;
    await this.writeCache(cache);
  }

  static async calculateHash(data: ArrayBuffer): Promise<string> {
    const cryptoApi = getWebCrypto();
    if (cryptoApi?.subtle) {
      const hashBuffer = await cryptoApi.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    const nodeCrypto = getNodeCrypto();
    if (nodeCrypto?.createHash) {
      return nodeCrypto.createHash('sha1').update(Buffer.from(data)).digest('hex');
    }

    throw new Error('WebCrypto not available');
  }
}

function getWebCrypto(): Crypto | undefined {
  const gc = (globalThis as any).crypto;
  if (gc?.subtle) return gc as Crypto;
  try {
    const req = (globalThis as any).require ?? (0, (globalThis as any).eval)('require');
    const nodeCrypto = req ? req('node:crypto') ?? req('crypto') : undefined;
    return nodeCrypto?.webcrypto as Crypto | undefined;
  } catch (e) {
    return undefined;
  }
}

function getNodeCrypto(): any {
  try {
    const req = (globalThis as any).require ?? (0, (globalThis as any).eval)('require');
    return req ? req('node:crypto') ?? req('crypto') : undefined;
  } catch (e) {
    return undefined;
  }
}
