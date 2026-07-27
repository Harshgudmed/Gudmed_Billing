import { useEffect } from 'react'
import { useDisplayDevice } from '@/hooks/useDisplayDevice'

// The ONE URL every physical display opens (kiosk / Electron loads this). It
// self-registers, shows a pairing code until an admin links it to a screen in
// Settings → TV Boards → Screen Health, then sends the TV straight to that
// screen's live board (which keeps its own heartbeat going via ?deviceId=).
export default function DisplayAutoPage() {
  const { ready, status, screenId, pairingCode, deviceId } = useDisplayDevice()

  // Paired → go to the real board page (identical to opening it directly). We
  // navigate rather than iframe so there's zero nesting; the board heartbeats
  // itself using the deviceId we pass along, so health stays accurate.
  useEffect(() => {
    if (status !== 'unpaired' && screenId) {
      const target = `/display/screen/${screenId}?deviceId=${encodeURIComponent(deviceId || '')}`
      if (!window.location.pathname.startsWith('/display/screen/')) {
        window.location.replace(target)
      }
    }
  }, [status, screenId, deviceId])

  if (status !== 'unpaired' && screenId) {
    return <div style={styles.wrap}><div style={styles.spinner} /><div style={styles.hint}>Opening the queue board…</div><style>{`@keyframes gm-spin { to { transform: rotate(360deg) } }`}</style></div>
  }

  const connecting = !ready || status === 'connecting'

  return (
    <div style={styles.wrap}>
      <div style={styles.brand}>GudMed · Display</div>

      {connecting ? (
        <>
          <div style={styles.spinner} />
          <div style={styles.hint}>Connecting to the queue server…</div>
        </>
      ) : (
        <>
          <div style={styles.label}>Pair this screen</div>
          <div style={styles.code}>{pairingCode || '——————'}</div>
          <div style={styles.steps}>
            <p>1. Open <b>Settings → TV Boards → Screen Health</b> on any GudMed computer.</p>
            <p>2. Find the display showing code <b>{pairingCode || '——————'}</b>.</p>
            <p>3. Assign it to a screen. This TV will start showing the queue automatically.</p>
          </div>
          <div style={styles.footer}>This screen checks for its assignment automatically — leave it on.</div>
        </>
      )}

      <style>{`@keyframes gm-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const styles = {
  wrap: {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: '18px',
    background: 'radial-gradient(1200px 600px at 50% 0%, #17233f 0%, #0b1120 60%, #070b16 100%)',
    color: '#e8eefc', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', textAlign: 'center', padding: '5vw',
  },
  brand: { position: 'absolute', top: '4vh', letterSpacing: '.28em', textTransform: 'uppercase', fontSize: '13px', color: '#7d8bb0', fontWeight: 700 },
  label: { fontSize: 'clamp(16px, 2.2vw, 24px)', color: '#9fb0d8', letterSpacing: '.04em' },
  code: {
    fontSize: 'clamp(64px, 13vw, 190px)', fontWeight: 800, letterSpacing: '.12em', lineHeight: 1,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    background: 'linear-gradient(180deg, #ffffff, #b9c6ea)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  steps: { maxWidth: '640px', color: '#aab7d8', fontSize: 'clamp(13px, 1.5vw, 18px)', lineHeight: 1.7, marginTop: '8px' },
  footer: { position: 'absolute', bottom: '5vh', color: '#5f6d92', fontSize: '13px' },
  hint: { color: '#9fb0d8', fontSize: 'clamp(14px, 1.6vw, 18px)' },
  spinner: { width: '46px', height: '46px', borderRadius: '50%', border: '4px solid #24314f', borderTopColor: '#6c8cff', animation: 'gm-spin 0.9s linear infinite' },
}
