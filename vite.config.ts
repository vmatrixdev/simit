import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'src/sidepanel/sidepanel.html'),
        sandbox: resolve(import.meta.dirname, 'src/sandbox/sandbox.html'),
        offscreen: resolve(import.meta.dirname, 'src/offscreen/offscreen.html'),
        background: resolve(import.meta.dirname, 'src/background/service-worker.ts'),
        content: resolve(import.meta.dirname, 'src/harvester/content-script.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'service-worker.js';
          if (chunkInfo.name === 'content') return 'content-script.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts']
  }
});
