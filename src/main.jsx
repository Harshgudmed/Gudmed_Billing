import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from '@/lib/auth'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import './styles/globals.css'

// After a new deploy, an already-open tab's index.html still points at chunk
// files whose hashed names no longer exist, so the next lazy import 404s and the
// page fails to render. Vite fires `vite:preloadError` for exactly this; reload
// once to fetch the fresh index and its current chunks, instead of showing the
// error screen. The timestamp guard allows recovery after every future deploy
// while stopping a reload loop if the failure is something a reload won't fix.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const KEY = 'chunkReloadAt'
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY)) || 0 } catch { /* storage blocked */ }
  if (Date.now() - last > 10000) {
    try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
    window.location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </ErrorBoundary>
)
