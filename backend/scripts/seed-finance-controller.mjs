// Seeds the demo Finance Controller account used to approve/reject refunds.
// Idempotent: upserts by email, safe to re-run, never touches other users.
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()
const ORG = process.env.ORGANIZATION_ID || 'org-demo'

async function main() {
  const passwordHash = await bcrypt.hash('Gudmed@123', 10)
  const user = await db.user.upsert({
    where: { email: 'finance@gudmed.in' },
    update: { role: 'finance_controller', isActive: true },
    create: {
      email: 'finance@gudmed.in',
      fullName: 'Finance Controller',
      role: 'finance_controller',
      organizationId: ORG,
      passwordHash,
      isActive: true,
    },
  })
  console.log(`✓ finance_controller  ${user.email}  (${user.id})`)
  console.log('Login password (demo): Gudmed@123')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
