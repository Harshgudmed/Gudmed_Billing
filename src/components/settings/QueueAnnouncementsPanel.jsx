import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Save, Volume2 } from 'lucide-react'
import client from '@/api/client'
import { toFormValues, fromFormValues } from '@/lib/orgSettingsSchema'
import { clearOrgCache } from '@/lib/orgSettings'

// What the waiting-hall display boards say out loud.
//
// Lives in the Integrations hub because that is what it is: the queue reaching
// out to a speaker in the corridor, the same way the PACS card reaches an
// imaging server. It is not an organisation detail like a GST number.
//
// Values are stored at the TOP level of Organization.settings (announceEnabled,
// announceLanguage, …) rather than under settings.integrations.queue, because
// the display boards read them through the same declared schema the rest of the
// app uses — see lib/orgSettingsSchema.js, which is the single place a default
// is written down.
export default function QueueAnnouncementsPanel({ settings, onSaved }) {
  const [form, setForm] = useState(() => toFormValues(settings || {}))
  const [saving, setSaving] = useState(false)

  // The hub can hand over newer settings after a sibling card saves.
  useEffect(() => { setForm(toFormValues(settings || {})) }, [settings])

  const set = (k) => (v) => setForm((p) => ({ ...p, [k]: v }))

  async function save() {
    setSaving(true)
    try {
      const merged = { ...(settings || {}), ...fromFormValues(form) }
      const res = await client.patch('/settings', { resource: 'organization', settings: merged })
      if (res.success) {
        toast.success('Announcement settings saved')
        clearOrgCache()
        onSaved?.(merged)
      } else {
        toast.error(res.error || 'Could not save')
      }
    } catch (e) {
      toast.error(e?.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-blue-600" />
          Queue Display &amp; Announcements
        </CardTitle>
        <CardDescription>
          What the waiting-hall display boards show, and what they say out loud.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── What the board SHOWS ────────────────────────────────────────── */}
        <div className="rounded-lg border bg-slate-50/60 p-4 space-y-4">
          <div>
            <div className="text-sm font-semibold">On the screen</div>
            <p className="text-xs text-gray-500">
              A screen is read by whoever looks at it. A speaker reaches the whole
              hall — so these are set separately from the spoken text below.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Show patients as</Label>
              <Select value={form.displayPatientAs} onValueChange={set('displayPatientAs')}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Patient name</SelectItem>
                  <SelectItem value="token">Token number only</SelectItem>
                  <SelectItem value="both">Name and token</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                A token cannot be tied to a person by anyone photographing the screen.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Doctor&rsquo;s name</Label>
              <label className="flex items-center gap-2 text-sm pt-2">
                <input
                  type="checkbox"
                  checked={!!form.displayShowDoctorName}
                  onChange={(e) => set('displayShowDoctorName')(e.target.checked)}
                />
                Show the doctor&rsquo;s name on the board
              </label>
              <p className="text-xs text-gray-500">
                Off keeps the room, the count and the queue — only the name goes.
                Some hospitals treat who is sitting where as internal.
              </p>
            </div>
          </div>
        </div>

        {/* ── What the board SAYS ─────────────────────────────────────────── */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!form.announceEnabled}
            onChange={(e) => set('announceEnabled')(e.target.checked)}
          />
          Speak announcements on display boards
        </label>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Language</Label>
            <Select value={form.announceLanguage} onValueChange={set('announceLanguage')}>
              <SelectTrigger><SelectValue placeholder="Select Language" /></SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto">
                <SelectItem value="en-IN">English (India)</SelectItem>
                <SelectItem value="en-US">English (US)</SelectItem>
                <SelectItem value="en-GB">English (UK)</SelectItem>
                <SelectItem value="hi-IN">हिन्दी (Hindi)</SelectItem>
                <SelectItem value="mr-IN">मराठी (Marathi)</SelectItem>
                <SelectItem value="ta-IN">தமிழ் (Tamil)</SelectItem>
                <SelectItem value="te-IN">తెలుగు (Telugu)</SelectItem>
                <SelectItem value="kn-IN">ಕನ್ನಡ (Kannada)</SelectItem>
                <SelectItem value="ml-IN">മലയാളം (Malayalam)</SelectItem>
                <SelectItem value="bn-IN">বাংলা (Bengali)</SelectItem>
                <SelectItem value="gu-IN">ગુજરાતી (Gujarati)</SelectItem>
                <SelectItem value="pa-IN">ਪੰਜਾਬੀ (Punjabi)</SelectItem>
                <SelectItem value="or-IN">ଓଡ଼ିଆ (Odia)</SelectItem>
                <SelectItem value="ur-IN">اردو (Urdu)</SelectItem>
                <SelectItem value="as-IN">অসমীয়া (Assamese)</SelectItem>
                <SelectItem value="es-ES">Español (Spanish)</SelectItem>
                <SelectItem value="fr-FR">Français (French)</SelectItem>
                <SelectItem value="ar-SA">العربية (Arabic)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              Hindi needs the Windows Hindi speech pack on each display PC. Without
              it the board speaks English and shows that it did.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Announce by</Label>
            <Select value={form.announceSay} onValueChange={set('announceSay')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Patient name</SelectItem>
                <SelectItem value="token">Token number only</SelectItem>
                <SelectItem value="both">Name and token</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              A name is heard by everyone in the hall, including people facing
              away. A token is not.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Repeat each announcement</Label>
            <Input
              type="number" min="1" max="3" placeholder="2"
              value={form.announceRepeat}
              onChange={(e) => set('announceRepeat')(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm pt-1">
              <input
                type="checkbox"
                checked={!!form.announceChime}
                onChange={(e) => set('announceChime')(e.target.checked)}
              />
              Play a chime first
            </label>
          </div>
        </div>

        {/* Two sentences, not one. They are different instructions: the first
            must keep the patient where they are, the second must bring them in.
            A single line can only do one of those jobs. */}
        <div className="space-y-2">
          <Label>When the patient is next &mdash; &ldquo;get ready&rdquo;</Label>
          <Input
            placeholder="{name}, you are next. Please wait near Room {room}."
            value={form.announceReadyText}
            onChange={(e) => set('announceReadyText')(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            This must NOT bring them to the door &mdash; the doctor is still with
            someone. Keep them nearby instead.
          </p>
        </div>

        <div className="space-y-2">
          <Label>When the doctor is free &mdash; &ldquo;come in&rdquo;</Label>
          <Input
            placeholder="{name}, please come to Room {room}."
            value={form.announceCallText}
            onChange={(e) => set('announceCallText')(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            You can use <code>{'{name}'}</code>, <code>{'{token}'}</code>,{' '}
            <code>{'{room}'}</code> and <code>{'{doctor}'}</code>. Anything with
            no value is left out rather than read aloud.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving…' : 'Save Announcement Settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

