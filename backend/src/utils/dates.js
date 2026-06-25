// Small, readable date helpers — no external library needed.
// Each one copies the input first, so the original date is never mutated.

/** Start of the given day → 00:00:00.000 (same calendar day). */
export function startOfDay(date) {
  const d = new Date(date)
    d.setHours(0, 0, 0, 0)
      return d
      }

      /** End of the given day → 23:59:59.999 (same calendar day). */
      export function endOfDay(date) {
        const d = new Date(date)
          d.setHours(23, 59, 59, 999)
            return d
            }

            /** A new Date that is `days` days BEFORE the given date (same time of day). */
            export function subDays(date, days) {
              const d = new Date(date)
                d.setDate(d.getDate() - days)
                  return d
                  }

                  /** A new Date that is `days` days AFTER the given date (same time of day). */
                  export function addDays(date, days) {
                    const d = new Date(date)
                      d.setDate(d.getDate() + days)
                        return d
                        }
                        