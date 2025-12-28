import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Settings UI strings', () => {
  it('uses a single, clearly named Create unsigned preset button', () => {
    const src = readFileSync(resolve(__dirname, '../../src/settings.ts'), 'utf8');
    expect(src).toMatch(/Create unsigned preset \(auto\)/);
    expect(src).not.toMatch(/Create preset \(auto\)/);
  });

  it('has maintenance buttons to clear and export shared cache', () => {
    const src = readFileSync(resolve(__dirname, '../../src/settings.ts'), 'utf8');
    expect(src).toMatch(/Clear shared cache/);
    expect(src).toMatch(/Export shared cache/);
  });
});
