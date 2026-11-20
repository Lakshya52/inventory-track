import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  envPrefix: ['VITE_', 'API_URL'],
  plugins: [tailwindcss(), react(), basicSsl()],
  // Never ship source maps (or internal source structure) in a browser build.
  build: { sourcemap: false },
  server: {
    host: '0.0.0.0',
    port: 3000,
    https: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      '/uploads': 'http://localhost:3001',
    },
  },
});
