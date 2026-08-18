import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Save, Volume2, RotateCcw } from 'lucide-react'
import client from '@/api/client'
import { toFormValues, fromFormValues } from '@/lib/orgSettingsSchema'
import { clearOrgCache } from '@/lib/orgSettings'
import { templatesFor, isDefaultText, announceValues, retemplate } from '@/lib/announceTemplates'
// The preview is built with the display board's OWN functions, not a copy of
// them — a preview that can disagree with the board is worse than none, because
// it is the one people trust.
import { fillTemplate, browserEngine, createAnnouncer } from '@/lib/announce'

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
/**
 * The sentence as the hall will actually hear it, with a button to hear it.
 *
 * The box above holds `{name}` and `{room}`, which say nothing about what a
 * patient hears — and `{name}` changes meaning with the "Announce by" dropdown,
 * so the template alone cannot show the effect of that choice. This does.
 *
 * The play button matters more than it looks: it is the only way to find out,
 * before a waiting room does, that this PC has no voice for the chosen language
 * or that its speakers are muted.
 */
function Preview({ text, busy, onPlay }) {
  if (!text) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Will say</div>
        <div className="mt-0.5 break-words text-sm text-slate-700">&ldquo;{text}&rdquo;</div>
      </div>
      <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onPlay} disabled={busy}>
        <Volume2 className="mr-1.5 h-3.5 w-3.5" />
        {busy ? 'Playing…' : 'Hear it'}
      </Button>
    </div>
  )
}

export default function QueueAnnouncementsPanel({ settings, onSaved }) {
  const [form, setForm] = useState(() => toFormValues(settings || {}))
  const [saving, setSaving] = useState(false)

  // The hub can hand over newer settings after a sibling card saves.
  //
  // Anything still on a DEFAULT — including the older wording this app used to
  // ship, which wrote {token} into the sentence — is shown as the current
  // default for the chosen language. Otherwise a hospital that never touched
  // the text would sit on wording that ignores its own "Announce by" choice,
  // and be warned about a decision it never made. Text a hospital actually
  // wrote is left exactly as it is.
  useEffect(() => {
    const v = toFormValues(settings || {})
    setForm(retemplate(v, { lang: v.announceLanguage, mode: v.announceSay }))
  }, [settings])

  const set = (k) => (v) => setForm((p) => ({ ...p, [k]: v }))

  /**
   * Exactly what the hall will hear, built with the SAME two functions the
   * display board uses.
   *
   * The boxes hold `{name}`, `{room}` — abstract, and worse, `{name}` changes
   * meaning with the "Announce by" dropdown, so reading the template tells you
   * nothing about what a patient actually hears. Rendering it here with sample
   * values makes that dropdown visible instead of theoretical.
   *
   * It reuses announceValues and fillTemplate rather than approximating them:
   * a preview that can disagree with the board is worse than none, because it
   * is believed. That also means the numbers appear here as words, in the chosen
   * language, exactly as they will be spoken.
   */
  const preview = (template) => fillTemplate(template, announceValues({
    mode: form.announceSay,
    lang: form.announceLanguage,
    name: 'Ramesh Kumar',
    token: '127',
    room: '311',
    doctor: 'Dr. Sharma',
  }))

  const [playing, setPlaying] = useState(null)
  const listen = async (which, text) => {
    if (!text) return
    setPlaying(which)
    try {
      const eng = browserEngine()
      // Voices arrive asynchronously; the first click of a session would
      // otherwise pick the wrong language or none.
      if (!eng.voices().length) await new Promise((r) => setTimeout(r, 600))
      const a = createAnnouncer(eng)
      await new Promise((resolve) => {
        a.announce({
          id: `preview:${Date.now()}`, text,
          lang: form.announceLanguage,
          gender: form.announceVoiceGender,
          chime: !!form.announceChime,
          repeat: 1,
        })
        // The announcer resolves nothing to the caller, so poll its own count.
        const started = Date.now()
        const t = setInterval(() => {
          if (a._pendingCount() === 0 || Date.now() - started > 30000) { clearInterval(t); resolve() }
        }, 300)
      })
      if (!a.state.heard) toast.error('Nothing came out — check the speaker and the volume')
      else if (a.state.languageFallback) {
        toast.warning(`No ${a.state.languageFallback} voice on this PC — another one read it`)
      }
    } catch (e) {
      toast.error(e?.message || 'Could not play')
    } finally {
      setPlaying(null)
    }
  }

  /**
   * Changing the language changes the words with it — but only while they are
   * still an untouched default.
   *
   * Without the swap, picking मराठी loads a Marathi voice and hands it Hindi to
   * read. Without the guard, a hospital that spent ten minutes wording its own
   * announcement loses it by opening the dropdown to look at the options.
   */
  // BOTH dropdowns rewrite the two sentences, through one function.
  //
  // Language and "Announce by" are the same kind of change — each one alters how
  // the announcement reads — so they must behave identically. They did not:
  // language rewrote the boxes and Announce-by silently changed meaning behind a
  // placeholder, which is indistinguishable from the setting doing nothing.
  //
  // retemplate leaves anything the hospital wrote itself untouched, whichever
  // dropdown is used.
  const setLanguage = (lang) => setForm((p) => retemplate(p, { lang }))
  const setMode = (mode) => setForm((p) => retemplate(p, { mode }))

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

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>Language</Label>
            <Select value={form.announceLanguage} onValueChange={setLanguage}>
              <SelectTrigger><SelectValue placeholder="Select Language" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en-IN">English</SelectItem>
                <SelectItem value="hi-IN">हिन्दी (Hindi)</SelectItem>
                <SelectItem value="mr-IN">मराठी (Marathi)</SelectItem>
                <SelectItem value="ta-IN">தமிழ் (Tamil)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              Changing this rewrites both sentences below &mdash; unless you have
              already written your own, which is never overwritten. Each language
              also needs its Windows speech pack on every display PC; without it
              the board speaks English and shows on screen that it did.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Announce by</Label>
            <Select value={form.announceSay} onValueChange={setMode}>
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
            {/* The supplied wording says {token} outright, so it ignores this
                choice. Saying so beats letting an admin switch to "Patient name",
                hear a token, and conclude the setting is broken. */}
            {form.announceSay !== 'token'
              && /\{token\}/.test(String(form.announceReadyText || '') + String(form.announceCallText || ''))
              && !/\{name\}/.test(String(form.announceReadyText || '') + String(form.announceCallText || '')) && (
              <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                Your wording below asks for <code>{'{token}'}</code> directly, so
                it will speak the token whatever is chosen here. Put{' '}
                <code>{'{name}'}</code> in the sentence instead to follow this
                setting.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Voice</Label>
            <Select value={form.announceVoiceGender} onValueChange={set('announceVoiceGender')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="any">Whatever is installed</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              The language always wins: if only a male voice is installed for it,
              that one is used rather than an English female one.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Say it how many times</Label>
            <Select value={String(form.announceRepeat || 2)} onValueChange={set('announceRepeat')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Once</SelectItem>
                <SelectItem value="2">Twice</SelectItem>
                <SelectItem value="3">Three times</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              Twice is the usual: nobody hears the first one. Each extra reading
              holds the queue for a few seconds before the next patient is called.
            </p>
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
          <Preview
            text={preview(form.announceReadyText)}
            busy={playing === 'ready'}
            onPlay={() => listen('ready', preview(form.announceReadyText))}
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
          <Preview
            text={preview(form.announceCallText)}
            busy={playing === 'call'}
            onPlay={() => listen('call', preview(form.announceCallText))}
          />
          <p className="text-xs text-gray-500">
            Both sentences are rewritten by the &ldquo;Language&rdquo; and
            &ldquo;Announce by&rdquo; boxes above &mdash; until you edit them,
            after which your words are kept and neither box touches them again.
            <code className="ml-1">{'{name}'}</code>,{' '}
            <code>{'{token}'}</code>, <code>{'{room}'}</code> and{' '}
            <code>{'{doctor}'}</code> are filled in as the board speaks; anything
            with no value is left out rather than read aloud.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* The way back. An admin who has rewritten both sentences and wants
              the supplied wording again would otherwise have to retype it from
              memory, or reopen the dropdown and hope — and the dropdown will not
              overwrite their text, precisely because it protects it. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const tpl = templatesFor(form.announceLanguage, form.announceSay)
              setForm((p) => ({ ...p, announceReadyText: tpl.ready, announceCallText: tpl.call }))
              toast.info('Both sentences reset — press Save to keep it')
            }}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset wording
          </Button>
          <Button onClick={save} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving…' : 'Save Announcement Settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

