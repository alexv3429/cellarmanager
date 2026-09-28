import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor",
              test: /node_modules/,
              maxSize: 400_000,
            },
          ],
        },
        strictExecutionOrder: true,
      },
    },
  },

  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",

      includeAssets: [
        "favicon.ico",
        "favicon.svg",
        "apple-touch-icon-180x180.png",
      ],

      manifest: {
        id: "/",
        name: "CellarManager",
        short_name: "Cellar",
        description:
          "Local-first wine cellar inventory management.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f7f4ef",
        theme_color: "#6d1b2b",
        categories: ["food", "lifestyle", "utilities"],
        shortcuts: [
          {
            name: "Inventory",
            short_name: "Inventory",
            description: "Browse cellar holdings",
            url: "/",
          },
          {
            name: "Activity",
            short_name: "Activity",
            description: "Review recent inventory changes",
            url: "/activity",
          },
        ],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      workbox: {
        cleanupOutdatedCaches: true,
        globIgnores: ["@powersync/**/*"],
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webmanifest,wasm}",
        ],
        maximumFileSizeToCacheInBytes:
          10 * 1024 * 1024,
        navigateFallback: "/index.html",
      },
    }),
  ],
})
