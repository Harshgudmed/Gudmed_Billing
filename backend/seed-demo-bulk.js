#!/usr/bin/env node
/**
 * Bulk demo-data generator (runs against the LOCAL database).
 * Creates: doctors, realistic 9am-8pm appointments with breaks (mapped to
 * doctors + patients), paid & unpaid invoices, and bulk pharmacy inventory.
 *
 * Idempotent: uses deterministic IDs so re-running updates instead of duping.
 * After running, push to prod with:  node upload-to-prod.js
 */
import { db } from './src/config/db.js'

// Static bcrypt hash (valid format) — demo doctors don't log in, so we avoid
// the bcrypt dependency. Corresponds to a generic password.
const DOCTOR_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

const ORG = 'org-demo'
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)]
const chance = (p) => Math.random() < p
const pad = (n, l = 2) => String(n).padStart(l, '0')

// ── 1. DOCTORS ───────────────────────────────────────────────────────────────
const DOCTORS = [
  ['Dr. Priya Mehta', 'Cardiology'],
  ['Dr. Rahul Verma', 'Neurology'],
  ['Dr. Anjali Sharma', 'Pediatrics'],
  ['Dr. Suresh Patel', 'Orthopedics'],
  ['Dr. Kavita Nair', 'Gynecology & Obstetrics'],
  ['Dr. Amit Singh', 'General Medicine'],
  ['Dr. Neha Gupta', 'Dermatology'],
  ['Dr. Vikram Reddy', 'ENT'],
  ['Dr. Sunita Rao', 'Ophthalmology'],
  ['Dr. Arjun Kapoor', 'General Surgery'],
  ['Dr. Meera Iyer', 'Psychiatry'],
  ['Dr. Rajesh Kumar', 'Urology'],
  ['Dr. Pooja Desai', 'Nephrology'],
  ['Dr. Sanjay Joshi', 'Pulmonology'],
  ['Dr. Divya Menon', 'Gastroenterology'],
  ['Dr. Manoj Tiwari', 'Endocrinology'],
  ['Dr. Shalini Bose', 'Oncology'],
  ['Dr. Karan Malhotra', 'Dental'],
]

async function seedDoctors() {
  const hash = DOCTOR_HASH
  const ids = []
  for (let i = 0; i < DOCTORS.length; i++) {
    const [name, spec] = DOCTORS[i]
    const id = `doc-demo-${pad(i + 1)}`
    const email = `demo.doc${pad(i + 1)}@gudmed.in`  // guaranteed unique
    await db.user.upsert({
      where: { id },
      update: { fullName: name, specialization: spec, role: 'doctor', isActive: true },
      create: {
        id, organizationId: ORG, email, fullName: name, passwordHash: hash,
        role: 'doctor', specialization: spec, isActive: true, updatedAt: new Date(),
      },
    }).catch(e => console.log(`  doctor ${id}: ${e.message.slice(0, 60)}`))
    ids.push(id)
  }
  console.log(`✅ Doctors: ${ids.length}`)
  return ids
}

// ── 2. APPOINTMENTS (9am-8pm, breaks, mapped to doctors) ─────────────────────
// Working windows (skip 13:00-14:00 lunch and 16:30-17:00 tea):
//   09:00-13:00, 14:00-16:30, 17:00-20:00  in 20-min slots
function daySlots() {
  const slots = []
  const windows = [[9 * 60, 13 * 60], [14 * 60, 16 * 60 + 30], [17 * 60, 20 * 60]]
  for (const [start, end] of windows) {
    for (let m = start; m < end; m += 20) slots.push(m)
  }
  return slots
}
const toHHMM = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`

const COMPLAINTS = [
  'Fever and body ache', 'Routine follow-up', 'Chest pain', 'Headache & dizziness',
  'Abdominal pain', 'Cough and cold', 'Back pain', 'Skin rash', 'High blood pressure review',
  'Diabetes management', 'Joint pain', 'Breathing difficulty', 'General check-up',
  'Ear pain', 'Eye irritation', 'Pregnancy check-up', 'Post-surgery review',
]
const APPT_TYPES = ['new_patient', 'follow_up']

async function seedAppointments(doctorIds, patients) {
  // Generate for today + next 4 days; tomorrow is the fullest.
  // Use the LOCAL calendar day but store at NOON UTC so the date never
  // shifts across timezones (server filters by UTC day).
  const now = new Date()
  const baseY = now.getFullYear(), baseM = now.getMonth(), baseD = now.getDate()
  let created = 0
  const slots = daySlots()

  for (let dayOffset = 0; dayOffset <= 4; dayOffset++) {
    const date = new Date(Date.UTC(baseY, baseM, baseD + dayOffset, 12, 0, 0))
    // tomorrow (offset 1) busiest; weekends lighter
    const dow = date.getUTCDay()
    const isWeekend = dow === 0 || dow === 6
    const fillRate = dayOffset === 1 ? 0.7 : isWeekend ? 0.25 : 0.5

    for (let di = 0; di < doctorIds.length; di++) {
      const doctorId = doctorIds[di]
      for (let si = 0; si < slots.length; si++) {
        if (!chance(fillRate)) continue
        const patient = rand(patients)
        const time = toHHMM(slots[si])
        const id = `appt-demo-${dayOffset}-${pad(di)}-${pad(si)}`
        // status: past slots could be completed; future scheduled/confirmed
        let status = 'scheduled'
        if (dayOffset === 0) status = rand(['completed', 'completed', 'checked_in', 'in_progress', 'confirmed'])
        else status = rand(['scheduled', 'confirmed', 'confirmed'])

        try {
          await db.appointment.upsert({
            where: { id },
            update: { appointmentDate: date, appointmentTime: time, doctorId, patientId: patient.id, status },
            create: {
              id, organizationId: ORG, patientId: patient.id, doctorId,
              appointmentDate: date, appointmentTime: time, appointmentType: rand(APPT_TYPES), status,
              chiefComplaint: rand(COMPLAINTS), updatedAt: new Date(),
            },
          })
          created++
        } catch (e) {
          if (created < 3) console.log(`  appt ${id}: ${e.message.slice(0, 70)}`)
        }
      }
    }
  }
  console.log(`✅ Appointments: ${created} (today + next 4 days, 9am-8pm with breaks)`)
}

// ── 3. INVOICES (paid + unpaid zones) ────────────────────────────────────────
const SERVICES = [
  ['Consultation Fee', 500], ['Complete Blood Count', 350], ['X-Ray Chest', 600],
  ['ECG', 400], ['Ultrasound Abdomen', 1200], ['MRI Brain', 6500], ['CT Scan', 4500],
  ['Blood Sugar Test', 150], ['Lipid Profile', 800], ['Dressing & Minor Procedure', 300],
  ['Physiotherapy Session', 700], ['Medicines (Pharmacy)', 950],
]

async function seedInvoices(patients) {
  let paid = 0, unpaid = 0
  const today = new Date()
  for (let i = 0; i < 36; i++) {
    const patient = rand(patients)
    const nItems = 1 + Math.floor(Math.random() * 3)
    const items = []
    let subtotal = 0
    for (let k = 0; k < nItems; k++) {
      const [name, price] = rand(SERVICES)
      const qty = 1
      items.push({ type: 'service', description: name, quantity: qty, unitPrice: price, discount: 0, tax: 0, total: price * qty })
      subtotal += price * qty
    }
    const isPaid = chance(0.5)
    const date = new Date(today); date.setDate(today.getDate() - Math.floor(Math.random() * 14))
    const id = `inv-demo-${pad(i + 1, 4)}`
    try {
      await db.invoice.upsert({
        where: { id },
        update: {},
        create: {
          id, organizationId: ORG, patientId: patient.id,
          invoiceNumber: `INV-DEMO-${pad(i + 1, 4)}`, invoiceDate: date,
          items: JSON.stringify(items), subtotal, totalAmount: subtotal,
          paymentStatus: isPaid ? 'paid' : 'unpaid',
          amountPaid: isPaid ? subtotal : 0,
          balanceDue: isPaid ? 0 : subtotal,
          status: isPaid ? 'paid' : (chance(0.4) ? 'overdue' : 'sent'),
          updatedAt: new Date(),
        },
      })
      isPaid ? paid++ : unpaid++
    } catch (e) {
      if (paid + unpaid < 3) console.log(`  invoice ${id}: ${e.message.slice(0, 70)}`)
    }
  }
  console.log(`✅ Invoices: ${paid} paid, ${unpaid} unpaid/pending`)
}

// ── 4. INVENTORY (bulk pharmacy drugs) ───────────────────────────────────────
const DRUGS = [
  ['Paracetamol 500mg', 'Paracetamol', 'Analgesic', 'Tablet', '500mg', 2, 5],
  ['Azithromycin 250mg', 'Azithromycin', 'Antibiotic', 'Tablet', '250mg', 8, 15],
  ['Amoxicillin 500mg', 'Amoxicillin', 'Antibiotic', 'Capsule', '500mg', 5, 10],
  ['Cetirizine 10mg', 'Cetirizine', 'Antihistamine', 'Tablet', '10mg', 1, 3],
  ['Omeprazole 20mg', 'Omeprazole', 'Antacid', 'Capsule', '20mg', 3, 6],
  ['Metformin 500mg', 'Metformin', 'Antidiabetic', 'Tablet', '500mg', 2, 4],
  ['Amlodipine 5mg', 'Amlodipine', 'Antihypertensive', 'Tablet', '5mg', 2, 5],
  ['Atorvastatin 10mg', 'Atorvastatin', 'Statin', 'Tablet', '10mg', 4, 8],
  ['Ibuprofen 400mg', 'Ibuprofen', 'NSAID', 'Tablet', '400mg', 2, 5],
  ['Pantoprazole 40mg', 'Pantoprazole', 'Antacid', 'Tablet', '40mg', 3, 7],
  ['Cough Syrup 100ml', 'Dextromethorphan', 'Cough', 'Syrup', '100ml', 35, 65],
  ['ORS Sachet', 'Oral Rehydration Salts', 'Electrolyte', 'Powder', '21g', 8, 15],
  ['Vitamin D3 60K', 'Cholecalciferol', 'Supplement', 'Capsule', '60000 IU', 12, 25],
  ['Vitamin B-Complex', 'B-Complex', 'Supplement', 'Tablet', '-', 3, 6],
  ['Calcium + D3', 'Calcium Carbonate', 'Supplement', 'Tablet', '500mg', 4, 8],
  ['Insulin Glargine', 'Insulin Glargine', 'Antidiabetic', 'Injection', '100IU/ml', 280, 420],
  ['Salbutamol Inhaler', 'Salbutamol', 'Bronchodilator', 'Inhaler', '100mcg', 120, 180],
  ['Dolo 650', 'Paracetamol', 'Analgesic', 'Tablet', '650mg', 2, 4],
  ['Augmentin 625', 'Amoxicillin+Clavulanate', 'Antibiotic', 'Tablet', '625mg', 12, 22],
  ['Pan-D', 'Pantoprazole+Domperidone', 'Antacid', 'Capsule', '40mg', 5, 10],
  ['Telmisartan 40mg', 'Telmisartan', 'Antihypertensive', 'Tablet', '40mg', 3, 7],
  ['Losartan 50mg', 'Losartan', 'Antihypertensive', 'Tablet', '50mg', 3, 6],
  ['Levothyroxine 50mcg', 'Levothyroxine', 'Thyroid', 'Tablet', '50mcg', 2, 5],
  ['Clopidogrel 75mg', 'Clopidogrel', 'Antiplatelet', 'Tablet', '75mg', 5, 10],
  ['Aspirin 75mg', 'Aspirin', 'Antiplatelet', 'Tablet', '75mg', 1, 3],
  ['Montelukast 10mg', 'Montelukast', 'Anti-asthmatic', 'Tablet', '10mg', 6, 12],
  ['Domperidone 10mg', 'Domperidone', 'Antiemetic', 'Tablet', '10mg', 2, 4],
  ['Ondansetron 4mg', 'Ondansetron', 'Antiemetic', 'Tablet', '4mg', 4, 8],
  ['Diclofenac Gel', 'Diclofenac', 'NSAID', 'Gel', '30g', 45, 80],
  ['Betadine 100ml', 'Povidone Iodine', 'Antiseptic', 'Solution', '100ml', 40, 70],
  ['Cotton Roll 500g', 'Absorbent Cotton', 'Surgical', 'Roll', '500g', 60, 110],
  ['Surgical Gloves (Pair)', 'Latex Gloves', 'Surgical', 'Pair', '-', 8, 15],
  ['Syringe 5ml', 'Disposable Syringe', 'Surgical', 'Piece', '5ml', 3, 6],
  ['IV Set', 'Infusion Set', 'Surgical', 'Piece', '-', 18, 35],
  ['Ranitidine 150mg', 'Ranitidine', 'Antacid', 'Tablet', '150mg', 1, 3],
  ['Cefixime 200mg', 'Cefixime', 'Antibiotic', 'Tablet', '200mg', 9, 18],
  ['Doxycycline 100mg', 'Doxycycline', 'Antibiotic', 'Capsule', '100mg', 4, 9],
  ['Prednisolone 10mg', 'Prednisolone', 'Steroid', 'Tablet', '10mg', 3, 6],
  ['Hydrocortisone Cream', 'Hydrocortisone', 'Steroid', 'Cream', '15g', 50, 90],
  ['Multivitamin Syrup', 'Multivitamin', 'Supplement', 'Syrup', '200ml', 75, 130],
]

async function seedInventory() {
  let count = 0
  for (let i = 0; i < DRUGS.length; i++) {
    const [drugName, genericName, category, form, strength, cost, sell] = DRUGS[i]
    const id = `drug-demo-${pad(i + 1, 3)}`
    // realistic stock: some low/near reorder for demo realism
    const reorder = 20
    const stock = chance(0.2) ? Math.floor(Math.random() * 15) : 40 + Math.floor(Math.random() * 460)
    const expiry = new Date(); expiry.setMonth(expiry.getMonth() + 3 + Math.floor(Math.random() * 24))
    try {
      await db.pharmacyDrug.upsert({
        where: { id },
        update: { quantityInStock: stock, costPrice: cost, sellingPrice: sell },
        create: {
          id, organizationId: ORG, drugName, genericName, drugCategory: category,
          dosageForm: form, strength, quantityInStock: stock, unitOfMeasure: form,
          reorderLevel: reorder, costPrice: cost, sellingPrice: sell,
          requiresPrescription: ['Antibiotic', 'Steroid', 'Antidiabetic'].includes(category),
          isActive: true, updatedAt: new Date(),
        },
      })
      count++
    } catch (e) {
      if (count < 3) console.log(`  drug ${id}: ${e.message.slice(0, 70)}`)
    }
  }
  console.log(`✅ Inventory: ${count} drugs`)
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('BULK DEMO DATA — local database')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const doctorIds = await seedDoctors()
  const patients = await db.patient.findMany({ where: { organizationId: ORG }, select: { id: true } })
  console.log(`   (${patients.length} patients available for mapping)\n`)

  await seedAppointments(doctorIds, patients)
  await seedInvoices(patients)
  await seedInventory()

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ DONE. Next: node upload-to-prod.js  to push to production')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

main()
  .catch(e => { console.error('FATAL:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
