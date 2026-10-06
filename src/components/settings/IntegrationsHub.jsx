import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Cpu, Server, Pill, MessageSquare, Volume2, QrCode, Loader2, ArrowLeft, ChevronRight, Save, ShoppingCart, Mail, Send } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import machineIntegrationApi from '@/api/machineIntegrationApi'
import MachineIntegrationSetup from './MachineIntegrationSetup'
import QueueAnnouncementsPanel from './QueueAnnouncementsPanel'
import SelfRegistrationQr from '@/components/registration/SelfRegistrationQr'
import PurchaseSettings from '@/components/purchase/PurchaseSettings'
import { isModuleOn } from '@/lib/roleConfig'
import { rfqApi } from '@/api/purchaseRfqApi'
import { showApiError } from '@/lib/apiRequest'
import { useAuth } from '@/lib/auth'

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
    // The queue reaching a speaker in the corridor — the same shape of thing as
    // the PACS card reaching an imaging server, which is why it sits here rather
    // than among the organisation's own details.
    key: 'queue',
    name: 'Queue Display & Announcements',
    icon: Volume2,
    description: 'Name or token on the waiting-hall boards, the doctor name, and the spoken call.',
    kind: 'panel', // its own screen — see QueueAnnouncementsPanel
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
  {
    // A patient's phone reaching the hospital's registration desk. Nothing to
    // configure — the QR is this hospital's link — so it is a set-up-once item
    // for the admin, not something the counter screen needs to carry.
    key: 'selfRegistration',
    name: 'Patient Registration QR',
    icon: QrCode,
    description: 'Print the QR for the entrance. Patients scan it and fill their own details.',
    kind: 'panel', // its own screen — see SelfRegistrationQr
  },
  {
    // The purchase setup every order stands on — units of measure and item
    // categories (with the GST a new item starts at). Only where the Purchase
    // module is switched on; vendors and items live in Purchase → Masters.
    key: 'purchase',
    name: 'Purchase Setup',
    icon: ShoppingCart,
    description: 'Units of measure, item categories (the GST a new item starts with) and who approves how much.',
    kind: 'panel', // its own screen — see PurchaseSettings
    requiresModule: 'purchase',
  },
  {
    // The hospital's own mail server. Stored like the SMS gateway, in
    // settings.integrations.email — but saved through its own endpoint, which
    // seals the password: the settings JSON reaches every staff screen, so the
    // password is never in it in words and never comes back here (EmailPanel).
    // Only Purchase sends e-mail today (requests for quotation), so the card
    // shows where Purchase is on.
    key: 'email',
    name: 'E-mail (SMTP)',
    icon: Mail,
    description: "The hospital's mail server — used to e-mail requests for quotation to vendors.",
    kind: 'panel', // its own screen — see EmailPanel
    requiresModule: 'purchase',
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
                // A saved key is never sent back to the screen (settingsSecrets.js):
                // say it is there, and that a blank box keeps it.
                placeholder={f.type === 'password' && form[`${f.name}Saved`] ? 'Saved — leave blank to keep it' : (f.placeholder || '')}
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

// ── E-mail (SMTP) ─────────────────────────────────────────────────────────────
// Read and saved through /purchase (resource email-settings, administrator):
// the server answers without the password and says only whether one is saved;
// a blank password keeps the saved one. After a save the hospital's settings
// are read again, so a later save of another card carries the stored block.
const EMAIL_BLANK = { enabled: true, host: '', port: '587', secure: false, user: '', password: '', fromName: '', fromAddress: '' }

function EmailPanel({ onSaved, onBack }) {
  const { user } = useAuth()
  const [form, setForm] = useState(EMAIL_BLANK)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState(user?.email || '')
  const [testing, setTesting] = useState(false)
  const setField = (name, value) => setForm((f) => ({ ...f, [name]: value }))

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(null)
    rfqApi.getEmailSettings()
      .then((r) => {
        if (!alive) return
        const d = r?.data || {}
        const known = Object.fromEntries(Object.entries(d).filter(([k, v]) => k in EMAIL_BLANK && v != null))
        setForm({ ...EMAIL_BLANK, ...known, port: d.port ? String(d.port) : EMAIL_BLANK.port, password: '' })
        setPasswordSaved(!!d.passwordSaved)
      })
      .catch((err) => { if (alive) setLoadError(err?.message || 'Could not load the e-mail settings') })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [attempt])

  const save = async () => {
    setSaving(true)
    try {
      const r = await rfqApi.saveEmailSettings(form)
      setPasswordSaved(!!r.data?.passwordSaved)
      setField('password', '')
      toast.success('E-mail settings saved')
      try {
        const fresh = await client.get('/settings')
        if (fresh?.data?.settings) onSaved?.(fresh.data.settings)
      } catch (err) {
        showApiError(err, 'Saved — but this screen could not re-read the settings. Reload the page before changing another card.')
      }
    } catch (err) {
      showApiError(err, 'Could not save the e-mail settings')
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    setTesting(true)
    try {
      await rfqApi.sendTestEmail(testTo.trim())
      toast.success(`Test e-mail sent to ${testTo.trim()} — check that inbox`)
    } catch (err) {
      showApiError(err, 'The test e-mail did not go')
    } finally {
      setTesting(false)
    }
  }

  const text = (name, label, props = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`smtp-${name}`}>{label}</Label>
      <Input id={`smtp-${name}`} value={form[name] ?? ''} onChange={(e) => setField(name, e.target.value)} {...props} />
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
          <div>
            <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />E-mail (SMTP)</CardTitle>
            <CardDescription>The hospital&apos;s mail server. Requests for quotation are e-mailed to vendors with it when Settings → Purchase says so.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="max-w-xl space-y-3">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" /></div>
        ) : loadError ? (
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {loadError}
            <button type="button" className="ml-2 font-medium underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between"><Label htmlFor="smtp-enabled">Enabled</Label><Switch id="smtp-enabled" checked={!!form.enabled} onCheckedChange={(v) => setField('enabled', v)} /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">{text('host', 'Mail server (SMTP host) *', { placeholder: 'smtp.gmail.com', autoComplete: 'off' })}</div>
              {text('port', 'Port *', { inputMode: 'numeric', placeholder: '587' })}
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="smtp-secure">Secure connection (SSL, usually port 465)</Label>
              <Switch id="smtp-secure" checked={!!form.secure}
                onCheckedChange={(v) => setForm((f) => ({ ...f, secure: v, port: v && f.port === '587' ? '465' : !v && f.port === '465' ? '587' : f.port }))} />
            </div>
            {text('user', 'User name', { placeholder: 'purchase@yourhospital.in', autoComplete: 'off' })}
            <div className="space-y-1">
              <Label htmlFor="smtp-password">Password</Label>
              <Input id="smtp-password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setField('password', e.target.value)}
                placeholder={passwordSaved ? 'Saved — type a new one only to change it' : "The mail account's password"} />
              {passwordSaved && <p className="text-xs text-green-700">A password is saved. It is never shown again.</p>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {text('fromName', 'Sender name', { placeholder: 'City Hospital Purchase' })}
              {text('fromAddress', 'Send from address *', { type: 'email', placeholder: 'purchase@yourhospital.in' })}
            </div>
            <div className="pt-2">
              <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save</Button>
            </div>
            <div className="space-y-1 border-t pt-4">
              <Label htmlFor="smtp-test">Send a test e-mail (uses the saved settings)</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="smtp-test" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@yourhospital.in" />
                <Button variant="outline" onClick={sendTest} disabled={testing || !testTo.trim()} className="shrink-0">
                  {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}Send test e-mail
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Hub: 4 cards → click to open detail ──────────────────────────────────────
// `modules` — the hospital's module switches; a card with `requiresModule`
// shows only where that module is on.
export default function IntegrationsHub({ settings = {}, onSaved, modules = {} }) {
  const [view, setView] = useState(null) // null | 'lab' | 'pacs' | 'eapts' | 'sms' | 'purchase' …
  const cards = CATALOG.filter((c) => !c.requiresModule || isModuleOn(c.requiresModule, modules))
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
  if (view === 'queue') {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setView(null)}><ArrowLeft className="h-4 w-4 mr-1" />Back to Integrations</Button>
        <QueueAnnouncementsPanel settings={settings} onSaved={onSaved} />
      </div>
    )
  }
  if (view === 'selfRegistration') {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setView(null)}><ArrowLeft className="h-4 w-4 mr-1" />Back to Integrations</Button>
        <SelfRegistrationQr />
      </div>
    )
  }
  if (view === 'email') return <EmailPanel onSaved={onSaved} onBack={() => setView(null)} />
  if (view === 'purchase') {
    return (
      <div className="space-y-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <Button variant="outline" size="sm" onClick={() => setView(null)}><ArrowLeft className="h-4 w-4 mr-1" />Back to Integrations</Button>
          <span className="text-gray-300" aria-hidden="true">/</span>
          <span className="font-medium text-gray-700">Purchase Setup</span>
        </nav>
        <PurchaseSettings />
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
      {cards.map((def) => {
        const Icon = def.icon
        // Announcements are stored at the TOP level of settings, not under
        // .integrations — the display boards read them through the shared
        // orgSettingsSchema, so the badge has to look where they really are.
        const badge = def.key === 'lab'
          ? (machineCount != null
              ? { label: `${machineCount} machine${machineCount === 1 ? '' : 's'}`, cls: machineCount ? 'bg-green-100 text-green-700' : '' }
              : { label: 'Manage', cls: '' })
          : def.key === 'queue'
            ? (settings.announceEnabled
                ? { label: 'Speaking', cls: 'bg-green-100 text-green-700' }
                : { label: 'Silent', cls: '' })
            : def.key === 'selfRegistration'
              ? { label: 'Ready', cls: 'bg-green-100 text-green-700' }
              : def.key === 'purchase'
                ? { label: 'Manage', cls: '' }
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

