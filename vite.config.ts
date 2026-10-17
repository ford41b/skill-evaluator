import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
