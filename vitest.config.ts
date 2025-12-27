import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      obsidian: new URL('./tests/__mocks__/obsidian.ts', import.meta.url).pathname,
    },
  },
});
