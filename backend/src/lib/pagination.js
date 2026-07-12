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

/**
 * The one list-endpoint shape every table uses. Runs the "paginate only when the
 * caller passes page/limit, otherwise return the whole (capped) list" rule once,
 * so a controller never re-writes that boilerplate.
 *
 * @param model  a Prisma delegate, e.g. `db.preTriage`
 * @param opts.where/include/select/orderBy  the query (as you'd pass to findMany)
 * @param opts.req      the request (for its query params)
 * @param opts.fullListTake  cap for the non-paginated (backward-compat) branch;
 *                      pass `null` to leave it UNCAPPED (e.g. the users endpoint
 *                      that fills dropdowns must return every row)
 * @param opts.summary  optional async () => ({...}) counted ONLY in the paginated
 *                      branch, for stat cards that must reflect the whole filtered
 *                      set rather than the current page
 * @returns the response body: `{ success, data, meta, pagination?, summary? }`
 */
export async function listResponse(model, { where, include, select, orderBy, req, fullListTake = 500, summary }) {
  const args = { where, orderBy }
  if (include) args.include = include
  if (select) args.select = select

  // No page/limit → the whole list, no `pagination` block, so existing non-table
  // consumers of the same endpoint keep working unchanged. `take` is applied only
  // when a cap is given; pass fullListTake:null for the callers that need every row.
  const wantsPage = req.query.page != null || req.query.limit != null
  if (!wantsPage) {
    const data = await model.findMany({ ...args, ...(fullListTake == null ? {} : { take: fullListTake }) })
    return { success: true, data, meta: { total: data.length } }
  }

  const { page, limit, skip } = getPagination(req.query)
  const [data, total] = await Promise.all([
    model.findMany({ ...args, skip, take: limit }),
    model.count({ where }),
  ])
  const body = { success: true, data, pagination: paginationMeta(page, limit, total), meta: { total } }
  if (summary) body.summary = await summary()
  return body
}
