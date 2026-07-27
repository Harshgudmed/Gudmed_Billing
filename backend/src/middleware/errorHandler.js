// Prisma error code → HTTP status. Codes tied to bad client input map to 4xx;
// only genuine server/DB-availability problems stay 5xx. Previously ONLY P2002
// and P2025 were mapped and everything else (notably P2003 foreign-key, on a
// garbage/non-existent linked id) fell through to a 500 that leaked raw Prisma
// text — across Pharmacy, Lab, Radiology, Consultation, Death-cert, Ambulance
// and Settings. This one table fixes all of them.
const PRISMA_STATUS = {
  P2002: 409, // unique constraint (duplicate)
  P2025: 404, // record not found
  P2003: 400, // foreign-key violation — a referenced id does not exist
  P2000: 400, // value too long for the column
  P2011: 400, // null-constraint violation
  P2012: 400, // missing a required value
  P2014: 400, // change would violate a required relation
}

function prismaErrorMessage(err) {
  switch (err.code) {
    case 'P1001':
      return 'Cannot reach the database. Check that PostgreSQL is running and DATABASE_URL in backend/.env is correct.'
    case 'P2021':
      return `Database table missing (${err.meta?.table || 'unknown'}). Run: cd backend && npx prisma db push`
    case 'P2002':
      return 'A record with this value already exists'
    case 'P2025':
      return 'Record not found'
    case 'P2003':
      return 'Invalid reference: a linked record does not exist'
    case 'P2000':
      return 'A value is too long for its field'
    case 'P2011':
    case 'P2012':
      return 'A required field is missing'
    default:
      // Never surface the raw Prisma message for unknown codes — it leaks schema
      // and column internals. Keep the detail in dev only.
      return process.env.NODE_ENV === 'production' ? 'Database error' : err.message
  }
}

export function errorHandler(err, _req, res, _next) {
  console.error('[API Error]', err.code || err.name, err.message)
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    console.error(err.stack)
  }

  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: err.issues,
    })
  }

  // A malformed query / wrong data type reaching Prisma is a client (400)
  // problem, not a server crash — and its raw multi-line message leaks the
  // schema, so never forward it.
  if (err.name === 'PrismaClientValidationError') {
    return res.status(400).json({ success: false, error: 'Invalid request data' })
  }

  if (err.code?.startsWith('P')) {
    const status = PRISMA_STATUS[err.code] || 500
    return res.status(status).json({
      success: false,
      error: prismaErrorMessage(err),
      code: err.code,
    })
  }

  const status = err.status || err.statusCode || 500
  res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
  })
}
