import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function check() {
  const users = await db.user.findMany({ where: { role: 'receptionist' } })
  console.log('Receptionists:', users.map(u => ({ email: u.email, name: u.firstName })))
  
  const billingClerks = await db.user.findMany({ where: { role: 'billing_clerk' } })
  console.log('Billing Clerks:', billingClerks.map(u => ({ email: u.email, name: u.firstName })))
}
check().finally(() => db.$disconnect())
