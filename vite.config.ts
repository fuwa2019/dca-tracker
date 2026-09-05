import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { execSync } from 'node:child_process';

function gitCommitDate() {
  try {
    return execSync('git log -1 --format=%cd --date=format:%Y-%m-%d', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const REQUIRED_PUBLIC_BUILD_VARS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_QUOTE_WORKER_URL',
] as const;

function assertProductionPublicEnv(env: Record<string, string>) {
  if (env.VITE_LOCAL_MODE === '1') return;
  const missing = REQUIRED_PUBLIC_BUILD_VARS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `[build] Missing required public environment variables: ${missing.join(', ')}. `
      + 'Use npm run build:local for the offline demo or configure the Pages build environment.',
    );
  }
}

const appConfig = {
  define: {
    __APP_COMMIT_DATE__: JSON.stringify(gitCommitDate()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The default injection is a plain synchronous <script src>, which
      // Lighthouse counts as render blocking. Nothing on first paint depends on
      // the service worker registering.
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Portfolio Ledger · 组合账本',
        short_name: '组合账本',
        description: '跨券商、跨币种、可核对的投资组合账本',
        theme_color: '#0a0a0a',
        background_color: '#fafafa',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: '32x32 192x192 512x512', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && url.pathname.startsWith('/api/quote'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'quote-cache',
              expiration: { maxAgeSeconds: 60 * 5 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // The object form pulls a listed package's own dependencies into the
        // same chunk unless they are claimed elsewhere. `clsx` and
        // `tailwind-merge` are dependencies of both `cn()` and recharts, so
        // without this entry they landed inside `charts` and dragged all 385 KB
        // of recharts into the first load through `cn()` alone.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
          classnames: ['clsx', 'tailwind-merge'],
        },
      },
    },
  },
};

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (command === 'build') assertProductionPublicEnv(env);
  return appConfig;
});
