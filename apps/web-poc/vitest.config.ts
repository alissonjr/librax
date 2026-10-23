import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@domain': resolve(__dirname, '../../services/api/src/domain'),
      '@apilib': resolve(__dirname, '../../services/api/src/lib'),
      '@usecases': resolve(__dirname, '../../services/api/src/usecases'),
    },
  },
});
