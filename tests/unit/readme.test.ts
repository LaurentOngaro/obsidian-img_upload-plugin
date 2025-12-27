import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('README guidance', () => {
  it('mentions Cloudinary management API/CORS guidance', () => {
    const md = readFileSync(resolve(__dirname, '../../README.md'), 'utf8');
    expect(md).toMatch(/Cloudinary management API appears blocked|creating upload presets from a renderer|CORS/);
    // Also ensure the README shows how to call the example server and display JSON
    expect(md).toMatch(/curl -s -X POST .*create-preset/);
    // README should mention auto-upload only runs for files referenced in open notes
    expect(md).toMatch(/referenced in an open note/);
  });
});
