import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/chiryu-bus-transit-app/',
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
