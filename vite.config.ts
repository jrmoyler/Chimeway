import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': rootDir },
  },
  server: {
    port: 3000,
    // Bound to loopback. The previous config used 0.0.0.0, which exposed the
    // dev server (and any local state) to everything on the network.
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    /*
     * 'hidden' emits the .map files but omits the sourceMappingURL comment, so
     * browsers do not fetch them and the original source is not served to
     * visitors. Upload the maps to an error tracker, or delete them after the
     * build; plain `true` publishes your entire source.
     */
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // React and the Supabase SDK change on a different cadence from app
        // code, so splitting them keeps those chunks cached across deploys.
        // The Gemini SDK is no longer here at all - it moved to the edge
        // function, which is where the API key lives.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@supabase')) return 'supabase';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
