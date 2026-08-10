// Did the response honour the request?
//
// WHY THIS EXISTS
// netwatch records how big a response was and how long it took. It never asks the
// more important question: is this the answer to the question that was asked?
//
// A call can be fast, small, 200 OK — and wrong:
//
//     ?status=pending   → rows come back that are not pending
//     ?limit=15         → sixteen rows arrive
//     ?doctorId=X       → another doctor's rows are in the list
//     ?date=2026-08-01  → rows from other days
//     meta.total = 500  → but paging past page 2 returns nothing
//
// None of that shows up as an error anywhere. The screen renders, the numbers look
// plausible, and a filter that quietly does not filter is how a doctor ends up
// looking at someone else's list. This module compares every request's query string
// against the rows that came back, and reports the mismatches.
//
// It is deliberately conservative: it only judges a parameter when it can map it to
// a field on the returned rows with confidence. A check that guesses would produce
// noise, and noisy findings are how real ones get ignored.

// query parameter → the row field it is supposed to constrain.
//
// `status` is deliberately absent, and that absence is the lesson. On /api/billing
// the parameter named `status` is translated by the controller onto a DIFFERENT
// column and to different values:
//
//     if (status === 'partial') where.paymentStatus = 'partially_paid'
//     else if (status === 'pending') where.paymentStatus = { in: ['unpaid', 'pending'] }
//
// Comparing `status=partial` against each row's `status` field therefore reported
// two confident, wholly false violations against code that was behaving correctly.
// A contract check that cannot see the translation must not judge the parameter —
// a false critical is worse than a missed one, because it burns the credibility of
// every true finding beside it.
//
// Only parameters whose name matches the field they filter, with the same values,
// belong here.
const FIELD_FOR = {
  doctorId: 'doctorId',
  patientId: 'patientId',
  priority: 'priority',
  testCategory: 'testCategory',
  department: null,        // matches a nested doctor.department.name — too indirect
  search: null,            // matches across several fields — not decidable here
  status: null,            // see above: translated per endpoint, not comparable
  category: null,          // pharmacy maps this onto drugCategory with different values
}

const rowsOf = (body) => {
  const d = body?.data ?? body
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.items)) return d.items
  if (Array.isArray(d?.rows)) return d.rows
  return null
}

/**
 * Compare one call's query string with its response body.
 * Returns a list of contract violations; empty means the response kept its promise.
 */
export function checkContract({ url, body }) {
  const issues = []
  const qs = url.split('?')[1]
  if (!qs) return issues
  const params = new URLSearchParams(qs)
  const rows = rowsOf(body)
  if (!rows) return issues

  // 1. limit — the most basic promise an API makes, and the easiest to break.
  const limit = Number(params.get('limit') ?? params.get('pageSize'))
  if (Number.isFinite(limit) && limit > 0 && rows.length > limit) {
    issues.push({ sev: 'critical', why: `asked for limit=${limit}, received ${rows.length} rows` })
  }

  // 2. every filter that maps cleanly to a field on the rows.
  for (const [param, field] of Object.entries(FIELD_FOR)) {
    if (!field) continue
    const wanted = params.get(param)
    if (!wanted || wanted === 'all' || wanted === '') continue

    // A comma-separated list means "any of these" — that is how this API expresses it.
    const allowed = new Set(wanted.split(',').map((v) => v.trim()))
    const wrong = rows.filter((r) => r?.[field] !== undefined && !allowed.has(String(r[field])))
    if (wrong.length) {
      const sample = [...new Set(wrong.map((r) => String(r[field])))].slice(0, 3)
      issues.push({
        sev: 'critical',
        why: `asked for ${param}=${wanted} but ${wrong.length} of ${rows.length} rows have ${field}=${sample.join('/')}`,
      })
    }
  }

  // 3. a date filter must actually narrow to that date — IN THE HOSPITAL'S TIMEZONE.
  //
  // Timestamps come back as UTC. Slicing the first ten characters off
  // "2026-08-08T18:30:00.000Z" gives 2026-08-08, but in IST that instant is
  // already the 9th. The API filters by the hospital's day (correctly, via
  // dayRange), so a naive UTC comparison reports every evening appointment as a
  // violation — forty of them in one Appointments run, all false.
  //
  // A date check that does not know what "day" means in this hospital is worse
  // than no date check at all.
  const date = params.get('date')
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const dateFields = ['appointmentDate', 'orderDate', 'invoiceDate', 'saleDate', 'joinedQueueAt', 'createdAt']
    const field = dateFields.find((f) => rows[0] && rows[0][f] !== undefined)
    if (field) {
      const HOSPITAL_TZ = process.env.HOSPITAL_TIMEZONE || 'Asia/Kolkata'
      const dayIn = (value) => {
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) return null
        // en-CA formats as YYYY-MM-DD, which is what we are comparing against.
        return d.toLocaleDateString('en-CA', { timeZone: HOSPITAL_TZ })
      }
      const wrong = rows.filter((r) => r[field] && dayIn(r[field]) && dayIn(r[field]) !== date)
      if (wrong.length) {
        issues.push({
          sev: 'critical',
          why: `asked for date=${date} but ${wrong.length} of ${rows.length} rows fall on ${dayIn(wrong[0][field])} in ${HOSPITAL_TZ}`,
        })
      }
    }
  }

  // 4. the count the response advertises versus what it can actually produce.
  const meta = body?.meta ?? body?.pagination
  if (meta) {
    const total = Number(meta.total ?? meta.totalRecords)
    const offset = Number(params.get('offset') ?? 0)
    if (Number.isFinite(total)) {
      // Claiming more rows than exist is how "2,000 appointments missing from the
      // dashboard count" happened before — the number and the list disagreed.
      if (rows.length > total) {
        issues.push({ sev: 'important', why: `meta.total says ${total} but this page alone returned ${rows.length} rows` })
      }
      if (offset === 0 && Number.isFinite(limit) && total > 0 && rows.length === 0) {
        issues.push({ sev: 'critical', why: `meta.total says ${total} but the first page is empty` })
      }
    }
  }

  return issues
}
