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
