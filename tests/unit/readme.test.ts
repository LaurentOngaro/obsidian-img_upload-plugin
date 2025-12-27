import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('README guidance', () => {
  it('mentions Cloudinary management API/CORS guidance', () => {
    const md = readFileSync(resolve(__dirname, '../../README.md'), 'utf8');
    expect(md).toMatch(/Cloudinary management API appears blocked|creating upload presets from a renderer|CORS/);
  });
});
