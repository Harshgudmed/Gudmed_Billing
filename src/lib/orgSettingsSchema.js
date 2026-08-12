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
