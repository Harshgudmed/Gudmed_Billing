// A real surgery catalogue for the OT module.
//
// `specialty` is written to match this hospital's DEPARTMENT names exactly
// (Orthopedics, ENT, Ophthalmology, …), because the booking form narrows the
// catalogue by the department chosen. A catalogue that says "Orthopaedics" while
// the department says "Orthopedics" filters to nothing and looks broken.
//
// Durations are typical theatre times including positioning and closure, not
// knife-to-skin, since that is what a theatre list is planned on.
//
// Run:  node seed-ot-catalogue.js
import { db } from './src/config/db.js'

// code, name, specialty, minutes, anaesthesia
const CATALOGUE = [
  // ── Orthopedics ──
  ['ORT001', 'Total Knee Replacement', 'Orthopedics', 120, 'SPINAL'],
  ['ORT002', 'Total Hip Replacement', 'Orthopedics', 150, 'SPINAL'],
  ['ORT003', 'Fracture Fixation (ORIF)', 'Orthopedics', 90, 'GENERAL'],
  ['ORT004', 'Closed Reduction and Casting', 'Orthopedics', 30, 'SEDATION'],
  ['ORT005', 'Arthroscopy — Knee', 'Orthopedics', 60, 'SPINAL'],
  ['ORT006', 'Arthroscopy — Shoulder', 'Orthopedics', 75, 'GENERAL'],
  ['ORT007', 'ACL Reconstruction', 'Orthopedics', 120, 'SPINAL'],
  ['ORT008', 'Carpal Tunnel Release', 'Orthopedics', 30, 'LOCAL'],
  ['ORT009', 'Implant Removal', 'Orthopedics', 45, 'SPINAL'],
  ['ORT010', 'Spinal Fusion (Lumbar)', 'Orthopedics', 180, 'GENERAL'],
  ['ORT011', 'Discectomy', 'Orthopedics', 90, 'GENERAL'],
  ['ORT012', 'Amputation — Below Knee', 'Orthopedics', 90, 'SPINAL'],
  ['ORT013', 'Tendon Repair', 'Orthopedics', 60, 'REGIONAL'],
  ['ORT014', 'Hemiarthroplasty (Hip)', 'Orthopedics', 100, 'SPINAL'],

  // ── General Medicine (general surgical procedures) ──
  ['GEN001', 'Appendicectomy', 'General Medicine', 60, 'GENERAL'],
  ['GEN002', 'Laparoscopic Cholecystectomy', 'General Medicine', 90, 'GENERAL'],
  ['GEN003', 'Open Cholecystectomy', 'General Medicine', 90, 'GENERAL'],
  ['GEN004', 'Inguinal Hernia Repair (Open Mesh)', 'General Medicine', 75, 'SPINAL'],
  ['GEN005', 'Laparoscopic Hernia Repair (TAPP)', 'General Medicine', 90, 'GENERAL'],
  ['GEN006', 'Umbilical Hernia Repair', 'General Medicine', 60, 'SPINAL'],
  ['GEN007', 'Haemorrhoidectomy', 'General Medicine', 45, 'SPINAL'],
  ['GEN008', 'Fistulectomy', 'General Medicine', 45, 'SPINAL'],
  ['GEN009', 'Fissurectomy with Sphincterotomy', 'General Medicine', 30, 'SPINAL'],
  ['GEN010', 'Pilonidal Sinus Excision', 'General Medicine', 60, 'SPINAL'],
  ['GEN011', 'Thyroidectomy', 'General Medicine', 120, 'GENERAL'],
  ['GEN012', 'Exploratory Laparotomy', 'General Medicine', 150, 'GENERAL'],
  ['GEN013', 'Incision and Drainage of Abscess', 'General Medicine', 30, 'LOCAL'],
  ['GEN014', 'Excision of Lipoma / Sebaceous Cyst', 'General Medicine', 30, 'LOCAL'],
  ['GEN015', 'Varicose Vein Surgery', 'General Medicine', 90, 'SPINAL'],
  ['GEN016', 'Splenectomy', 'General Medicine', 150, 'GENERAL'],
  ['GEN017', 'Colostomy / Ileostomy', 'General Medicine', 120, 'GENERAL'],
  ['GEN018', 'Wound Debridement', 'General Medicine', 45, 'SEDATION'],
  ['GEN019', 'Skin Grafting', 'General Medicine', 90, 'GENERAL'],
  ['GEN020', 'Circumcision', 'General Medicine', 30, 'LOCAL'],

  // ── ENT ──
  ['ENT001', 'Tonsillectomy', 'ENT', 45, 'GENERAL'],
  ['ENT002', 'Adenoidectomy', 'ENT', 40, 'GENERAL'],
  ['ENT003', 'Tonsillectomy with Adenoidectomy', 'ENT', 60, 'GENERAL'],
  ['ENT004', 'Septoplasty', 'ENT', 60, 'GENERAL'],
  ['ENT005', 'Functional Endoscopic Sinus Surgery (FESS)', 'ENT', 90, 'GENERAL'],
  ['ENT006', 'Myringotomy with Grommet', 'ENT', 30, 'GENERAL'],
  ['ENT007', 'Tympanoplasty', 'ENT', 120, 'GENERAL'],
  ['ENT008', 'Mastoidectomy', 'ENT', 150, 'GENERAL'],
  ['ENT009', 'Direct Laryngoscopy and Biopsy', 'ENT', 30, 'GENERAL'],
  ['ENT010', 'Tracheostomy', 'ENT', 45, 'LOCAL'],
  ['ENT011', 'Turbinate Reduction', 'ENT', 30, 'GENERAL'],
  ['ENT012', 'Parotidectomy', 'ENT', 150, 'GENERAL'],

  // ── Ophthalmology ──
  ['OPH001', 'Cataract Surgery (Phacoemulsification)', 'Ophthalmology', 30, 'LOCAL'],
  ['OPH002', 'Cataract Surgery (SICS)', 'Ophthalmology', 40, 'LOCAL'],
  ['OPH003', 'Trabeculectomy', 'Ophthalmology', 60, 'LOCAL'],
  ['OPH004', 'Vitrectomy', 'Ophthalmology', 90, 'LOCAL'],
  ['OPH005', 'Pterygium Excision', 'Ophthalmology', 30, 'LOCAL'],
  ['OPH006', 'Dacryocystorhinostomy (DCR)', 'Ophthalmology', 60, 'LOCAL'],
  ['OPH007', 'Squint Correction', 'Ophthalmology', 60, 'GENERAL'],
  ['OPH008', 'Corneal Transplant (Keratoplasty)', 'Ophthalmology', 90, 'LOCAL'],
  ['OPH009', 'Chalazion Excision', 'Ophthalmology', 20, 'LOCAL'],
  ['OPH010', 'Retinal Detachment Repair', 'Ophthalmology', 120, 'LOCAL'],

  // ── Cardiology ──
  ['CAR001', 'Coronary Angiography', 'Cardiology', 45, 'LOCAL'],
  ['CAR002', 'Coronary Angioplasty with Stenting (PCI)', 'Cardiology', 90, 'LOCAL'],
  ['CAR003', 'Permanent Pacemaker Implantation', 'Cardiology', 90, 'LOCAL'],
  ['CAR004', 'Coronary Artery Bypass Graft (CABG)', 'Cardiology', 300, 'GENERAL'],
  ['CAR005', 'Valve Replacement', 'Cardiology', 300, 'GENERAL'],
  ['CAR006', 'Pericardiocentesis', 'Cardiology', 45, 'LOCAL'],
  ['CAR007', 'ICD Implantation', 'Cardiology', 120, 'SEDATION'],

  // ── Neurology (neurosurgical) ──
  ['NEU001', 'Craniotomy for Tumour Excision', 'Neurology', 240, 'GENERAL'],
  ['NEU002', 'Burr Hole and Evacuation', 'Neurology', 90, 'GENERAL'],
  ['NEU003', 'Ventriculoperitoneal Shunt', 'Neurology', 90, 'GENERAL'],
  ['NEU004', 'Lumbar Laminectomy', 'Neurology', 120, 'GENERAL'],
  ['NEU005', 'Microdiscectomy', 'Neurology', 120, 'GENERAL'],
  ['NEU006', 'Decompressive Craniectomy', 'Neurology', 180, 'GENERAL'],

  // ── Oncology ──
  ['ONC001', 'Modified Radical Mastectomy', 'Oncology', 150, 'GENERAL'],
  ['ONC002', 'Lumpectomy with Axillary Clearance', 'Oncology', 120, 'GENERAL'],
  ['ONC003', 'Excision Biopsy of Lymph Node', 'Oncology', 45, 'LOCAL'],
  ['ONC004', 'Chemoport Insertion', 'Oncology', 60, 'LOCAL'],
  ['ONC005', 'Wide Local Excision', 'Oncology', 90, 'GENERAL'],
  ['ONC006', 'Radical Hysterectomy', 'Oncology', 180, 'GENERAL'],

  // ── Pediatrics ──
  ['PED001', 'Paediatric Herniotomy', 'Pediatrics', 45, 'GENERAL'],
  ['PED002', 'Orchidopexy', 'Pediatrics', 60, 'GENERAL'],
  ['PED003', 'Pyloromyotomy', 'Pediatrics', 60, 'GENERAL'],
  ['PED004', 'Cleft Lip Repair', 'Pediatrics', 120, 'GENERAL'],
  ['PED005', 'Cleft Palate Repair', 'Pediatrics', 150, 'GENERAL'],
  ['PED006', 'Hypospadias Repair', 'Pediatrics', 120, 'GENERAL'],

  // ── Dermatology ──
  ['DER001', 'Skin Lesion Excision', 'Dermatology', 30, 'LOCAL'],
  ['DER002', 'Punch Biopsy', 'Dermatology', 15, 'LOCAL'],
  ['DER003', 'Nail Avulsion', 'Dermatology', 20, 'LOCAL'],
  ['DER004', 'Electrocautery of Warts', 'Dermatology', 20, 'LOCAL'],
]

async function main() {
  const org = (await db.organization.findMany({
    select: { id: true, name: true, _count: { select: { patients: true } } },
  })).sort((a, b) => b._count.patients - a._count.patients)[0]
  console.log('Organization:', org.name, '\n')

  const departments = await db.department.findMany({
    where: { organizationId: org.id },
    select: { name: true },
    orderBy: { name: 'asc' },
  })
  const departmentNames = new Set(departments.map((d) => d.name))

  let created = 0
  let updated = 0

  for (const [code, name, specialty, minutes, anaesthesia] of CATALOGUE) {
    const existing = await db.surgeryCatalog.findFirst({
      where: { organizationId: org.id, name },
      select: { id: true },
    })

    if (existing) {
      await db.surgeryCatalog.update({
        where: { id: existing.id },
        data: { code, specialty, defaultMinutes: minutes, defaultAnaesthesia: anaesthesia },
      })
      updated++
    } else {
      await db.surgeryCatalog.create({
        data: {
          organizationId: org.id,
          code, name, specialty,
          defaultMinutes: minutes,
          defaultAnaesthesia: anaesthesia,
        },
      })
      created++
    }
  }

  // The filter only works when the two names agree, so say so plainly rather
  // than leaving it to be discovered in a demo.
  console.log('Specialty -> department match:')
  const bySpecialty = await db.surgeryCatalog.groupBy({
    by: ['specialty'],
    where: { organizationId: org.id },
    _count: true,
  })
  for (const row of bySpecialty.sort((a, b) => (a.specialty ?? '').localeCompare(b.specialty ?? ''))) {
    const matched = departmentNames.has(row.specialty)
    console.log(`  ${matched ? '✅' : '⚠️ '} ${String(row.specialty).padEnd(20)} ${String(row._count).padStart(3)} procedures${matched ? '' : '  — no department of this name; the form will not narrow to it'}`)
  }

  const total = await db.surgeryCatalog.count({ where: { organizationId: org.id } })
  console.log(`\n🎉 ${created} added, ${updated} updated. Catalogue now holds ${total} procedures.`)
}

main()
  .catch((e) => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
