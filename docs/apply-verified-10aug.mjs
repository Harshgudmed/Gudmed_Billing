// Fold the 10 August verification run back into findings.json.
//
//   node docs/apply-verified-10aug.mjs && node docs/build-module-pages.mjs
//
// WHY THIS EXISTS
// A list of Billing optimisation issues was checked one by one against the running
// app (e2e/verify-billing-claims.mjs). Three were confirmed, one turned out to be
// already fixed, and one of MY OWN verdicts from that run was wrong and has to be
// walked back. All four outcomes belong in the report — a report that records only
// what it got right cannot be told apart from one that never checked.
//
// Nothing is deleted. A finding that turns out to be wrong keeps its row, struck
// through, with the reason; that is what makes the rows next to it trustworthy.
import { readFileSync, writeFileSync } from 'node:fs'

const PATH = new URL('./findings.json', import.meta.url)
const doc = JSON.parse(readFileSync(PATH, 'utf8'))
const byId = (id) => doc.findings.find((f) => f.id === id)

const NEW = [
  {
    module: 'billing',
    id: 'BI8',
    severity: 'high',
    rule: 5,
    kind: 'limit-cap',
    title: 'The New Invoice catalogues are capped at 500 rows — 1,079 KB, and the rest is invisible',
    detail:
      'Choosing a department on the New Invoice tab pulls that catalogue with <code>limit=500</code>: ' +
      '<code>/laboratory?resource=tests</code> <strong>287.3&nbsp;KB / 500 rows</strong>, ' +
      '<code>/radiology?resource=exams</code> <strong>196.8&nbsp;KB / 500 rows</strong>, ' +
      '<code>/pharmacy/drugs</code> <strong>595.0&nbsp;KB / 500 rows</strong> — <strong>1,079&nbsp;KB</strong> across the three. ' +
      'The pharmacy catalogue is roughly 200,000 rows, so a cashier can reach 0.25% of it and the ' +
      'other 99.75% reports as "no results" for drugs that exist. This is rule 5: a cap is not ' +
      'pagination, and rows past it vanish with no message.<br><br>' +
      'One correction to how this was first described: the three do <strong>not</strong> load together when the ' +
      'tab opens. Each fires only when its department is selected, so a single bill costs one of ' +
      'the three, not all 1,079&nbsp;KB. The cap is the defect; the bundling was not real.',
    proof:
      'measured 10 August, e2e/verify-billing-claims.mjs — laboratory 287.3 KB/500 rows, ' +
      'radiology 196.8 KB/500 rows, pharmacy 595.0 KB/500 rows; the New Invoice tab itself fired 0 catalogue calls',
  },
  {
    module: 'billing',
    id: 'BI9',
    severity: 'high',
    kind: 'wasted-refetch',
    title: 'Every keystroke, filter and clear fires four requests where one is needed',
    detail:
      'Three actions were measured and all three behave the same way. Typing <code>INV</code> into the ' +
      'invoice search fired <strong>four</strong> requests and only one carried the search term; the other three — ' +
      '<code>?resource=services</code>, <code>?resource=stats</code> and <code>/insurance</code> — re-read data no ' +
      'user input had touched. Clearing the search: four again. Changing the status filter: four again.<br><br>' +
      'The cause is one effect at <code>BillingModule.jsx:622-629</code>. <code>fetchAll</code> bundles four ' +
      'fetchers, and <code>fetchBills</code> closes over page, search, status, type and date — so its identity ' +
      'changes on every interaction, which changes <code>fetchAll</code>, which re-runs the effect, which calls ' +
      'all four. The other three depend on none of it.<br><br>' +
      'This is the measured, per-request form of the vaguer "queries refetch when nothing has changed" ' +
      'already recorded against this module.',
    proof:
      'measured 10 August, e2e/verify-billing-claims.mjs — search "INV": 4 requests, 1 carried search=; ' +
      'clear: 4 requests, 1 useful; status filter: 4 requests, 1 carried status=paid',
  },
  {
    module: 'billing',
    id: 'BI10',
    severity: 'low',
    kind: 'unverified',
    ok: true,
    title: 'Not proved either way — whether paging fires the same four requests',
    detail:
      'The run reported "Next fired 0 requests" and an earlier draft of this page read that as the ' +
      'paging control being clean. It was not measured at all: the status filter applied a step earlier ' +
      'had narrowed the list to a single row, so <strong>Next was disabled and never clicked</strong>. Zero ' +
      'requests from a control that was never pressed is a broken test, not a passing one.<br><br>' +
      'Given the cause recorded in BI9 lives in a shared effect and <code>fetchBills</code> closes over ' +
      '<code>invoicesPage</code>, paging almost certainly fires the same four — but "almost certainly" is not ' +
      'a measurement, and this row stays open until one exists.',
    proof: 'not measured — the Next button was disabled when the run reached it',
  },
  {
    module: 'billing',
    id: 'BI11',
    severity: 'low',
    fixed: true,
    ok: true,
    kind: 'out-of-date',
    title: 'No longer true — Billing books a real consultation, not a ₹500 line',
    detail:
      'An outstanding item said a consultation raised from the Billing counter used a fixed ₹500 OPD ' +
      'fee with no department, doctor, slot or fee mapping. Re-checked against the running app: choosing ' +
      '<em>OPD / Consultation</em> no longer adds a cart line at all. Its handler returns early and opens the ' +
      'real booking dialog (<code>BillingModule.jsx:1369</code>), which carries the department picker and the ' +
      'doctor\'s slots, and the fee is resolved server-side from that doctor\'s slab.<br><br>' +
      'Fixed in commit <code>d8d6c58</code>. Recorded here because the item was still circulating as open.',
    proof:
      'measured 10 August — clicking the Consultation radio does not select it (the early return runs) ' +
      'and the booking dialog opens with a department picker and slot/timing fields',
  },
]

for (const f of NEW) {
  const at = doc.findings.findIndex((x) => x.id === f.id)
  if (at >= 0) doc.findings[at] = f
  else doc.findings.push(f)
}

// The pre-existing vague entry now has a measured sibling; point one at the other
// so a reader does not treat them as two separate problems to fix twice.
const vague = doc.findings.find(
  (f) => f.module === 'billing' && f.title.startsWith('Queries refetch when nothing'),
)
if (vague && !/BI9/.test(vague.detail)) {
  vague.detail += ' <br><br><strong>Measured 10 August:</strong> the specific case, with counts per request, is BI9 below — same cause, one effect at <code>BillingModule.jsx:622</code>.'
}

writeFileSync(PATH, JSON.stringify(doc, null, 2) + '\n')
console.log(`  findings.json: ${doc.findings.length}`)
for (const f of NEW) console.log(`  ${f.id.padEnd(5)} ${f.fixed ? 'FIXED   ' : f.ok ? 'NOTED   ' : f.severity.toUpperCase().padEnd(8)} ${f.title}`)
