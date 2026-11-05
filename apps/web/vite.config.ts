import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registro feito em src/main.tsx (recarrega sozinho quando há versão nova)
      injectRegister: false,
      includeAssets: ['brand/icon-48.png', 'brand/icon-180.png'],
      manifest: {
        name: 'FAV Assist',
        short_name: 'FAV Assist',
        description: 'Planejamento estratégico de marketing — by FAVIS Design Studio',
        lang: 'pt-BR',
        theme_color: '#2d1500',
        background_color: '#2d1500',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // A API nunca é cacheada: dados sempre atuais e sem vazamento entre sessões
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3333', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3333', changeOrigin: false } },
  },
});
