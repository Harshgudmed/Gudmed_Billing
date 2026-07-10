// Single source of truth for "which User is this system-generated order attributed to".
//
// WHY THIS FILE EXISTS: three different answers to the same question had grown up
// side by side — radiology hardcoded the literal id `'user-admin'` (wrong hospital,
// or a foreign-key crash in any org that has no such user), laboratory kept a local
// copy that honoured DEFAULT_REQUESTED_BY_ID *without checking the user belongs to
// the caller's org* (a cross-tenant leak), and billing's fulfilment had a third.
//
// Every caller must pass the organizationId, and every candidate is verified to
// belong to it before being returned.

/**
 * Pick the User an order should be attributed to, in priority order:
 *   1. the acting user (the logged-in doctor/biller), if they belong to this org
 *   2. DEFAULT_REQUESTED_BY_ID, if that user belongs to this org
 *   3. the org's oldest active user (so a demo/unauthenticated request still works)
 *
 * @param client   Prisma client OR an interactive transaction client (`tx`)
 * @param organizationId  the caller's tenant — never optional
 * @param actorId  id of the logged-in user, if any
 * @throws {Error & {status:400}} when the org has no active user at all
 */
export async function resolveRequestedById(client, organizationId, actorId) {
  const candidates = [actorId, process.env.DEFAULT_REQUESTED_BY_ID].filter(Boolean)

  for (const id of candidates) {
    // findFirst (not findUnique) so the organizationId filter is applied — this is
    // what stops another hospital's user id from being accepted.
    const user = await client.user.findFirst({
      where: { id, organizationId },
      select: { id: true },
    })
    if (user) return user.id
  }

  const fallback = await client.user.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (fallback) return fallback.id

  throw Object.assign(
    new Error('No active user found to raise the order against. Create a user in Settings first.'),
    { status: 400 },
  )
}
