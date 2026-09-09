import { db } from '../config/db.js'
import { z } from 'zod'
import { getOrgId } from '../lib/reqContext.js'
import { getPagination, paginationMeta } from '../lib/pagination.js'

// Self-service pre-registration: a patient fills their own details via the
// hospital's QR code before reaching the counter. Two audiences, two trust
// levels, split deliberately across public vs authenticated routes:
//   - the PUBLIC create (below) is reachable with no login — anyone with the QR
//   - the reception list/delete are behind authenticate + the org's own scope
//
// This never mints a UHID. On "Confirm", reception hands the stored form to the
// normal POST /patients (patientController.create), which is the ONE place a
// Patient + UHID + first appointment are created — so nothing here duplicates
// that logic or that atomic UHID counter.

// A pending row is only useful if reception can search it and later hand it back
// to the patient form, so require the fields they search on and keep the rest as
// the patient typed it. Full validation is the confirm step's job (patientSchema
// in patientController), not this one — a half-filled walk-up should still reach
// the counter rather than be rejected on their phone.
const preRegSchema = z.object({
  organizationId: z.string().min(1),
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  // 10-digit Indian mobile — the same rule the patient form and backend storage
  // use, applied here because phone IS the field reception looks people up by.
  phonePrimary: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
}).passthrough() // keep every other field the form sent, stored as-is

// Pending rows are a convenience, not a record: one left unconfirmed is a person
// who filled the form and never came (or was served without the counter finding
// their entry). Sweeping them on read keeps the reception list to today's actual
// walk-ups instead of a growing pile, and needs no cron. 48h so an evening
// registration for tomorrow morning still survives the night.
const STALE_MS = 48 * 60 * 60 * 1000

/**
 * POST /api/public/pre-registration  (PUBLIC — no login)
 * The patient's own submission from the QR-code form.
 */
export async function createPreRegistration(req, res, next) {
  try {
    const parsed = preRegSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid form', details: parsed.error.issues })
    }
    const { organizationId, firstName, lastName, phonePrimary, ...rest } = parsed.data

    // The org id rides in from the QR URL, so it is caller-supplied and must be
    // checked — a bad or guessed id would otherwise create an orphan pending row.
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } })
    if (!org) return res.status(404).json({ success: false, error: 'Hospital not found' })

    // The whole form goes back to POST /patients untouched on confirm, so store
    // exactly what will be sent — name/phone included — not a stripped copy.
    const formData = { firstName, lastName, phonePrimary, ...rest }

    const row = await db.preRegistration.create({
      data: {
        organizationId,
        firstName,
        lastName,
        phonePrimary,
        formData: JSON.stringify(formData),
        status: 'pending',
      },
      select: { id: true, firstName: true, lastName: true, createdAt: true },
    })

    res.status(201).json({
      success: true,
      data: row,
      message: 'Details submitted. Please visit the reception counter to complete your registration.',
    })
  } catch (err) { next(err) }
}

/**
 * GET /api/public/org/:orgId  (PUBLIC — no login)
 * Just enough hospital branding for the self-register page's header, so a
 * patient sees the right hospital name and colours before typing anything.
 */
export async function getPublicOrg(req, res, next) {
  try {
    const org = await db.organization.findUnique({
      where: { id: req.params.orgId },
      select: { id: true, name: true, logoUrl: true, primaryColor: true, city: true },
    })
    if (!org) return res.status(404).json({ success: false, error: 'Hospital not found' })
    res.json({ success: true, data: org })
  } catch (err) { next(err) }
}

/**
 * GET /api/pre-registration  (reception — authenticated)
 * The pending walk-ups for this hospital, newest first, searchable by name or
 * phone — the reception's "what's your number / name?" lookup.
 */
export async function listPreRegistrations(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const { search } = req.query
    const { page, limit, skip } = getPagination(req.query)

    // Sweep stale rows before listing (see STALE_MS) so the count reception sees
    // is real. Fire-and-forget: a slow delete must not hold up the list.
    db.preRegistration.deleteMany({
      where: { organizationId, createdAt: { lt: new Date(Date.now() - STALE_MS) } },
    }).catch(() => {})

    const where = { organizationId, status: 'pending' }
    // Search only the columns THIS table actually has (name + phone). The
    // patient-list search builder can't be reused as-is: it also matches on
    // `middleName` and `mrn`, which don't exist on PreRegistration, so Prisma
    // rejects the whole query. Same "split words, match any field" shape, three
    // real columns.
    const terms = String(search || '').trim().split(/\s+/).filter(Boolean)
    if (terms.length) {
      where.AND = terms.map((term) => ({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { phonePrimary: { contains: term, mode: 'insensitive' } },
        ],
      }))
    }

    const [rows, total] = await Promise.all([
      db.preRegistration.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip }),
      db.preRegistration.count({ where }),
    ])

    // Hand back the parsed form so the reception UI can drop it straight into the
    // patient form — the caller should not have to JSON.parse each row itself.
    const data = rows.map((r) => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      phonePrimary: r.phonePrimary,
      createdAt: r.createdAt,
      form: (() => { try { return JSON.parse(r.formData) } catch { return {} } })(),
    }))

    res.json({ success: true, data, pagination: paginationMeta(page, limit, total) })
  } catch (err) { next(err) }
}

/**
 * DELETE /api/pre-registration/:id  (reception — authenticated)
 * Removes a pending row — used both after a successful confirm and to clear a
 * junk/duplicate entry. Org-scoped so one hospital can't delete another's.
 */
export async function deletePreRegistration(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const existing = await db.preRegistration.findFirst({
      where: { id: req.params.id, organizationId },
      select: { id: true },
    })
    if (!existing) return res.status(404).json({ success: false, error: 'Pre-registration not found' })
    await db.preRegistration.delete({ where: { id: existing.id } })
    res.json({ success: true, message: 'Removed' })
  } catch (err) { next(err) }
}
