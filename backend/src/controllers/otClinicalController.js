// Operation Theatre — Phase 2, the four documents a case produces.
//
// Each is one-per-case and edited in place, so there is no create/delete here:
// GET reads, PATCH upserts. A form that is opened, part-filled and saved twice
// must not produce two pre-op assessments.
//
// Same house pieces as otController: getOrgId/getActor/svcErr, isOwned, auditIpd,
// ipdAllowed. Nothing cross-cutting is re-implemented.
import { db } from '../config/db.js'
import { getOrgId, getActor, svcErr, bad, notFound, conflict, forbidden } from '../lib/reqContext.js'
import { isOwned } from '../lib/tenant.js'
import { auditIpd } from '../inpatient/audit.js'
import { ipdAllowed } from '../inpatient/rbac.js'
import { parseUserDate } from '../lib/dates.js'



// ── Allowed values ──────────────────────────────────────────────────────────
// The columns are Strings. Without these a typo is stored and only found on a
// screen that cannot render it.
const ASA_GRADES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'IE', 'IIE', 'IIIE', 'IVE', 'VE']
const FITNESS = ['FIT', 'UNFIT', 'FIT_WITH_CONDITIONS']
const ANAESTHESIA_TYPES = ['GENERAL', 'SPINAL', 'EPIDURAL', 'REGIONAL', 'LOCAL', 'SEDATION', 'COMBINED']
const AIRWAY_DEVICES = ['ETT', 'LMA', 'FACE_MASK', 'NASAL', 'TRACHEOSTOMY']
const VENTILATION_MODES = ['SPONTANEOUS', 'CONTROLLED', 'ASSISTED', 'SIMV', 'PSV']

// How the case ended. ABANDONED is the one that has to be sayable: a surgery
// stopped after induction is a different event from one that finished, and until
// now the record could not tell them apart.
const PROCEDURE_STATUS = ['COMPLETED', 'MODIFIED', 'ABANDONED']

// Where the patient went from the table. RECOVERY (PACU) is the usual answer;
// ICU and HDU are the ones a ward needs warning about.
const PATIENT_DESTINATIONS = ['RECOVERY', 'ICU', 'HDU', 'WARD', 'HOME']

// What kind of complication occurred.
//
// A clinical taxonomy, deliberately the same for every hospital on the system.
// Left to each hospital to name, one would write "Bleeding", another
// "Haemorrhage" and a third "Blood loss" — and "how many bleeding complications
// across the group" would go back to being a text search, which is the thing
// structuring this was meant to end.
//
// Mirrored in src/api/otApi.js. That file is the only other place these strings
// appear; nothing else in either half should spell them out.
const COMPLICATION_TYPES = [
  'BLEEDING',
  'INFECTION',
  'ORGAN_INJURY',
  'ANAESTHESIA',
  'CARDIOVASCULAR',
  'RESPIRATORY',
  'EQUIPMENT',
  'OTHER',
]

// The complication answer, in three states that must stay distinguishable:
//   undefined  not sent — leave whatever is stored alone
//   null       explicitly cleared
//   "[]"       the surgeon answered "none"
//   '["..."]'  these kinds occurred
//
// Storing "no complications" and "nobody has said" the same way is how an audit
// comes to believe a hospital never has any.
function complicationTypes(value, details) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null

  const list = Array.isArray(value) ? value : safeParseArray(value)
  if (list === null) throw bad('complicationTypes must be a list of complication codes')

  const cleaned = [...new Set(list.map((v) => String(v ?? '').trim()).filter(Boolean))]
  for (const code of cleaned) {
    if (COMPLICATION_TYPES.includes(code) === false) {
      throw bad(`complicationTypes must contain only: ${COMPLICATION_TYPES.join(', ')}`)
    }
  }

  // "Other" says a kind occurred that the list cannot name. Without the words,
  // the record says a complication happened and refuses to say what — worse
  // than no answer, because it looks like one.
  if (cleaned.includes('OTHER') && String(details ?? '').trim() === '') {
    throw bad('Say what the complication was when you choose Other')
  }

  return JSON.stringify(cleaned)
}

// Accepts a JSON array or nothing. Returns null when the text is not an array,
// so the caller can refuse it rather than storing a shrug.
function safeParseArray(value) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Which document each resource is, and who may write it. The document belongs to
// the discipline that signs it: the anaesthetist assesses and charts, the nurse
// runs the checklist and the counts, the surgeon dictates the note.
const DOCUMENTS = {
  preop: { model: 'otPreOpAssessment', permission: 'ot-preop', label: 'pre-op assessment' },
  checklist: { model: 'otSafetyChecklist', permission: 'ot-checklist', label: 'safety checklist' },
  anaesthesia: { model: 'otAnaesthesiaRecord', permission: 'ot-anaesthesia', label: 'anaesthesia record' },
  // `onlyAfter` names the statuses a document may be written in. Absent means
  // any open case — which is right for the pre-op assessment, whose entire job
  // is to happen before the day.
  opnote: {
    model: 'otOperativeNote',
    permission: 'ot-opnote',
    label: 'operative note',
    onlyAfter: ['IN_THEATRE', 'COMPLETED'],
  },
}

function assertMay(req, action) {
  if (!ipdAllowed(req, action)) throw forbidden()
}

function assertOneOf(value, allowed, label) {
  if (value === undefined || value === null || value === '') return
  if (!allowed.includes(value)) throw bad(`${label} must be one of ${allowed.join(', ')}`)
}

// Blank stays blank; anything sent must be a whole number in range. Number("")
// is 0 and Number("abc") is NaN, both of which the database stores happily.
function optionalCount(value, label, { min = 0, max = 999 } = {}) {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (Number.isInteger(n) === false || n < min || n > max) {
    throw bad(`${label} must be a whole number between ${min} and ${max}`)
  }
  return n
}

function optionalDecimal(value, label, { min = 0, max = 1000 } = {}) {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (Number.isFinite(n) === false || n < min || n > max) {
    throw bad(`${label} must be a number between ${min} and ${max}`)
  }
  return n
}

// Blank stays blank. Everything else goes through lib/dates.js#parseUserDate,
// which is also what rejects 30 February — the check this file was written
// without, so OT bookings refused it while the case record accepted it.
function optionalDate(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  return parseUserDate(value, label)
}

const text = (v) => (v === undefined ? undefined : (String(v ?? '').trim() || null))
const flag = (v) => (v === undefined ? undefined : !!v)

// Drops the keys the caller did not send, so a form that edits one section does
// not blank the sections it never showed.
const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

// The case must exist, belong to this hospital, and still be open to recording.
// A cancelled case never happened; nothing may be written against it.
async function loadBooking(bookingId, orgId) {
  if (!bookingId) throw bad('bookingId is required')
  if (!(await isOwned('otBooking', bookingId, orgId))) throw notFound('Booking not found')
  return db.otBooking.findUnique({
    where: { id: bookingId },
    select: { id: true, caseNumber: true, status: true },
  })
}

// ─────────────────────────────────────────────────────────────── READS ──────

export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { resource, bookingId } = req.query

    await loadBooking(bookingId, ORG_ID)

    // One request for the whole case, because the detail screen shows all four
    // tabs at once — four round trips to fill one dialog is three too many.
    if (resource === 'all') {
      const [preop, checklist, anaesthesia, opnote] = await Promise.all(
        Object.values(DOCUMENTS).map((d) => db[d.model].findUnique({ where: { bookingId } })),
      )
      return res.json({ success: true, data: { preop, checklist, anaesthesia, opnote } })
    }

    const document = DOCUMENTS[resource]
    if (!document) throw bad(`resource must be one of ${Object.keys(DOCUMENTS).join(', ')}, or all`)

    const row = await db[document.model].findUnique({ where: { bookingId } })
    return res.json({ success: true, data: row })
  } catch (e) {
    if (e.status) return svcErr(res, e)
    next(e)
  }
}

// ────────────────────────────────────────────────────────────── WRITES ──────
// PATCH upserts. Every builder below returns only the fields the caller sent.

function buildPreOp(body, actor) {
  assertOneOf(body.asaGrade, ASA_GRADES, 'asaGrade')
  assertOneOf(body.fitness, FITNESS, 'fitness')
  assertOneOf(body.reassessFitness, FITNESS, 'reassessFitness')

  return defined({
    diagnosis: text(body.diagnosis),
    plannedProcedure: text(body.plannedProcedure),
    indication: text(body.indication),
    allergies: text(body.allergies),
    currentMedication: text(body.currentMedication),
    comorbidities: text(body.comorbidities),
    previousSurgery: text(body.previousSurgery),

    asaGrade: text(body.asaGrade),
    mallampati: optionalCount(body.mallampati, 'mallampati', { min: 1, max: 4 }),
    airwayNote: text(body.airwayNote),

    heightCm: optionalDecimal(body.heightCm, 'heightCm', { min: 20, max: 260 }),
    weightKg: optionalDecimal(body.weightKg, 'weightKg', { min: 0.5, max: 400 }),

    systolicBp: optionalCount(body.systolicBp, 'systolicBp', { min: 40, max: 300 }),
    diastolicBp: optionalCount(body.diastolicBp, 'diastolicBp', { min: 20, max: 200 }),
    heartRate: optionalCount(body.heartRate, 'heartRate', { min: 20, max: 250 }),
    spo2: optionalDecimal(body.spo2, 'spo2', { min: 50, max: 100 }),

    bloodGroup: text(body.bloodGroup),
    haemoglobin: optionalDecimal(body.haemoglobin, 'haemoglobin', { min: 1, max: 25 }),
    investigationNote: text(body.investigationNote),

    fastingFrom: optionalDate(body.fastingFrom, 'fastingFrom'),
    fastingNote: text(body.fastingNote),
    consentTaken: flag(body.consentTaken),
    consentBy: text(body.consentBy),

    fitness: text(body.fitness),
    fitnessNote: text(body.fitnessNote),

    // Stamped by the server from the session, never taken from the body: a
    // record that says who assessed the patient must mean it.
    ...(body.fitness !== undefined && {
      assessedById: actor.id,
      assessedByName: actor.name,
      assessedAt: new Date(),
    }),

    reassessFitness: text(body.reassessFitness),
    reassessNote: text(body.reassessNote),
    ...(body.reassessFitness !== undefined && {
      reassessedById: actor.id,
      reassessedByName: actor.name,
      reassessedAt: new Date(),
    }),
  })
}

function buildChecklist(body, actor) {
  const counts = {
    swabInitial: optionalCount(body.swabInitial, 'swabInitial'),
    swabFinal: optionalCount(body.swabFinal, 'swabFinal'),
    instrumentInitial: optionalCount(body.instrumentInitial, 'instrumentInitial'),
    instrumentFinal: optionalCount(body.instrumentFinal, 'instrumentFinal'),
    needleInitial: optionalCount(body.needleInitial, 'needleInitial'),
    needleFinal: optionalCount(body.needleFinal, 'needleFinal'),
  }

  return defined({
    // Each phase stamps its own time and signer when it is submitted, so the
    // record shows WHEN the checklist was run, not merely that it was.
    ...(body.phase === 'signIn' && { signInAt: new Date(), signInById: actor.id, signInByName: actor.name }),
    identityConfirmed: flag(body.identityConfirmed),
    siteMarked: flag(body.siteMarked),
    consentConfirmed: flag(body.consentConfirmed),
    anaesthesiaCheck: flag(body.anaesthesiaCheck),
    pulseOximeterOn: flag(body.pulseOximeterOn),
    knownAllergy: flag(body.knownAllergy),
    difficultAirwayRisk: flag(body.difficultAirwayRisk),
    bloodLossRisk: flag(body.bloodLossRisk),
    signInNote: text(body.signInNote),

    ...(body.phase === 'timeOut' && { timeOutAt: new Date(), timeOutById: actor.id, timeOutByName: actor.name }),
    teamIntroduced: flag(body.teamIntroduced),
    patientSiteAgreed: flag(body.patientSiteAgreed),
    antibioticGiven: flag(body.antibioticGiven),
    imagingDisplayed: flag(body.imagingDisplayed),
    criticalStepsSaid: flag(body.criticalStepsSaid),
    timeOutNote: text(body.timeOutNote),

    ...(body.phase === 'signOut' && { signOutAt: new Date(), signOutById: actor.id, signOutByName: actor.name }),
    procedureRecorded: flag(body.procedureRecorded),
    specimenLabelled: flag(body.specimenLabelled),
    equipmentIssue: text(body.equipmentIssue),
    recoveryConcern: text(body.recoveryConcern),
    signOutNote: text(body.signOutNote),

    ...counts,
    countsCorrect: flag(body.countsCorrect),
    countNote: text(body.countNote),
    ...(body.countsCorrect !== undefined && { countedById: actor.id, countedByName: actor.name }),
  })
}

function buildAnaesthesia(body, actor) {
  assertOneOf(body.anaesthesiaType, ANAESTHESIA_TYPES, 'anaesthesiaType')
  assertOneOf(body.asaGrade, ASA_GRADES, 'asaGrade')
  assertOneOf(body.airwayDevice, AIRWAY_DEVICES, 'airwayDevice')
  assertOneOf(body.ventilationMode, VENTILATION_MODES, 'ventilationMode')

  const inductionAt = optionalDate(body.inductionAt, 'inductionAt')
  const reversalAt = optionalDate(body.reversalAt, 'reversalAt')
  if (inductionAt && reversalAt && reversalAt <= inductionAt) {
    throw bad('Reversal cannot be at or before induction')
  }

  return defined({
    anaesthesiaType: text(body.anaesthesiaType),
    asaGrade: text(body.asaGrade),
    airwayDevice: text(body.airwayDevice),
    tubeSize: text(body.tubeSize),
    ventilationMode: text(body.ventilationMode),
    ventilatorNote: text(body.ventilatorNote),
    drugsGiven: text(body.drugsGiven),
    fluidsMl: optionalCount(body.fluidsMl, 'fluidsMl', { max: 20000 }),
    fluidNote: text(body.fluidNote),
    bloodGiven: flag(body.bloodGiven),
    bloodUnits: optionalCount(body.bloodUnits, 'bloodUnits', { max: 50 }),
    bloodNote: text(body.bloodNote),
    monitoringNote: text(body.monitoringNote),
    complication: text(body.complication),
    inductionAt,
    reversalAt,
    recordedById: actor.id,
    recordedByName: actor.name,
  })
}

function buildOpNote(body, actor) {
  const incisionAt = optionalDate(body.incisionAt, 'incisionAt')
  const closureAt = optionalDate(body.closureAt, 'closureAt')
  if (incisionAt && closureAt && closureAt <= incisionAt) {
    throw bad('Closure cannot be at or before incision')
  }

  assertOneOf(body.procedureStatus, PROCEDURE_STATUS, 'procedureStatus')
  assertOneOf(body.patientDestination, PATIENT_DESTINATIONS, 'patientDestination')

  return defined({
    incisionAt,
    closureAt,
    findings: text(body.findings),
    procedurePerformed: text(body.procedurePerformed),
    procedureNote: text(body.procedureNote),
    procedureStatus: text(body.procedureStatus),
    // The kinds, and the words. `complication` is unchanged and still holds
    // whatever older notes were written with, so nothing historical is touched.
    complicationTypes: complicationTypes(body.complicationTypes, body.complication),
    complication: text(body.complication),
    specimenSent: flag(body.specimenSent),
    specimenDetail: text(body.specimenDetail),
    bloodLossMl: optionalCount(body.bloodLossMl, 'bloodLossMl', { max: 20000 }),
    drainDetail: text(body.drainDetail),
    postOpInstruction: text(body.postOpInstruction),
    patientDestination: text(body.patientDestination),
    ...(body.procedurePerformed !== undefined && {
      dictatedById: actor.id,
      dictatedByName: actor.name,
      dictatedAt: new Date(),
    }),
  })
}

const BUILDERS = {
  preop: buildPreOp,
  checklist: buildChecklist,
  anaesthesia: buildAnaesthesia,
  opnote: buildOpNote,
}

export async function update(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const actor = getActor(req)
    const { resource, bookingId } = req.body

    const document = DOCUMENTS[resource]
    if (!document) throw bad(`resource must be one of ${Object.keys(DOCUMENTS).join(', ')}`)

    assertMay(req, document.permission)
    const booking = await loadBooking(bookingId, ORG_ID)

    // A cancelled case never happened. Recording against it would put a
    // procedure note and a set of counts on an operation nobody performed.
    if (booking.status === 'CANCELLED') {
      throw conflict(
        `${booking.caseNumber} was cancelled — nothing can be recorded against it`,
        'OT_CASE_CANCELLED',
      )
    }

    // Some documents only make sense once the case has actually happened.
    //
    // An operative note describes an operation: what was found, what was done,
    // how much blood was lost. A case that is still SCHEDULED — or POSTPONED,
    // which means it did not take place — has none of those facts, and a note
    // written against one is a record of a surgery that never occurred. That is
    // the wrong kind of wrong: it reads as evidence.
    //
    // The pre-op assessment is deliberately NOT restricted. Assessing fitness
    // before the day is its whole purpose, and it stays editable after a
    // postponement because the assessment did happen and may need correcting.
    if (document.onlyAfter && document.onlyAfter.includes(booking.status) === false) {
      throw conflict(
        `${booking.caseNumber} is ${booking.status.toLowerCase().replace(/_/g, ' ')} — `
        + `the ${document.label} can only be written once the case is under way`,
        'OT_CASE_NOT_STARTED',
      )
    }

    const data = BUILDERS[resource](req.body, actor)
    if (Object.keys(data).length === 0) throw bad('Nothing to save')

    const before = await db[document.model].findUnique({ where: { bookingId } })

    const row = await db[document.model].upsert({
      where: { bookingId },
      create: { organizationId: ORG_ID, bookingId, ...data },
      update: data,
    })

    await auditIpd(req, ORG_ID, {
      action: before ? 'update' : 'create',
      entityType: `ot.${resource}`,
      entityId: row.id,
      before,
      after: row,
    })
    return res.json({ success: true, data: row })
  } catch (e) {
    if (e.status) return svcErr(res, e)
    next(e)
  }
}
