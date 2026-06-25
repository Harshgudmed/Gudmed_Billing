// Phase 3.0 — seed one demo staff user per clinical-orders role (idempotent).
// Org: org-demo. Password (demo mode): Gudmed@123.
// Safe to re-run: upserts by email, never duplicates, never touches other users.
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()
const ORG = process.env.ORGANIZATION_ID || 'org-demo'

const ROLES = [
  { role: 'doctor',               email: 'doctor.demo@gudmed.in',     fullName: 'Dr. Demo Physician' },
  { role: 'nurse',                email: 'nurse.demo@gudmed.in',      fullName: 'Demo Nurse' },
  { role: 'pharmacist',           email: 'pharmacist.demo@gudmed.in', fullName: 'Demo Pharmacist' },
  { role: 'lab_technician',       email: 'lab.demo@gudmed.in',        fullName: 'Demo Lab Technician' },
  { role: 'radiology_technician', email: 'radiology.demo@gudmed.in',  fullName: 'Demo Radiology Technician' },
  { role: 'billing',              email: 'billing.demo@gudmed.in',    fullName: 'Demo Billing Staff' },
  { role: 'housekeeping',         email: 'housekeeping.demo@gudmed.in', fullName: 'Demo Housekeeping' },
]

async function main() {
  const passwordHash = await bcrypt.hash('Gudmed@123', 10)
  for (const u of ROLES) {
    const row = await db.user.upsert({
      where: { email: u.email },
      update: { role: u.role, fullName: u.fullName, isActive: true },
      create: {
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        organizationId: ORG,
        passwordHash,
        isActive: true,
      },
    })
    console.log(`✓ ${u.role.padEnd(22)} ${u.email}  (${row.id})`)
  }
  console.log('\nAll role users ready. Login password (demo): Gudmed@123')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
