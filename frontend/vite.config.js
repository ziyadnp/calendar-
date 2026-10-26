import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Backend URL for the dev proxy; override with API_TARGET in frontend/.env
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_TARGET || 'http://localhost:5000';

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true
        }
      }
    }
  };
});
