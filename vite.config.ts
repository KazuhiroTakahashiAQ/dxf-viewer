/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Content-Security-Policy for the production build. GitHub Pages cannot set
 * response headers, so the policy is delivered as a <meta> tag. There is no
 * 'unsafe-eval' and no inline script: DXF content can never become code.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data: blob:",
  // `?url=` loading fetches user-confirmed https URLs
  "connect-src 'self' https: blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/** Commit the build is made from: the help dialog links its source (GPL). */
function sourceCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function cspPlugin(): Plugin {
  return {
    name: 'dxfv-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  define: { __SOURCE_COMMIT__: JSON.stringify(sourceCommit()) },
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: './',
        name: 'DXF Viewer',
        short_name: 'DXF Viewer',
        description: 'Inspect DXF drawings entirely in your browser.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#16181d',
        theme_color: '#16181d',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [
          {
            action: './',
            accept: { 'application/dxf': ['.dxf'], 'image/vnd.dxf': ['.dxf'], 'image/x-dxf': ['.dxf'], 'image/vnd.dwg': ['.dwg'], 'application/acad': ['.dwg'] },
          },
        ],
        launch_handler: { client_mode: 'focus-existing' },
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        globIgnores: ['fonts/**', 'samples/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/fonts\/.+\.(woff2|json|txt)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'dxfv-fonts',
              expiration: { maxEntries: 4000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // LibreDWG (~10 MB) is fetched on the first DWG, not precached
            urlPattern: ({ url }) => /\/assets\/.+\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'dxfv-wasm',
              expiration: { maxEntries: 2 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => /\/samples\/.+\.dxf$/i.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'dxfv-samples' },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    // the package exports only its wrapper; the raw Emscripten module and its
    // .wasm (used by src/dwg/convert.ts) live in its wasm/ folder
    alias: [{ find: /^libredwg-web-wasm\//, replacement: fileURLToPath(new URL('./node_modules/@mlightcad/libredwg-web/wasm/', import.meta.url)) }],
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2048 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
