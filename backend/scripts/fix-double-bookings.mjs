// Finds slots that hold more than one LIVE appointment — the thing that stops
// the 20260716100500_appointment_slot_unique migration.
//
//   # look (safe, writes nothing):
//   DATABASE_URL="<render url>" node backend/scripts/fix-double-bookings.mjs
//
//   # act (cancels all but the FIRST-BOOKED appointment in each clashing slot):
//   DATABASE_URL="<render url>" node backend/scripts/fix-double-bookings.mjs --cancel-duplicates
//
// These are real bookings, so nothing is cancelled unless you pass the flag.
// The keeper is whichever was created first; the rest are set to 'cancelled'
// with a reason, which is exactly what the freed-slot rule already expects
// (the partial unique index ignores cancelled rows).
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const APPLY = process.argv.includes('--cancel-duplicates')

const clashes = await db.$queryRawUnsafe(`
  SELECT "organizationId", "doctorId", "appointmentDate", "appointmentTime",
         COUNT(*)::int AS n, ARRAY_AGG(id ORDER BY "createdAt" ASC) AS ids
  FROM "Appointment"
  WHERE "doctorId" IS NOT NULL
    AND status NOT IN ('cancelled','no_show','rescheduled')
  GROUP BY 1,2,3,4
  HAVING COUNT(*) > 1
  ORDER BY 5 DESC`)

if (clashes.length === 0) {
  console.log('✅ No double-booked slots. The migration will apply cleanly — re-deploy.')
  await db.$disconnect()
  process.exit(0)
}

console.log(`\nFound ${clashes.length} clashing slot(s):\n`)
for (const c of clashes) {
  const doctor = await db.user.findUnique({ where: { id: c.doctorId }, select: { fullName: true } })
  const appts = await db.appointment.findMany({
    where: { id: { in: c.ids } },
    select: {
      id: true, status: true, createdAt: true, appointmentType: true,
      patient: { select: { firstName: true, lastName: true, mrn: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const day = new Date(c.appointmentDate).toISOString().slice(0, 10)
  console.log(`  ${doctor?.fullName || c.doctorId}  —  ${day} ${c.appointmentTime}  (${c.n} live appointments)`)
  appts.forEach((a, i) => {
    const who = `${a.patient?.firstName || ''} ${a.patient?.lastName || ''}`.trim() || '(no patient)'
    console.log(`     ${i === 0 ? 'KEEP  ' : 'CANCEL'}  ${who}  ${a.patient?.mrn || ''}  [${a.status}, ${a.appointmentType || '—'}, booked ${a.createdAt.toISOString().slice(0, 16).replace('T', ' ')}]`)
  })
  console.log('')
}

if (!APPLY) {
  console.log('Nothing changed — this was a dry run.')
  console.log('Review the list above. If cancelling the later booking in each slot is right,')
  console.log('re-run with --cancel-duplicates. Otherwise fix them by hand in the app.\n')
  await db.$disconnect()
  process.exit(0)
}

let cancelled = 0
for (const c of clashes) {
  const [, ...duplicates] = c.ids // keep the first-booked
  const res = await db.appointment.updateMany({
    where: { id: { in: duplicates } },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancellationReason: 'Duplicate booking for the same doctor and slot (resolved before enabling the double-booking guard)',
    },
  })
  cancelled += res.count
}
console.log(`✅ Cancelled ${cancelled} duplicate appointment(s). The keeper in each slot is untouched.`)
console.log('\nNext: clear the failed migration, then re-deploy:')
console.log('  npx prisma migrate resolve --rolled-back 20260716100500_appointment_slot_unique\n')
await db.$disconnect()
