import { db } from '../src/config/db.js'
import bcrypt from 'bcryptjs'
import { PLATFORM_SLUG } from '../src/controllers/platformController.js'

// ============================================================================
// Creates the platform owner — the GudMed team's own login, for /api/platform
// (the hospitals and the modules each has bought). Run by hand, once, by the
// person who owns the platform:
//
//   PLATFORM_OWNER_EMAIL=you@gudmed.in PLATFORM_OWNER_PASSWORD='a long password' \
//     node prisma/create-platform-owner.js
//
// Deliberately NOT part of prisma/seed.js: that runs on every deploy, and a
// platform owner must never come from a password written in the code or reset
// by a deploy. Nothing here is a default.
//
// It makes (when missing) the "GudMed Platform" hospital the login belongs to —
// every user needs one; it holds no patients and no modules — and then the
// owner. It never changes a user that already exists: to change the password
// or retire the login, do it on purpose, not by running this again.
// ============================================================================

const email = String(process.env.PLATFORM_OWNER_EMAIL || '').trim().toLowerCase()
const password = String(process.env.PLATFORM_OWNER_PASSWORD || '')
const fullName = String(process.env.PLATFORM_OWNER_NAME || 'Platform Owner').trim()

function stop(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) stop('Set PLATFORM_OWNER_EMAIL to the owner\'s e-mail.')
// Longer than a hospital user's: this login can reach every hospital's plan.
if (password.length < 12) stop('Set PLATFORM_OWNER_PASSWORD to at least 12 characters.')
if (password.length > 72) stop('PLATFORM_OWNER_PASSWORD is too long (72 characters at most).')
if (fullName.length < 2) stop('PLATFORM_OWNER_NAME is too short.')

try {
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    stop(`${email} already has an account — nothing was changed.`)
  }
  const passwordHash = await bcrypt.hash(password, 10)
  const owner = await db.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { slug: PLATFORM_SLUG },
      update: {},
      create: {
        name: 'GudMed Platform', slug: PLATFORM_SLUG, country: 'India',
        // Nothing bought, nothing on: the platform hospital works with no module.
        modulesAllowed: '{}', modulesEnabled: '{}',
        subscriptionTier: 'pro', subscriptionStatus: 'active',
      },
      select: { id: true },
    })
    return tx.user.create({
      data: { organizationId: organization.id, email, fullName, role: 'platform_owner', passwordHash, isActive: true },
      select: { id: true, email: true },
    })
  })
  console.log(`✔ Platform owner created: ${owner.email}`)
  await db.$disconnect()
} catch (e) {
  console.error('✖ Could not create the platform owner:', e.message)
  process.exit(1)
}
