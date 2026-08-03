// An UNATTENDED wall display should drift back to the overview after someone
// taps into a floor or room and walks away — the next person arriving should
// find the board on its home screen, not on whatever the last person opened.
//
// It must not do that to someone who is still LOOKING at the screen. At 30s,
// reading a room's patient list was long enough to get thrown out mid-read,
// because only `click` counted as activity: scrolling the list, moving the
// mouse, or pressing a key all left the board convinced nobody was there.
// Two minutes is past what it takes to read a room and still short enough to
// reset a genuinely abandoned board.
export const IDLE_RETURN_MS = 120000

// ── Why this screen looks different from the rest of the app ────────────────
//
// Every other screen is an ADMIN screen: dense, read at arm's length, by
// someone who chose to look at it. This one is a TV on a wall, read from
// across a waiting room by a patient who is anxious and not necessarily
// looking. It was built with admin-screen values — 14px rows, a table, and a
// layout that left ~70% of a 1080p panel empty — and so was unreadable at the
// only distance that matters.
//
// The guidance for this kind of display is well established (see the sources
// noted with this change):
//   · roughly 1 inch of cap height per 10 feet of viewing distance
//   · the single thing the reader came for — who is being seen now — should be
//     the largest object on the screen, not one cell in a grid
//   · high contrast throughout; nothing structural in caption-sized type
//
// Light ground, by the hospital's choice. That puts the weight on TYPE and
// SPACE rather than on a dark canvas: near-black text on white for anything
// that must carry across a room, one saturated accent reserved for the hero,
// and generous padding so the eye can find a row without scanning.
export const SURFACE = 'bg-slate-50'
export const CARD = 'bg-white border border-slate-200 shadow-sm'
export const TEXT_MUTED = 'text-slate-500'
export const BRAND = '#2E4168'

// Public-display privacy, OFF by the hospital's decision.
//
// This board has no separate token system: the patient's name and UHID ARE how
// they are called and how they recognise their turn, so both are shown in full.
//
// Flipping this to true partially masks them ("Harsh K. V." / "••••7884"),
// which is what public queue-board guidance recommends — a waiting room is a
// public space, and a full name beside a full hospital ID links an identity to
// a medical visit for every stranger present or anyone photographing the
// screen. Left here, and applied at every render site, so that decision is one
// line away rather than a rewrite.
export const MASK_PATIENT_IDENTITY = false

// Distinct, readable pairs so a floor's departments are tellable apart at a
// glance instead of all rendering as the same chip. Hashed by department id so
// a given department always gets the same colour (stable across polls), not
// just the first N in whatever order they arrive in. Tuned for the dark ground:
// a light-mode `bg-blue-50` chip on near-black is an unreadable glare patch.
export const DEPARTMENT_COLORS = [
  'bg-sky-50 text-sky-700 ring-sky-200',
  'bg-violet-50 text-violet-700 ring-violet-200',
  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'bg-amber-50 text-amber-700 ring-amber-200',
  'bg-pink-50 text-pink-700 ring-pink-200',
  'bg-teal-50 text-teal-700 ring-teal-200',
  'bg-indigo-50 text-indigo-700 ring-indigo-200',
  'bg-orange-50 text-orange-700 ring-orange-200',
]

// Anything that means a human is present. `click` alone was not enough: reading
// a room's list involves scrolling and mouse movement but often no click at all,
// so an attentive viewer read as idle and the board navigated away underneath
// them mid-read.
export const ACTIVITY_EVENTS = ['click', 'mousemove', 'wheel', 'scroll', 'keydown', 'touchstart', 'pointerdown']

// How many doctor-columns share the screen at once before the board starts
// paging through the rest, and how long each page stays up. Both are
// per-screen ADMIN settings (Settings → TV Boards → DisplayScreen.maxDoctors
// / .sliderSpeedSeconds) — these are only the fallback for the floor-wide
// auto-divide feed (getFloorQueue), which has no single screen row to read
// settings from.
export const DEFAULT_MAX_VISIBLE = 5
export const DEFAULT_SLIDE_MS = 30000

// Fewer columns on screen at once means each one gets more width — so it
// should also get BIGGER type, not just more empty padding. Tiers below are
// keyed by how many columns are sharing the row right now; 5+ is the
// original size this screen was tuned at, everything below it scales up.
// Capped at 3 tiers past that baseline: a single column filling the whole TV
// still needs to read as "one room," not turn into a poster.
export const COLUMN_SIZE_TIERS = {
  1: { doctor: 'text-5xl', patient: 'text-3xl', now: 'text-2xl', num: 'h-11 w-11 text-2xl' },
  2: { doctor: 'text-4xl', patient: 'text-2xl', now: 'text-xl', num: 'h-10 w-10 text-xl' },
  3: { doctor: 'text-3xl', patient: 'text-xl', now: 'text-lg', num: 'h-9 w-9 text-lg' },
  4: { doctor: 'text-2xl', patient: 'text-lg', now: 'text-lg', num: 'h-8 w-8 text-base' },
}
export const BASE_COLUMN_SIZE = { doctor: 'text-2xl', patient: 'text-lg', now: 'text-lg', num: 'h-8 w-8 text-base' }
