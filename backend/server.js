import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import path from 'path'
import { fileURLToPath } from 'url'
import { router } from './src/routes/index.js'
import { errorHandler } from './src/middleware/errorHandler.js'
import { assertSecurityConfig } from './src/config/security.js'
import { startAllListeners } from './src/integration/hl7Listener.js'

// Fail-closed: refuse to boot an exploitable server in production (C7).
assertSecurityConfig()

const app  = express()
const PORT = process.env.PORT || 5000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Render/Vercel terminate TLS at a proxy — trust it so Secure cookies work
app.set('trust proxy', 1)

// ── CORS — works locally AND in production ───────────────────────────────────
// To add a new frontend URL: just add it to ALLOWED_ORIGINS or set FRONTEND_URL in .env
const ALLOWED_ORIGINS = [
  'http://localhost:5173',          // local dev
  'http://localhost:4173',          // local preview (npm run preview)
  'https://gudmed.vercel.app',      // production (old URL)
  'https://frontend-sigma-gray-63.vercel.app',  // old production frontend
  'https://gudmed-hms-new.vercel.app',           // current production frontend
  process.env.FRONTEND_URL,         // set this in Render dashboard → Environment
].filter(Boolean)

// Allow any localhost/127.0.0.1 port during development (Vite may fall back to
// 5174, 5175, … when 5173 is taken), while keeping the strict allowlist in prod.
const isLocalhost = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

// Allow private-LAN origins during development so a phone on the same WiFi can
// hit the dev server (e.g. https://192.168.0.108:5173 from `npm run dev:lan`).
const isPrivateLan = (origin) =>
  /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)

// Allow any *.vercel.app deployment. Every Vercel production/preview deploy gets
// a unique hashed subdomain, so listing them one-by-one is endless whack-a-mole.
const isVercelApp = (origin) => /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)

// Allow Cloudflare quick-tunnels (cloudflared tunnel --url) for sharing a local
// demo with a remote client. Dev-only — gated behind NODE_ENV !== 'production'.
const isCloudflareTunnel = (origin) => /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(origin)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    if (isVercelApp(origin)) return cb(null, true)
    if (process.env.NODE_ENV !== 'production' && (isLocalhost(origin) || isPrivateLan(origin) || isCloudflareTunnel(origin))) return cb(null, true)
    cb(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
}))

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
  xFrameOptions: false,
}))
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use(cookieParser())

// The Razorpay webhook signature is computed over the RAW request bytes, so this
// one path must NOT be JSON-parsed. Registering `express.raw` first sets
// `req._body`, which makes the `express.json` below skip it.
app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }))

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status:  'ok',
  env:     process.env.NODE_ENV,
  version: '1.0.0',
  time:    new Date(),
}))
app.use('/api', router)

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use(errorHandler)

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[${process.env.NODE_ENV}] Backend running on http://localhost:${PORT}`)

  // HL7 lab-analyzer listeners — opt-in via ENABLE_HL7_LISTENERS=true so this
  // only runs on a host that actually has analyzers on the LAN (not on
  // Vercel/Render serverless). Failures here never crash the API.
  if (process.env.ENABLE_HL7_LISTENERS === 'true') {
    startAllListeners()
      .then((started) => console.log(`[HL7] Started ${started.length} analyzer listener(s)`))
      .catch((e) => console.error('[HL7] Listener bootstrap failed:', e.message))
  }
})
