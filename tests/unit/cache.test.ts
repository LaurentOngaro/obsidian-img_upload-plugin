import { describe, it, expect, beforeEach } from 'vitest';
import { CloudinaryCache, CacheEntry } from '../../src/cache';

function createMockApp() {
  const store: Record<string, string> = {};
  const adapter = {
    async exists(path: string) {
      return Object.prototype.hasOwnProperty.call(store, path);
    },
    async read(path: string) {
      if (!Object.prototype.hasOwnProperty.call(store, path)) throw new Error('file not found: ' + path);
      return store[path];
    },
    async write(path: string, content: string) {
      store[path] = content;
    },
    async remove(path: string) {
      delete store[path];
    },
    async copy(src: string, dest: string) {
      store[dest] = store[src];
    },
    // helper to inspect
    __store() {
      return store;
    },
  } as any;

  return { vault: { adapter } } as any;
}

describe('CloudinaryCache integration (mocked vault adapter)', () => {
  let app: any;
  const path = 'test_cache.json';

  beforeEach(() => {
    app = createMockApp();
  });

  it('readCache returns empty when file does not exist', async () => {
    const c = new CloudinaryCache(app, path);
    const res = await c.readCache();
    expect(res).toEqual({});
  });

  it('writeCache and readCache roundtrip', async () => {
    const c = new CloudinaryCache(app, path);
    const entry: CacheEntry = {
      url: 'https://example.com/img.jpg',
      public_id: 'img123',
      filename: 'img.jpg',
      uploaded_at: new Date().toISOString(),
      uploader: 'unit-test',
    };
    await c.writeCache({ ['h1']: entry });
    const store = (app.vault.adapter as any).__store();
    // Check the actual persisted file exists
    expect(await app.vault.adapter.exists(path)).toBe(true);

    const read = await c.readCache();
    expect(read['h1']).toEqual(entry);
  });

  it('addEntry and getEntry', async () => {
    const c = new CloudinaryCache(app, path);
    const entry: CacheEntry = {
      url: 'https://example.com/p.png',
      public_id: 'p1',
      filename: 'p.png',
      uploaded_at: new Date().toISOString(),
      uploader: 'unittest',
    };
    expect(await c.getEntry('h2')).toBeNull();
    await c.addEntry('h2', entry);
    const got = await c.getEntry('h2');
    expect(got).not.toBeNull();
    expect(got).toEqual(entry);
  });

  it('migrates legacy string entries into full CacheEntry objects', async () => {
    const storeJson = JSON.stringify({ legacyHash: 'https://legacy.example/legacy.png' }, null, 2);
    await app.vault.adapter.write(path, storeJson);
    const c = new CloudinaryCache(app, path);
    const read = await c.readCache();
    expect(read.legacyHash).toBeTruthy();
    const v = read.legacyHash as CacheEntry;
    expect(v.url).toBe('https://legacy.example/legacy.png');
    expect(v.uploader).toBe('migrated');
    // After migration the file should be rewritten as an object; verify content was updated
    const persisted = JSON.parse((app.vault.adapter as any).__store()[path]);
    expect(typeof persisted.legacyHash).toBe('object');
    expect(persisted.legacyHash.url).toBe('https://legacy.example/legacy.png');
  });

  it('calculateHash returns a deterministic SHA-1 hex string', async () => {
    const buf = new TextEncoder().encode('hello world');
    const hash = await CloudinaryCache.calculateHash(buf.buffer);
    // sha1("hello world") = 2aae6c35c94fcfb415dbe95f408b9ce91ee846ed
    expect(hash).toBe('2aae6c35c94fcfb415dbe95f408b9ce91ee846ed');
  });
});
