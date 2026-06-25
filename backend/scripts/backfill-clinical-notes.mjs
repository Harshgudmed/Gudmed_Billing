// One-time migration: copy existing Admission.clinicalNotes (JSON) → ClinicalNote table.
// Idempotent — skips admissions that already have ClinicalNote rows.
// The JSON column is left intact as a fallback. node scripts/backfill-clinical-notes.mjs
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const ORG = process.env.ORGANIZATION_ID || 'org-demo'

const TYPE_MAP = {
  nursing: 'NURSING', doctor: 'DOCTOR', progress: 'PROGRESS',
  procedure: 'PROCEDURE', observation: 'OBSERVATION', transfer: 'TRANSFER', note: 'PROGRESS',
}

async function main() {
  const admissions = await db.admission.findMany({
    where: { organizationId: ORG, clinicalNotes: { not: null } },
    select: { id: true, clinicalNotes: true },
  })
  let migrated = 0, skipped = 0, admWith = 0
  for (const a of admissions) {
    let notes = []
    try { notes = a.clinicalNotes ? JSON.parse(a.clinicalNotes) : [] } catch { notes = [] }
    if (!Array.isArray(notes) || notes.length === 0) continue

    const existing = await db.clinicalNote.count({ where: { organizationId: ORG, admissionId: a.id } })
    if (existing > 0) { skipped++; continue }

    admWith++
    for (const n of notes) {
      await db.clinicalNote.create({
        data: {
          organizationId: ORG,
          admissionId: a.id,
          noteType: TYPE_MAP[(n.noteType || 'note').toLowerCase()] || 'PROGRESS',
          body: n.note || n.text || '(empty)',
          authorName: n.authorName || null,
          authoredAt: n.date ? new Date(n.date) : new Date(),
          vitals: n.vitals || undefined,
        },
      })
      migrated++
    }
  }
  console.log(`Backfill done: ${migrated} notes from ${admWith} admissions migrated, ${skipped} admissions already had notes (skipped).`)
}
main().catch((e) => { console.error('BACKFILL FAILED:', e); process.exit(1) }).finally(() => db.$disconnect())
