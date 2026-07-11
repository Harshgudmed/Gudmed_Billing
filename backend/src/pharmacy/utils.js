// Shared sorting and error helpers for pharmacy controllers.
// Pagination now lives in lib/pagination.js so non-pharmacy controllers can
// use it too; re-exported here so existing pharmacy imports keep working.

export { getPagination, paginationMeta } from '../lib/pagination.js'

// Returns true if the error was handled (sent response), false if caller should next(err)
export function handleServiceError(res, err) {
  if (err.status && err.status < 500) {
    res.status(err.status).json({
      success: false,
      message: err.message,
      errorCode: err.errorCode || 'CLIENT_ERROR',
      ...(err.details ? { details: err.details } : {}),
    })
    return true
  }
  return false
}

export function makeError(message, status, errorCode, details) {
  const err = new Error(message)
  err.status = status
  err.errorCode = errorCode
  if (details) err.details = details
  return err
}
