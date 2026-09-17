import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { QrCode, Download, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getOrgSettings, getOrgRaw } from '@/lib/orgSettings'

// The hospital's self-registration QR, delivered as a printable POSTER.
//
// A bare QR code on a wall tells a patient nothing: they cannot see whose it is
// or what scanning it does, so most walk past it. The download is an A4 poster
// instead — the hospital's logo and name, what the code is for, the code itself,
// and the four steps from scanning to the counter.
//
// Its own file so Settings can show it without importing the reception screen
// (and the whole registration form that comes with it). The link carries THIS
// hospital's id, so pass `orgId` when the caller already has it; otherwise the
// logged-in user's hospital is used. Name, logo and colour come from the same
// cached /settings read the printed bills use (getOrgSettings / getOrgRaw).

// A4 portrait at 150 dpi — sharp when printed, small enough to share.
const W = 1240
const H = 1754
const FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

const STEPS = [
  'Open your phone camera and point it at the QR code.',
  'Tap the link that appears on your screen.',
  'Fill in your details and press Submit.',
  'Go to the reception counter and tell them your name or mobile number.',
]

/** The QR is useless if it points at this computer rather than the live site. */
function isLocalOrigin() {
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h)
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    // A logo on another host must allow CORS, or the canvas becomes unexportable.
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Splits text into lines that fit maxWidth at the context's current font. */
function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w } else line = test
  }
  if (line) lines.push(line)
  return lines
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

async function drawPoster({ org, color, qrUrl, link, withLogo = true }) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // Page
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // ── Header band: logo + hospital name ──
  ctx.font = `700 64px ${FONT}`
  const nameLines = wrap(ctx, org.name || 'Hospital', W - 160).slice(0, 2)
  const bandH = 330 + nameLines.length * 76 + (org.city ? 44 : 0)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, W, bandH)

  const logoBox = 200
  const lx = (W - logoBox) / 2
  const ly = 60
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, lx, ly, logoBox, logoBox, 36)
  ctx.fill()
  const logo = withLogo ? await loadImage(org.logoUrl) : null
  if (logo) {
    const pad = 22
    const scale = Math.min((logoBox - pad * 2) / logo.width, (logoBox - pad * 2) / logo.height)
    const lw = logo.width * scale
    const lh = logo.height * scale
    ctx.drawImage(logo, lx + (logoBox - lw) / 2, ly + (logoBox - lh) / 2, lw, lh)
  } else {
    // No logo (or it would not load): the hospital's initials, so the box is never empty.
    const initials = String(org.name || 'H').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
    ctx.fillStyle = color
    ctx.font = `700 88px ${FONT}`
    ctx.fillText(initials, W / 2, ly + logoBox / 2 + 32)
  }

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 64px ${FONT}`
  let y = ly + logoBox + 100
  for (const l of nameLines) { ctx.fillText(l, W / 2, y); y += 76 }
  if (org.city) {
    ctx.font = `400 34px ${FONT}`
    ctx.globalAlpha = 0.85
    ctx.fillText(org.city, W / 2, y - 18)
    ctx.globalAlpha = 1
  }

  // ── Heading ──
  y = bandH + 110
  ctx.fillStyle = '#0f172a'
  ctx.font = `800 84px ${FONT}`
  ctx.fillText('Patient Registration', W / 2, y)
  y += 60
  ctx.fillStyle = '#475569'
  ctx.font = `500 38px ${FONT}`
  ctx.fillText('Scan with your mobile phone to register before the counter', W / 2, y)

  // Measure the steps first, so the QR takes whatever room is left and the
  // steps can never slide under the footer (a long hospital name adds a line
  // to the header band and would otherwise push them off the page).
  // Taller when the hospital has a phone number, to fit the helpdesk line.
  const footH = org.phone ? 220 : 150
  const left = 150
  const textX = left + 90
  const stepFont = `500 36px ${FONT}`
  const lineH = 46
  const stepGap = 28
  ctx.font = stepFont
  const stepLines = STEPS.map((s) => wrap(ctx, s, W - textX - 100))
  const stepsH = stepLines.reduce((h, l) => h + l.length * lineH + stepGap, 0) - stepGap

  // ── QR card ──
  const cardPad = 32
  const gapAboveCard = 44
  const gapBelowCard = 84
  const room = (H - footH - 50) - (y + gapAboveCard) - gapBelowCard - stepsH
  const cardW = Math.max(420, Math.min(672, room))
  const qrSize = cardW - cardPad * 2
  const cx = (W - cardW) / 2
  const cy = y + gapAboveCard
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = color
  ctx.lineWidth = 10
  roundRect(ctx, cx, cy, cardW, cardW, 40)
  ctx.fill()
  ctx.stroke()
  const qr = await loadImage(qrUrl)
  if (qr) ctx.drawImage(qr, cx + cardPad, cy + cardPad, qrSize, qrSize)

  // ── Steps ──
  y = cy + cardW + gapBelowCard
  stepLines.forEach((lines, i) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(left + 30, y - 12, 30, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 34px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(String(i + 1), left + 30, y)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#1e293b'
    ctx.font = stepFont
    lines.forEach((l, j) => ctx.fillText(l, textX, y + j * lineH))
    y += lines.length * lineH + stepGap
  })

  // ── Footer ──
  ctx.fillStyle = '#f1f5f9'
  ctx.fillRect(0, H - footH, W, footH)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#334155'
  ctx.font = `600 32px ${FONT}`
  ctx.fillText('No app needed  •  Takes about a minute  •  Saves time at the counter', W / 2, H - footH + 58)
  if (org.phone) {
    // "Need Help or Assistance? Call our Helpdesk: <number>" — one centred
    // line, the number bold in the hospital colour so it is found at a glance.
    // Shrinks to fit when the phone field holds more than one number.
    const ask = 'Need Help or Assistance?  Call our Helpdesk: '
    ctx.font = `500 32px ${FONT}`
    const fullAskW = ctx.measureText(ask).width
    ctx.font = `800 36px ${FONT}`
    const scale = Math.min(1, (W - 100) / (fullAskW + ctx.measureText(org.phone).width))
    const askFont = `500 ${Math.floor(32 * scale)}px ${FONT}`
    const numFont = `800 ${Math.floor(36 * scale)}px ${FONT}`
    ctx.font = askFont
    const askW = ctx.measureText(ask).width
    ctx.font = numFont
    const numW = ctx.measureText(org.phone).width
    const startX = (W - askW - numW) / 2
    ctx.textAlign = 'left'
    ctx.fillStyle = '#334155'
    ctx.font = askFont
    ctx.fillText(ask, startX, H - footH + 118)
    ctx.fillStyle = color
    ctx.font = numFont
    ctx.fillText(org.phone, startX + askW, H - footH + 118)
    ctx.textAlign = 'center'
  }
  ctx.fillStyle = '#64748b'
  ctx.font = `400 24px ${FONT}`
  ctx.fillText(wrap(ctx, link, W - 120)[0], W / 2, H - 34)

  return canvas.toDataURL('image/png')
}

export default function SelfRegistrationQr({ orgId: orgIdProp }) {
  const [org, setOrg] = useState(null)
  const orgId = orgIdProp || org?.id || ''
  const [qrUrl, setQrUrl] = useState('')
  const [posterUrl, setPosterUrl] = useState('')
  const [building, setBuilding] = useState(false)
  const link = orgId ? `${window.location.origin}/self-register?org=${orgId}` : ''
  const local = isLocalOrigin()

  // Name, logo, city, phone (print view) + id and brand colour (raw row) — one request.
  useEffect(() => {
    let live = true
    Promise.all([getOrgSettings(), getOrgRaw()])
      .then(([print, raw]) => { if (live) setOrg({ ...print, id: raw?.id, primaryColor: raw?.primaryColor }) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!link || !org) return
    let live = true
    setBuilding(true)
    ;(async () => {
      try {
        // High error-correction so the code still scans when printed small or if the
        // poster gets a little scuffed on a hospital wall.
        const qr = await QRCode.toDataURL(link, { width: 600, margin: 1, errorCorrectionLevel: 'H' })
        const color = /^#[0-9a-f]{6}$/i.test(org.primaryColor || '') ? org.primaryColor : '#2E4168'
        let poster
        try {
          poster = await drawPoster({ org, color, qrUrl: qr, link })
        } catch {
          // A logo served without CORS taints the canvas and blocks the export —
          // a poster without the logo is far better than no poster.
          poster = await drawPoster({ org, color, qrUrl: qr, link, withLogo: false })
        }
        if (live) { setQrUrl(qr); setPosterUrl(poster) }
      } catch {
        if (live) { setQrUrl(''); setPosterUrl('') }
      } finally {
        if (live) setBuilding(false)
      }
    })()
    return () => { live = false }
  }, [link, org])

  const save = (href, name) => {
    if (!href) return
    const a = document.createElement('a')
    a.href = href
    a.download = name
    a.click()
  }
  const slug = String(org?.name || 'hospital').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:items-start">
        <div className="shrink-0 rounded-lg border bg-white p-2 shadow-sm">
          {posterUrl
            ? <img src={posterUrl} alt="Patient registration poster" className="h-72 w-auto" />
            : (
              <div className="flex h-72 w-52 items-center justify-center text-slate-300">
                {building ? <Loader2 className="h-8 w-8 animate-spin" /> : <QrCode className="h-10 w-10" />}
              </div>
            )}
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h3 className="flex items-center justify-center gap-2 text-base font-semibold text-slate-800 sm:justify-start">
            <QrCode className="h-4 w-4 text-blue-600" /> Patient registration poster
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Print this A4 poster and put it at the entrance. It shows your hospital&rsquo;s logo and
            name, the QR code, and the steps — patients scan it with their phone and fill their own
            details before they reach the counter.
          </p>
          {link && <p className="mt-2 break-all rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">{link}</p>}

          {local && (
            <p className="mt-2 flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-left text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This page is open on a local address, so the QR points at this computer and will not
              open on a patient&rsquo;s phone. Download the poster from the live site instead.
            </p>
          )}

          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button size="sm" onClick={() => save(posterUrl, `patient-registration-poster-${slug}.png`)} disabled={!posterUrl}>
              <Download className="mr-1.5 h-4 w-4" /> Download poster
            </Button>
            <Button size="sm" variant="outline" onClick={() => save(qrUrl, `patient-registration-qr-${slug}.png`)} disabled={!qrUrl}>
              <Download className="mr-1.5 h-4 w-4" /> QR only
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
