import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": process.env.VITE_API_TARGET || "http://127.0.0.1:5000",
    },
    // Named Cloudflare Tunnels can use either a custom domain or a generated
    // hostname. The tunnel still points only at this local development server.
    allowedHosts: true as const,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}))
