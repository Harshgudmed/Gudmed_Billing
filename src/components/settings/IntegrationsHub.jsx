import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Cpu, Server, Pill, MessageSquare, Loader2, ArrowLeft, ChevronRight, Save } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import machineIntegrationApi from '@/api/machineIntegrationApi'
import MachineIntegrationSetup from './MachineIntegrationSetup'

// ── Integration catalog: 4 cards shown on the hub ────────────────────────────
// `lab` opens the full machine-management screen; the rest open a config panel
// whose values live in the hospital's Organization.settings.integrations.<key>.
const CATALOG = [
  {
    key: 'lab',
    name: 'Lab & Device Machines',
    icon: Cpu,
    description: 'Connect analyzers / equipment (HL7/ASTM). Results flow in automatically.',
    kind: 'panel', // custom screen
  },
  {
    key: 'pacs',
    name: 'PACS Integration',
    icon: Server,
    description: 'Medical imaging (X-ray/CT/MRI) — Orthanc PACS + OHIF viewer.',
    kind: 'config',
    fields: [
      { name: 'enabled', label: 'Enabled', type: 'switch' },
      { name: 'orthancUrl', label: 'Orthanc Server URL', placeholder: 'http://localhost:8042' },
      { name: 'dicomWebUrl', label: 'DICOMweb URL', placeholder: 'http://localhost:8042/dicom-web' },
      { name: 'ohifViewerUrl', label: 'OHIF Viewer URL', placeholder: 'http://localhost:3000/viewer' },
      { name: 'aeTitle', label: 'AE Title', placeholder: 'ORTHANC' },
    ],
    note: 'Note: images dikhne ke liye Orthanc + OHIF server chalu hona chahiye (Phase 2). Config yahan save hoga.',
  },
  {
    key: 'eapts',
    name: 'eAPTS (Pharmacy)',
    icon: Pill,
    description: 'Government narcotics / drug tracking sync for pharmacy.',
    kind: 'config',
    fields: [
      { name: 'enabled', label: 'Enabled', type: 'switch' },
      { name: 'apiUrl', label: 'eAPTS API URL', placeholder: 'https://eapts.gov.in/api' },
      { name: 'apiKey', label: 'API Key', type: 'password' },
      { name: 'facilityCode', label: 'Facility Code', placeholder: 'Your facility ID' },
      { name: 'autoSyncEnabled', label: 'Auto Sync', type: 'switch' },
      { name: 'syncIntervalMinutes', label: 'Sync Interval (minutes)', type: 'number', placeholder: '60' },
    ],
  },
  {
    key: 'sms',
    name: 'SMS Gateway',
    icon: MessageSquare,
    description: 'SMS alerts — appointment, reports ready, critical values.',
    kind: 'config',
    fields: [
      { name: 'enabled', label: 'Enabled', type: 'switch' },
      { name: 'provider', label: 'Provider', type: 'select', options: ['msg91', 'twilio', 'textlocal', 'gupshup', 'other'] },
      { name: 'apiUrl', label: 'API URL', placeholder: 'https://api.msg91.com/...' },
      { name: 'apiKey', label: 'API Key', type: 'password' },
      { name: 'senderId', label: 'Sender ID', placeholder: 'e.g. GUDMED' },
    ],
  },
]

function configBadge(cfg) {
  if (!cfg || Object.keys(cfg).length === 0) return { label: 'Not Configured', cls: '' }
  if (cfg.enabled) return { label: 'Connected', cls: 'bg-green-100 text-green-700' }
  return { label: 'Configured (off)', cls: 'bg-yellow-100 text-yellow-700' }
}

// ── Inline config panel for pacs / eapts / sms ───────────────────────────────
function ConfigPanel({ def, settings, onSaved, onBack }) {
  const integrations = settings.integrations || {}
  const [form, setForm] = useState({ ...(integrations[def.key] || {}) })
  const [saving, setSaving] = useState(false)
  const setField = (name, value) => setForm((f) => ({ ...f, [name]: value }))

  const save = async () => {
    const cleaned = { ...form }
    if ('syncIntervalMinutes' in cleaned) cleaned.syncIntervalMinutes = Number(cleaned.syncIntervalMinutes) || 60
    const merged = { ...settings, integrations: { ...integrations, [def.key]: cleaned } }
    setSaving(true)
    try {
      const res = await client.patch('/settings', { resource: 'organization', settings: merged })
      if (res.success === false) throw new Error(res.error || 'Save failed')
      toast.success(`${def.name} saved`)
      onSaved?.(merged)
      onBack()
    } catch (e) {
      toast.error('Save failed', { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const Icon = def.icon
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
          <div>
            <CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5" />{def.name}</CardTitle>
            <CardDescription>{def.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 max-w-xl">
        {def.fields.map((f) => (
          <div key={f.name} className={f.type === 'switch' ? 'flex items-center justify-between' : 'space-y-1'}>
            <Label>{f.label}</Label>
            {f.type === 'switch' ? (
              <Switch checked={!!form[f.name]} onCheckedChange={(v) => setField(f.name, v)} />
            ) : f.type === 'select' ? (
              <Select value={form[f.name] || ''} onValueChange={(v) => setField(f.name, v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>{f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input
                type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                value={form[f.name] ?? ''}
                onChange={(e) => setField(f.name, e.target.value)}
                placeholder={f.placeholder || ''}
              />
            )}
          </div>
        ))}
        {def.note && <p className="text-xs text-amber-600">{def.note}</p>}
        <div className="pt-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Hub: 4 cards → click to open detail ──────────────────────────────────────
export default function IntegrationsHub({ settings = {}, onSaved }) {
  const [view, setView] = useState(null) // null | 'lab' | 'pacs' | 'eapts' | 'sms'
  const [machineCount, setMachineCount] = useState(null)

  useEffect(() => {
    machineIntegrationApi.listIntegrations()
      .then((r) => setMachineCount((r.data || []).length))
      .catch(() => setMachineCount(null))
  }, [])

  if (view === 'lab') {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setView(null)}><ArrowLeft className="h-4 w-4 mr-1" />Back to Integrations</Button>
        <MachineIntegrationSetup />
      </div>
    )
  }
  if (view) {
    const def = CATALOG.find((c) => c.key === view)
    return <ConfigPanel def={def} settings={settings} onSaved={onSaved} onBack={() => setView(null)} />
  }

  // Launcher: 4 cards
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {CATALOG.map((def) => {
        const Icon = def.icon
        const badge = def.key === 'lab'
          ? (machineCount != null
              ? { label: `${machineCount} machine${machineCount === 1 ? '' : 's'}`, cls: machineCount ? 'bg-green-100 text-green-700' : '' }
              : { label: 'Manage', cls: '' })
          : configBadge((settings.integrations || {})[def.key])
        return (
          <button
            key={def.key}
            type="button"
            onClick={() => setView(def.key)}
            className="text-left p-5 border rounded-lg hover:shadow-md hover:border-blue-300 transition group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium flex items-center gap-2">
                <Icon className="h-5 w-5 text-blue-600" />{def.name}
              </span>
              <Badge className={badge.cls || undefined} variant={badge.cls ? undefined : 'secondary'}>{badge.label}</Badge>
            </div>
            <p className="text-sm text-gray-500 mb-3">{def.description}</p>
            <span className="text-sm text-blue-600 inline-flex items-center group-hover:gap-1.5 gap-1">
              Open <ChevronRight className="h-4 w-4" />
            </span>
          </button>
        )
      })}
    </div>
  )
}
