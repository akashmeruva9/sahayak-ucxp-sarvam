import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // changeOrigin stays off on purpose. It would rewrite Host to
      // 127.0.0.1:8000, and the backend builds Google's redirect_uri from Host
      // -- so sign-in would ask to come back to a port Google has never heard
      // of and fail with redirect_uri_mismatch. Preserving localhost:5173 makes
      // the derived URI match the one registered on the OAuth client.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
});
