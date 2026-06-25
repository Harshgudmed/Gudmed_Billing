function prismaErrorMessage(err) {
  switch (err.code) {
    case 'P1001':
      return 'Cannot reach the database. Check that PostgreSQL is running and DATABASE_URL in backend/.env is correct.'
    case 'P2021':
      return `Database table missing (${err.meta?.table || 'unknown'}). Run: cd backend && npx prisma db push`
    case 'P2003':
      return `Foreign key constraint failed (${err.meta?.field_name || 'relation'}). Seed users/patients or fix linked IDs.`
    case 'P2002':
      return 'A record with this value already exists'
    case 'P2025':
      return 'Record not found'
    default:
      return err.message
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

  if (err.code?.startsWith('P')) {
    const status = err.code === 'P2002' ? 409 : err.code === 'P2025' ? 404 : 500
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
