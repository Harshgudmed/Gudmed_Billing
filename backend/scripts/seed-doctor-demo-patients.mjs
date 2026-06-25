// Give the demo doctor (doctor.demo@gudmed.in) BOTH IPD and OPD patients so the
// "Doctor Notes & Orders" page (IPD) and Consultations (OPD) both show data.
// Idempotent: re-running just re-points the same few records. Run after seed-staff-roles.
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const ORG = process.env.ORGANIZATION_ID || 'org-demo'

async function main() {
  const doc = await db.user.findUnique({ where: { email: 'doctor.demo@gudmed.in' } })
  if (!doc) throw new Error('doctor.demo not found — run seed-staff-roles.mjs first')

  // IPD: make this doctor the attending/admitting doctor for up to 4 admitted patients
  const adms = await db.admission.findMany({ where: { organizationId: ORG, status: 'admitted' }, take: 4 })
  for (const a of adms) {
    await db.admission.update({ where: { id: a.id }, data: { attendingDoctorId: doc.id, admittingDoctorId: doc.id } })
  }

  // OPD: assign up to 6 consultations to this doctor
  let cons = []
  try { cons = await db.consultation.findMany({ where: { organizationId: ORG }, take: 6 }) } catch {}
  for (const c of cons) { try { await db.consultation.update({ where: { id: c.id }, data: { doctorId: doc.id } }) } catch {} }

  // OPD: assign up to 6 appointments to this doctor (best-effort)
  let appts = []
  try { appts = await db.appointment.findMany({ where: { organizationId: ORG }, take: 6 }) } catch {}
  for (const ap of appts) { try { await db.appointment.update({ where: { id: ap.id }, data: { doctorId: doc.id } }) } catch {} }

  console.log('✓ doctor.demo@gudmed.in now has:')
  console.log('   IPD admitted patients :', adms.length)
  console.log('   OPD consultations     :', cons.length)
  console.log('   OPD appointments      :', appts.length)
  console.log('   login: doctor.demo@gudmed.in / Gudmed@123')
  process.exit(0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
