import { defineConfig } from 'vitest/config';
import seoContentPlugin from './vite-plugin-seo-content';

export default defineConfig({
  base: '/chiryu-bus-transit-app/',
  plugins: [seoContentPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
