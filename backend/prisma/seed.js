import { db } from '../src/config/db.js'
import bcrypt from 'bcryptjs'

// ============================================================================
// GudMed — ONE consolidated demo seed.
//
// This single file replaces the ~35 scattered seed-*.js scripts. It sets up a
// coherent, ready-to-explore demo for a FRESH database and is fully IDEMPOTENT:
// every write is an upsert / find-or-create, so running it twice (or on a DB
// that already has data) never duplicates rows and never crashes on a unique
// constraint — the old `.create()` seeds were the reason re-runs blew up.
//
// Run it with:   npx prisma db seed        (or)   node prisma/seed.js
//
// Everything lands in the "org-demo" organization. Login (same password for
// every demo account):  admin@gudmed.in / Gudmed@123
// ============================================================================

const ORG_ID = 'org-demo'
const DEMO_PASSWORD = 'Gudmed@123'

// Ten departments with short codes (used to build doctor emails / room numbers).
const DEPARTMENTS = [
  { name: 'Cardiology', code: 'CARD' },
  { name: 'General Medicine', code: 'GM' },
  { name: 'Pediatrics', code: 'PED' },
  { name: 'Orthopedics', code: 'ORTHO' },
  { name: 'Neurology', code: 'NEURO' },
  { name: 'Ophthalmology', code: 'OPHTHO' },
  { name: 'ENT', code: 'ENT' },
  { name: 'Psychiatry', code: 'PSY' },
  { name: 'Dermatology', code: 'DERM' },
  { name: 'Oncology', code: 'ONC' },
]

const FIRST_NAMES = ['Priya', 'Suresh', 'Anita', 'Rahul', 'Meera', 'Vikram', 'Sunita', 'Arjun', 'Kavita', 'Deepak',
  'Neha', 'Rajesh', 'Pooja', 'Amit', 'Divya', 'Sanjay', 'Ritu', 'Manoj', 'Swati', 'Karan']
const LAST_NAMES = ['Mehta', 'Patel', 'Joshi', 'Sharma', 'Nair', 'Reddy', 'Gupta', 'Iyer', 'Singh', 'Rao',
  'Verma', 'Desai', 'Kapoor', 'Bose', 'Menon', 'Chopra', 'Pillai', 'Shah', 'Malhotra', 'Bhat']

// Free follow-up ≤3 days, discounted 3–15 and 15–30 — the standard OPD fee ladder.
const FEE_SLABS = [
  { fromDays: 0, toDays: 3, feeAmount: 0, notes: 'Free follow-up' },
  { fromDays: 3, toDays: 15, feeAmount: 300, notes: 'Discounted follow-up' },
  { fromDays: 15, toDays: 30, feeAmount: 200, notes: 'Further discounted' },
]

async function main() {
  console.log('🌱 Seeding GudMed demo (idempotent — safe to re-run)...\n')
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  // 1. Organization -----------------------------------------------------------
  const org = await db.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'GudMed Hospital',
      slug: 'gudmed',
      email: 'harsh.raj@gudmed.in',
      phone: '7322907656',
      address: 'Major Laxmi Chand Road, Chakkarpur',
      city: 'Gurugram',
      region: 'Haryana',
      country: 'India',
      primaryColor: '#2E4168',
      settings: JSON.stringify({
        currency: 'INR', language: 'en', timezone: 'Asia/Kolkata',
        workingHours: { start: '08:00', end: '20:00' }, appointmentDuration: 30,
      }),
      subscriptionTier: 'pro',
      subscriptionStatus: 'active',
      isActive: true,
      updatedAt: new Date(),
    },
  })
  console.log(`✅ Organization: ${org.name}`)

  // 2. Departments ------------------------------------------------------------
  // Unique per (organizationId, name) → upsert on that compound key.
  const deptByCode = {}
  for (const d of DEPARTMENTS) {
    const dept = await db.department.upsert({
      where: { organizationId_name: { organizationId: ORG_ID, name: d.name } },
      update: { code: d.code },
      create: { organizationId: ORG_ID, name: d.name, code: d.code },
    })
    deptByCode[d.code] = dept
  }
  console.log(`✅ Departments: ${DEPARTMENTS.length}`)

  // 3. Staff users (admin + receptionist) — email is the unique identity -------
  // Re-assert passwordHash on every run so a drifted hash resets to DEMO_PASSWORD.
  const staff = [
    { email: 'admin@gudmed.in', fullName: 'Admin User', role: 'admin' },
    { email: 'reception@gudmed.in', fullName: 'Front Desk', role: 'receptionist' },
  ]
  for (const s of staff) {
    await db.user.upsert({
      where: { email: s.email },
      update: { passwordHash },
      create: {
        organizationId: ORG_ID, email: s.email, fullName: s.fullName,
        role: s.role, passwordHash, isActive: true,
      },
    })
  }
  console.log(`✅ Staff: admin + receptionist`)

  // 4. Doctors (2 per department) + commission config + fee slabs -------------
  const doctors = []
  let k = 0
  for (const d of DEPARTMENTS) {
    for (let i = 1; i <= 2; i++) {
      const email = `dr.${d.code.toLowerCase()}.${i}@gudmed.in`
      const fullName = `Dr. ${FIRST_NAMES[k % FIRST_NAMES.length]} ${LAST_NAMES[k % LAST_NAMES.length]}`
      const consultationFee = 400 + (k % 8) * 50 // ₹400–₹750
      const doc = await db.user.upsert({
        where: { email },
        update: { passwordHash, departmentId: deptByCode[d.code].id, specialization: d.name, consultationFee, followUpDays: 7 },
        create: {
          organizationId: ORG_ID, email, fullName, role: 'doctor',
          departmentId: deptByCode[d.code].id, specialization: d.name,
          consultationFee, followUpDays: 7, passwordHash, isActive: true,
        },
      })
      doctors.push(doc)
      k++

      // Commission config — doctorId is unique, so upsert on it.
      await db.doctorCommissionConfig.upsert({
        where: { doctorId: doc.id },
        update: {},
        create: { organizationId: ORG_ID, doctorId: doc.id, commissionType: 'percentage', commissionRate: 20, isActive: true },
      })

      // Fee slabs — unique per (doctorId, fromDays, toDays).
      for (const slab of FEE_SLABS) {
        await db.doctorFeeSlab.upsert({
          where: { doctorId_fromDays_toDays: { doctorId: doc.id, fromDays: slab.fromDays, toDays: slab.toDays } },
          update: { feeAmount: slab.feeAmount, notes: slab.notes },
          create: { organizationId: ORG_ID, doctorId: doc.id, ...slab, isActive: true },
        })
      }
    }
  }
  console.log(`✅ Doctors: ${doctors.length} (each with commission config + fee slabs)`)

  // 5. Wards (inpatient) — fixed ids so upsert is stable ----------------------
  const wards = [
    { id: 'ward-general', name: 'General Ward', type: 'general', capacity: 20, floor: '1st' },
    { id: 'ward-icu', name: 'ICU', type: 'icu', capacity: 5, floor: '2nd' },
    { id: 'ward-private', name: 'Private Ward', type: 'private', capacity: 10, floor: '3rd' },
  ]
  for (const w of wards) {
    await db.ward.upsert({
      where: { id: w.id },
      update: {},
      create: { ...w, organizationId: ORG_ID, isActive: true },
    })
  }
  console.log(`✅ Wards: ${wards.length}`)

  // 6. Floors + Rooms + doctor-room links (OPD / queue / display board) -------
  // Spread the 10 departments across 4 floors; one consulting room each, linked
  // to that department's first doctor. Find-or-create keeps it idempotent.
  const FLOOR_NAMES = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor']
  let roomCount = 0
  for (let di = 0; di < DEPARTMENTS.length; di++) {
    const dept = deptByCode[DEPARTMENTS[di].code]
    const floorName = FLOOR_NAMES[di % FLOOR_NAMES.length]

    let floor = await db.floor.findFirst({ where: { organizationId: ORG_ID, name: floorName } })
    if (!floor) floor = await db.floor.create({ data: { organizationId: ORG_ID, name: floorName } })

    const roomNumber = String(101 + di)
    let room = await db.room.findFirst({ where: { organizationId: ORG_ID, floorId: floor.id, roomNumber } })
    if (!room) {
      room = await db.room.create({ data: { organizationId: ORG_ID, floorId: floor.id, departmentId: dept.id, roomNumber, sittingType: 'single' } })
    }
    roomCount++

    // Link the department's first doctor (unique per doctorId+roomId).
    const deptDoctor = doctors.find((doc) => doc.departmentId === dept.id)
    if (deptDoctor) {
      const link = await db.doctorRoomAssignment.findFirst({ where: { roomId: room.id, doctorId: deptDoctor.id } })
      if (!link) await db.doctorRoomAssignment.create({ data: { organizationId: ORG_ID, roomId: room.id, doctorId: deptDoctor.id } })
    }
  }
  console.log(`✅ Floors + Rooms: ${roomCount} rooms across ${FLOOR_NAMES.length} floors`)

  // 7. Patients (30) — keyed on (organizationId, mrn) -------------------------
  // NOT `where: { mrn }`. An MRN is unique WITHIN a hospital, not across the
  // system (@@unique([organizationId, mrn]) — see the
  // 20260806040818_scope_document_numbers_per_org migration), so mrn alone is
  // not a valid unique selector and Prisma rejects the call outright. This ran
  // on every deploy and took the whole build down with it.
  const patients = []
  for (let i = 1; i <= 30; i++) {
    const mrn = `MRN-DEMO-${String(i).padStart(4, '0')}`
    const p = await db.patient.upsert({
      where: { organizationId_mrn: { organizationId: ORG_ID, mrn } },
      update: {},
      create: {
        organizationId: ORG_ID, mrn,
        firstName: FIRST_NAMES[(i * 3) % FIRST_NAMES.length],
        lastName: LAST_NAMES[(i * 7) % LAST_NAMES.length],
        dateOfBirth: new Date(1970 + (i % 40), i % 12, 1 + (i % 27)),
        gender: i % 2 === 0 ? 'male' : 'female',
        phonePrimary: `98${String(76000000 + i).padStart(8, '0')}`,
        city: 'Gurugram', state: 'Haryana', isActive: true,
      },
    })
    patients.push(p)
  }
  console.log(`✅ Patients: ${patients.length}`)

  // 8. Billing service (find-or-create by name within the org) ----------------
  let opd = await db.billingService.findFirst({ where: { organizationId: ORG_ID, serviceName: 'OPD Consultation' } })
  if (!opd) {
    opd = await db.billingService.create({
      data: { organizationId: ORG_ID, serviceName: 'OPD Consultation', serviceCategory: 'consultation', unitPrice: 500, isActive: true },
    })
  }
  console.log(`✅ Billing service: ${opd.serviceName}`)

  // 9. Appointments + invoices + commissions ----------------------------------
  // Gated on the demo invoice number so a re-run adds nothing (and can't hit the
  // doctor-slot unique index). Times/dates are spaced so no doctor is double-booked.
  let apptCreated = 0
  for (let i = 0; i < 30; i++) {
    const doctor = doctors[i % doctors.length]
    const patient = patients[i % patients.length]
    const invoiceNumber = `DEMO-INV-${String(i + 1).padStart(4, '0')}`

    const already = await db.invoice.findFirst({ where: { organizationId: ORG_ID, invoiceNumber }, select: { id: true } })
    if (already) continue

    const appointmentDate = new Date()
    appointmentDate.setDate(appointmentDate.getDate() - (i % 7))
    const appointmentTime = `${String(9 + (i % 8)).padStart(2, '0')}:00`
    const fee = doctor.consultationFee || 500

    const appointment = await db.appointment.create({
      data: {
        organizationId: ORG_ID, patientId: patient.id, doctorId: doctor.id,
        appointmentDate, appointmentTime, appointmentType: 'new_patient',
        status: 'completed', consultationFee: fee, departmentId: doctor.departmentId,
      },
    })

    const invoice = await db.invoice.create({
      data: {
        organizationId: ORG_ID, patientId: patient.id, appointmentId: appointment.id, invoiceNumber,
        items: JSON.stringify([{ type: 'consultation', description: `${doctor.fullName} — Consultation`, quantity: 1, unitPrice: fee, discount: 0, tax: 0, total: fee }]),
        subtotal: fee, totalAmount: fee, status: 'sent', paymentStatus: 'unpaid',
      },
    })

    await db.doctorCommission.create({
      data: {
        organizationId: ORG_ID, doctorId: doctor.id, invoiceId: invoice.id,
        invoiceAmount: fee, commissionRate: 20, commissionType: 'percentage',
        commissionAmount: (fee * 20) / 100, status: 'pending',
      },
    })
    apptCreated++
  }
  console.log(`✅ Appointments/invoices/commissions: ${apptCreated} new`)

  // Summary -------------------------------------------------------------------
  const [uCount, pCount, aCount, iCount, cCount] = await Promise.all([
    db.user.count({ where: { organizationId: ORG_ID } }),
    db.patient.count({ where: { organizationId: ORG_ID } }),
    db.appointment.count({ where: { organizationId: ORG_ID } }),
    db.invoice.count({ where: { organizationId: ORG_ID } }),
    db.doctorCommission.count({ where: { organizationId: ORG_ID } }),
  ])
  console.log('\n' + '='.repeat(52))
  console.log('🎉 DEMO READY  (org: GudMed Hospital / org-demo)')
  console.log('='.repeat(52))
  console.log(`   Users: ${uCount}   Patients: ${pCount}`)
  console.log(`   Appointments: ${aCount}   Invoices: ${iCount}   Commissions: ${cCount}`)
  console.log('\n   Login (same password for every demo account):')
  console.log(`     Admin:      admin@gudmed.in     / ${DEMO_PASSWORD}`)
  console.log(`     Reception:  reception@gudmed.in / ${DEMO_PASSWORD}`)
  console.log(`     Doctor:     dr.card.1@gudmed.in / ${DEMO_PASSWORD}`)
  console.log('='.repeat(52) + '\n')
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1) })
  .finally(() => db.$disconnect())
