#!/usr/bin/env node
/**
 * Seed the Surgery/Procedure list (endoscopy etc.) into the RadiologyExam
 * catalog under the "Endoscopy / Procedure" category, so they are orderable
 * alongside imaging. Run, then `node upload-to-prod.js`.
 */
import { db } from './src/config/db.js'

const ORG = 'org-demo'
const pad = (n, l = 3) => String(n).padStart(l, '0')

const PROCEDURES = [
  "Upper GI Endoscopy","Anoscopy","Colonoscopy","Sigmoidoscopy","Thoracoscopy","Capsule Endoscopy",
  "Endoscopy Small Bowel","Endoscopy Upper","Small Bowel Endoscopy","Upper Endoscopy","Cystoscopy",
  "Esophagogastroduodenoscopy","Flexible Sigmoidoscopy","Capsule Enteroscopy","Colposcopy",
  "Virtual Colonoscopy","Bronchoscopy","Cystopanendoscopy","Esophagoscopy","Endocervical Test",
  "ECC Endocervical Curettage Test","Otoendoscopy","Throat Endoscopy",
  "Fiberoptic Endoscopic Evaluation of Swallowing","Pre-Operative Surgical Package",
]

async function main() {
  console.log(`Seeding ${PROCEDURES.length} procedures into the catalog...`)
  let ok = 0, fail = 0
  for (let i = 0; i < PROCEDURES.length; i++) {
    const examName = PROCEDURES[i].trim()
    const id = `proc-${pad(i + 1)}`
    const data = {
      organizationId: ORG, examName,
      examCode: examName.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase(),
      examCategory: 'Endoscopy / Procedure', modality: 'OT',
      price: 3000, isActive: true, updatedAt: new Date(),
    }
    try {
      await db.radiologyExam.upsert({ where: { id }, update: data, create: { id, ...data } })
      ok++
    } catch (e) { fail++; if (fail <= 3) console.log(`  ${id}: ${e.message.slice(0, 80)}`) }
  }
  console.log(`✅ Procedures: ${ok} seeded${fail ? `, ${fail} failed` : ''}`)
  const total = await db.radiologyExam.count({ where: { organizationId: ORG } })
  console.log(`   Total catalog entries now: ${total}`)
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) }).finally(() => db.$disconnect())
