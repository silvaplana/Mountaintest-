import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
  worker: { format: 'es' },
  // PowerSync (essai) : sa base SQLite en WebAssembly ne se pré-compile pas.
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite', '@powersync/web'] },
});
