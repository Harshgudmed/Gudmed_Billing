import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log("Fetching appointments to add to queue...")
  
  // Find appointments that do not have a queue entry yet
  const appointments = await prisma.appointment.findMany({
    where: {
      queueEntry: null
    },
    include: {
      patient: true
    }
  })

  console.log(`Found ${appointments.length} appointments not in queue.`)

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
  
  console.log(`Successfully added ${count} appointments to the Queue Management system!`)
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
  })
