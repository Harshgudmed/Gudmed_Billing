// The platform owner's work: the hospitals on GudMed and which modules each has
// bought. Mounted behind requirePlatformOwner (middleware/auth.js), never
// authorize() — that lets every hospital's administrator through.
//
// GET   /platform/hospitals        list (search, page, limit)
// POST  /platform/hospitals        a new hospital with its first administrator
// PATCH /platform/hospitals/:id    modules bought, plan, name, contact, on/off
//
// Only the hospital's own record and its login are handled here. No patient,
// staff list or bill of a hospital is ever read or returned.
//
// A hospital's modules are two switches (lib/modules.js): `modulesAllowed`, what
// it bought — written only here — and `modulesEnabled`, what its administrator
// keeps on. Nothing on the server refuses a module that is not bought yet; to
// keep the hospital's screens honest meanwhile, what is bought is mirrored into
// modulesEnabled (bought → on, not bought → off), which the sidebar already obeys.
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '../config/db.js'
import { getPagination, paginationMeta } from '../lib/pagination.js'
import { getOrgId } from '../lib/reqContext.js'
import { auditIpd } from '../inpatient/audit.js'
import { MODULE_TOGGLE, isToggleBought, parseModuleMap } from '../lib/modules.js'

// The hospital the platform owner's own login belongs to (every user needs one).
// It holds no patients or modules and is never listed or edited here.
export const PLATFORM_SLUG = 'gudmed-platform'

// A hospital's code becomes part of its link (/h/<code>), so it must not collide
// with a route and must stay readable.
const RESERVED_SLUGS = new Set(['platform', PLATFORM_SLUG, 'admin', 'login', 'api', 'h', 'www', 'app', 'static', 'assets', 'patient', 'patients'])

// Every module the platform can sell. Store Indent has no toggle of its own: it
// is on and off with Purchase.
const BUYABLE = [...new Set(Object.values(MODULE_TOGGLE).filter(Boolean))]

const optionalText = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null)

const modulesSchema = z.record(z.boolean(), { invalid_type_error: 'Modules must be a list of on / off choices' })
  .superRefine((map, ctx) => {
    const unknown = Object.keys(map).filter((k) => !BUYABLE.includes(k))
    if (unknown.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown module: ${unknown.join(', ')}` })
  })
  .transform((map) => Object.fromEntries(Object.entries(map).filter(([, on]) => on).map(([k]) => [k, true])))

const hospitalFields = {
  name: z.string().trim().min(2, 'Enter the hospital name').max(120),
  city: optionalText(80),
  region: optionalText(80),
  email: z.string().trim().toLowerCase().email('Enter a valid hospital e-mail').max(254).optional().nullable().or(z.literal('')).transform((v) => v || null),
  phone: optionalText(30),
  subscriptionTier: z.enum(['basic', 'standard', 'pro'], { errorMap: () => ({ message: 'Choose the plan: basic, standard or pro' }) }),
  subscriptionStatus: z.enum(['trial', 'active', 'suspended', 'expired'], { errorMap: () => ({ message: 'Choose the plan status' }) }),
  // Calendar day the plan ends; null = no end date.
  subscriptionEndsAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the plan end date as a day').nullable().optional()
    .transform((v) => (v ? new Date(`${v}T23:59:59+05:30`) : v)),
  modulesAllowed: modulesSchema,
}

const createSchema = z.object({
  ...hospitalFields,
  subscriptionTier: hospitalFields.subscriptionTier.default('basic'),
  subscriptionStatus: hospitalFields.subscriptionStatus.default('active'),
  slug: z.string().trim().toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'The hospital code is 3 to 40 letters, digits or dashes, and cannot start or end with a dash')
    .refine((s) => !RESERVED_SLUGS.has(s), 'That hospital code is reserved — choose another'),
  admin: z.object({
    fullName: z.string().trim().min(2, 'Enter the administrator\'s name').max(100),
    email: z.string().trim().toLowerCase().email('Enter a valid administrator e-mail').max(254),
    password: z.string().min(8, 'The administrator\'s password needs at least 8 characters').max(72, 'The password is too long'),
  }),
})

// Every field optional on an update; the code (slug) is never changed — it is in
// the hospital's links.
const updateSchema = z.object({ ...hospitalFields, isActive: z.boolean() }).partial().strict()

const problem = (parsed) => parsed.error.issues[0]?.message || 'Invalid hospital details'

/**
 * Mirrors what is bought into what is on: a module that is no longer bought is
 * switched off; one newly bought is switched on. A module the hospital keeps
 * keeps its administrator's choice. `allowedBefore` null = it had no limit.
 */
function enabledAfter(allowedNow, allowedBefore, enabledBefore) {
  const next = { ...enabledBefore }
  for (const toggle of BUYABLE) {
    const boughtNow = allowedNow[toggle] === true
    if (!boughtNow) next[toggle] = false
    else if (!isToggleBought(toggle, allowedBefore)) next[toggle] = true
  }
  return next
}

const listSelect = {
  id: true, name: true, slug: true, city: true, region: true, email: true, phone: true, isActive: true,
  subscriptionTier: true, subscriptionStatus: true, subscriptionStartedAt: true, subscriptionEndsAt: true,
  modulesAllowed: true, modulesEnabled: true, createdAt: true,
  _count: { select: { users: true } },
}

const toRow = ({ _count, modulesAllowed, modulesEnabled, ...org }) => ({
  ...org,
  // null = no limit yet (a hospital from before plans): every module is open to it.
  modulesAllowed: modulesAllowed == null ? null : parseModuleMap(modulesAllowed),
  modulesEnabled: parseModuleMap(modulesEnabled),
  staffCount: _count?.users ?? 0,
})

export async function listHospitals(req, res, next) {
  try {
    const { page, limit, skip } = getPagination(req.query)
    const term = String(req.query.search || '').trim().slice(0, 80)
    const where = {
      slug: { not: PLATFORM_SLUG },
      ...(term ? { OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { slug: { contains: term, mode: 'insensitive' } },
        { city: { contains: term, mode: 'insensitive' } },
      ] } : {}),
    }
    // The tiles count every hospital, not the search or the page — filtered
    // hospitals would make the tiles change as the owner types.
    const everyHospital = { slug: { not: PLATFORM_SLUG } }
    const [rows, total, active] = await Promise.all([
      db.organization.findMany({ where, select: listSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take: limit }),
      db.organization.count({ where }),
      db.organization.groupBy({ by: ['isActive'], where: everyHospital, _count: { _all: true } }),
    ])
    const countOf = (isActive) => active.find((g) => g.isActive === isActive)?._count._all ?? 0
    res.json({
      success: true, data: rows.map(toRow), pagination: paginationMeta(page, limit, total),
      summary: { total: countOf(true) + countOf(false), active: countOf(true), inactive: countOf(false) },
      meta: { buyableModules: BUYABLE },
    })
  } catch (e) { next(e) }
}

export async function createHospital(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: problem(parsed) })
    const { admin, modulesAllowed, slug, ...fields } = parsed.data

    // Named up front so the owner is told which one is taken; the unique indexes
    // still decide a race between two owners, and that is caught below.
    if (await db.organization.findUnique({ where: { slug }, select: { id: true } })) {
      return res.status(409).json({ success: false, error: 'That hospital code is already taken — choose another' })
    }
    if (await db.user.findUnique({ where: { email: admin.email }, select: { id: true } })) {
      return res.status(409).json({ success: false, error: 'That administrator e-mail already has an account — use another e-mail' })
    }

    const passwordHash = await bcrypt.hash(admin.password, 10)
    const created = await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          ...fields,
          slug,
          country: 'India',
          modulesAllowed: JSON.stringify(modulesAllowed),
          modulesEnabled: JSON.stringify(enabledAfter(modulesAllowed, {}, {})),
          subscriptionStartedAt: new Date(),
          createdById: req.user?.id || null,
        },
        select: listSelect,
      })
      await tx.user.create({
        data: { organizationId: org.id, email: admin.email, fullName: admin.fullName, role: 'admin', passwordHash, isActive: true },
      })
      // The password is never written to the audit trail.
      await auditIpd(req, getOrgId(req), {
        action: 'create', entityType: 'platform.hospital', entityId: org.id,
        after: { name: org.name, slug, modulesAllowed, adminEmail: admin.email },
      }, tx)
      return org
    })
    res.status(201).json({ success: true, data: toRow({ ...created, _count: { users: 1 } }) })
  } catch (e) {
    if (e?.code === 'P2002') return res.status(409).json({ success: false, error: 'That hospital code or administrator e-mail was just taken — check them and try again' })
    next(e)
  }
}

export async function updateHospital(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ success: false, error: problem(parsed) })
    const changes = parsed.data
    if (!Object.keys(changes).length) return res.status(400).json({ success: false, error: 'Nothing to change' })

    const updated = await db.$transaction(async (tx) => {
      const before = await tx.organization.findFirst({ where: { id: String(req.params.id), slug: { not: PLATFORM_SLUG } }, select: listSelect })
      if (!before) return null
      const data = { ...changes }
      if (changes.modulesAllowed) {
        data.modulesEnabled = JSON.stringify(enabledAfter(changes.modulesAllowed, before.modulesAllowed, parseModuleMap(before.modulesEnabled)))
        data.modulesAllowed = JSON.stringify(changes.modulesAllowed)
      }
      const org = await tx.organization.update({ where: { id: before.id }, data, select: listSelect })
      await auditIpd(req, getOrgId(req), {
        action: 'update', entityType: 'platform.hospital', entityId: before.id,
        before: Object.fromEntries(Object.keys(changes).map((k) => [k, before[k]])),
        after: Object.fromEntries(Object.keys(changes).map((k) => [k, changes[k]])),
      }, tx)
      return org
    })
    if (!updated) return res.status(404).json({ success: false, error: 'Hospital not found' })
    res.json({ success: true, data: toRow(updated) })
  } catch (e) { next(e) }
}

// Removing a hospital is for an EMPTY one only — a code typed by mistake, a
// cancelled onboarding. A hospital that has seen a patient, a bill or a booking
// keeps its records (they are medical and tax documents): switch it off instead
// (PATCH isActive). Never a cascade that erases real data behind one dialog.
export async function deleteHospital(req, res, next) {
  try {
    const id = String(req.params.id)
    const confirmSlug = String(req.body?.confirmSlug || '').trim().toLowerCase()
    const org = await db.organization.findFirst({
      where: { id, slug: { notIn: [PLATFORM_SLUG, 'gudmed'] } },
      select: { id: true, name: true, slug: true, _count: { select: { patients: true, invoices: true, appointments: true, users: true } } },
    })
    if (!org) return res.status(404).json({ success: false, error: 'Hospital not found, or it is the platform itself and cannot be removed' })
    if (confirmSlug !== org.slug) {
      return res.status(400).json({ success: false, error: `Type the hospital code "${org.slug}" to confirm removal` })
    }
    // Real records block removal — the hospital is switched off instead.
    const has = []
    if (org._count.patients) has.push(`${org._count.patients} patient${org._count.patients === 1 ? '' : 's'}`)
    if (org._count.invoices) has.push(`${org._count.invoices} bill${org._count.invoices === 1 ? '' : 's'}`)
    if (org._count.appointments) has.push(`${org._count.appointments} appointment${org._count.appointments === 1 ? '' : 's'}`)
    if (has.length) {
      return res.status(409).json({
        success: false,
        error: `This hospital has ${has.join(', ')}. Its records are kept — switch the hospital off instead of removing it.`,
      })
    }
    // Empty but for its own staff logins: those go with it, in one transaction.
    await db.$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { organizationId: id } })
      await tx.organization.delete({ where: { id } })
      await auditIpd(req, getOrgId(req), {
        action: 'delete', entityType: 'platform.hospital', entityId: id,
        before: { name: org.name, slug: org.slug, staffRemoved: org._count.users },
      }, tx)
    })
    res.json({ success: true })
  } catch (e) { next(e) }
}

