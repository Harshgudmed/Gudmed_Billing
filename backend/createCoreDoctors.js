import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const hash = await bcrypt.hash('Gudmed@123', 10)
  
  const doctors = [
    { id: 'user-doctor1', name: 'Dr. Priya Mehta', email: 'priya@gudmed.in', spec: 'General Medicine' },
    { id: 'user-doctor2', name: 'Dr. Suresh Patel', email: 'suresh@gudmed.in', spec: 'Cardiology' },
    { id: 'user-doctor3', name: 'Dr. Anita Joshi', email: 'anita@gudmed.in', spec: 'Pediatrics' },
  ]

  for (const doc of doctors) {
    await prisma.user.upsert({
      where: { email: doc.email },
      update: { passwordHash: hash },
      create: {
        id: doc.id,
        organizationId: 'org-demo',
        fullName: doc.name,
        email: doc.email,
        passwordHash: hash,
        role: 'doctor',
        specialization: doc.spec,
        isActive: true
      }
    })
    console.log('Restored/Updated:', doc.email)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
