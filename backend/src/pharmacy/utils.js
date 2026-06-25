// Shared pagination, sorting, and error helpers for pharmacy controllers

export function getPagination(query) {
  const page = Math.max(Number(query.page) || 1, 1)
  const limit = Math.min(Number(query.limit) || 20, 5000)
  const skip = (page - 1) * limit
  return { page, limit, skip }
}

export function paginationMeta(page, limit, total) {
  const totalPages = Math.ceil(total / limit)
  return {
    page,
    limit,
    totalRecords: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  }
}

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
