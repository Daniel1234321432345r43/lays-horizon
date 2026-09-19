import { defineConfig } from 'vite';

// El puerto lo inyecta el entorno de preview (PORT); 5173 es solo el respaldo
// local. Sin strictPort, un puerto ocupado no impide el arranque.
const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port,
    strictPort: false
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true
  }
});
