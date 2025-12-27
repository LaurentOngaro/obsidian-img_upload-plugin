import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Help modal guidance', () => {
  it('mentions the example server instructions link', () => {
    const src = readFileSync(resolve(__dirname, '../../src/cloudinary-help-modal.ts'), 'utf8');
    expect(src).toMatch(/Open example server instructions/);
    expect(src).toMatch(/create-preset-example.js/);
  });
});
