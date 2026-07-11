// Shared page/limit handling for every paginated list endpoint.
//
// The frontend's useServerPagination hook sends `?page=&limit=` and reads the
// total back off `pagination.totalRecords`, so controllers should return
// `paginationMeta(page, limit, total)` under a `pagination` key.

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
