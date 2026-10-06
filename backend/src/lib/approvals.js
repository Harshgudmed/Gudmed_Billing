// Approvals for purchase documents — one system for every document type.
//
// A hospital's rules are rows of ApprovalRule, one per LEVEL: "level 1, Admin,
// from ₹0", "level 2, Finance Controller, from ₹25,000". A document needs every
// level whose minAmount it reaches, one after another. A ₹10,000 request needs
// level 1; a ₹40,000 one needs level 1 and then level 2.
//
// When a document is submitted its levels are written as ApprovalStep rows —
// a copy of the rules as they were at that moment — so a rule changed later
// never changes what a request already in the queue needs, and the history
// shows who approved what under which rule.
//
// Purchase requests use it now; purchase orders and vendor bills will call
// the same functions with their own documentType.

// PR = purchase request (is it needed?), PO = purchase order (the money).
export const DOCUMENT_TYPES = ['PR', 'PO']

// Roles a level can be given to. Admin is always allowed to act (see canAct).
export const APPROVER_ROLES = ['admin', 'finance_controller', 'purchase_officer']

// A hospital that has not set rules: one level, an administrator, any amount.
// Not written to the database — the hospital's first save replaces it.
export const DEFAULT_RULES = {
  PR: [{ level: 1, approverRole: 'admin', minAmount: 0 }],
  PO: [{ level: 1, approverRole: 'admin', minAmount: 0 }],
}

export const MAX_LEVELS = 5
const ALWAYS_APPROVES = new Set(['admin', 'super_admin'])

/**
 * The levels a document of `amount` needs, lowest first. Empty when the first
 * level starts above the amount — a hospital may say "under ₹2,000 needs no
 * approval".
 */
export function levelsFor(rules, amount) {
  return [...rules]
    .sort((a, b) => a.level - b.level)
    .filter((r) => (Number(amount) || 0) >= (Number(r.minAmount) || 0))
}

/**
 * Checks a set of rules before it is saved. Returns an error message or null.
 * Levels run 1, 2, 3… with no gaps, and a higher level never starts below a
 * lower one — otherwise "level 2 from ₹5,000" under "level 1 from ₹10,000"
 * would ask for level 2 without level 1.
 */
export function rulesError(rules) {
  if (!Array.isArray(rules)) return 'Rules must be a list'
  // No rows reads back as the DEFAULT (an administrator approves everything),
  // so an empty list cannot mean "nobody approves". For that, start level 1
  // above the amounts that need no approval.
  if (rules.length === 0) return 'Keep at least one level — to let small requests through, raise level 1\'s amount'
  if (rules.length > MAX_LEVELS) return `At most ${MAX_LEVELS} levels`
  const sorted = [...rules].sort((a, b) => a.level - b.level)
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]
    if (r.level !== i + 1) return 'Levels must be numbered 1, 2, 3… without gaps'
    if (!APPROVER_ROLES.includes(r.approverRole)) return `Level ${r.level}: choose who approves from the list`
    if (!Number.isFinite(r.minAmount) || r.minAmount < 0) return `Level ${r.level}: the amount must be 0 or more`
    if (i > 0 && r.minAmount < sorted[i - 1].minAmount) {
      return `Level ${r.level} starts at ₹${r.minAmount}, below level ${sorted[i - 1].level} (₹${sorted[i - 1].minAmount}) — a higher level cannot start lower`
    }
  }
  return null
}

/** The step waiting for a decision now: the lowest pending level, or null. */
export function currentStep(steps) {
  return [...steps].sort((a, b) => a.level - b.level).find((s) => s.status === 'pending') || null
}

/**
 * May `actor` decide `step` of a document raised by `requestedById`?
 * The level's own role may, and an administrator always may. Nobody approves
 * their own request — except an administrator, because a small hospital may
 * have only one. Returns an error message or null.
 */
export function actError(step, actor, requestedById, steps = []) {
  if (!step) return 'Nothing is waiting for approval on this document'
  const admin = ALWAYS_APPROVES.has(actor?.role)
  if (!admin && actor?.role !== step.approverRole) return `Level ${step.level} is approved by ${roleName(step.approverRole)}`
  if (!admin && actor?.id && actor.id === requestedById) return 'You cannot approve a request you raised yourself'
  // Two levels are two people: whoever approved one level may not approve the
  // next, even when the hospital gave both levels to the same role.
  const earlier = !admin && actor?.id && steps.find((s) => s.status === 'approved' && s.actedById === actor.id)
  if (earlier) return `You approved level ${earlier.level} — level ${step.level} needs another person`
  return null
}

const ROLE_NAMES = { admin: 'an administrator', finance_controller: 'the Finance Controller', purchase_officer: 'a Purchase Officer' }
export const roleName = (role) => ROLE_NAMES[role] || role

// ── Database side (always inside the caller's transaction) ───────────────────

/** The hospital's rules for a document type, or the default when it has none. */
export async function loadRules(tx, organizationId, documentType) {
  const rows = await tx.approvalRule.findMany({
    where: { organizationId, documentType },
    orderBy: { level: 'asc' },
    select: { level: true, approverRole: true, minAmount: true },
  })
  return rows.length ? rows : DEFAULT_RULES[documentType] || []
}

/**
 * Writes the steps a submitted document needs. Clears any from an earlier
 * submission first (a rejected request sent again). Returns how many were
 * written — 0 means the amount needs no approval.
 */
export async function openSteps(tx, organizationId, documentType, documentId, amount) {
  const levels = levelsFor(await loadRules(tx, organizationId, documentType), amount)
  await tx.approvalStep.deleteMany({ where: { organizationId, documentType, documentId } })
  if (levels.length) {
    await tx.approvalStep.createMany({
      data: levels.map((r) => ({
        organizationId, documentType, documentId, level: r.level, approverRole: r.approverRole,
      })),
    })
  }
  return levels.length
}

/** A document's steps, lowest level first. */
export function stepsOf(tx, organizationId, documentType, documentId) {
  return tx.approvalStep.findMany({
    where: { organizationId, documentType, documentId },
    orderBy: { level: 'asc' },
  })
}

/**
 * Records `actor`'s decision on the current step. Approve moves to the next
 * level; reject ends it (the remaining levels are cancelled). Returns
 * { outcome: 'next' | 'approved' | 'rejected' } or { error }.
 */
export async function decide(tx, organizationId, documentType, documentId, { actor, requestedById, approve, remark }) {
  const steps = await stepsOf(tx, organizationId, documentType, documentId)
  const step = currentStep(steps)
  const error = actError(step, actor, requestedById, steps)
  if (error) return { error }

  const now = new Date()
  await tx.approvalStep.update({
    where: { id: step.id },
    data: { status: approve ? 'approved' : 'rejected', actedById: actor.id, actedByName: actor.name, actedAt: now, remark: remark || null },
  })
  if (!approve) {
    await tx.approvalStep.updateMany({
      where: { organizationId, documentType, documentId, status: 'pending' },
      data: { status: 'cancelled' },
    })
    return { outcome: 'rejected', step }
  }
  const more = steps.some((s) => s.status === 'pending' && s.level > step.level)
  return { outcome: more ? 'next' : 'approved', step }
}

/**
 * Ids of the documents of `documentType` whose CURRENT step (lowest pending
 * level) `actor` may decide — their "waiting for me" list. An administrator
 * may decide any. Excluding the actor's own documents is the caller's.
 */
export async function awaitingFor(client, organizationId, documentType, actor, admin) {
  const pending = await client.approvalStep.findMany({
    where: { organizationId, documentType, status: 'pending' },
    select: { documentId: true, level: true, approverRole: true },
  })
  const current = new Map()
  for (const s of pending) {
    const c = current.get(s.documentId)
    if (!c || s.level < c.level) current.set(s.documentId, s)
  }
  const waiting = [...current.values()].filter((s) => admin || s.approverRole === actor.role).map((s) => s.documentId)
  if (admin || !actor?.id || !waiting.length) return waiting
  // Not one whose earlier level this person approved: the next is someone else's (actError).
  const done = await client.approvalStep.findMany({
    where: { organizationId, documentType, documentId: { in: waiting }, status: 'approved', actedById: actor.id },
    select: { documentId: true },
  })
  const skip = new Set(done.map((d) => d.documentId))
  return waiting.filter((id) => !skip.has(id))
}

/** Withdraws whatever is still pending (the document was cancelled). */
export function cancelSteps(tx, organizationId, documentType, documentId) {
  return tx.approvalStep.updateMany({
    where: { organizationId, documentType, documentId, status: 'pending' },
    data: { status: 'cancelled' },
  })
}
