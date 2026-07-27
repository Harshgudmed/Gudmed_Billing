import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import client from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { RotateCw, MonitorPlay } from 'lucide-react'

// One place that decides how each status looks — matches the backend's
// getDeviceStatus() values (unpaired | online | reconnecting | offline).
const STATUS = {
  online:       { label: 'Online',       dot: '#16a34a', bg: '#dcfce7', fg: '#166534' },
  reconnecting: { label: 'Reconnecting', dot: '#d97706', bg: '#fef3c7', fg: '#92400e' },
  offline:      { label: 'Offline',      dot: '#dc2626', bg: '#fee2e2', fg: '#991b1b' },
  unpaired:     { label: 'Needs pairing', dot: '#2563eb', bg: '#dbeafe', fg: '#1e40af' },
}

function ago(iso) {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.offline
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: s.bg, color: s.fg }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.dot }} />
      {s.label}
    </span>
  )
}

export default function ScreenHealth({ screens = [] }) {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await client.get('/display/devices')
      setDevices(res.data || [])
    } catch {
      // a transient poll failure shouldn't wipe the table
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll every 10s so online/offline stays live without a manual refresh.
  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  async function assign(deviceId, screenId) {
    setSavingId(deviceId)
    try {
      await client.post(`/display/devices/${deviceId}/assign`, { screenId: screenId || null })
      toast.success(screenId ? 'Screen assigned' : 'Screen unpaired')
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not assign')
    } finally {
      setSavingId(null)
    }
  }

  const online = devices.filter(d => d.status === 'online').length
  const offline = devices.filter(d => d.status === 'offline' || d.status === 'reconnecting').length
  const unpaired = devices.filter(d => d.status === 'unpaired').length

  if (loading) return <div className="p-8 text-center text-gray-500">Loading screen health…</div>

  return (
    <div className="space-y-4">
      {/* Summary tiles — what needs attention reads at a glance. */}
      <div className="grid grid-cols-3 gap-3">
        {[['Online', online, '#16a34a'], ['Down / reconnecting', offline, '#dc2626'], ['Waiting to pair', unpaired, '#2563eb']].map(([label, n, c]) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: c }}>{n}</div>
          </CardContent></Card>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Every TV that opens the display page shows up here. A screen that stops sending updates turns <b>Offline</b> so you know it's down.</p>
        <button onClick={load} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <RotateCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {devices.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-gray-400">
          <MonitorPlay className="mx-auto mb-2 h-6 w-6" />
          No displays yet. Open the display page on a TV — it will register here automatically.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Display</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Assigned screen</th>
                <th className="px-4 py-2.5">Last seen</th>
                <th className="px-4 py-2.5">Assign / change</th>
              </tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.deviceId} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{d.friendlyName || 'Unnamed display'}</div>
                    <div className="text-[11px] text-gray-400">
                      {d.status === 'unpaired' && d.pairingCode
                        ? <>code <span className="font-mono font-semibold text-blue-600">{d.pairingCode}</span></>
                        : <span className="font-mono">{d.deviceId.slice(0, 8)}</span>}
                      {d.appVersion ? ` · v${d.appVersion}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-3 text-gray-700">{d.screen?.name || <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3 text-gray-500 tabular-nums">{ago(d.lastSeenAt)}</td>
                  <td className="px-4 py-3">
                    <select
                      value={d.screenId || ''}
                      disabled={savingId === d.deviceId}
                      onChange={e => assign(d.deviceId, e.target.value)}
                      className="rounded-md border px-2 py-1.5 text-sm disabled:opacity-50"
                    >
                      <option value="">— Unassigned —</option>
                      {screens.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
