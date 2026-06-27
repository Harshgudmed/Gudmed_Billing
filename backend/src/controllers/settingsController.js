import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import bcrypt from 'bcryptjs'

function parseOrg(org) {
  if (!org) return org
  return {
    ...org,
    settings: org.settings ? (() => { try { return JSON.parse(org.settings) } catch { return {} } })() : {},
    modulesEnabled: org.modulesEnabled ? (() => { try { return JSON.parse(org.modulesEnabled) } catch { return {} } })() : {},
  }
}

export async function getOrganization(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const org = await db.organization.findUnique({ where: { id: ORG_ID } })
    res.json({ success: true, data: parseOrg(org) })
  } catch (err) { next(err) }
}

// Only these org fields may be set by clients. Spreading req.body would let a
// caller overwrite anything on the row (mass assignment) — whitelist instead.
// (navbar/header colours live inside the `settings` JSON, not as columns.)
const ORG_UPDATABLE_FIELDS = [
  'name', 'address', 'city', 'phone', 'email', 'logoUrl',
  'primaryColor', 'secondaryColor', 'region', 'country',
]

export async function updateOrganization(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const data = {}
    for (const field of ORG_UPDATABLE_FIELDS) {
      if (req.body[field] !== undefined) data[field] = req.body[field]
    }
    if (req.body.settings && typeof req.body.settings === 'object') {
      data.settings = JSON.stringify(req.body.settings)
    }
    if (req.body.modulesEnabled && typeof req.body.modulesEnabled === 'object') {
      data.modulesEnabled = JSON.stringify(req.body.modulesEnabled)
    }
    const org = await db.organization.update({ where: { id: ORG_ID }, data })
    res.json({ success: true, data: parseOrg(org) })
  } catch (err) { next(err) }
}

export async function getUsers(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const users = await db.user.findMany({
      where: { organizationId: ORG_ID },
      include: { department: { select: { id: true, name: true } } },
      orderBy: { fullName: 'asc' },
    })
    // Never expose password hashes to the client.
    const safe = users.map(({ passwordHash, ...u }) => u)
    res.json({ success: true, data: safe })
  } catch (err) { next(err) }
}

export async function createUser(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { fullName, email, role, departmentId, phone, specialization, password } = req.body
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'A password of at least 6 characters is required so the user can log in' })
    }
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) return res.status(400).json({ success: false, error: 'Email already in use' })
    const user = await db.user.create({
      data: {
        organizationId: ORG_ID,
        fullName,
        email,
        role,
        passwordHash: await bcrypt.hash(password, 10),
        departmentId: departmentId || null,
        phone: phone || null,
        specialization: specialization || null,
        isActive: true,
      },
      include: { department: { select: { id: true, name: true } } },
    })
    // Never return the hash to the client.
    const { passwordHash, ...safe } = user
    res.json({ success: true, data: safe })
  } catch (err) { next(err) }
}

export async function updateUser(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id, fullName, email, role, departmentId, phone, specialization, password } = req.body
    // Tenant guard: only update a user that belongs to the caller's org.
    const existing = await db.user.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'User not found' })

    const data = { fullName, email, role, departmentId: departmentId || null, phone: phone || null, specialization: specialization || null }
    // Optional password reset — only re-hash when a new password is supplied.
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' })
      }
      data.passwordHash = await bcrypt.hash(password, 10)
    }
    const user = await db.user.update({
      where: { id },
      data,
      include: { department: { select: { id: true, name: true } } },
    })
    const { passwordHash, ...safe } = user
    res.json({ success: true, data: safe })
  } catch (err) { next(err) }
}

export async function toggleUserStatus(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id, isActive } = req.body
    // Tenant guard: prevent cross-org enable/disable of accounts.
    const existing = await db.user.findFirst({ where: { id, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'User not found' })

    const user = await db.user.update({ where: { id }, data: { isActive } })
    res.json({ success: true, data: user })
  } catch (err) { next(err) }
}

export async function getDepartments(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const departments = await db.department.findMany({
      where: { organizationId: ORG_ID },
      orderBy: { name: 'asc' },
    })
    res.json({ success: true, data: departments })
  } catch (err) { next(err) }
}

export async function createDepartment(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { name, description } = req.body
    const dept = await db.department.create({
      data: { organizationId: ORG_ID, name, description: description || null },
    })
    res.json({ success: true, data: dept })
  } catch (err) { next(err) }
}

export async function getBillingServices(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const services = await db.billingService.findMany({
      where: { organizationId: ORG_ID, isActive: true },
      orderBy: [{ serviceCategory: 'asc' }, { serviceName: 'asc' }],
    })
    res.json({ success: true, data: services })
  } catch (err) { next(err) }
}
