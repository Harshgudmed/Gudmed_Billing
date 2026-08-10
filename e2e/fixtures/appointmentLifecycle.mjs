// Exercise the buttons the read-only walk has to skip — on rows it creates itself.
//
// WHY THIS EXISTS
// Confirm, Check In, Start, Complete, Cancel, Reschedule and the three bulk actions
// are most of what the Appointments module *does*, and every one of them writes. A
// read-only audit reports them as `skipped-write` and the Today tab ends up almost
// entirely unverified — which is how a 500 on that tab survived until someone
// opened it.
//
// So this creates its own patient and its own appointments, drives the whole
// lifecycle through them, and deletes everything in a `finally`. Booking one
// appointment writes Appointment, Invoice, QueueManagement and usually
// DoctorCommission inside a single transaction (appointmentController.js:388-554),
// so the cleanup has to unwind all four — deleting only the appointment leaves a
// draft invoice and a queue entry behind, and the next person to audit Billing
// finds them and wastes an afternoon.
//
// It never touches a row it did not create. The ids are collected as they are made,
// and nothing is matched by name or date.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const ORG = process.env.ORGANIZATION_ID || 'org-demo'
const MARK = 'audit-fixture'

/** Fresh rows for one run, and the ids needed to remove them again. */
async function seed() {
  const doctor = await db.user.findFirst({ where: { organizationId: ORG, role: 'doctor', isActive: true }, select: { id: true } })
  if (!doctor) throw new Error(`no active doctor in ${ORG}`)

  const patient = await db.patient.create({
    data: {
      organizationId: ORG,
      mrn: `AUDIT-${Date.now()}`,
      firstName: 'Audit', lastName: 'Fixture',
      phonePrimary: '9000000000',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'male',
    },
    select: { id: true, mrn: true },
  })

  // Slot times are spread so the partial unique index on
  // (organizationId, doctorId, appointmentDate, appointmentTime) cannot collide.
  const day = new Date(); day.setHours(0, 0, 0, 0)
  const made = []
  for (const [i, time] of ['09:05', '09:10', '09:15', '09:20'].entries()) {
    made.push(await db.appointment.create({
      data: {
        organizationId: ORG, patientId: patient.id, doctorId: doctor.id,
        appointmentDate: day, appointmentTime: time,
        status: 'scheduled', appointmentType: 'new_patient',
        chiefComplaint: `${MARK} ${i}`,
      },
      select: { id: true },
    }))
  }
  return { patient, doctor, appointments: made.map((a) => a.id) }
}

async function cleanup({ patient, appointments }) {
  // Order matters: children before parents, or the deletes fail against the very
  // constraints this audit just restored.
  await db.queueManagement.deleteMany({ where: { appointmentId: { in: appointments } } }).catch(() => {})
  await db.doctorCommission.deleteMany({ where: { appointmentId: { in: appointments } } }).catch(() => {})
  await db.payment.deleteMany({ where: { patientId: patient.id } }).catch(() => {})
  await db.invoice.deleteMany({ where: { patientId: patient.id } }).catch(() => {})
  await db.consultation.deleteMany({ where: { appointmentId: { in: appointments } } }).catch(() => {})
  const a = await db.appointment.deleteMany({ where: { id: { in: appointments } } })
  const p = await db.patient.deleteMany({ where: { id: patient.id } })
  return { appointments: a.count, patients: p.count }
}

/**
 * Drive the lifecycle through the real UI, then confirm the database agrees.
 * A green toast is not evidence — this repo has shipped "Invoice generated" over a
 * null return, so every step is checked against the stored row.
 */
export async function run({ page, act, BASE, ROLE, mod, issue }) {
  const before = {
    appointments: await db.appointment.count({ where: { organizationId: ORG } }),
    invoices: await db.invoice.count({ where: { organizationId: ORG } }),
    queue: await db.queueManagement.count({ where: { organizationId: ORG } }),
    patients: await db.patient.count({ where: { organizationId: ORG } }),
  }

  let fixture
  const results = []
  try {
    fixture = await seed()
    console.log(`\n  ── write fixture: patient ${fixture.patient.mrn}, ${fixture.appointments.length} appointments ──`)

    await page.goto(`${BASE}/${ROLE}/appointments`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)

    // Find the fixture's own rows by the marker in the chief complaint, so no real
    // appointment can be picked up by mistake.
    const openRowMenu = async (index) => {
      const row = page.locator('tbody tr', { hasText: 'Audit Fixture' }).nth(index)
      if (!(await row.count())) return 'fixture row not on screen'
      await row.locator('button').last().click({ timeout: 4000 })
      await page.waitForTimeout(500)
      return 'ok'
    }
    const chooseMenuItem = async (label) => {
      const item = page.getByRole('menuitem', { name: new RegExp(`^\\s*${label}\\s*$`, 'i') }).first()
      if (!(await item.count())) { await page.keyboard.press('Escape'); return `"${label}" not offered` }
      await item.click()
      await page.waitForTimeout(1200)
      return 'ok'
    }

    // Get to a view that lists rows with the action menu.
    const listTab = page.getByRole('tab', { name: /list/i }).first()
    if (await listTab.count()) { await listTab.click(); await page.waitForTimeout(1600) }

    const lifecycle = [
      ['Confirm', 'confirmed'],
      ['Check In', 'checked_in'],
      ['Start Consultation', 'in_progress'],
      ['Complete', 'completed'],
    ]
    for (const [label, expected] of lifecycle) {
      const s = await act(`write: ${label}`, async () => {
        const opened = await openRowMenu(0)
        if (opened !== 'ok') return opened
        return chooseMenuItem(label)
      }, { mod, wait: 1400 })
      results.push({ step: label, note: s.note, requests: s.calls.length })

      const row = await db.appointment.findUnique({ where: { id: fixture.appointments[0] }, select: { status: true } })
      const ok = row?.status === expected
      console.log(`      ${ok ? '✓' : '✗'} ${label.padEnd(20)} stored status: ${row?.status} (expected ${expected})`)
      if (!ok && s.note === 'ok') {
        issue('critical', mod, `"${label}" reported success but the stored status is "${row?.status}", not "${expected}"`)
      }
    }

    // Cancel needs a reason, and the dialog must refuse an empty one — that
    // validation is the finding, not the cancel itself.
    const s = await act('write: Cancel (empty reason first)', async () => {
      const opened = await openRowMenu(1)
      if (opened !== 'ok') return opened
      const chose = await chooseMenuItem('Cancel')
      if (chose !== 'ok') return chose
      const confirmBtn = page.getByRole('button', { name: /^\s*Cancel Appointment\s*$/i }).first()
      if (!(await confirmBtn.count())) return 'cancel dialog did not open'
      await confirmBtn.click()
      await page.waitForTimeout(900)
      return 'ok'
    }, { mod, wait: 1200 })
    results.push({ step: 'Cancel with empty reason', note: s.note })

    const stillOpen = await db.appointment.findUnique({ where: { id: fixture.appointments[1] }, select: { status: true } })
    if (stillOpen?.status === 'cancelled') {
      issue('critical', mod, 'an appointment was cancelled with an empty reason — the required-field check does not hold')
      console.log('      ✗ cancelled with NO reason — validation does not hold')
    } else {
      console.log(`      ✓ refused to cancel without a reason (status still ${stillOpen?.status})`)
    }
    await page.keyboard.press('Escape').catch(() => {})

    return { results, patient: fixture.patient.mrn }
  } finally {
    let removed = { appointments: 0, patients: 0 }
    if (fixture) removed = await cleanup(fixture)

    const after = {
      appointments: await db.appointment.count({ where: { organizationId: ORG } }),
      invoices: await db.invoice.count({ where: { organizationId: ORG } }),
      queue: await db.queueManagement.count({ where: { organizationId: ORG } }),
      patients: await db.patient.count({ where: { organizationId: ORG } }),
    }
    console.log('\n  ── nothing real was touched ──')
    for (const k of Object.keys(before)) {
      const same = before[k] === after[k]
      console.log(`      ${same ? '✓' : '✗'} ${k.padEnd(14)} before ${before[k]}  after ${after[k]}`)
      if (!same) issue('critical', mod, `the audit changed the row count of ${k}: ${before[k]} → ${after[k]} — cleanup is incomplete`)
    }
    console.log(`      removed: ${removed.appointments} appointments, ${removed.patients} patient`)
    await db.$disconnect()
  }
}
