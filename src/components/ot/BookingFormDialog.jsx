import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import PatientLookup from '@/components/common/PatientLookup'
import { useBookingSource } from '@/components/common/hooks/useBookingSource'
import { useDebounce } from '@/lib/useDebounce'
import { drName } from '@/lib/utils'
import { Loader2, AlertCircle, AlertTriangle, Check, Clock, Info, Plus, User, X } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import { otApi, OT_PRIORITIES, OT_LATERALITY } from '@/api/otApi'
import { OT_LATERALITY_LABEL, formatSlot, formatDuration } from './otDisplay'

// Book a case into a theatre.
//
// Six numbered steps, filled top to bottom, with a running summary beside them.
// The order is not cosmetic: everything the server checks a slot against is
// asked for BEFORE the slot.
//
//   1 Patient            ─┐
//   2 Procedure & surgeon ─┴─ the three the clash check runs on
//   3 When, then where    ─── so this step can say what is actually open
//   4 Equipment  5 Rest of the team  6 Other
//
// The server refuses a booking on the theatre, the primary surgeon OR the
// patient. Asking for the surgeon after the theatre meant the form could report
// "OT-1 free", take the booking, and be refused for a surgeon already operating
// down the corridor — a decision invalidated two steps after it was made. The
// assistant, the anaesthetist and the nurses are not checked by the server, so
// they come after the slot rather than standing in front of it.
//
// The clash rules are NOT re-implemented here. The backend owns them — one
// theatre, one surgeon, one patient, plus the cleaning gap — and the availability
// endpoint answers with those same rules. What this form shows and what the
// server allows are the same code, so they cannot drift.

const emptyForm = {
  departmentId: '',
  theatreId: '',
  surgeryId: '',
  procedureName: '',
  laterality: 'NA',
  siteOfSurgery: '',
  priority: 'ELECTIVE',
  date: '',
  startTime: '09:00',
  estimatedMinutes: '',
  patientLocation: '',
  equipmentNeeded: '',
  primarySurgeonId: '',
  anaesthetistId: '',
  assistantSurgeonId: '',
  scrubNurseId: '',
  circulatingNurseId: '',
  notes: '',
}

// Where a patient waits before theatre. A list, because these are the same few
// places every time and free text turns one ward into three.
const PATIENT_LOCATIONS = [
  'Ward', 'Private Room', 'ICU', 'Day Care', 'Emergency', 'Pre-op Holding', 'Home (day of surgery)',
]

// The kit a theatre is asked to have ready.
const OT_EQUIPMENT = [
  'C-Arm', 'Laparoscopy Stack', 'Operating Microscope', 'Arthroscopy Set',
  'Harmonic Scalpel', 'Electrocautery', 'Tourniquet', 'Ultrasound',
  'Cell Saver', 'Image Intensifier', 'Endoscopy Tower', 'Defibrillator',
]

// What each speciality usually asks for. Keyed on the first word of the
// department name, because hospitals write "Orthopaedics", "Orthopedic Surgery"
// and "Ortho Dept" for the same place.
//
// This belongs in the database, not here — a hospital cannot edit its own kit
// list without a deploy, and two hospitals on this system do not own the same
// machines. It stays hard-coded until SurgeryCatalog carries the equipment for
// each procedure, which is the narrower and more useful place for it.
//
// Every list is a SHORTLIST, never the whole truth — an ENT surgeon may still
// want a C-arm — so the form always offers a way back to the full list.
const EQUIPMENT_BY_SPECIALITY = {
  ortho: ['C-Arm', 'Image Intensifier', 'Tourniquet', 'Arthroscopy Set', 'Electrocautery'],
  general: ['Laparoscopy Stack', 'Electrocautery', 'Harmonic Scalpel', 'Ultrasound'],
  surgery: ['Laparoscopy Stack', 'Electrocautery', 'Harmonic Scalpel', 'Ultrasound'],
  ophthalmology: ['Operating Microscope'],
  eye: ['Operating Microscope'],
  ent: ['Endoscopy Tower', 'Electrocautery', 'Operating Microscope'],
  obstetrics: ['Electrocautery', 'Ultrasound', 'Defibrillator'],
  gynaecology: ['Laparoscopy Stack', 'Electrocautery', 'Ultrasound'],
  gynecology: ['Laparoscopy Stack', 'Electrocautery', 'Ultrasound'],
  cardiology: ['Cell Saver', 'Defibrillator', 'Electrocautery', 'Ultrasound'],
  cardiac: ['Cell Saver', 'Defibrillator', 'Electrocautery', 'Ultrasound'],
  neurosurgery: ['Operating Microscope', 'Image Intensifier', 'Electrocautery'],
  neuro: ['Operating Microscope', 'Image Intensifier', 'Electrocautery'],
  urology: ['Endoscopy Tower', 'Ultrasound', 'Electrocautery'],
  paediatric: ['Laparoscopy Stack', 'Electrocautery', 'Ultrasound'],
}

// Body parts there are two of. When the site names one of these, "not applicable"
// is not an answer — the one field that exists to prevent wrong-side surgery
// cannot be left saying nothing.
const PAIRED_SITES = [
  'knee', 'eye', 'ear', 'hand', 'foot', 'ankle', 'hip', 'arm', 'leg', 'wrist',
  'elbow', 'shoulder', 'kidney', 'lung', 'breast', 'ovary', 'testis', 'testicle',
  'inguinal', 'femur', 'tibia', 'humerus', 'thumb', 'finger', 'toe', 'nostril',
]

// Does the site name a part the patient has two of?
function sideMatters(site) {
  const text = (site || '').toLowerCase()
  if (text.trim() === '') return false
  return PAIRED_SITES.some((part) => text.includes(part))
}

// "Orthopaedic Surgery" -> "orthopaedic". One word, lower case, to match on.
const specialityKey = (name) => (name || '').toLowerCase().split(/[\s/&,-]+/)[0] || ''

// Does this free-text specialty belong to this department? Compared both ways,
// because the catalogue says "Orthopaedics" and the department may say "Ortho".
function belongsTo(specialty, departmentName) {
  if (!specialty || !departmentName) return false
  const a = specialityKey(specialty)
  const b = specialityKey(departmentName)
  if (a === '' || b === '') return false
  return a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))
}

// Allergies and chronic conditions are stored as a JSON array in one column, and
// older rows hold plain text. Neither should ever throw on a booking screen.
function parseList(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [String(parsed)]
  } catch {
    return String(value).split(',').map((v) => v.trim()).filter(Boolean)
  }
}

// 'YYYY-MM-DD' from local parts. Never toISOString(), which converts to UTC and
// hands back the previous day for anyone east of Greenwich.
const toDateInput = (date) => {
  const d = date instanceof Date ? date : new Date(date)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// A free-text procedure is offered as an option whose value carries the text.
// The catalogue cannot hold every procedure — an emergency laparotomy at 2am is
// not going to be added to a master list first — so the field has to accept a
// name that is simply typed.
const FREE_TEXT = '__type__:'

// Before the server has answered, nothing is known — which is not the same as
// everything being free. `null` for the two people means "not asked about", so
// an unanswered question never renders as a clean bill of health.
const NOTHING_KNOWN = { theatres: [], surgeon: null, patient: null }

export default function BookingFormDialog({
  open,
  onOpenChange,
  theatres = [],
  surgeries = [],
  defaultTheatreId = '',
  defaultDate,
  onCreated,
}) {
  const [patient, setPatient] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Departments (cached across the session) and the doctors in the chosen one.
  // The shared hook already scopes that request — measured at 18 KB for one
  // department against 336 KB for all 1,128 doctors — which is why the surgeon
  // list only fills once a department is picked.
  const { departments, doctors, loading: sourceLoading } = useBookingSource({
    departmentId: form.departmentId,
  })

  // Anaesthetists work in their own department, not the surgical one. Filtering
  // them by the chosen speciality listed ENT surgeons under "Anaesthetist" — the
  // same box, the wrong people. A second scoped call costs one 18 KB request and
  // reuses the module-level department cache.
  const anaesthesiaDeptId = useMemo(() => {
    const found = departments.find((d) => /an(a)?esth/i.test(d.name || ''))
    return found?.id || ''
  }, [departments])
  const { doctors: anaesthetists, loading: anaesLoading } = useBookingSource({
    departmentId: anaesthesiaDeptId,
  })

  const setField = (name) => (value) => setForm((f) => ({ ...f, [name]: value }))

  const [showAllSurgeries, setShowAllSurgeries] = useState(false)
  const [showAllEquipment, setShowAllEquipment] = useState(false)
  const [surgeryQuery, setSurgeryQuery] = useState('')

  // Changing department clears everything that belonged to the old speciality.
  // Left alone, the surgeon from the previous department stays selected but is no
  // longer in the list — the box looks empty while a real id is still submitted.
  const onPickDepartment = (departmentId) => {
    setShowAllSurgeries(false)
    setShowAllEquipment(false)
    setForm((f) => ({
      ...f, departmentId,
      surgeryId: '', procedureName: '', equipmentNeeded: '',
      primarySurgeonId: '', assistantSurgeonId: '',
    }))
  }

  const doctorOptions = useMemo(
    () => doctors.map((d) => ({
      value: d.id,
      label: drName(d.fullName),
      sublabel: d.specialization || undefined,
    })),
    [doctors],
  )

  const anaesthetistOptions = useMemo(
    () => anaesthetists.map((d) => ({
      value: d.id,
      label: drName(d.fullName),
      sublabel: d.specialization || undefined,
    })),
    [anaesthetists],
  )

  // Nurses are not part of useBookingSource, which exists for booking a doctor's
  // consultation. Same endpoint, same lean shape, filtered to nursing — fetched
  // once, because the roster does not change while a form is open.
  const [nurses, setNurses] = useState([])
  useEffect(() => {
    if (!open || nurses.length > 0) return
    client.get('/settings', { params: { resource: 'users', role: 'nurse', lean: 1 } })
      .then((res) => setNurses((res?.data ?? res ?? []).filter((n) => n.isActive !== false)))
      .catch(() => setNurses([]))
  }, [open, nurses.length])

  const nurseOptions = useMemo(
    () => nurses.map((n) => ({ value: n.id, label: n.fullName })),
    [nurses],
  )

  // Everything typed is cleared when the dialog opens, and the theatre and date
  // the user came from are pre-filled — clicking "Add case" on OT-2 should not
  // then ask which theatre they meant.
  useEffect(() => {
    if (!open) return
    setPatient(null)
    setError(null)
    setSurgeryQuery('')
    setShowAllSurgeries(false)
    setShowAllEquipment(false)
    setForm({
      ...emptyForm,
      theatreId: defaultTheatreId || '',
      date: toDateInput(defaultDate || new Date()),
    })
  }, [open, defaultTheatreId, defaultDate])

  const selectedDepartment = departments.find((d) => d.id === form.departmentId)

  // Choosing Orthopaedics should not leave the user scrolling past cataracts and
  // caesareans. `specialty` is free text, so a near-miss must never make a real
  // surgery unreachable: there is always a way back to the full catalogue.
  const matchingSurgeries = useMemo(
    () => (selectedDepartment ? surgeries.filter((s) => belongsTo(s.specialty, selectedDepartment.name)) : []),
    [surgeries, selectedDepartment],
  )
  const surgeryFilterActive = Boolean(selectedDepartment) && matchingSurgeries.length > 0 && showAllSurgeries === false

  // One field for "which operation". A catalogue row sets the id, the name and
  // the usual duration; anything else typed becomes the name on its own.
  //
  // `onSearch` puts the typed text in this component's hands, which is the only
  // way to offer "use what I typed" as a choice. The list is still filtered here
  // rather than fetched — the catalogue is already loaded.
  const surgeryOptions = useMemo(() => {
    const pool = surgeryFilterActive ? matchingSurgeries : surgeries
    const q = surgeryQuery.trim().toLowerCase()
    const rows = (q === ''
      ? pool
      : pool.filter((s) => `${s.name} ${s.code || ''} ${s.specialty || ''}`.toLowerCase().includes(q))
    ).map((s) => ({
      value: s.id,
      label: s.name,
      sublabel: [s.specialty, s.defaultMinutes ? formatDuration(s.defaultMinutes) : null]
        .filter(Boolean).join(' · '),
      keywords: [s.code, s.specialty].filter(Boolean).join(' '),
    }))

    // Nothing in the catalogue is called this — offer it as typed rather than
    // making the user find another field to put it in.
    const exact = rows.some((r) => r.label.toLowerCase() === q)
    if (q.length >= 2 && exact === false) {
      rows.push({
        value: `${FREE_TEXT}${surgeryQuery.trim()}`,
        label: `Use "${surgeryQuery.trim()}"`,
        sublabel: 'Not in the catalogue — booked under this name',
      })
    }
    return rows
  }, [surgeries, matchingSurgeries, surgeryFilterActive, surgeryQuery])

  const selectedSurgery = surgeries.find((s) => s.id === form.surgeryId) || null

  // The shortlist of kit for this speciality, pre-ticked when a procedure is
  // chosen so the common case needs no clicks at all.
  const shortlistEquipment = useMemo(() => {
    if (!selectedDepartment) return null
    const key = specialityKey(selectedDepartment.name)
    const hit = Object.keys(EQUIPMENT_BY_SPECIALITY)
      .find((k) => key.startsWith(k.slice(0, 5)) || k.startsWith(key.slice(0, 5)))
    return hit ? EQUIPMENT_BY_SPECIALITY[hit] : null
  }, [selectedDepartment])

  const equipmentFilterActive = Boolean(shortlistEquipment) && showAllEquipment === false
  const equipmentOptions = equipmentFilterActive ? shortlistEquipment : OT_EQUIPMENT

  const onPickSurgery = (value) => {
    if (String(value).startsWith(FREE_TEXT)) {
      setForm((f) => ({ ...f, surgeryId: '', procedureName: String(value).slice(FREE_TEXT.length) }))
      return
    }
    const surgery = surgeries.find((s) => s.id === value)
    setForm((f) => ({
      ...f,
      surgeryId: value,
      procedureName: surgery?.name ?? f.procedureName,
      // A catalogue duration is a starting point, not a rule — it stays editable.
      estimatedMinutes: surgery?.defaultMinutes ? String(surgery.defaultMinutes) : f.estimatedMinutes,
      // A different procedure needs a different tray, so the suggestion replaces
      // whatever the last one put there.
      equipmentNeeded: shortlistEquipment ? shortlistEquipment.join(', ') : f.equipmentNeeded,
    }))
  }

  // What the picker should show once something is chosen. A free-text procedure
  // has no row in `options`, so its label has to be supplied.
  const surgeryValue = form.surgeryId || (form.procedureName ? `${FREE_TEXT}${form.procedureName}` : '')
  const surgeryLabel = form.surgeryId ? selectedSurgery?.name : form.procedureName

  const minutes = Number(form.estimatedMinutes) || selectedSurgery?.defaultMinutes || 60

  const slotPreview = useMemo(() => {
    if (!form.date || !form.startTime) return ''
    const start = new Date(`${form.date}T${form.startTime}`)
    if (Number.isNaN(start.getTime())) return ''
    const end = new Date(start.getTime() + minutes * 60_000)
    return `${formatSlot(start, end)} · ${formatDuration(minutes)}`
  }, [form.date, form.startTime, minutes])

  // ── Which theatres are actually free for this slot ─────────────────────────
  //
  // Debounced, because the slot changes on every keystroke in the time and
  // duration boxes and each change is a request. The answer comes from the same
  // rules that block a real booking, so a room shown as free here is a room the
  // server will accept.
  const [avail, setAvail] = useState(NOTHING_KNOWN)
  const [availLoading, setAvailLoading] = useState(false)
  const [availFailed, setAvailFailed] = useState(false)

  // The surgeon and the patient are part of the key, not just the clock. A free
  // room is not a bookable slot: the server refuses on the theatre, the surgeon
  // OR the patient, so changing the surgeon has to re-ask the question.
  const slotKey = useDebounce(
    form.date && form.startTime
      ? [`${form.date}T${form.startTime}`, minutes, form.primarySurgeonId, patient?.id || ''].join('|')
      : '',
    400,
  )

  useEffect(() => {
    if (!open || slotKey === '') { setAvail(NOTHING_KNOWN); return }
    const [scheduledStart, mins, surgeonId, patientId] = slotKey.split('|')
    let live = true
    setAvailLoading(true)
    setAvailFailed(false)
    otApi.getAvailability({
      scheduledStart,
      estimatedMinutes: mins,
      // Left out until chosen — an empty id would be a question about nobody.
      ...(surgeonId ? { primarySurgeonId: surgeonId } : {}),
      ...(patientId ? { patientId } : {}),
    })
      .then((res) => { if (live) setAvail({ ...NOTHING_KNOWN, ...(res?.data ?? {}) }) })
      .catch(() => {
        // The server is still the gate. If this lookup fails, every theatre stays
        // selectable rather than the form hiding rooms it cannot vouch for.
        if (live) { setAvail(NOTHING_KNOWN); setAvailFailed(true) }
      })
      .finally(() => { if (live) setAvailLoading(false) })
    return () => { live = false }
  }, [open, slotKey])

  const availabilityById = useMemo(
    () => new Map(avail.theatres.map((a) => [a.id, a])),
    [avail.theatres],
  )

  // Free rooms first — the list exists to answer "where can this go", and a busy
  // room is the answer to a different question.
  const theatreCards = useMemo(() => {
    const rows = theatres.map((t) => ({ ...t, avail: availabilityById.get(t.id) || null }))
    return rows.sort((a, b) => {
      const aFree = a.avail?.free !== false
      const bFree = b.avail?.free !== false
      if (aFree !== bFree) return aFree ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [theatres, availabilityById])

  const chosenAvailability = form.theatreId ? availabilityById.get(form.theatreId) : null
  const chosenTheatre = theatres.find((t) => t.id === form.theatreId) || null

  // A theatre that was free when it was picked can go busy while the rest of the
  // form is filled in. Clearing it silently would be worse — say so instead.
  const theatreNowBusy = chosenAvailability?.free === false

  // The other two ways the server can refuse this slot. `=== false` and not a
  // plain falsy check: null means the question was never asked, and that must
  // not read as a clash.
  const surgeonBusy = avail.surgeon?.free === false
  const patientBusy = avail.patient?.free === false

  // ── Team, validation, submit ───────────────────────────────────────────────

  const teamRows = useMemo(() => {
    const named = (id, list) => list.find((p) => p.id === id)?.fullName
    return [
      { role: 'PRIMARY_SURGEON', userId: form.primarySurgeonId, memberName: named(form.primarySurgeonId, doctors) },
      { role: 'ASSISTANT_SURGEON', userId: form.assistantSurgeonId, memberName: named(form.assistantSurgeonId, doctors) },
      { role: 'ANAESTHETIST', userId: form.anaesthetistId, memberName: named(form.anaesthetistId, anaesthetists) },
      { role: 'SCRUB_NURSE', userId: form.scrubNurseId, memberName: named(form.scrubNurseId, nurses) },
      { role: 'CIRCULATING_NURSE', userId: form.circulatingNurseId, memberName: named(form.circulatingNurseId, nurses) },
    ].filter((m) => m.userId && m.memberName)
  }, [form.primarySurgeonId, form.assistantSurgeonId, form.anaesthetistId,
      form.scrubNurseId, form.circulatingNurseId, doctors, anaesthetists, nurses])

  const lateralityMissing = sideMatters(form.siteOfSurgery) && form.laterality === 'NA'

  // Every check the form makes, in one list, so the panel on the right and the
  // Book button can never disagree about whether this case is ready.
  const checks = [
    {
      label: patientBusy ? 'Patient is booked elsewhere' : 'Patient selected',
      ok: Boolean(patient) && patientBusy === false,
      need: patientBusy ? 'a slot the patient is free for' : 'patient',
    },
    { label: 'Procedure selected', ok: Boolean(form.surgeryId || form.procedureName.trim()), need: 'procedure' },
    { label: 'Primary surgeon assigned', ok: Boolean(form.primarySurgeonId), need: 'surgeon' },
    { label: 'Date and time set', ok: Boolean(form.date && form.startTime), need: 'start time' },
    // Only once a surgeon has been chosen. Before that this is a question about
    // nobody, and it was answering it anyway — putting "surgeon" in the missing
    // list twice, which read as a bug in the form rather than a hint.
    ...(form.primarySurgeonId ? [{
      label: surgeonBusy ? 'Surgeon is operating elsewhere' : 'Surgeon free for this slot',
      ok: surgeonBusy === false,
      need: 'a slot the surgeon is free for',
    }] : []),
    {
      label: theatreNowBusy ? 'Theatre is no longer free' : 'Theatre available',
      ok: Boolean(form.theatreId) && theatreNowBusy === false,
      need: form.theatreId ? 'a free theatre' : 'theatre',
    },
    {
      label: lateralityMissing ? 'Side not stated for a paired site' : 'Side confirmed',
      ok: lateralityMissing === false,
      need: 'left or right',
    },
  ]
  // De-duplicated: two checks can want the same thing, and "surgeon, surgeon"
  // in the footer reads as a broken form rather than a hint.
  const missing = [...new Set(checks.filter((c) => c.ok === false).map((c) => c.need))]

  const submit = async () => {
    if (missing.length > 0) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await otApi.createBooking({
        patientId: patient.id,
        theatreId: form.theatreId,
        surgeryId: form.surgeryId || undefined,
        procedureName: form.procedureName.trim() || undefined,
        laterality: form.laterality,
        siteOfSurgery: form.siteOfSurgery.trim() || undefined,
        patientLocation: form.patientLocation || undefined,
        equipmentNeeded: form.equipmentNeeded || undefined,
        priority: form.priority,
        team: teamRows,
        // No timezone suffix: the browser reads this as local wall-clock time,
        // which is the time the theatre list is actually written in.
        scheduledStart: `${form.date}T${form.startTime}`,
        estimatedMinutes: minutes,
        primarySurgeonId: form.primarySurgeonId,
        anaesthetistId: form.anaesthetistId || undefined,
        notes: form.notes.trim() || undefined,
      })
      toast.success(`Case ${res?.data?.caseNumber ?? ''} booked`)
      onOpenChange(false)
      onCreated?.(res?.data)
    } catch (e) {
      // A clash is the expected failure here, and its message names the theatre
      // and the time it frees up. Keep it in the form, beside the fields the user
      // has to change — a toast would vanish before they could act on it.
      setError(e?.message || 'Could not book this case')
    } finally {
      setSubmitting(false)
    }
  }

  const allergies = parseList(patient?.allergies)
  const conditions = parseList(patient?.chronicConditions)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Surgery Booking</DialogTitle>
          <DialogDescription>
            The theatre, the surgeon and the patient are each checked for a clash before this is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── The six steps ─────────────────────────────────────────────── */}
          <div className="space-y-4">

            <Step n={1} title="Patient Details" done={Boolean(patient)}>
              {patient ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                  <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-white p-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100">
                      <User className="h-4 w-4 text-blue-700" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">
                        {[patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' ')}
                      </p>
                      <p className="truncate text-xs text-gray-600">
                        {[
                          patient.mrn && `MRN: ${patient.mrn}`,
                          patient.age && `${patient.age} years`,
                          patient.gender,
                          patient.phonePrimary,
                        ].filter(Boolean).join('  |  ')}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPatient(null)}>
                      Change patient
                    </Button>
                  </div>

                  {/* An allergy is the one thing on this screen that changes what
                      the anaesthetist does. It is shown here rather than left for
                      someone to open the chart and find. */}
                  {(allergies.length > 0 || conditions.length > 0) && (
                    <div className="sm:col-span-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <div className="min-w-0 space-y-0.5">
                        {allergies.length > 0 && (
                          <p className="text-red-800">
                            <b>Allergies:</b> {allergies.join(', ')}
                          </p>
                        )}
                        {conditions.length > 0 && (
                          <p className="text-red-700">
                            <b>Known:</b> {conditions.join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <PatientLookup
                  selectedPatient={patient}
                  onSelect={setPatient}
                  onClear={() => setPatient(null)}
                />
              )}
            </Step>

            <Step
              n={2}
              title="Procedure & Surgeon"

              done={Boolean((form.surgeryId || form.procedureName.trim()) && form.primarySurgeonId)}
            >
              <div className="grid gap-4 sm:grid-cols-[1fr_1.3fr_150px]">
                <Field label="Department *" hint="Filters surgeries, surgeons and equipment.">
                  <SearchableSelect
                    className="w-full"
                    options={departments.map((d) => ({ value: d.id, label: d.name }))}
                    value={form.departmentId}
                    onChange={onPickDepartment}
                    placeholder="Select department"
                  />
                </Field>

                {/* One field, not two. The catalogue sets an id, a name and a
                    duration; anything typed becomes the name on its own, so an
                    emergency procedure that was never added to the master list
                    can still be booked. */}
                <Field
                  label="Surgery / Procedure *"
                  hint={
                    selectedDepartment && surgeryFilterActive
                      ? `${matchingSurgeries.length} ${selectedDepartment.name} procedures available`
                      : 'Search the catalogue, or type a name that is not in it.'
                  }
                >
                  <SearchableSelect
                    className="w-full"
                    options={surgeryOptions}
                    value={surgeryValue}
                    selectedLabel={surgeryLabel}
                    onChange={onPickSurgery}
                    // `onSearch` is only here to get hold of what was typed, so
                    // "use this name" can be offered for a procedure the
                    // catalogue does not have. 0, not 1: any higher and the
                    // picker hides the whole department list until a key is
                    // pressed, which is exactly the filtered list the user came
                    // for.
                    onSearch={setSurgeryQuery}
                    minSearchLength={0}
                    disabled={!form.departmentId}
                    placeholder={form.departmentId ? 'Search or type a procedure' : 'Select a department first'}
                    emptyText="No match — type a name to book under it"
                  />
                  {surgeryFilterActive && (
                    <button
                      type="button"
                      className="mt-1 text-xs font-medium text-blue-600 hover:underline"
                      onClick={() => setShowAllSurgeries(true)}
                    >
                      Search all {surgeries.length} procedures
                    </button>
                  )}
                </Field>

                <Field label={lateralityMissing ? 'Laterality *' : 'Laterality'}>
                  <Select value={form.laterality} onValueChange={setField('laterality')}>
                    <SelectTrigger className={lateralityMissing ? 'border-amber-400' : undefined}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OT_LATERALITY.map((l) => (
                        <SelectItem key={l} value={l}>{OT_LATERALITY_LABEL[l] ?? l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Laterality says which SIDE; this says which side of WHAT. Both
                    are read aloud at the surgical Time Out, and only together do
                    they identify the operative site. */}
                <Field label="Site of surgery" hint="Read aloud at the surgical Time Out.">
                  <Input
                    value={form.siteOfSurgery}
                    onChange={(e) => setField('siteOfSurgery')(e.target.value)}
                    placeholder="e.g. Right knee · Left eye · L4-L5"
                  />
                </Field>

                {/* The surgeon is asked for HERE, before the schedule, because
                    which slots are open depends on them: the server refuses a
                    booking for a surgeon already operating, whatever room is
                    free. Asked after the theatre, this field could invalidate a
                    choice made a step earlier. */}
                <Field
                  label="Primary surgeon *"
                  hint={selectedDepartment ? `Showing ${selectedDepartment.name} consultants` : 'Decides which slots are open.'}
                >
                  <SearchableSelect
                    className="w-full"
                    options={doctorOptions}
                    value={form.primarySurgeonId}
                    onChange={setField('primarySurgeonId')}
                    disabled={!form.departmentId}
                    loading={sourceLoading.doctors}
                    placeholder={form.departmentId ? 'Select surgeon' : 'Select a department first'}
                    emptyText="No consultants in this department"
                  />
                </Field>
              </div>

              {/* Only when the site actually has two sides. Saying "not required"
                  the rest of the time is a line the user has to read on every
                  booking to learn nothing. */}
              {lateralityMissing && (
                <Note tone="amber" icon={AlertTriangle}>
                  This site has a left and a right. Say which one — it is read back
                  at the Time Out.
                </Note>
              )}
            </Step>

            <Step
              n={3}
              title="Schedule & Available Theatres"

              done={Boolean(form.date && form.startTime && form.theatreId) && theatreNowBusy === false}
            >
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Date *">
                  <Input type="date" value={form.date} onChange={(e) => setField('date')(e.target.value)} />
                </Field>
                <Field label="Start time *">
                  <Input type="time" value={form.startTime} onChange={(e) => setField('startTime')(e.target.value)} />
                </Field>
                <Field
                  label="Duration (min) *"
                  hint={selectedSurgery ? 'From the catalogue — editable.' : undefined}
                >
                  <Input
                    type="number"
                    min="5"
                    step="5"
                    value={form.estimatedMinutes || String(minutes)}
                    onChange={(e) => setField('estimatedMinutes')(e.target.value)}
                  />
                </Field>
                <Field label="Priority *">
                  <Select value={form.priority} onValueChange={setField('priority')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OT_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {slotPreview && (
                <p className="flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-700">
                  <Clock className="h-4 w-4 shrink-0" /> {slotPreview}
                </p>
              )}

              {/* A free room is not a bookable slot. The server refuses on the
                  theatre, the surgeon OR the patient, so when one of the other
                  two is the problem it is said here — above the theatre list,
                  where "all rooms free" would otherwise be read as "go ahead". */}
              {(surgeonBusy || patientBusy) && (
                <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                  {surgeonBusy && (
                    <p className="flex items-start gap-2 text-red-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <b>Surgeon is not free.</b> {avail.surgeon.reason} — every
                        theatre below is unavailable for this surgeon at this time.
                      </span>
                    </p>
                  )}
                  {patientBusy && (
                    <p className="flex items-start gap-2 text-red-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span><b>Patient is already booked.</b> {avail.patient.reason}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wide text-gray-500">
                  Available theatres for this slot
                </Label>
                {availLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
              </div>

              {theatres.length === 0 ? (
                <p className="text-sm text-gray-500">No theatres configured.</p>
              ) : (
                <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
                  {theatreCards.map((t) => (
                    <TheatreCard
                      key={t.id}
                      theatre={t}
                      selected={form.theatreId === t.id}
                      onSelect={() => setField('theatreId')(t.id)}
                    />
                  ))}
                </div>
              )}

              {availFailed && (
                <Note tone="slate" icon={Info}>
                  Could not check availability just now — every theatre is still
                  selectable, and the clash check still runs when you book.
                </Note>
              )}
              {chosenTheatre?.cleaningMinutes ? (
                <p className="text-xs text-gray-500">
                  A {chosenTheatre.cleaningMinutes} minute cleaning gap is kept after each case.
                </p>
              ) : null}
            </Step>

            <Step n={4} title="Equipment Required" done={Boolean(form.equipmentNeeded)}>
              <Field label="Going to theatre for this case">
                <MultiPick
                  options={equipmentOptions}
                  value={form.equipmentNeeded}
                  onChange={setField('equipmentNeeded')}
                  emptyText="Nothing selected yet — tap an item below to add it"
                  addLabel={
                    equipmentFilterActive && selectedDepartment
                      ? `Suggested for ${selectedDepartment.name}`
                      : 'All equipment'
                  }
                />
                {shortlistEquipment && (
                  <button
                    type="button"
                    className="mt-1.5 text-xs font-medium text-blue-600 hover:underline"
                    onClick={() => setShowAllEquipment(equipmentFilterActive)}
                  >
                    {equipmentFilterActive
                      ? `Show all ${OT_EQUIPMENT.length} items`
                      : `Narrow to ${selectedDepartment?.name}`}
                  </button>
                )}
              </Field>
            </Step>

            {/* The rest of the team. None of these is a scheduling constraint —
                the server checks the theatre, the primary surgeon and the
                patient, and nothing else — so they are asked for after the slot
                is settled rather than standing between the user and it. */}
            <Step n={5} title="Rest of the Team">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Assistant surgeon">
                  <SearchableSelect
                    className="w-full"
                    options={doctorOptions}
                    value={form.assistantSurgeonId}
                    onChange={setField('assistantSurgeonId')}
                    disabled={!form.departmentId}
                    loading={sourceLoading.doctors}
                    placeholder="Not assigned"
                    emptyText="No consultants in this department"
                  />
                </Field>

                {/* From the Anaesthesia department, not the surgical one. */}
                <Field
                  label="Anaesthetist"
                  hint={anaesthesiaDeptId ? undefined : 'No Anaesthesia department found in settings.'}
                >
                  <SearchableSelect
                    className="w-full"
                    options={anaesthetistOptions}
                    value={form.anaesthetistId}
                    onChange={setField('anaesthetistId')}
                    loading={anaesLoading.doctors}
                    placeholder="Not assigned"
                    emptyText="No anaesthetists found"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Scrub nurse">
                  <SearchableSelect
                    className="w-full"
                    options={nurseOptions}
                    value={form.scrubNurseId}
                    onChange={setField('scrubNurseId')}
                    placeholder="Not assigned"
                    emptyText="No nursing staff found"
                  />
                </Field>

                <Field label="Circulating nurse">
                  <SearchableSelect
                    className="w-full"
                    options={nurseOptions}
                    value={form.circulatingNurseId}
                    onChange={setField('circulatingNurseId')}
                    placeholder="Not assigned"
                    emptyText="No nursing staff found"
                  />
                </Field>
              </div>
            </Step>

            <Step n={6} title="Other Details">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Patient location" hint="Where the patient is collected from.">
                  <Select value={form.patientLocation} onValueChange={setField('patientLocation')}>
                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      {PATIENT_LOCATIONS.map((l) => (
                        <SelectItem key={l} value={l}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Notes">
                  <Textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setField('notes')(e.target.value)}
                    placeholder="Anything the theatre team should know before the day"
                  />
                </Field>
              </div>
            </Step>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

        </div>

        <DialogFooter className="flex-col items-stretch gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
          {/* The one line the checklist panel was really for: why the button is
              off. Beside the button, where it is read — the panel repeated every
              step's heading back at the user to say one thing. */}
          {missing.length > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-amber-800 sm:mr-auto">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
              Still needed: {missing.join(', ')}
            </span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            onClick={submit}
            disabled={submitting || missing.length > 0}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Book Case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

// One numbered step.
//
// The number stays because the order is real — the patient, the procedure and
// the surgeon are all settled before a slot can be offered — but the colour
// does not. Six differently tinted headers on one form read as decoration, and
// a booking screen that looks like a paint chart does not read as a hospital
// record. Colour is kept for the things that MEAN something on this form: free
// and busy, an allergy, a warning. Everything else is grey.
//
// A finished step turns its badge green, which is the one place a tint here
// carries information: what is left to fill in.
function Step({ n, title, done = false, children }) {
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200">
      <div className="flex items-center gap-2.5 border-b bg-gray-50 px-4 py-3">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? 'bg-green-600 text-white' : 'bg-gray-700 text-white'
        }`}>
          {done ? <Check className="h-3.5 w-3.5" /> : n}
        </span>
        {/* Sentence case and full weight. Small-caps grey was quiet enough that
            the section a field belonged to stopped being obvious — the heading
            has to be the first thing read, not the last. */}
        <h3 className="text-[15px] font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="space-y-4 bg-white p-4">{children}</div>
    </section>
  )
}

// Label + control + optional hint, so every field is spaced and labelled the
// same way without repeating the wrapper twenty times.
function Field({ label, hint, children }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

const NOTE_TONES = {
  slate: 'border-gray-200 bg-gray-50 text-gray-600',
  amber: 'border-amber-300 bg-amber-50 text-amber-900',
}

function Note({ tone = 'slate', icon: Icon = Info, children }) {
  return (
    <div className={`flex items-start gap-2 self-start rounded-lg border p-2.5 text-xs ${NOTE_TONES[tone]}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

// One theatre, with what the server says about this exact slot.
//
// A busy room is shown and disabled rather than hidden: "OT-2 is busy until
// 11:30" answers the user's next question, while a missing OT-2 reads as a
// broken list. When availability could not be fetched, nothing is disabled —
// the server is still the gate, and a guess must not stand in its way.
function TheatreCard({ theatre, selected, onSelect }) {
  const avail = theatre.avail
  const busy = avail?.free === false
  const known = Boolean(avail)

  const base = 'rounded-lg border p-2.5 text-left transition-colors'
  const look = busy
    ? 'cursor-not-allowed border-red-200 bg-red-50/60'
    : selected
      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
      : 'border-gray-200 bg-white hover:bg-gray-50'

  return (
    <button type="button" disabled={busy} onClick={onSelect} className={`${base} ${look}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-blue-600' : 'border-gray-300'
        }`}>
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
        </span>
        <span className="truncate text-sm font-semibold text-gray-900">{theatre.name}</span>
        {known && (
          <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            busy ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}>
            {busy ? 'Busy' : 'Free'}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-xs text-gray-500">
        {theatre.theatreType || 'Theatre'}
      </p>
      {busy && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-red-700">
          {avail.reason}
        </p>
      )}
    </button>
  )
}


// Pick several from a short, fixed list. Stored as one comma-separated string,
// because that is what the column is and an equipment list is read, not queried.
//
// Two rows, not one toggling row: what is going to theatre sits in its own box
// with an X on each chip, and what is left to add sits under it. A single row of
// toggles made the answer something the user had to work out by comparing which
// chips looked filled in — the OT technician reads this list off a screen, and
// "what did I pick" should not be a puzzle.
//
// A chip chosen from the full list stays visible after the list is narrowed back
// to the speciality. It is in `value`, so it renders and can still be removed —
// nothing silently drops out of a case because a filter changed.
function MultiPick({ options, value, onChange, emptyText = 'Nothing selected yet', addLabel }) {
  const chosen = [...new Set((value || '').split(',').map((v) => v.trim()).filter(Boolean))]
  const available = options.filter((o) => chosen.includes(o) === false)

  const add = (option) => onChange([...chosen, option].join(', '))
  const remove = (option) => onChange(chosen.filter((c) => c !== option).join(', '))

  return (
    <div className="space-y-2">
      <div className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-md border bg-gray-50 p-2">
        {chosen.length === 0 ? (
          <span className="px-1 text-xs text-gray-400">{emptyText}</span>
        ) : (
          chosen.map((option) => (
            <span
              key={option}
              className="flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 py-1 pl-2.5 pr-1 text-xs font-medium text-blue-900"
            >
              {option}
              <button
                type="button"
                onClick={() => remove(option)}
                aria-label={`Remove ${option}`}
                className="rounded-full p-0.5 text-blue-700 hover:bg-blue-100 hover:text-blue-900"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>

      {available.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {addLabel && (
            <span className="mr-0.5 text-xs text-gray-500">{addLabel}:</span>
          )}
          {available.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => add(option)}
              className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-900"
            >
              <Plus className="h-3 w-3" />
              {option}
            </button>
          ))}
        </div>
      )}

      {/* Always here, never conditional on the shortlist having anything left.
          With every suggestion already picked the whole add row used to vanish,
          and the only way on was a small "show all" link.
          It also takes anything typed, because the list above is twelve items
          hard-coded in this file and a theatre that owns a robot, a
          neuronavigation rig or one named brand of stack could otherwise not say
          so at all. What the technician has to wheel in is not a closed set. */}
      <AddOther onAdd={add} chosen={chosen} />
    </div>
  )
}

// Type anything that is not on the list.
function AddOther({ onAdd, chosen }) {
  const [draft, setDraft] = useState('')
  const clean = draft.trim()
  // Case-insensitive, so "c-arm" does not join "C-Arm" as a second entry that
  // reads the same on the board and counts as two on a report.
  const duplicate = chosen.some((c) => c.toLowerCase() === clean.toLowerCase())
  const canAdd = clean !== '' && duplicate === false

  const commit = () => {
    if (canAdd === false) return
    onAdd(clean)
    setDraft('')
  }

  return (
    <div>
      <div className="flex gap-1.5">
        <Input
          className="h-8 text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            // The form would otherwise take this as Book Case.
            e.preventDefault()
            commit()
          }}
          placeholder="Something else — type it and press Add"
        />
        <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={canAdd === false} onClick={commit}>
          <Plus className="mr-1 h-3 w-3" /> Add
        </Button>
      </div>
      {duplicate && (
        <p className="mt-1 text-xs text-gray-500">Already on the list above.</p>
      )}
    </div>
  )
}
