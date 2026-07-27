// Canonical queue priority levels, ordered most-urgent first.
//
// The queue is sorted on the numeric rank below, NOT on the priority string.
// A plain string sort ordered them alphabetically ("high" sorted *below* "low",
// and dropped to the bottom of a desc sort), so bumping a patient to a higher
// priority never actually moved them up the queue. Ranks are spaced 20 apart to
// leave room for a future time-based aging bump within a band.

export const QUEUE_PRIORITIES = ['urgent', 'high', 'medium', 'normal', 'low']

const RANK = { urgent: 100, high: 80, medium: 60, normal: 40, low: 20 }

export const DEFAULT_PRIORITY_RANK = RANK.normal

// Maps a priority string to its sort rank. Unknown/legacy values fall back to
// the "normal" rank so an odd stored value never sinks a patient off the list.
export function priorityRank(priority) {
  return RANK[priority] ?? DEFAULT_PRIORITY_RANK
}

// The queue's ONE canonical sort order: highest priority first, then who has
// been waiting longest, with createdAt as the final tiebreak so two rows with
// an identical joinedQueueAt (a bulk check-in, or the same instant) always
// sort the same way — without it Postgres returns tied rows in an unstable
// physical order and the board reshuffles the same patients on every poll.
//
// This was copy-pasted at four call sites (queueController's list and
// call-next, displayController's board feed and floor grid) with a comment at
// each one saying it "must match" the others — a convention nothing enforced,
// so a future edit to one had nothing stopping it from silently drifting from
// the rest. If they disagree, the person the QUEUE SCREEN shows as next is not
// the person a "call next" press actually calls — import this everywhere
// instead of retyping the array.
export const QUEUE_ORDER_BY = [{ priorityRank: 'desc' }, { joinedQueueAt: 'asc' }, { createdAt: 'asc' }]
