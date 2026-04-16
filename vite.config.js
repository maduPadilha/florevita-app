import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-pages-admin': [
            './src/pages/usuarios.js',
            './src/pages/colaboradores.js',
            './src/pages/config.js',
            './src/pages/backup.js',
            './src/pages/ecommerce.js',
          ],
          'vendor-pages-reports': [
            './src/pages/relatorios.js',
            './src/pages/financeiro.js',
            './src/pages/caixa.js',
          ],
          'vendor-pages-ops': [
            './src/pages/producao.js',
            './src/pages/expedicao.js',
            './src/pages/ponto.js',
            './src/pages/estoque.js',
          ],
        }
      }
    }
  },
});
