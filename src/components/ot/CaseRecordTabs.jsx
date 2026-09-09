import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, AlertCircle, Save, CheckCircle2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/format'
import { formatDuration } from './otDisplay'
import {
  otClinicalApi, ASA_GRADES, OT_FITNESS,
  ANAESTHESIA_TYPES, AIRWAY_DEVICES, VENTILATION_MODES,
  PROCEDURE_STATUS, PROCEDURE_STATUS_LABEL,
  PATIENT_DESTINATIONS, PATIENT_DESTINATION_LABEL,
  COMPLICATION_TYPES, COMPLICATION_TYPE_LABEL,
} from '@/api/otApi'

// The four documents a case produces, as four forms.
//
// Each is one per case and saved in place, so every form here is "load what is
// there, change some of it, save". Only the fields the user actually touched are
// sent, which is what lets the anaesthetist and the surgeon work on the same
// case without overwriting each other's half.

// ── Shared form plumbing ────────────────────────────────────────────────────
// Written once because all four forms do exactly the same five things around
// the one call that differs: hold a draft, know whether it is dirty, save, report
// the failure, and stop spinning afterwards.
function useDocForm(record, save, onSaved) {
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // A fresh record (another case opened, or a save came back) discards the
  // draft — otherwise the previous case's typing would be saved onto this one.
  useEffect(() => { setDraft({}); setError(null) }, [record?.id])

  const value = (field, fallback = '') => draft[field] ?? record?.[field] ?? fallback
  const set = (field) => (v) => setDraft((d) => ({ ...d, [field]: v }))
  const dirty = Object.keys(draft).length > 0

  const submit = async (extra = {}) => {
    setSaving(true)
    setError(null)
    try {
      await save({ ...draft, ...extra })
      toast.success('Saved')
      setDraft({})
      onSaved?.()
    } catch (e) {
      setError(e?.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return { value, set, dirty, saving, error, submit }
}

function Row({ label, children, className = '' }) {
  return (
    <div className={className}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

function Tick({ label, checked, onChange }) {
  return (
    <label className="flex items-start gap-2 rounded-md p-1.5 text-sm hover:bg-gray-50">
      <Checkbox checked={!!checked} onCheckedChange={onChange} className="mt-0.5" />
      <span>{label}</span>
    </label>
  )
}

function Picker({ options, value, onChange, placeholder = 'Select', labels }) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{labels?.[o] ?? o.replace(/_/g, ' ')}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Save bar, plus whatever the backend said when it refused.
function FormFooter({ form, label = 'Save', signedBy, signedAt }) {
  return (
    <>
      {form.error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{form.error}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-xs text-gray-500">
          {signedBy
            ? <>Recorded by <b className="font-medium text-gray-700">{signedBy}</b>{signedAt && ` · ${formatDateTime(signedAt)}`}</>
            : 'Not recorded yet'}
        </span>
        <Button
          size="sm"
          className="bg-blue-600 hover:bg-blue-700"
          disabled={form.saving || !form.dirty}
          onClick={() => form.submit()}
        >
          {form.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {label}
        </Button>
      </div>
    </>
  )
}

// ── Times ───────────────────────────────────────────────────────────────────

// 'YYYY-MM-DDTHH:mm' from local parts, which is what a datetime-local input
// takes. Never toISOString(), which converts to UTC and hands back the wrong
// hour — and for a case near midnight, the wrong day.
function localStamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const clockOnly = (v) =>
  v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''

// Null when either end is missing or unreadable — the caller shows nothing
// rather than a duration built from half an answer.
function minutesBetween(from, to) {
  if (!from || !to) return null
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 60_000)
}

// Whether anything went wrong, and what kind.
//
// Was one free-text box. "minor bleeding controlled" is a fine sentence and a
// useless row: counting bleeding complications across a year meant searching
// text for words nobody agreed on. The kinds are now ticked from a fixed list
// and the sentence is kept beside them, so the record reads the same and the
// count becomes possible.
//
// THREE states, and telling them apart is the point:
//   null / undefined   nobody has answered
//   []                 the surgeon said none
//   ['BLEEDING', ...]  these occurred
// An unanswered note must never read as "no complications" — that is how an
// audit comes to believe a hospital never has any.
function Complications({ types, details, onTypes, onDetails }) {
  // Stored as a JSON array string; a note written before this existed has null.
  const chosen = (() => {
    if (types === null || types === undefined || types === '') return null
    try {
      const parsed = JSON.parse(types)
      return Array.isArray(parsed) ? parsed : null
    } catch { return null }
  })()

  const answered = chosen !== null
  const storedNone = answered && chosen.length === 0

  // "Yes, but nothing ticked yet" is a real moment on screen and NOT a state the
  // column can hold — an empty array there means "none". So the radio keeps its
  // own answer, and nothing is written until there is something true to write.
  const [mode, setMode] = useState(null)
  useEffect(() => {
    if (answered === false) { setMode(null); return }
    setMode(chosen.length === 0 ? 'none' : 'yes')
    // Only when the saved value changes underneath — reopening the case, or
    // another tab's save landing. Typing here must not fight the user.
  }, [types]) // eslint-disable-line react-hooks/exhaustive-deps

  const none = mode === 'none'
  const yes = mode === 'yes'

  // An older note carries words but no ticks. Say so rather than showing it as
  // unanswered — somebody did write this down.
  const legacyText = answered === false && String(details ?? '').trim() !== ''

  const setNone = () => { setMode('none'); onTypes(JSON.stringify([])) }
  const setYes = () => {
    setMode('yes')
    // Deliberately writes nothing yet. Storing [] here would record "no
    // complications" for a case the surgeon has just said had one.
  }

  const toggle = (code) => {
    const list = chosen ?? []
    onTypes(JSON.stringify(
      list.includes(code) ? list.filter((c) => c !== code) : [...list, code],
    ))
  }

  const ticked = yes ? (chosen ?? []) : []
  const otherPicked = ticked.includes('OTHER')
  const detailsMissing = otherPicked && String(details ?? '').trim() === ''

  return (
    <Row label="Complications">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Choice on={none} onClick={setNone} label="None" />
          <Choice on={yes} onClick={setYes} label="Yes" />
        </div>

        {legacyText && (
          <p className="flex items-start gap-1.5 rounded-md bg-gray-50 p-2 text-xs text-gray-600">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
            Recorded before this form had types: <b className="font-medium">{details}</b>.
            Pick None or Yes to record it in a way that can be counted — the words
            below are kept either way.
          </p>
        )}

        {/* Ticks only once "Yes" is chosen. An uncomplicated case is one click
            and nothing typed, which is most of them. */}
        {yes && (
          <div className="space-y-2 rounded-md border p-2.5">
            <p className="text-xs font-medium text-gray-700">What kind? *</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {COMPLICATION_TYPES.map((code) => (
                <Tick
                  key={code}
                  label={COMPLICATION_TYPE_LABEL[code]}
                  checked={ticked.includes(code)}
                  onChange={() => toggle(code)}
                />
              ))}
            </div>
            {ticked.length === 0 && (
              <p className="text-xs text-amber-800">
                Tick at least one kind — nothing is recorded until you do.
              </p>
            )}
          </div>
        )}

        {/* The words stay whatever is ticked — they are what the next surgeon
            actually reads, and they are the only record of an older note. */}
        <div>
          <Label className="text-xs text-gray-600">
            Details{otherPicked ? ' *' : ''}
          </Label>
          <Textarea
            rows={2}
            value={details || ''}
            onChange={(e) => onDetails(e.target.value)}
            placeholder={none ? 'Nothing to add' : 'What happened, and what was done about it'}
          />
          {detailsMissing && (
            <p className="mt-1 text-xs text-amber-800">
              Say what the complication was — &quot;Other&quot; on its own records that
              something happened and refuses to say what.
            </p>
          )}
        </div>
      </div>
    </Row>
  )
}

// A None / Yes button pair. Not a Select: two options that change what the rest
// of the section asks for should both be visible without opening anything.
function Choice({ on, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
        on ? 'border-blue-500 bg-blue-50 font-medium text-blue-900' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
        on ? 'border-blue-600' : 'border-gray-300'
      }`}>
        {on && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
      </span>
      {label}
    </button>
  )
}

// What was actually done, against what was booked.
//
// These are two different facts and the bill follows this one, so it is never
// filled in automatically — a procedure nobody asserted is not a record. But it
// was being TYPED again, forty characters, into the one field on this form where
// a typo costs money. The tick copies the booked name; anything else is typed
// as before, and saying so out loud is the point of the line underneath.
//
// The tick is derived from the two strings rather than kept in its own state,
// so a note saved last week opens showing the truth about itself.
function PerformedProcedure({ scheduled, value, onChange }) {
  const booked = (scheduled || '').trim()
  const performed = (value || '').trim()
  const same = booked !== '' && performed === booked
  const differs = booked !== '' && performed !== '' && performed !== booked

  return (
    <Row label="Procedure performed">
      {booked !== '' && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-gray-500">Booked as</span>
          <span className="font-medium text-gray-800">{booked}</span>
        </div>
      )}

      <Input
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What was actually done — this drives the bill"
      />

      {booked !== '' && (
        <div className="mt-1.5">
          {/* Ticking copies the booked name; un-ticking empties the box to be
              typed in. Both directions are one click, and neither loses
              anything that was not one click away. */}
          <Tick
            label="Same as booked"
            checked={same}
            onChange={(on) => onChange(on ? booked : '')}
          />
          {differs && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-800">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              Different from what was booked. The bill follows this line, so say
              what changed in the notes below.
            </p>
          )}
        </div>
      )}
    </Row>
  )
}

// A time, with one tap to stamp the moment it happened.
//
// The datetime box stays for writing a note after the fact, which is how most
// of them are written — but during a case nobody types a date. "Now" is the
// whole point: a nurse taps it as the knife goes in.
function StampField({ value, onChange }) {
  return (
    <div className="flex gap-2">
      <Input
        type="datetime-local"
        className="min-w-0 flex-1"
        value={value?.slice?.(0, 16) || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => onChange(localStamp())}
      >
        <Clock className="mr-1 h-3.5 w-3.5" /> Now
      </Button>
    </div>
  )
}

const FITNESS_LABEL = {
  FIT: 'Fit for surgery',
  UNFIT: 'Not fit',
  FIT_WITH_CONDITIONS: 'Fit with conditions',
}

// ── 1. Pre-op assessment ────────────────────────────────────────────────────

export function PreOpTab({ bookingId, record, onSaved }) {
  const form = useDocForm(record, (fields) => otClinicalApi.savePreOp(bookingId, fields), onSaved)
  const { value, set } = form

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Diagnosis">
          <Input value={value('diagnosis')} onChange={(e) => set('diagnosis')(e.target.value)} placeholder="e.g. Chronic cholecystitis" />
        </Row>
        <Row label="Indication for surgery">
          <Input value={value('indication')} onChange={(e) => set('indication')(e.target.value)} placeholder="Why this operation is being done" />
        </Row>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Allergies">
          <Input value={value('allergies')} onChange={(e) => set('allergies')(e.target.value)} placeholder='"None known" is an answer' />
        </Row>
        <Row label="Current medication">
          <Input value={value('currentMedication')} onChange={(e) => set('currentMedication')(e.target.value)} />
        </Row>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Comorbidities">
          <Input value={value('comorbidities')} onChange={(e) => set('comorbidities')(e.target.value)} placeholder="DM, HTN, CAD, asthma…" />
        </Row>
        <Row label="Previous surgery / anaesthesia">
          <Input value={value('previousSurgery')} onChange={(e) => set('previousSurgery')(e.target.value)} />
        </Row>
      </div>

      <Separator />

      <div className="grid gap-3 sm:grid-cols-4">
        <Row label="ASA grade">
          <Picker options={ASA_GRADES} value={value('asaGrade')} onChange={set('asaGrade')} />
        </Row>
        <Row label="Mallampati (1–4)">
          <Input type="number" min="1" max="4" value={value('mallampati')} onChange={(e) => set('mallampati')(e.target.value)} />
        </Row>
        <Row label="Height (cm)">
          <Input type="number" value={value('heightCm')} onChange={(e) => set('heightCm')(e.target.value)} />
        </Row>
        <Row label="Weight (kg)">
          <Input type="number" value={value('weightKg')} onChange={(e) => set('weightKg')(e.target.value)} />
        </Row>
      </div>

      <Row label="Airway notes">
        <Input value={value('airwayNote')} onChange={(e) => set('airwayNote')(e.target.value)} placeholder="Anything that would make intubation difficult" />
      </Row>

      <div className="grid gap-3 sm:grid-cols-4">
        <Row label="Systolic BP">
          <Input type="number" value={value('systolicBp')} onChange={(e) => set('systolicBp')(e.target.value)} />
        </Row>
        <Row label="Diastolic BP">
          <Input type="number" value={value('diastolicBp')} onChange={(e) => set('diastolicBp')(e.target.value)} />
        </Row>
        <Row label="Heart rate">
          <Input type="number" value={value('heartRate')} onChange={(e) => set('heartRate')(e.target.value)} />
        </Row>
        <Row label="SpO₂ (%)">
          <Input type="number" value={value('spo2')} onChange={(e) => set('spo2')(e.target.value)} />
        </Row>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Row label="Blood group">
          <Input value={value('bloodGroup')} onChange={(e) => set('bloodGroup')(e.target.value)} placeholder="e.g. B+" />
        </Row>
        <Row label="Haemoglobin (g/dL)">
          <Input type="number" step="0.1" value={value('haemoglobin')} onChange={(e) => set('haemoglobin')(e.target.value)} />
        </Row>
        <Row label="Fasting from">
          <Input type="datetime-local" value={value('fastingFrom')?.slice?.(0, 16) || ''} onChange={(e) => set('fastingFrom')(e.target.value)} />
        </Row>
      </div>

      <Row label="Investigation reports">
        <Textarea rows={2} value={value('investigationNote')} onChange={(e) => set('investigationNote')(e.target.value)} placeholder="ECG, chest X-ray, coagulation — what was ordered and what it showed" />
      </Row>

      <Separator />

      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Consent">
          <div className="pt-1">
            <Tick label="Informed consent taken" checked={value('consentTaken', false)} onChange={set('consentTaken')} />
          </div>
        </Row>
        <Row label="Consent signed by">
          <Input value={value('consentBy')} onChange={(e) => set('consentBy')(e.target.value)} placeholder="Patient, or the relative and why" />
        </Row>
      </div>

      {/* The conclusion. Everything above is evidence for this one line, and the
          case must not proceed on UNFIT. */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Fitness for surgery">
            <Picker options={OT_FITNESS} value={value('fitness')} onChange={set('fitness')} labels={FITNESS_LABEL} />
          </Row>
          <Row label="Fitness notes">
            <Input value={value('fitnessNote')} onChange={(e) => set('fitnessNote')(e.target.value)} placeholder="Conditions, if any" />
          </Row>
        </div>
      </div>

      {/* A fitness decided a week ago is not a fitness now — the fast may be
          broken, the BP up, a chest infection new. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
          Re-assessment on the day
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Fitness today">
            <Picker options={OT_FITNESS} value={value('reassessFitness')} onChange={set('reassessFitness')} labels={FITNESS_LABEL} />
          </Row>
          <Row label="Notes">
            <Input value={value('reassessNote')} onChange={(e) => set('reassessNote')(e.target.value)} placeholder="Fasting confirmed, vitals rechecked…" />
          </Row>
        </div>
        {record?.reassessedAt && (
          <p className="mt-2 text-xs text-amber-800">
            Re-assessed by {record.reassessedByName} · {formatDateTime(record.reassessedAt)}
          </p>
        )}
      </div>

      <FormFooter form={form} label="Save assessment" signedBy={record?.assessedByName} signedAt={record?.assessedAt} />
    </div>
  )
}

// ── 2. WHO Surgical Safety Checklist ────────────────────────────────────────

const CHECKLIST_PHASES = [
  {
    key: 'signIn', title: 'Sign In', when: 'Before anaesthesia',
    atField: 'signInAt', byField: 'signInByName', noteField: 'signInNote',
    items: [
      ['identityConfirmed', 'Patient identity, procedure and site confirmed'],
      ['siteMarked', 'Surgical site marked'],
      ['consentConfirmed', 'Consent confirmed'],
      ['anaesthesiaCheck', 'Anaesthesia machine and medication check complete'],
      ['pulseOximeterOn', 'Pulse oximeter on the patient and working'],
      ['knownAllergy', 'Known allergy'],
      ['difficultAirwayRisk', 'Difficult airway or aspiration risk'],
      ['bloodLossRisk', 'Risk of >500 ml blood loss (7 ml/kg in children)'],
    ],
  },
  {
    key: 'timeOut', title: 'Time Out', when: 'Before the incision',
    atField: 'timeOutAt', byField: 'timeOutByName', noteField: 'timeOutNote',
    items: [
      ['teamIntroduced', 'All team members introduced by name and role'],
      ['patientSiteAgreed', 'Patient, site and procedure confirmed aloud'],
      ['antibioticGiven', 'Antibiotic prophylaxis given in the last 60 minutes'],
      ['imagingDisplayed', 'Essential imaging displayed'],
      ['criticalStepsSaid', 'Critical steps, duration and blood loss anticipated'],
    ],
  },
  {
    key: 'signOut', title: 'Sign Out', when: 'Before the patient leaves the room',
    atField: 'signOutAt', byField: 'signOutByName', noteField: 'signOutNote',
    items: [
      ['procedureRecorded', 'Procedure recorded as performed'],
      ['specimenLabelled', 'Specimen labelled, including patient name'],
    ],
  },
]

export function ChecklistTab({ bookingId, record, onSaved }) {
  const form = useDocForm(record, (fields) => otClinicalApi.saveCounts(bookingId, fields), onSaved)
  const { value, set } = form
  const [signing, setSigning] = useState(null)

  const signPhase = async (phase) => {
    setSigning(phase.key)
    try {
      await otClinicalApi.saveChecklistPhase(bookingId, phase.key, {
        ...Object.fromEntries(phase.items.map(([f]) => [f, value(f, false)])),
        [phase.noteField]: value(phase.noteField),
      })
      toast.success(`${phase.title} signed`)
      onSaved?.()
    } catch (e) {
      toast.error(e?.message || `Could not sign ${phase.title}`)
    } finally {
      setSigning(null)
    }
  }

  // A count that does not match is the whole reason the numbers are kept.
  const mismatch = ['swab', 'instrument', 'needle'].filter((k) => {
    const a = value(`${k}Initial`)
    const b = value(`${k}Final`)
    return a !== '' && b !== '' && Number(a) !== Number(b)
  })

  return (
    <div className="space-y-4">
      {CHECKLIST_PHASES.map((phase) => {
        const signedAt = record?.[phase.atField]
        return (
          <div key={phase.key} className="rounded-lg border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold">{phase.title}</span>
                <span className="ml-2 text-xs text-gray-500">{phase.when}</span>
              </div>
              {signedAt ? (
                <Badge className="bg-green-100 text-green-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {record[phase.byField]} · {formatDateTime(signedAt)}
                </Badge>
              ) : (
                <Badge className="bg-gray-100 text-gray-600">Not signed</Badge>
              )}
            </div>

            <div className="grid gap-0.5 sm:grid-cols-2">
              {phase.items.map(([field, label]) => (
                <Tick key={field} label={label} checked={value(field, false)} onChange={set(field)} />
              ))}
            </div>

            <Input
              className="mt-2"
              value={value(phase.noteField)}
              onChange={(e) => set(phase.noteField)(e.target.value)}
              placeholder="Notes"
            />

            {phase.key === 'signOut' && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Row label="Equipment problems">
                  <Input value={value('equipmentIssue')} onChange={(e) => set('equipmentIssue')(e.target.value)} />
                </Row>
                <Row label="Recovery concerns">
                  <Input value={value('recoveryConcern')} onChange={(e) => set('recoveryConcern')(e.target.value)} />
                </Row>
              </div>
            )}

            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant={signedAt ? 'outline' : 'default'}
                className={signedAt ? '' : 'bg-blue-600 hover:bg-blue-700'}
                disabled={signing === phase.key}
                onClick={() => signPhase(phase)}
              >
                {signing === phase.key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {signedAt ? `Re-sign ${phase.title}` : `Sign ${phase.title}`}
              </Button>
            </div>
          </div>
        )
      })}

      {/* The counts. WHO asks only whether they are correct; the numbers are kept
          as well, because a retained swab is found by comparing them. */}
      <div className="rounded-lg border p-3">
        <p className="mb-2 font-semibold">Instrument, swab and needle counts</p>

        <div className="grid gap-3 sm:grid-cols-3">
          {[['swab', 'Swabs'], ['instrument', 'Instruments'], ['needle', 'Needles']].map(([key, label]) => (
            <div key={key} className="rounded-md border p-2">
              <p className="mb-1 text-xs font-medium text-gray-600">{label}</p>
              <div className="grid grid-cols-2 gap-2">
                <Row label="Before">
                  <Input type="number" min="0" value={value(`${key}Initial`)} onChange={(e) => set(`${key}Initial`)(e.target.value)} />
                </Row>
                <Row label="After">
                  <Input type="number" min="0" value={value(`${key}Final`)} onChange={(e) => set(`${key}Final`)(e.target.value)} />
                </Row>
              </div>
            </div>
          ))}
        </div>

        {mismatch.length > 0 && (
          <div className="mt-2 flex items-start gap-2 rounded-md bg-red-50 p-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              The {mismatch.join(', ')} count does not match. Do not close until it is reconciled.
            </span>
          </div>
        )}

        <div className="mt-2">
          <Tick label="All counts correct" checked={value('countsCorrect', false)} onChange={set('countsCorrect')} />
        </div>
        <Input
          className="mt-1"
          value={value('countNote')}
          onChange={(e) => set('countNote')(e.target.value)}
          placeholder="Count notes"
        />
      </div>

      <FormFooter form={form} label="Save counts" signedBy={record?.countedByName} />
    </div>
  )
}

// ── 3. Anaesthesia record ───────────────────────────────────────────────────

export function AnaesthesiaTab({ bookingId, record, onSaved }) {
  const form = useDocForm(record, (fields) => otClinicalApi.saveAnaesthesia(bookingId, fields), onSaved)
  const { value, set } = form

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Row label="Anaesthesia type">
          <Picker options={ANAESTHESIA_TYPES} value={value('anaesthesiaType')} onChange={set('anaesthesiaType')} />
        </Row>
        <Row label="ASA grade">
          <Picker options={ASA_GRADES} value={value('asaGrade')} onChange={set('asaGrade')} />
        </Row>
        <Row label="Airway device">
          <Picker options={AIRWAY_DEVICES} value={value('airwayDevice')} onChange={set('airwayDevice')} />
        </Row>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Row label="Tube size">
          <Input value={value('tubeSize')} onChange={(e) => set('tubeSize')(e.target.value)} placeholder="e.g. 7.5" />
        </Row>
        <Row label="Ventilation mode">
          <Picker options={VENTILATION_MODES} value={value('ventilationMode')} onChange={set('ventilationMode')} />
        </Row>
        <Row label="Ventilator settings">
          <Input value={value('ventilatorNote')} onChange={(e) => set('ventilatorNote')(e.target.value)} placeholder="TV, RR, PEEP, FiO₂" />
        </Row>
      </div>

      <Row label="Drugs given">
        <Textarea rows={2} value={value('drugsGiven')} onChange={(e) => set('drugsGiven')(e.target.value)} placeholder="Agent, dose and time — e.g. Propofol 120 mg, Fentanyl 100 mcg" />
      </Row>

      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="IV fluids (ml)">
          <Input type="number" min="0" value={value('fluidsMl')} onChange={(e) => set('fluidsMl')(e.target.value)} />
        </Row>
        <Row label="Fluid notes">
          <Input value={value('fluidNote')} onChange={(e) => set('fluidNote')(e.target.value)} placeholder="RL, NS, colloid…" />
        </Row>
      </div>

      <div className="rounded-lg border p-3">
        <Tick label="Blood or blood products given" checked={value('bloodGiven', false)} onChange={set('bloodGiven')} />
        {value('bloodGiven', false) && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Row label="Units">
              <Input type="number" min="0" value={value('bloodUnits')} onChange={(e) => set('bloodUnits')(e.target.value)} />
            </Row>
            <Row label="Product, group and cross-match">
              <Input value={value('bloodNote')} onChange={(e) => set('bloodNote')(e.target.value)} />
            </Row>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Induction at">
          <Input type="datetime-local" value={value('inductionAt')?.slice?.(0, 16) || ''} onChange={(e) => set('inductionAt')(e.target.value)} />
        </Row>
        <Row label="Reversal at">
          <Input type="datetime-local" value={value('reversalAt')?.slice?.(0, 16) || ''} onChange={(e) => set('reversalAt')(e.target.value)} />
        </Row>
      </div>

      <Row label="Monitoring notes">
        <Textarea rows={2} value={value('monitoringNote')} onChange={(e) => set('monitoringNote')(e.target.value)} placeholder="What was monitored, and anything it showed" />
      </Row>

      <Row label="Complications">
        <Input value={value('complication')} onChange={(e) => set('complication')(e.target.value)} placeholder='"Nil" is an answer' />
      </Row>

      <FormFooter form={form} label="Save anaesthesia record" signedBy={record?.recordedByName} />
    </div>
  )
}

// ── 4. Operative note ───────────────────────────────────────────────────────

export function OpNoteTab({ bookingId, booking, record, onSaved }) {
  const form = useDocForm(record, (fields) => otClinicalApi.saveOpNote(bookingId, fields), onSaved)
  const { value, set } = form

  const incision = value('incisionAt')
  const closure = value('closureAt')
  const operatingMinutes = minutesBetween(incision, closure)

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Incision at">
            <StampField value={incision} onChange={set('incisionAt')} />
          </Row>
          <Row label="Closure at">
            <StampField value={closure} onChange={set('closureAt')} />
          </Row>
        </div>

        {/* Knife-to-skin and closure are NOT when the patient came in and went
            out — induction, positioning and draping sit before the first, and
            dressing and extubation after the second. The theatre's own two
            timestamps are shown as the anchor to write against, never copied
            into these fields: an incision time is what a surgical-site
            infection audit counts from, and ten minutes of convenience there
            would be ten minutes of quietly wrong data. */}
        {(booking?.actualStart || booking?.actualEnd) && (
          <p className="text-xs text-gray-500">
            Theatre recorded: in at <b className="text-gray-700">{clockOnly(booking.actualStart)}</b>
            {booking.actualEnd && <> · out at <b className="text-gray-700">{clockOnly(booking.actualEnd)}</b></>}
          </p>
        )}

        {operatingMinutes !== null && (
          <p className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm ${
            operatingMinutes > 0 ? 'bg-blue-50 text-blue-900' : 'bg-red-50 text-red-800'
          }`}>
            <Clock className="h-4 w-4 shrink-0" />
            {operatingMinutes > 0
              ? <>Operating time <b>{formatDuration(operatingMinutes)}</b> — calculated, not entered</>
              : 'Closure cannot be before incision'}
          </p>
        )}
      </div>

      <Row label="Operative findings">
        <Textarea rows={3} value={value('findings')} onChange={(e) => set('findings')(e.target.value)} placeholder="What was found on opening" />
      </Row>

      {/* Kept apart from the booked procedure on purpose: a case is booked as one
          operation and not rarely becomes another on the table, and the bill
          follows what was performed.
          Apart, but not unaided — in most cases the two are the same sentence,
          and it was being typed out again into the one field a typo costs money
          in. One tick copies it; changing it is still a deliberate act. */}
      <PerformedProcedure
        scheduled={booking?.procedureName}
        value={value('procedurePerformed')}
        onChange={set('procedurePerformed')}
      />

      {/* How it ended. A case abandoned after induction and one that finished as
          planned were indistinguishable in this record until now — same fields,
          same shape, and the bill and the audit both read them the same way. */}
      <Row label="How the case ended">
        <Picker
          options={PROCEDURE_STATUS}
          labels={PROCEDURE_STATUS_LABEL}
          value={value('procedureStatus')}
          onChange={set('procedureStatus')}
          placeholder="Completed, changed, or abandoned"
        />
        {value('procedureStatus') === 'ABANDONED' && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            Say in the notes below at what point it was stopped and why.
          </p>
        )}
      </Row>

      <Row label="Procedure notes">
        <Textarea rows={4} value={value('procedureNote')} onChange={(e) => set('procedureNote')(e.target.value)} placeholder="Step-by-step account" />
      </Row>

      <Complications
        types={value('complicationTypes')}
        details={value('complication')}
        onTypes={set('complicationTypes')}
        onDetails={set('complication')}
      />

      <Row label="Estimated blood loss (ml)" className="sm:max-w-[220px]">
        <Input type="number" min="0" value={value('bloodLossMl')} onChange={(e) => set('bloodLossMl')(e.target.value)} />
      </Row>

      <div className="rounded-lg border p-3">
        <Tick label="Specimen sent" checked={value('specimenSent', false)} onChange={set('specimenSent')} />
        {value('specimenSent', false) && (
          <Input
            className="mt-2"
            value={value('specimenDetail')}
            onChange={(e) => set('specimenDetail')(e.target.value)}
            placeholder="What, how many, and where it was sent"
          />
        )}
      </div>

      <Row label="Drains">
        <Input value={value('drainDetail')} onChange={(e) => set('drainDetail')(e.target.value)} placeholder="Type, site, number" />
      </Row>

      <Row label="Post-operative instructions">
        <Textarea rows={3} value={value('postOpInstruction')} onChange={(e) => set('postOpInstruction')(e.target.value)} placeholder="Diet, analgesia, mobilisation, review" />
      </Row>

      {/* The handover, written down. The record used to stop at the theatre door,
          so nothing said whether the patient went to a ward bed or to ICU — the
          one line the receiving nurse most needs. */}
      <Row label="Patient went to">
        <Picker
          options={PATIENT_DESTINATIONS}
          labels={PATIENT_DESTINATION_LABEL}
          value={value('patientDestination')}
          onChange={set('patientDestination')}
          placeholder="Where the patient was handed over"
        />
      </Row>

      <FormFooter form={form} label="Save operative note" signedBy={record?.dictatedByName} signedAt={record?.dictatedAt} />
    </div>
  )
}
