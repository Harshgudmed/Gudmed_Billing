// Every hospital-configurable setting, declared once.
//
// These live in Organization.settings, a JSON blob, and each one used to be
// written out in SIX places: the shared reader (orgSettings.js), the hook's
// default shape (useOrgSettings.js), and the form's defaults, loader, saver and
// input (SettingsModule.jsx). Nothing tied them together, so forgetting one
// failed silently and differently each time — miss the reader and receipts print
// a blank, miss the loader and the screen opens empty over a value that is really
// in the database, miss the saver and pressing Save quietly discards what was
// typed. None of them raise an error.
//
// The drift that proves the point: `showEmptyReceiptFields` defaulted to `true`
// in the reader and `false` in the form. Two of this database's three hospitals
// have no such key, so their Settings screen shows the toggle OFF while their
// receipts print the empty fields ON — the screen lies about what printing does.
// One default, here, is the only way that cannot happen again.

export const ORG_SETTING_FIELDS = [
  { key: 'website',                type: 'text',   default: '',    label: 'Website' },
  { key: 'gstNo',                  type: 'text',   default: '',    label: 'GST No' },
  { key: 'cin',                    type: 'text',   default: '',    label: 'CIN' },
  { key: 'sacCode',                type: 'text',   default: '',    label: 'SAC Code' },
  { key: 'labCode',                type: 'text',   default: '',    label: 'Lab Code' },
  { key: 'homeCollectionCharge',   type: 'number', default: 0,     label: 'Home Collection Charge' },
  { key: 'showEmptyReceiptFields', type: 'bool',   default: true,  label: 'Show empty fields on receipts' },
  { key: 'receiptFooter',          type: 'text',   default: '',    label: 'Receipt Footer' },

  // Cancellation & refund. Each hospital decides for itself: one wants the money
  // back at the counter immediately, another wants finance to approve first.
  //
  // The two percentages are separate because a real hospital charges by WHEN the
  // cancellation happens, not by a flat rate — a lab test cancelled before the
  // sample is drawn costs the hospital nothing, and the same test cancelled after
  // the tube is filled has already spent the reagent and the technician's time.
  // A hospital that wants one flat rate simply puts the same number in both.
  { key: 'refundMode',                type: 'text',   default: 'approval',
    label: 'Refund mode', options: ['approval', 'instant'] },
  { key: 'cancelChargeBeforeWorkPct', type: 'number', default: 0,
    label: 'Cancellation charge % — before work started' },
  { key: 'cancelChargeAfterWorkPct',  type: 'number', default: 100,
    label: 'Cancellation charge % — after work started' },

  // Spoken announcements on the waiting-hall display boards.
  //
  // OFF by default, and that is deliberate: a hospital that upgrades must not
  // discover its televisions have started talking to a full waiting room. The
  // administrator turns it on once they have chosen the words.
  //
  // The two sentences are separate because they are two different instructions.
  // "You are next" must NOT bring the patient to the door — the doctor is still
  // with somebody — it must keep them nearby and get their reports out. "Please
  // come in" is the opposite. One combined sentence can only do one of those
  // jobs, and doing the wrong one puts the patient back at the door, which is
  // the behaviour this whole feature exists to remove.
  //
  // English by default even though a hospital may want Hindi: this machine's
  // Windows install has three English voices and no Hindi one, and a Hindi
  // sentence read by an English voice is worse than an English sentence. The
  // language pack is a one-time install on each display PC, after which the
  // hospital rewrites both lines in its own words.
  { key: 'announceEnabled',  type: 'bool',   default: false,
    label: 'Speak announcements on display boards' },
  { key: 'announceLanguage', type: 'text',   default: 'en-IN',
    label: 'Announcement language', options: [
      'en-IN', 'en-US', 'en-GB',
      'hi-IN', 'mr-IN', 'ta-IN', 'te-IN', 'kn-IN', 'ml-IN', 'bn-IN', 'gu-IN', 'pa-IN', 'or-IN', 'ur-IN', 'as-IN',
      'es-ES', 'fr-FR', 'ar-SA'
    ] },
  { key: 'announceSay',      type: 'text',   default: 'name',
    label: 'Announce by', options: ['name', 'token', 'both'] },
  { key: 'announceRepeat',   type: 'number', default: 2,
    label: 'Repeat each announcement' },
  { key: 'announceChime',    type: 'bool',   default: true,
    label: 'Play a chime first' },
  { key: 'announceReadyText', type: 'text',
    default: '{name}, you are next. Please wait near Room {room} and keep your reports ready.',
    label: 'Announcement — get ready' },
  { key: 'announceCallText',  type: 'text',
    default: '{name}, please come to Room {room}.',
    label: 'Announcement — come in' },

  // What the display boards SHOW, as opposed to what they say. Separate settings
  // on purpose: a hospital can reasonably print the name on a screen that only
  // the waiting area sees while announcing the token over speakers that carry
  // into the corridor — and the reverse is just as reasonable. Tying the two
  // together would force one policy on both.
  //
  // This replaces a hardcoded `MASK_PATIENT_IDENTITY = false` in the wall-display
  // constants, which made the choice once for every hospital.
  { key: 'displayPatientAs', type: 'text', default: 'name',
    label: 'Show patients on the board as', options: ['name', 'token', 'both'] },
  { key: 'displayShowDoctorName', type: 'bool', default: true,
    label: 'Show the doctor\'s name on the board' },
]

const BY_KEY = Object.fromEntries(ORG_SETTING_FIELDS.map((f) => [f.key, f]))

/** One stored value, coerced to the type the app expects. */
function coerce(field, raw) {
  if (raw === undefined || raw === null || raw === '') return field.default
  if (field.type === 'number') return Number(raw) || 0
  if (field.type === 'bool') return raw === true || raw === 'true'
  return String(raw)
}

/**
 * The settings JSON as the app reads it — every declared key present and typed,
 * whatever the stored blob happens to contain. A hospital saved before a setting
 * existed still gets its default rather than `undefined`.
 */
export function readOrgSettings(stored = {}) {
  const out = {}
  for (const f of ORG_SETTING_FIELDS) out[f.key] = coerce(f, stored[f.key])
  return out
}

/** The same shape with nothing stored — the value to hold before the fetch lands. */
export function defaultOrgSettings() {
  return readOrgSettings({})
}

/**
 * Form values are strings (an <input> holds text even when the field is a number),
 * so numbers become '' rather than '0' — a zero charge and an unset one look the
 * same in a box, and printing '0' into an empty field reads as a real value.
 */
export function toFormValues(stored = {}) {
  const out = {}
  for (const f of ORG_SETTING_FIELDS) {
    const v = coerce(f, stored[f.key])
    out[f.key] = f.type === 'number' ? (v ? String(v) : '') : v
  }
  return out
}

/** Turn the form's strings back into the typed JSON the API stores. */
export function fromFormValues(form = {}) {
  const out = {}
  for (const f of ORG_SETTING_FIELDS) out[f.key] = coerce(f, form[f.key])
  return out
}

export { BY_KEY as ORG_SETTING_BY_KEY }
