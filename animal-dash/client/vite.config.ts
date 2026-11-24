import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared/src') } },
  server: { port: 5173, host: true, fs: { allow: ['..'] } },
  build: { target: 'es2022', outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
