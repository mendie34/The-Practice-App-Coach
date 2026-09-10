import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // No favicon.svg asset exists for this app (the player repo references one that isn't
      // actually present either — not worth carrying the same gap forward); the PWA icons below
      // cover the installed-app case, and browsers fall back fine without a dedicated favicon.
      manifest: {
        name: "The Practice App — Coach",
        short_name: "Practice App Coach",
        description: "Coach dashboard for The Practice App — review player requests and analyze their stats",
        theme_color: "#14291F",
        background_color: "#14291F",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // Everything the app needs is bundled at build time; the only runtime data is Firestore,
        // which handles its own offline caching — a simple cache-everything strategy for the
        // static app shell is enough here (mirrors the player app's approach).
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
      },
    }),
  ],
});
