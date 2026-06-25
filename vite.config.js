import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env        = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'

  // `npm run dev:lan` (mode "lan") serves HTTPS + exposes the dev server on the
  // local network so a PHONE can use its camera to scan barcodes. In this mode
  // VITE_API_URL from .env.development is NOT loaded, so the app uses the proxied
  // "/api" path — which the phone can reach (and avoids http/https mixed content).
  const lan = mode === 'lan'

  return {
    plugins: [react(), ...(lan ? [basicSsl()] : [])],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: 5174,
      host: lan ? true : undefined, // expose on LAN for phone access
      // Allow Cloudflare quick-tunnel hosts (`cloudflared tunnel --url`) for remote demos.
      allowedHosts: ['.trycloudflare.com'],
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
      },
    },
    preview: {
      port: 4173,
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
      },
    },
  }
})
