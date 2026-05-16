// Vitest config. jsdom env so DOM types resolve; tests that touch
// browser globals (localStorage, matchMedia) currently use
// vi.stubGlobal per-test rather than relying on automatic
// globalThis exposure — vitest 4 + jsdom + bun's interplay didn't
// make `localStorage` bare-global reliably across runs.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts', 'src/components/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*', '**/types.ts'],
    },
  },
});
