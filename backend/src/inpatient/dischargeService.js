// Phase 3 — discharge exit types.
// (Discharge clearances + housekeeping turnover were removed; discharge is gated
//  on a paid bill, and the bed is freed straight to "available".)

// How strict each exit type is. `requireClearances` (legacy name) now means
// "needs a paid bill": NORMAL = balanceDue 0; LAMA/ABSCONDED/EXPIRED/TRANSFER_OUT bypass.
export const DISCHARGE_TYPES = {
  NORMAL: { state: 'DISCHARGED', requireClearances: true },
  LAMA: { state: 'LAMA', requireClearances: false }, // risk consent; can bypass
  ABSCONDED: { state: 'ABSCONDED', requireClearances: false }, // patient gone
  EXPIRED: { state: 'EXPIRED', requireClearances: false }, // death — own workflow
  TRANSFER_OUT: { state: 'TRANSFERRED_OUT', requireClearances: false },
}
