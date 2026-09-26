import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // The guarded wrapper in src/lib/registerServiceWorker.ts is the only registrar.
      injectRegister: null,
      devOptions: { enabled: false },
      filename: "sw.js",
      includeAssets: ["favicon.ico", "app-icon.png"],

      manifest: {
        name: "SMC Trading Signals",
        short_name: "SMC Signals",
        description: "Smart Money Concepts trading signal analyzer with real-time market analysis",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "app-icon.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "app-icon.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "app-icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Evict caches from previous builds and take control immediately, so a
        // fixed bundle can never be shadowed by a stale cached one.
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // HTML navigations always hit the network first.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/~oauth/],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-navigations",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 20 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.deriv\.com/,
            handler: "NetworkFirst",
            options: {
              cacheName: "deriv-api-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5, // 5 minutes
              },
            },
          },
        ],
      },

    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
