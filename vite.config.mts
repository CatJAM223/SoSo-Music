import { devCspHashes } from './scripts/desktop/devCsp.mts';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    devCspHashes(),
    electron([
      {
        // Main process entry file of the Electron App.
        entry: 'src/desktop/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rolldownOptions: {
              external: ['sql.js', 'path', 'fs', 'electron'],
              output: {
                entryFileNames: 'main.js',
              },
            },
          },
        },
      },
      {
        entry: 'src/desktop/preload/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rolldownOptions: {
              output: {
                entryFileNames: 'preload.js',
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
            },
            { name: 'vendor-icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/ },
            { name: 'vendor-hls', test: /[\\/]node_modules[\\/]hls\.js[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
