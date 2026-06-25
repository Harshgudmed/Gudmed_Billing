// Generates backend/data/clinical-kb.json from the ICMR-STW-KnowledgeBase.csv.
// The CSV uses Excel-style quoting (fields wrapped in ", embedded " escaped as "",
// fields can contain commas and newlines). Run once after the CSV changes:
//   node backend/scripts/build-clinical-kb.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSV_PATH = path.resolve(__dirname, '../../ICMR-STW-KnowledgeBase.csv')
const OUT_DIR = path.resolve(__dirname, '../data')
const OUT_PATH = path.join(OUT_DIR, 'clinical-kb.json')

// Quote-aware CSV parser: returns array of rows, each row an array of cell strings.
function parseCsv(text) {
  // Strip BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\r') { /* ignore, handled by \n */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else field += c
    }
  }
  // Trailing field/row (no final newline).
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

// CSV header -> JSON key.
const KEY_MAP = {
  Specialty: 'specialty',
  Condition: 'condition',
  ICD10: 'icd10',
  When_to_Suspect_Symptoms_Signs: 'whenToSuspect',
  Risk_Precipitating_Categorization: 'risk',
  Scores_Risk_Stratification: 'scores',
  Investigations: 'investigations',
  Drugs_and_Dosage: 'drugs',
  Management_by_Level: 'management',
  Referral_RedFlags: 'referralRedFlags',
  Algorithm_Notes: 'algorithmNotes',
}

// ── Suggestion extractors ────────────────────────────────────────────────────
// The ICMR prose isn't structured, so we heuristically surface short test and
// drug names as clickable suggestions. These are advisory only — the doctor taps
// to add, then sets the exact dose. Quality need not be perfect; junk is ignorable.

// Words that look like a header/abbreviation, never a test we want to show.
const TEST_STOP = /\b(if|when|for|with|the|and|or|should|may|might|consider|rule|out|assess|look|done|preferable|to be|in|on|all|any|other|aim|note|tips|order|get|once|detected|stone|patient|patients|history|symptoms|signs|level|levels|score|risk|management|treatment|advised|recommended|evaluation|assessment)\b/i

function cleanPhrase(p) {
  let s = p.replace(/\s+/g, ' ').trim().replace(/^[-•:,.\s]+|[-•:,.\s]+$/g, '').trim()
  // strip leading verbs / severity qualifiers that aren't part of the test name
  s = s.replace(/^(perform|consider|do|order|obtain|check|repeat|get|arrange|send|advise|start)\s+/i, '')
  s = s.replace(/^(some|severe|mild|moderate|no|marked|initial|basic|desirable|optional|essential|preliminary)\s+/i, '')
  return s.trim()
}

// Comorbidities / conditions that get mentioned near investigations but are NOT tests.
const NOT_A_TEST = /\b(stroke|cancer|epilepsy|diabetes|hypothyroidism|coronary artery disease|auto immune|airway obstruction|sepsis|malignancy|infection|anaemia|anemia|pregnancy|obstruction|dehydration|comorbid|disorder|disease)\b/i

function extractTests(text) {
  if (!text) return []
  let t = text.replace(/\([^)]*\)/g, ' ')          // drop parentheticals
  t = t.replace(/\b[A-Z][A-Z0-9 /&'-]{2,}:/g, ' ; ') // header labels -> separator
  const parts = t.split(/[;.:]/).flatMap((s) => s.split(/,| and /i))
  const seen = new Set(); const out = []
  for (let p of parts) {
    p = cleanPhrase(p)
    if (!p) continue
    const words = p.split(' ')
    if (words.length > 4 || p.length < 3 || p.length > 34) continue
    if (TEST_STOP.test(p) && words.length > 2) continue
    if (NOT_A_TEST.test(p)) continue
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    // Title-case the first letter for a tidy chip.
    const chip = key === p.toLowerCase() ? p.charAt(0).toUpperCase() + p.slice(1) : p
    seen.add(key); out.push(chip)
    if (out.length >= 10) break
  }
  return out
}

// Common drug-name endings — catches most generic INN names.
const DRUG_SUFFIX = /(?:azepam|pram|xetine|triptyline|ipramine|cillin|mycin|cycline|floxacin|prazole|tidine|sartan|pril|dipine|olol|terol|tropium|asone|solone|nidazole|azole|idone|oxetine|statin|parin|dronate|caine|osin|oxin|profen|fenac|codeine|tamol|sone|pine|tine|done|mide|ine|ol)$/i
const DRUG_STOP = new Set(['ECG', 'AF', 'BP', 'HR', 'CHF', 'MI', 'TIA', 'DM', 'COPD', 'CKD', 'HF', 'IV', 'IM', 'OAC', 'NSR', 'BB', 'HS', 'OD', 'BD', 'TID', 'QID', 'SOS', 'SBP', 'DBP', 'INR', 'STEMI', 'NSTEMI', 'LV', 'RFA', 'NOAC', 'PHC', 'CHC', 'STW', 'ICMR', 'SAM', 'AKI', 'UTI', 'AES', 'PPH', 'HMB', 'ASD', 'SLD', 'OCD', 'CBT', 'ECT', 'THP', 'EPS', 'AP', 'SSRI', 'SNRI', 'TCA', 'SUD', 'MUS', 'BPH', 'TWOC', 'MET', 'CAP', 'LRTI', 'SABA', 'SAMA', 'UFH', 'PTF', 'TRUS', 'FEV1', 'PEF', 'CRB',
  // Common English words that happen to end with a drug-like suffix.
  'CONTROL', 'COMBINATION', 'COMBINE', 'SALINE', 'STEAM', 'ROUTINE', 'SEVERE', 'DISEASE', 'FEMALE', 'SINGLE', 'MULTIPLE', 'BASELINE', 'PROFILE', 'OUTCOME', 'PEOPLE', 'WHILE', 'DECLINE', 'GUIDELINE', 'MIDLINE', 'TIMELINE', 'MEDICINE', 'VACCINE', 'IODINE', 'EXAMINE', 'DETERMINE', 'PRISTINE', 'MACHINE', 'DEADLINE', 'ONLINE', 'DEFINE', 'INCLINE', 'CONSIDER', 'MANAGE', 'NORMAL', 'GENERAL', 'CONTROL', 'PROTOCOL', 'SCHOOL', 'ALCOHOL', 'SYMBOL', 'TITLE', 'WHOLE', 'ROLE', 'RULE', 'SCALE', 'TABLE', 'STABLE', 'SIMPLE', 'COUPLE', 'NEEDLE', 'HANDLE', 'GENTLE', 'MIDDLE', 'CIRCLE'])

function extractDrugs(text) {
  if (!text) return []
  const t = text.replace(/\([^)]*\)/g, ' ')
  const tokens = t.split(/[^A-Za-z-]+/)
  const seen = new Set(); const out = []
  for (const w of tokens) {
    if (!w || w.length < 5) continue
    if (!/^[A-Z][a-z]+/.test(w)) continue          // Capitalised, mixed-case word
    if (DRUG_STOP.has(w.toUpperCase())) continue
    if (!DRUG_SUFFIX.test(w)) continue
    const key = w.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key); out.push(w)
    if (out.length >= 10) break
  }
  return out
}

const raw = fs.readFileSync(CSV_PATH, 'utf8')
const rows = parseCsv(raw).filter((r) => r.length > 1 && r.some((c) => c.trim() !== ''))
const header = rows[0]
const keys = header.map((h) => KEY_MAP[h.trim()] || h.trim())

const entries = rows.slice(1).map((r) => {
  const obj = {}
  keys.forEach((k, idx) => { obj[k] = (r[idx] ?? '').trim() })
  obj.suggestedTests = extractTests(obj.investigations)
  obj.suggestedDrugs = extractDrugs(obj.drugs)
  return obj
})

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2), 'utf8')

const specialties = [...new Set(entries.map((e) => e.specialty))]
console.log(`Wrote ${entries.length} conditions across ${specialties.length} specialties to ${OUT_PATH}`)
console.log('Specialties:', specialties.join(', '))
