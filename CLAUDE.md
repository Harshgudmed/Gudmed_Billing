# Rules for working in this repo

Work here as a senior engineer would on a system that handles real patients and
real money: **design before you type, and assume the worst case will happen.**

Before writing code, think through — and say out loud — four things:

1. **Shape.** What is the simplest structure that solves this? Where does it
   belong (a shared lib, or this one component)? Which existing piece already
   does part of it? **Which OTHER modules will need the same thing?** (see rule
   9 — this is not optional.) Prefer boring and obvious over clever; the next
   person to read it will be debugging at 11pm.
2. **Concurrency.** What happens if two users do this at the same millisecond?
   Anything read-then-written must be atomic (`$transaction`, an `updateMany`
   with a guard in the `where`, or a counter) — never fetch, compute in JS, and
   write back. Every generated identifier goes through a counter, never a clock
   or a random number.
3. **Security.** Every id in the request body is hostile until proven to belong
   to this tenant. Every list read is org-scoped. Never trust a status, price or
   total the client sent — recompute it server-side.
4. **Edge cases.** Zero rows, one row, a million rows. Null and missing fields.
   A request that arrives twice. A network failure halfway through. A value that
   is `0` (which is falsy — `||` will silently replace it). The list that grows
   past whatever limit was assumed.

Then write the smallest change that covers all four. If a fix needs a comment to
explain why it exists, write that comment — say what breaks without it, not what
the code does.

The rules below are hard rules, not suggestions. Breaking one has cost real money
and real debugging time in this project already.

## 1. Search before you write. Always.

Before writing ANY function, hook, component, helper or script, search the repo
for one that already does it, and reuse it. **Say what you searched for and what
you found before writing a line of code.**

This has been violated repeatedly and it always costs more than it saved:
- A paginated fetch with debounce + page-reset was hand-rolled inside
  `RadiologyModule.jsx` when `src/lib/useServerPagination.js` already did it —
  and did it better (it also snaps back when the page falls past the end of a
  narrowed result set).
- A date-range helper was nearly written when `dateRangeFor`
  (`src/components/common/DateFilter.jsx`) and the timezone-aware `dayRange`
  (`backend/src/lib/dates.js`) both existed. The naive version would have made
  "today" wrong by 5.5 hours in IST.
- An IDOR scan script was written without noticing `backend/scripts/bug-hunt.mjs`
  and `bug-hunt-api.mjs` already existed.

The existing versions encode fixes for bugs that were already found and paid for
once. Duplicating them re-introduces those bugs.

### Canonical helpers — reach for these first

**Frontend**
| Need | Use |
|---|---|
| Paginated table (server-side) | `useServerPagination` — `src/lib/useServerPagination.js` |
| Type-to-search picker | `SearchableSelect` — `src/components/ui/searchable-select.jsx` (has `onSearch`/`loading`/`selectedLabel` for server mode) |
| Patient picker | `PatientLookup` — `src/components/common/PatientLookup.jsx` |
| Patient age / name / initials | `calcAge`, `getFullName`, `initials` — `src/lib/patient.js` |
| Date range for a filter | `dateRangeFor` — `src/components/common/DateFilter.jsx` |
| Debounce | `useDebounce` — `src/lib/useDebounce.js` |
| Live refresh | `useLiveRefresh` — `src/hooks/useLiveRefresh.js`, or `pollMs` on `useServerPagination` |
| Debounced server search with race guard | copy the `cancelled`-flag pattern in `PosDrugCombo.jsx` / `PatientLookup.jsx` |

**Backend**
| Need | Use |
|---|---|
| Tenant ownership check before a write | `isOwned(model, id, orgId)` — `src/lib/tenant.js` |
| Any human-visible number (invoice, receipt, order, UHID…) | `nextSeriesNumber` / `generateUHID` — `src/lib/counters.js` |
| Patient search `where` | `patientSearchWhere` — `src/lib/patientSearch.js` |
| Patient fields for a receipt | `PATIENT_SNAPSHOT_SELECT`, `getPatientSnapshot`, `ageFromDob` — `src/utils/patientSnapshot.js` |
| Day boundaries in hospital timezone | `dayRange`, `todayRange` — `src/lib/dates.js` |
| Money rounding / financial year | `round2`, `financialYear` — `src/lib/money.js` |
| Pagination response | `getPagination`, `listResponse` — `src/lib/pagination.js` |
| Recompute invoice totals | `recalcInvoice` — `src/lib/invoiceLedger.js` |
| Stock movement | `recordStockChange`, `consumeFromBatches` — `src/pharmacy/stockService.js` |

## 2. Write it for the next person, not for yourself

Someone else will read this at 11pm with a hospital waiting. Optimise for that.

- **Don't repeat yourself.** If the same logic appears twice, it belongs in one
  place. If it appears in two modules, that place is a shared lib — not a copy
  in each. Every duplicate is a bug that only gets fixed in one of them (this
  repo has already had age, patient-name and date-range logic drift apart that
  way).
- **Name things for what they mean, not what they are.** `patientAge` not
  `a`; `unpaidBalance` not `x2`; `hasActiveShift` not `flag`. A boolean reads as
  a yes/no question (`isOwned`, `hasInsurance`). A function is a verb
  (`recalcInvoice`, `consumeFromBatches`). No abbreviations that only make sense
  today (`tmp`, `data2`, `handleClick3`).
- **One function, one job.** If you need "and" to describe it, split it.
- **Comments explain WHY, never WHAT.** `// loop over items` is noise. `// stock
  must be decremented inside the same tx, or a failed payment leaves the shelf
  short` is worth its line. State what breaks without the code.
- **Leave no mess.** Delete dead code rather than commenting it out — git
  remembers it. No stray `console.log`. No unused imports or variables. Match the
  formatting of the file you are in; do not reformat lines you did not change.
- **Small, focused changes.** Fix the thing that was asked. Unrelated cleanup
  belongs in its own change so a reviewer can see what actually happened.

## 3. Never generate an identifier from `Date.now()` or `Math.random()`

Every human-visible number goes through `nextSeriesNumber` (or `generateUHID`)
**inside a `$transaction`**. Timestamps and random digits collide, and these
columns are `@unique`, so a collision is a hard 500 in front of a user.

Also: two call sites that mint the same KIND of number must use the same series
key. A second key means a second counter starting at 1, which walks straight
back through numbers the first one already issued.

## 4. Never trust an id from the request body

Any `patientId` / `doctorId` / `drugId` / `appointmentId` / `prescriptionId`
arriving from a client must be checked with `isOwned(...)` (or an
`organizationId` in the `where`) before it is read, written or linked. This is a
multi-tenant system: an unguarded id lets one hospital read or modify another
hospital's records.

**Every feature is multi-hospital or it is not finished.** Nothing may assume one
organisation — not a query, not a counter, not a cache, not a script, not a seed,
not a report. Before calling anything done, ask what it does when a second hospital
exists: does the list still scope, does the number series still start at 1 per
hospital, does the cached settings object belong to the right one? A feature that
works today and needs rewriting for hospital number two was not built, it was
prototyped.

**The database does not check tenancy — only the code does.** As of 2026-08-08 all
18 `patientId` relations have foreign keys again, so a patient referenced by an
appointment is guaranteed to *exist*. It is **not** guaranteed to belong to the same
hospital: `patientId` references `Patient(id)`, and every hospital's patients share
that table, so a cross-tenant id satisfies the constraint and stores cleanly. The
only thing stopping it is `isOwned()` in the controller. Enforcing it in Postgres
means a UNIQUE index on `Patient(organizationId, id)` and composite foreign keys on
all 18 children — worth doing, not yet done. Until then,
`node backend/scripts/check-orphans.mjs` reports any cross-tenant row that appears;
run it after anything that writes patient-linked data in bulk.

## 5. A big `limit` is not pagination

Never fetch a whole table with `limit=2000` / `limit=5000` and filter it in the
browser. Use server-side search (send the search term) or server-side pagination
(`useServerPagination`). The pharmacy catalogue is ~200k rows; a `limit=5000`
picker could not see 97% of it and reported "no results" for drugs that existed.

## 6. Verify with evidence, not assertion

Before saying something is fixed: run it. A live API call, a browser test, or a
query — and show the output. "It should work now" is not acceptable here; several
"fixed" claims in this repo turned out to be untouched code.

Two ready-made scanners exist — run them rather than writing new ones:
`node backend/scripts/bug-hunt.mjs` (data invariants) and
`node backend/scripts/bug-hunt-api.mjs` (API behaviour).

## 7. Tests: run the existing ones, then add to them

There are ~100 unit tests (`npm run test:unit` in `backend/`) and integration
tests (`npm run test:integration`). **Run them before and after any backend
change** — a green run before you start is what proves you broke something, not
that it was already broken.

New tests go in `backend/src/lib/__tests__/*.test.js`, using `node:test` +
`node:assert/strict`, following `phone.test.js` for style and
`concurrency.test.js` for anything that touches the database or concurrency.
Name each test after the real-world failure it prevents, not after the function.
Test behaviour that causes a visible bug when wrong — not that a function exists.
Clean up any rows a test creates, even when it fails.

## 8. Ask before large refactors

Splitting files, swapping state management, or restructuring a module: propose it
first. Fix the bug that was asked for; don't rewrite around it.

## 9. Never build a feature for one module. Build it for all of them.

Before writing anything, ask out loud: **which other modules need this same
thing?** Laboratory, Radiology, Pharmacy, Billing and IPD are five doors into the
same hospital — a patient, a price, an order, a receipt, a number. If a thing is
true for one of them it is almost always true for the rest.

So the question is never "how do I do this in Laboratory?" It is:

- What is the *general* thing here, with the module-specific part pulled out?
- Where does the general part live so all five can reach it — `backend/src/lib/`
  or `src/lib/`, not inside the module?
- What is genuinely different per module, and can that be a small table or a
  parameter instead of a copy?

The pattern that works: **one shared function + a small table of per-module
differences.**

```js
// backend/src/lib/catalogPrice.js — one lookup, four catalogues
const CATALOG = {
  lab:       { model: 'labTest',        priceOf: (r) => r.price },
  radiology: { model: 'radiologyExam',  priceOf: (r) => r.price },
  pharmacy:  { model: 'pharmacyDrug',   priceOf: (r) => r.sellingPrice ?? r.mrp },
  service:   { model: 'billingService', priceOf: (r) => r.unitPrice },
}
```

Adding a sixth catalogue is one line. Writing it per module would be four copies
of the org-scoping, the not-found check and the rounding — and the next security
fix would land in one of them.

This repo has already paid for ignoring it:

- The lab report HTML was written twice — 156 lines inside `LaboratoryModule.jsx`
  and 162 in `printLabReport.js`. Same report, two files. A logo change would
  have altered the Patient Profile's copy and silently left Laboratory printing
  the old one.
- `invoiceFulfillment.js` and `inpatient/orderBillingService.js` both read the
  lab/radiology/pharmacy catalogues, separately, with different fallbacks.
- Age, patient-name and date-range logic each drifted apart across modules before
  `src/lib/patient.js` and `dates.js` existed.

**The test:** if you can describe what you built without naming a module, it
belongs in a shared lib. "Get the price of a catalogue item" — shared. "Colour
the Laboratory status badge" — stays in Laboratory.

**But do not over-build.** Two modules with the same need is a shared lib. One
module with an imagined future need is speculation — CLAUDE.md rule 2 still
applies, and a wrong abstraction costs more than a second copy. Point at the
second real caller before you generalise.

## 10. Open the Network tab before you call a screen "done"

A screen that renders correctly can still be shipping megabytes and calling the
same endpoint three times. None of that shows up in a code review — it shows up
in DevTools, or on a hospital's connection at 9am.

Run this pass on any screen you touched, and paste the numbers:

**Network tab** (F12 → Network, with *Disable cache* and *Preserve log* on):

| Check | What is wrong |
|---|---|
| **Duplicate calls** | The same URL twice in one page load = two components fetching the same thing. Lift it to one hook. |
| **Response size** | Any API response over ~100 KB. Ask what the screen actually reads — a picker that needs 7 fields should not receive 25. |
| **`limit=500` / `limit=2000`** | Rule 5. It is a cap, not pagination — rows past it vanish silently. |
| **Slow calls** | Over ~200 ms locally means seconds on Render. A slow call with a *tiny* response is a bad query, not a big payload. |
| **Status** | 4xx is ours, 5xx is the server's, `(failed)` never arrived. An aborted slow request reports as a CORS error — check the timing before believing the message. |
| **Throttling → Slow 3G** | The honest test. 900 KB is 20 seconds there. |

**Console:** zero errors, or say why.

**React re-renders:** the sidebar and app shell must not re-render because a table
paged. Nothing in `src/` is memoised today, so assume they do until measured.

Measured on this app (17 modules, one page load each) — treat these as the bar:

```
/api/doctor-accountability?resource=doctors   2,080 KB   ← biggest in the app
/api/fee-slabs                                1,162 KB
/api/laboratory?resource=tests&limit=2000       928 KB
/api/settings?resource=users                    721 KB   (called by 5 modules)
/api/patients?status=active&limit=500           651 KB
/api/settings                                 called TWICE on all 17 modules
```

You do not need the browser open to do this — `e2e/helpers.js` drives a real
Chromium, and `page.on('requestfinished')` gives every request's size, status and
timing. Read `request.timing()` there, not in the `response` handler: before the
body lands, `responseEnd` is -1 and every duration comes out as 0.

### The audit is one command, and it discovers the module itself

```
node e2e/audit.mjs --deep --module <key> --json e2e/audit-report/<key>.json
node e2e/audit.mjs --deep --write --lighthouse --module <key>    # + write buttons, + Lighthouse
```

**Never add a module's buttons, tabs or filters to a list in `audit.mjs`.** It used
to work that way and the list was always shorter than the module — Appointments'
entry was a search placeholder and four tab names while the module has five tabs,
nine icon-only buttons, five filters and five dialogs. The audit reported "done"
having touched a sixth of it, and nothing failed to say so. A module is now a key,
a URL and a name; `e2e/discover.mjs` reads the live DOM on every run.

Icon-only buttons have no text, no `aria-label` and no `title`, so they are named
from the lucide class on their `<svg>` (`lucide-chevron-left` → "chevron-left").
That is the only reason they can be clicked *or* reported as missed.

**Every run must print, per API call, and never only per action:**
status · method · path · KB · ms · **row count** · query string · request payload.
"3 requests, 900 KB" sends you back to DevTools; the row count is what separates
"2,000 rows, needs pagination" from "one row with a blob in it, needs a `select`".

**Every run must end with the coverage ledger** — `found N · clicked M · skipped-write ·
skipped-destructive · unreachable · NOT CLICKED` — and then **list the unclicked ones
by name**. A run that claims everything passed without naming what it left out is the
failure this replaces. Do not report a module as audited while that list is non-empty;
name them instead.

**Write buttons** (Confirm, Check In, Cancel, Reschedule, bulk actions) are skipped by
default and recorded as `skipped-write`. To cover them, add a fixture under
`e2e/fixtures/` that creates its own throwaway rows, drives the lifecycle, and deletes
everything in a `finally` — including the rows the write cascaded into. Booking one
appointment writes `Appointment`, `Invoice`, `QueueManagement` and usually
`DoctorCommission` in one transaction, so cleanup must cover all four. Never point a
write fixture at real data.

**What the run checks that a code review cannot:** the same URL twice in one action;
two different URLs returning byte-identical bodies (a cache being bypassed); a query
refetched with nothing changed since the last action (a bad `useEffect` dependency
array); responses over 100 KB; calls over 200 ms; 4xx/5xx; `limit=` with three or more
digits (rule 5); a `cursor-pointer` element with no React `onClick` (looks clickable,
does nothing); and — from the profiler — **which components re-rendered by name**, not
just how many commits happened. The app shell re-rendering because a table paged is a
finding; everything rendering on a page load is not.

### Before you open DevTools: read the screen and predict where it breaks

**Do this first, every time, and write it down before running anything.** The tool
tells you what happened; only this tells you what *should* have happened. An audit
that starts with the browser open finds slow calls and misses wrong answers.

For every control on the screen — **every button, every filter, every card, every
popup, every table, every icon, every tab** — answer three questions:

1. **Why does this exist?** Who on the ward reaches for it, and what do they expect
   after clicking? A control nobody can explain is either dead or mislabelled, and
   both are findings.
2. **What are its edge cases?** Zero rows, one row, a million. Null and missing
   fields. A value of `0` (falsy — `||` silently replaces it). A name with an
   apostrophe. A date at the month boundary, and the same date in IST vs UTC. A
   number past the assumed limit. A request that arrives twice. A row whose foreign
   key points at something deleted.
3. **Where will it fail?** Name the failure before you look. Then go and check that
   exact thing. A prediction that turns out wrong teaches you the screen; a
   prediction that turns out right is a bug you found on purpose.

### Wear four hats on every screen. Each one finds what the others walk past.

Run all four before calling a module audited. They are different jobs, and a screen
that survives one routinely falls to the next.

**As a QA engineer — break the input.**
Boundaries first: 0, 1, and one-past-the-limit. Empty string, whitespace-only, a
name with an apostrophe (`O'Brien`), 500 characters where 50 were expected, emoji,
a `<script>` tag, a leading `=` (Excel formula injection in any CSV export).
Negative money. A quantity of `0` — falsy, so `||` silently replaces it. A date of
29 February. Paste instead of type. Double-click every submit. Submit, go back,
submit again. Then check the *stored* row, not the toast: this repo has shipped a
green "Invoice generated" over a `null` return.

**As a UAT tester — walk the department's actual day.**
Not "click every button" but "book the patient, bill them, collect the sample,
print the report" — end to end, in the order the staff do it, with the data they
really have (a patient with no phone, a doctor with no fee configured, a walk-in
with no UHID). Then ask the questions they will ask: is the number on the printout
the number in the system? Does the queue show what the counter just did? If the
same test is ordered from Laboratory, from a consultation, from IPD and from the
billing counter — do all four produce the same row? (`fulfillInvoiceItems` means
they take different paths; rule 11 has the map.) Anything that needs a workaround
to finish is a finding even when nothing errored.

**As a security engineer — assume the client is hostile.**
Every id in a request body belongs to another hospital until proven otherwise: send
one and see. Re-send a `PATCH` with `patientId`, `organizationId`, `id`,
`<doc>Number` added — `.passthrough()` schemas keep whatever you send
(`backend/src/lib/stripIdentity.js` is what stops it, and only where it is called).
Send a price, a total or a status the server should have decided. Read every list
response and ask what is in it that the screen never displays — `passwordHash` and
`invitationToken` were shipping to the browser on Doctor Accountability until a
payload was measured. Replay a request twice and see if it charges twice. Open the
screen as a lower-privileged role and see what is still reachable.

**As an architect — look for what will fail at scale or under concurrency.**
Two users doing this in the same millisecond: is the read-then-write atomic, or
does it fetch, compute in JS and write back? Is every generated number minted by
`nextSeriesNumber` inside the transaction, or by a clock? What happens at 200,000
rows — is that `limit=1000` a cap that hides 97% of the table (rule 5)? Which other
module needs this exact thing, and is the logic in a shared lib or copied (rule 9)?
**And check the constraints, not just the code:** this database has 165 foreign
keys and, until 2026-08-08, *zero* of them pointed at `Patient` — so `onDelete:
Cascade` in the schema did nothing, deleting patients left 381 appointments
pointing at nobody, and every list containing one returned a hard 500. Code that is
correct on top of a schema that is not enforced is not correct.

Then **test it like an enemy**, not like a user following the happy path:
- Give every filter the value it was not designed for — an empty range, a reversed
  range (end before start), a future date, a deleted doctor.
- **Combine filters.** One filter at a time is the easy case and it is not the case
  that breaks. Status + date + doctor + department + a search term, all at once,
  and then remove them one at a time. Filters that each work alone routinely
  contradict each other combined — one narrows server-side while another narrows
  client-side, and the count in the header stops matching the rows in the table.
- Paginate to the last page, *then* narrow the filter. If page 7 no longer exists,
  does the table go blank or snap back? (`useServerPagination` snaps back; anything
  hand-rolled usually does not.)
- Click the same button twice quickly. Submit, then hit back and submit again.
- Open a dialog, change something, press Escape. Did the list behind it lie?
- Ask what the server does with an id you did not send from this screen.

### Validation: check every field, and check where the message appears

A form that accepts wrong input and fails on the server is a bug even when the
server correctly refuses it — the user has already typed everything, pressed Save,
and been given nothing to act on. Audit validation as its own pass, field by field.

**Where the message must appear**
- **Inline, under the field that is wrong**, the moment the user leaves it — not
  only after Save. Red border plus text; colour alone fails anyone colour-blind.
- **Say what to do, not what happened.** "Enter a 10-digit mobile number" beats
  "Invalid phone". Never show a raw server message, a stack trace, or a Zod dump.
- **A toast is for the outcome of an action, not for field errors** — it disappears
  in four seconds and the user cannot read it while fixing three fields. Use a
  dialog only when the whole action is refused for a reason not tied to one field
  ("This doctor is on leave that day", "This slot was just taken").
- **On Save with errors:** block the submit, focus and scroll to the first bad
  field, and keep everything the user typed. Losing a half-filled patient
  registration is the single most expensive UX failure in this app.
- **While saving:** disable the button and show it is working, so a double-click
  cannot create two invoices — the `Invoice.idempotencyKey` exists because that
  already happened.
- **Required fields** carry a visible `*` before the user finds out by pressing Save.

**What to check on every field**
Empty and whitespace-only. Too long (500 chars where 50 was assumed). A `0` where a
number is expected — falsy, so `||` silently substitutes a default. Negative money
and negative quantities. A date before birth, a date in the future, and an end date
before its start. A phone with spaces, `+91`, or ten zeros. An email without a dot.
Two decimal places on money and what happens at three. Paste rather than type
(paste fires no `keydown`, and hand-rolled handlers miss it).

**Then check the server refuses it too.** Client validation is a courtesy; the rule
lives on the server. Call the endpoint directly with the value the form blocked. If
the API accepts what the UI rejected, the UI is the only thing protecting the data
— and a `curl` gets past it. Every price, total and status must be recomputed
server-side regardless of what arrived (rule 3 of the four at the top of this file).

**How to test it:** fill the form wrong on purpose, one field at a time, and record
three things per field — did it block, where did the message appear, and did the
typed data survive. A field that fails any of the three is a finding.

### Auditing a module: this order, nothing skipped

Do ONE module at a time and finish it. A half-audited module is worse than an
un-audited one, because it reads as checked. For each tab, in this order:

1. **Page load** — requests, total KB, slowest call, React commits.
2. **Cards / clickable rows** — click each. Does it open a dialog, navigate, or
   do nothing? Watch the commit count: opening a dialog should not re-render the
   world. A `cursor-pointer` with no handler is a lie the UI tells the user.
3. **Search box** — type at human speed (~60 ms/char), then count. *n characters
   must not produce n requests.* Do NOT pause a second between characters: that
   defeats the debounce you are trying to measure and reports every module as
   broken. Also check whether the search term leaks into a table it has nothing to
   do with.
4. **Every filter, every option** — including the "All" reset. One request each,
   and the query string must actually carry the filter. **Then every combination
   that matters**, per the enemy section above.
5. **Every date control** — today, a past date, a future date, a range whose end is
   before its start, and the half-filled state (start typed, end still empty). Date
   filters are the ones that get skipped; they are also where IST vs UTC turns
   "today" into yesterday after 6:30pm.
6. **Table** — Next, Previous, and the disabled state at both ends. Then every
   row action (view, edit, print). Skip the destructive ones (delete, cancel,
   clear) and say so in the output rather than silently omitting them.
7. **Every icon-only button.** These are the ones that get missed: a bare eye,
   printer, receipt, pencil or download with no text label. They usually have no
   accessible name at all, so name them from the lucide class on their `<svg>`.
   Check the count against what you actually clicked — if the page has 14 icon
   buttons and you clicked 9, the audit is not finished.
8. **Every dialog that opened** — its own tabs, its own fields, its own footer
   buttons. A dialog is a screen; it gets steps 2-7 too.
9. **Then the next tab of the same module** — repeat 2-8. A module is not audited
   until every tab is.

**Finish the module.** A count at the end — "34 controls found, 25 clicked, 8
could not be selected, 1 destructive skipped" — is part of the result. Never
report a module as checked while controls remain unclicked; name them instead.
Do this module by module, and keep the list of which modules are done, at what
depth. Every module gets there eventually; none gets skipped because it looked
boring.

Report it as a table: action · requests · KB · slowest · renders · console error —
**plus every API call individually**: status · method · path · KB · ms · row count ·
query string · payload. Say plainly which controls you skipped and why.

### Then answer three questions the numbers do not answer

A run that ends at "here are the numbers" is half a deliverable. Every module audit
closes with these, in this order:

**1. Where is the time going, and what would remove it?** Not "this is slow" — name
the call, the row count and the fix. A 300 KB response with 1,100 rows wants
pagination or a narrower `select`; a 200 ms response with 2 KB wants an index. Run
the profiler and say **which component** re-rendered, by name: the app shell
repainting because a table paged is a memoisation gap the user pays for on every
click. Run Lighthouse too, and report Performance / Accessibility / Best Practices /
SEO with LCP and TBT — and state plainly whether it was measured on localhost
(optimistic: no latency, no cold start) or against the deployed app.

**2. What would a UX designer change?** Look at the screen as someone who has to
use it for eight hours: how many clicks to the thing they do fifty times a day; what
is unlabelled; what gives no feedback while it loads; what looks clickable and
isn't; what is destructive and un-confirmed; what breaks on a laptop screen. Rank
the suggestions by how many times a day they are hit, not by how hard they are.

**3. What should exist and doesn't?** The gap between what the module does and what
the department actually needs to run — again, ranked by daily use.

### The report is part of the audit, not a favour afterwards

`docs/gudmed-status.html` is the single place every finding lives. **Writing to it is
the last step of every audit, done without being asked.** A finding that exists only
in a chat message is lost the moment the window closes, and then the same bug gets
found again next month at full price.

Every module audit adds, in the same run:
- its own numbered findings table — **every** finding, with what was measured
- the coverage ledger, including the controls that were NOT clicked, by name
- the module's row in the progress table
- its numbers folded into the **performance section**: page load, the slowest calls
  with their size and row count, TBT, and what re-renders on a keystroke
- **what was checked and found fine**, stated as plainly as what was found broken —
  a report that only lists failures cannot be told apart from a report that only
  looked for them
- **retractions.** A finding that turns out to be an artefact of the tool stays in
  the table, struck through, with the reason. Two of Appointments' twenty-four were
  withdrawn that way; hiding them would have made the other twenty-two less
  trustworthy, not more.

### Which modules are done — keep this true

Update this row when you finish a module. "Done" means the coverage ledger came back
with nothing in NOT CLICKED, or with the remainder named here.

| Module | Depth | Date | Left open |
|---|---|---|---|
| Patients | deep (controls, filters, profile tabs) | 2026-08-07 | date filters were missed on the first pass and re-run |
| Appointments | deep + write + Lighthouse | 2026-08-08 | see `e2e/audit-report/appointments.json` |
| Laboratory | partial — refactor + print path only | 2026-08-06 | never control-walked |
| Doctor Acct | payload only (3.2 MB → 552 KB) | 2026-08-08 | never control-walked |
| Billing | **none** | — | highest priority: money passes through it |
| Pharmacy · Radiology · Queue · OPD · IPD · Pre-Triage · Day Care · Ambulance · Insurance · Death Certs · Settings · Dashboard | **none** | — | |

### Also check: is the module actually code-split?

Each module should arrive as its own chunk, so opening Laboratory does not
download Radiology. Check `npm run build` output for a per-page chunk
(`LaboratoryPage-*.js`), and confirm the route is behind `React.lazy` +
`<Suspense>` in `src/App.jsx`. A module that is statically imported lands in the
main bundle and every user pays for it whether they open it or not.

Within a module, the same applies to anything heavy that only one tab needs — a
print template, a chart library, a barcode scanner. If it is imported at the top
of the module file, all five tabs carry it.

## 11. Every module gets documented — features, wiring, and annotated screenshots

The manual is a deliverable, not an afterthought. A module is not finished until
someone who has never seen it can be handed the doc and run the department.

**The screenshot tool already exists — do not hand-draw arrows in Paint.**
`e2e/annotate.mjs` opens the real page, draws numbered callouts and arrows
anchored to live selectors, and captures it into `e2e/shots/`. Because the
callouts are anchored to selectors rather than pixels, re-running it after a UI
change regenerates every figure correctly instead of leaving the manual showing
last month's screen. Copy the `annotate(page, marks)` helper's shape; do not
write a second one.

Coverage today: Queue, Display boards, Settings/Rooms (29 figures). **Laboratory,
Billing, Pharmacy, Appointments, OPD, Radiology and IPD have none.**

For each module, the doc must carry:

1. **What the module is for**, in one paragraph, in the words the staff use.
2. **Every tab**, and every control on it — search, each filter, each table
   action, each button — with a numbered callout on the screenshot.
3. **Each function's effect**: what row it writes, what number it mints, what
   other module finds out about it.
4. **What it needs before it works** (a patient, a priced catalogue, a user with
   a role).
5. **What breaks it**, and what the user sees when it does.

### The module map — keep this true

Measured from the code, not remembered. Re-derive it when wiring changes.

**Frontend — which module imports another module's code**
```
laboratory  ─┐
radiology   ─┼──→ billing        (createInvoiceWithPayment, printLabReceipt)
pharmacy    ─┘
appointments ──→ patients
queue        ──→ appointments, billing
```

**Backend — which controller writes another domain's tables**
```
billing       →  invoice · payment · labOrder · radiologyOrder · pharmacySale
                 (fulfillInvoiceItems: billing a test RAISES the lab order and
                  draws down pharmacy stock, inside the invoice transaction)
consultation  →  consultation · appointment · labOrder · labResult · radiologyOrder
appointment   →  appointment · invoice · queueManagement
                 (booking mints the OPD voucher AND the queue entry)
inpatient     →  admission · ipdCharge · labOrder · radiologyOrder
queue         →  queueManagement · appointment
laboratory    →  labOrder · labResult · labTest        (own domain only)
radiology     →  radiologyOrder · radiologyExam        (own domain only)
```

**Billing is the hub.** A lab test can be ordered from Laboratory, from a
consultation, from IPD, or by billing it at the counter — and each path writes a
different set of rows. Before changing anything in an order flow, check all four.

## 12. Bugs this repo has already paid for — never ship them twice

Each line below reached a real hospital screen once. They are grouped by the rule
that now prevents them; if you are about to break that rule, this is what it costs.

**Cross-tenant leaks — rule 4**
- One hospital's users could open another hospital's patients: name, phone, lab
  and radiology orders. Guarded by `isOwned()` / `organizationId` in every `where`.
- Patient portal login matched a duplicate identifier and could open the wrong
  patient's record. Now every candidate's password is checked and an ambiguous
  match is refused, not guessed.
- A radiology order's `patientId` could be rewritten by a `PATCH`, moving one
  patient's scan onto another. `.passthrough()` schemas must strip
  `organizationId, id, patientId, <doc>Number, requestedById` — Laboratory does;
  **Radiology still does not** (open item).

**Colliding document numbers — rule 3**
- Day-Care and Death Certificate shared one number series.
- Ambulance, Insurance and Day-Care could mint duplicate document numbers.
- Two lab/radiology orders created in the same moment collided and the order
  failed outright.
- The lab accession number was `Math.random()` over 10,000 values against a
  `@@unique` column — and was generated twice per collection, so the number on
  the tube was never the number in the record.
- Every one of these is now `nextSeriesNumber` inside the write's `$transaction`.

**Money that did not add up**
- A double-click created a second invoice for the same visit and the patient
  could be charged twice → `Invoice.idempotencyKey`.
- A ₹1,000 bill with ₹100 received was marked **Fully Paid**.
- A cancelled bill still showed an active **Pay** button.
- Cancelled pharmacy bills were still counted as revenue in profit reports.
- The billing counter multiplied whatever `unitPrice` the request contained →
  `lib/catalogPrice.js` prices every catalogue line server-side.

**Stock and fulfilment**
- Medicine was issued after physical stock ran out (negative stock).
- A cancelled bill did not return its medicines to stock, so the ledger and the
  shelf disagreed → `reverseInvoiceFulfillment`.

**Lists that silently hid rows — rule 5**
- 99.99% of patients could not be searched, so a death certificate could not be
  raised at all.
- 95% of booked doctor slots displayed as **Free**, inviting double booking.
- 2,000+ appointments were missing from the management dashboard count.
- Cancelled appointments reappeared on the Queue and the TV display board.

**Speed, measured before and after**
```
Patient search      0.47 s   →  0.010 s   (47× — GIN trigram on all 5 searched fields)
Appointment search  20 s+ timeout → 1.6 s
Lab order search    0.87 s
Billing search      0.68 s
/api/settings?resource=users   1,698 KB → 312 KB   (explicit select; 5 modules + Register)
/api/settings                  2 calls → 1 call    (all 17 modules; App.jsx now shares the cache)
```

When you touch one of these areas, re-run the check that caught it the first
time — `backend/scripts/bug-hunt.mjs`, `bug-hunt-api.mjs`, or
`node e2e/audit.mjs --deep`.

## 13. Before adding to a module, read that module's open findings

`docs/findings.json` holds every measured finding, tagged with the one module it
belongs to. **Read the entries for the module you are about to touch, and do not
reintroduce what is already recorded there.** A new feature that repeats the
module's existing defect doubles the fix, and the second copy is the one that gets
missed.

```
node -e "const d=require('./docs/findings.json');
  for (const f of d.findings.filter(x => x.module === 'billing'))
    console.log(f.severity.padEnd(8), f.title)"
```

The report is generated, never hand-edited:

```
node docs/harvest-findings.mjs     # pull findings out of the run logs
node docs/missing-check.mjs        # what the run found and the report has not recorded
node docs/build-module-pages.mjs   # regenerate docs/modules/*.html
node docs/verify-report.mjs        # every finding reaches its page — must print 0 mismatches
```

`verify-report.mjs` compares identifiers, not prose. Two earlier versions matched on
words picked out of a finding's sentences and both cried wolf; a checker that raises
false alarms teaches you to skim it, which is the habit it exists to break.

### The seven traps that keep recurring — check each one before you write

Every one of these was measured in this repo, most of them in several modules at
once. They are cheap to avoid while writing and expensive to find afterwards.

| Trap | What it looks like | What to do instead |
|---|---|---|
| **A cap posing as pagination** | `limit=1000` returning 536 KB; `limit=2000` returning 950 KB | Filter server-side (`?role=doctor`), or paginate. A filter narrows correctly; a cap hides rows silently |
| **One request per row** | Weekly view fires seven `limit=50` calls, ~380 KB, to draw one week | One request for the range. `calendar-counts` already returns a month in 2 KB |
| **The same URL twice in one action** | Queue, Settings; `?resource=users` pulled by five modules | Lift it into one hook with a module-level cache, the way `src/lib/orgSettings.js` does |
| **Refetching with nothing changed** | Five modules flagged it — a `useEffect` whose dependency array is wider than the query | Depend on exactly the values the request is built from |
| **The app shell repainting** | Up to 286 `NavLink` renders for one click, in every module | Memoise what you hand down. A fresh object or element each render defeats `memo` on the child |
| **`0` is falsy** | A free follow-up is `fee: 0`; `fee \|\| base` silently charges the base | `??`, never `\|\|`, for money, quantities and counts |
| **A toast is not evidence** | A green "Invoice generated" over a `null` return | Check the stored row. `backend/scripts/create-probe.mjs` counts before and after |

### Adding a feature that another module already has

Search for it first (rule 1), then reuse it — and reuse the whole path, not the
shape of it. Booking an appointment is the worked example:

`POST /appointments` writes **four** tables in one transaction — `appointment`,
`queueManagement`, `invoice` (number from `nextSeriesNumber`) and
`doctorCommission`. A second module that "also books an appointment" by writing its
own invoice produces **two bills** and no queue entry and no commission. Call the
endpoint that owns the behaviour and let the cascade do its work.

The server also refuses a client-supplied `consultationFee` and resolves the fee
from the doctor's slab itself (`appointmentController.js:401`) — so a caller cannot
send its own price, and should not try.

## Commits

Commit as the repo owner only — no `Co-Authored-By` trailer.
