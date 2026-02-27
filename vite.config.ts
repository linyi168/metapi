import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolveDevProxyTarget } from './src/web/devProxyTarget';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = resolveDevProxyTarget(env);
  console.log(`[vite] dev proxy target: ${proxyTarget}`);

  return {
    root: 'src/web',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: '../../dist/web',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '^/api($|/)': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '^/monitor-proxy($|/)': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '^/v1($|/)': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
