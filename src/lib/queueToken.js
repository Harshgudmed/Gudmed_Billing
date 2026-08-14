// The readable part of a queue token.
//
// Stored tokens are long on purpose — `OPD20260812-000004` — because
// QueueManagement carries @@unique([organizationId, queueNumber]) and that holds
// for ALL TIME, not per day. Drop the date and tomorrow's fourth patient
// collides with today's, and the insert fails in front of a receptionist.
//
// But nobody reads that from across a waiting hall and nobody remembers it. The
// date and the prefix are there for the database; the counter is the part the
// patient needs, so that is the part shown: 4.
//
// It stays unambiguous because the counter is per hospital per day, NOT per
// room and not per doctor:
//
//   Room 19 · Dr A   →  12
//   Room 20 · Dr B   →  13
//   Room 20 · Dr C   →  14
//
// Per-room or per-doctor numbering is the version that breaks: every room would
// start at 1, "Token 1" would exist three times in one building, and a single
// announcement would stand three people up. One counter for the hospital's day
// is what makes a bare number safe to say out loud.
//
// Lives in lib/ rather than in the wall display because the token is shown in
// more than one place — the Queue module's table and the printed slip carry the
// same number, and they must shorten it identically or the slip in the patient's
// hand stops matching the board.

// The LEADING ZERO is the whole test, and it is not cosmetic.
//
// `OPD20260812-000004` came from the counter — padStart(6,'0') put those zeros
// there. `OPD20260716-759407` is one of the 197,598 rows minted before the
// counter existed, when the number was Math.random() over six digits. Both have
// the identical shape PREFIX + 8 digits + '-' + digits, so shape alone cannot
// tell them apart — and shortening a random one to "759407" would print six
// digits on a wall board while claiming to be a short token.
//
// Requiring at least one leading zero identifies the padded ones exactly. It
// stops working only if a hospital's counter passes 99,999 patients in a single
// day, at which point the padding runs out — and at 100,000 OPD patients a day
// the token is not the problem.
// Accepts counter tokens (OPD20260812-000004) and H-prefixed tokens (OPD20260629-H000001)
const COUNTER_TOKEN = /^[A-Z]+\d{8}-(?:H)?(0\d{5,})$/

export function shortToken(token) {
  const raw = String(token ?? '').trim()
  if (!raw) return ''
  const m = COUNTER_TOKEN.exec(raw)
  if (!m) return raw
  const n = Number(m[1])
  // A counter starts at 1. A zero here means no number was ever drawn, and "0"
  // on a board is worse than the raw token — it looks like a real position.
  return Number.isFinite(n) && n > 0 ? String(n) : raw
}
