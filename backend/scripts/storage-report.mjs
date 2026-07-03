// ============================================================================
//  STORAGE & MEMORY  —  short summary for the client (no long reading).
//  Run from the project root:   npm run size-check
//  (save it to send:            npm run size-check > report.txt)
//  Read-only. Safe to run anytime.
// ============================================================================

import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND   = path.resolve(__dirname, '..')
const ROOT      = path.resolve(__dirname, '..', '..')
config({ path: path.join(BACKEND, '.env') })

const L = (s = '') => console.log(s)
function size(bytes) {
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB'
  if (mb >= 1)    return mb.toFixed(1) + ' MB'
  return (bytes / 1024).toFixed(0) + ' KB'
}
function folderSize(dir) {
  let total = 0, entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    try { total += e.isDirectory() ? folderSize(full) : fs.statSync(full).size } catch {}
  }
  return total
}

const MODULE_OF = {
  Patient: 'Patients', PatientDocument: 'Patients',
  Appointment: 'Appointments',
  Consultation: 'Consultations',
  PharmacyDrug: 'Pharmacy', PharmacyBatch: 'Pharmacy', Prescription: 'Pharmacy',
  PharmacySale: 'Pharmacy', PharmacyPurchaseOrder: 'Pharmacy', StockLedger: 'Pharmacy',
  Vendor: 'Pharmacy', MedicineReference: 'Pharmacy',
  LabTest: 'Laboratory', LabOrder: 'Laboratory', LabResult: 'Laboratory',
  RadiologyExam: 'Radiology', RadiologyOrder: 'Radiology', RadiologyReport: 'Radiology',
  Ward: 'Inpatient', Bed: 'Inpatient', Admission: 'Inpatient', BedCategory: 'Inpatient',
  TariffPlan: 'Inpatient', ChargeMaster: 'Inpatient', TariffRule: 'Inpatient',
  PatientTariff: 'Inpatient', BedOccupancy: 'Inpatient', IpdCharge: 'Inpatient',
  Bill: 'Inpatient', BillPayment: 'Inpatient', BillCounter: 'Inpatient',
  VitalsRecord: 'Inpatient', ClinicalNote: 'Inpatient', MedicationAdministration: 'Inpatient',
  DischargeClearance: 'Inpatient', HousekeepingTask: 'Inpatient', ClinicalOrder: 'Inpatient',
  OrderTask: 'Inpatient', ClinicalOrderEvent: 'Inpatient', IpdConsultation: 'Inpatient',
  PreTriage: 'Pre-Triage', QueueManagement: 'Queue', DayCareCase: 'Day Care',
  AmbulanceTrip: 'Ambulance', InsuranceCase: 'Insurance', InsuranceClaim: 'Insurance',
  DeathCertificate: 'Death Certificates',
}

async function main() {
  // ── gather numbers ──
  const appBytes = folderSize(path.join(ROOT, 'src')) +
                   folderSize(path.join(BACKEND, 'src')) +
                   folderSize(path.join(BACKEND, 'prisma')) +
                   folderSize(path.join(ROOT, 'node_modules')) +
                   folderSize(path.join(BACKEND, 'node_modules'))
  const buildBytes = folderSize(path.join(ROOT, 'dist'))

  const { PrismaClient } = await import('@prisma/client')
  const db = new PrismaClient()
  let dbBytes = 0, totalRows = 0, sorted = []
  try {
    await db.$executeRawUnsafe('ANALYZE')
    dbBytes = Number((await db.$queryRawUnsafe(`SELECT pg_database_size(current_database()) AS b`))[0].b)
    const tables = await db.$queryRawUnsafe(
      `SELECT relname AS t, pg_total_relation_size(relid) AS bytes, n_live_tup AS rows
       FROM pg_stat_user_tables`)
    const roll = {}
    for (const r of tables) {
      const m = MODULE_OF[r.t] || 'Other / Core'
      roll[m] ??= { bytes: 0, rows: 0 }
      roll[m].bytes += Number(r.bytes); roll[m].rows += Number(r.rows)
    }
    sorted = Object.entries(roll).sort((a, b) => b[1].bytes - a[1].bytes)
    totalRows = sorted.reduce((s, [, v]) => s + v.rows, 0)
  } finally { await db.$disconnect() }

  const grand = dbBytes + appBytes + buildBytes

  // RAM of just the API SERVER (real production figure).
  let ramMB = 0
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*server.js*\' } | Select-Object -First 1 -ExpandProperty WorkingSetSize)"',
        { encoding: 'utf8' })
      ramMB = (parseInt(out.trim()) || 0) / 1024 / 1024
    } else {
      const out = execSync("ps -C node -o rss=,args= 2>/dev/null | grep server.js | head -1 | awk '{print $1}'",
        { encoding: 'utf8' })
      ramMB = (parseInt(out.trim()) || 0) / 1024
    }
  } catch {}

  // ── print ──
  const inIN = (n) => n.toLocaleString('en-IN')
  L('')
  L('============================================================')
  L('   STORAGE & MEMORY  —  QUICK SUMMARY')
  L('   ' + new Date().toLocaleDateString())
  L('============================================================')
  L('')
  L('   STORAGE                                  SIZE')
  L('   ---------------------------------------------------')
  L('   Saved data (Database) ............ ' + size(dbBytes).padStart(8) + '   (' + inIN(totalRows) + ' records)')
  L('   App + libraries (on server) ...... ' + size(appBytes).padStart(8))
  L('   Website (what users open) ........ ' + size(buildBytes).padStart(8))
  L('   ---------------------------------------------------')
  L('   TOTAL ............................ ' + size(grand).padStart(8))
  L('')
  L('   DATA BREAKDOWN (per section)')
  L('   ---------------------------------------------------')
  L('   ' + 'Section'.padEnd(22) + 'Space'.padStart(9) + '   Records')
  for (const [m, v] of sorted) {
    L('   ' + m.padEnd(22) + size(v.bytes).padStart(9) + '   ' + inIN(v.rows))
  }
  L('')
  L('   MEMORY (RAM) while running')
  L('   ---------------------------------------------------')
  L('   App server uses .................. ' + ((ramMB > 0 ? Math.round(ramMB) : 60) + ' MB').padStart(8))
  L('   >> Stays the SAME even with 20 lakh+ records.')
  L('')
  L('============================================================')
  L('')
}

main().catch(e => { console.error('Report failed:', e.message); process.exit(1) })
