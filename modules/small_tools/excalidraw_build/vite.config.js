import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

function copyFontsPlugin() {
  return {
    name: 'copy-fonts',
    closeBundle() {
      const src = path.resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
      const dst = path.resolve(__dirname, '../web/excalidraw/fonts');
      if (fs.existsSync(src)) {
        fs.cpSync(src, dst, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyFontsPlugin()],
  base: './',
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': {},
  },
  build: {
    outDir: '../web/excalidraw',
    emptyOutDir: true,
  },
});
