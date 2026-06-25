// Serves the ICMR Standard Treatment Workflow knowledge base (static reference data).
// Backed by backend/data/clinical-kb.json, generated from ICMR-STW-KnowledgeBase.csv
// via scripts/build-clinical-kb.mjs. Loaded once and cached in memory.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KB_PATH = path.resolve(__dirname, '../../data/clinical-kb.json')

let cache = null
function load() {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'))
  } catch (err) {
    console.error('[clinical-kb] failed to load', KB_PATH, err.message)
    cache = []
  }
  return cache
}

// GET /api/clinical-kb/specialties -> ["Cardiology", "ENT", ...]
export function getSpecialties(_req, res, next) {
  try {
    const kb = load()
    const specialties = [...new Set(kb.map((e) => e.specialty))].sort()
    res.json({ success: true, data: specialties })
  } catch (err) {
    next(err)
  }
}

// GET /api/clinical-kb?specialty=Cardiology -> [{ condition, icd10 }, ...]
export function getConditions(req, res, next) {
  try {
    const kb = load()
    const { specialty } = req.query
    let rows = kb
    if (specialty) rows = rows.filter((e) => e.specialty === specialty)
    const data = rows
      .map((e) => ({ condition: e.condition, icd10: e.icd10 }))
      .sort((a, b) => a.condition.localeCompare(b.condition))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

// GET /api/clinical-kb/condition?specialty=X&condition=Y -> full guidance object
export function getCondition(req, res, next) {
  try {
    const kb = load()
    const { specialty, condition } = req.query
    if (!condition) {
      return res.status(400).json({ success: false, error: 'condition is required' })
    }
    const entry = kb.find(
      (e) => e.condition === condition && (!specialty || e.specialty === specialty)
    )
    if (!entry) {
      return res.status(404).json({ success: false, error: 'Condition not found' })
    }
    res.json({ success: true, data: entry })
  } catch (err) {
    next(err)
  }
}
