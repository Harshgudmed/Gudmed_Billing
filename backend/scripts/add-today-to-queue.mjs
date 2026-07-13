import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  console.log("Fetching today's appointments to add to queue...")
  
  // Find appointments that are specifically for today
  const appointments = await prisma.appointment.findMany({
    where: {
      queueEntry: null,
      appointmentDate: {
        gte: todayStart,
        lte: todayEnd
      }
    },
    include: {
      patient: true
    }
  })

  console.log(`Found ${appointments.length} appointments for today not in queue.`)

  let count = 0
  for (const appt of appointments) {
    if (!appt.patientId) continue;
    
    // Generate a queue number based on date and count
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const qn = `OPD-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`

    await prisma.queueManagement.create({
      data: {
        organizationId: appt.organizationId,
        patientId: appt.patientId,
        appointmentId: appt.id,
        serviceArea: 'opd',
        queueNumber: qn,
        priority: appt.priority || 'normal',
        priorityRank: appt.priority === 'urgent' ? 100 : 40,
        status: 'waiting',
        joinedQueueAt: new Date()
      }
    })
    count++
  }
  
  console.log(`Successfully added ${count} today's appointments to the Queue!`)
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
  })
