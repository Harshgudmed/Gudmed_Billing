// HL7 Direct Injector — test the DATABASE side of the pipeline without TCP or a
// machine. It pushes a raw HL7 message straight into the queue + processor
// against your real Postgres, so you can confirm: does it match my LabOrder and
// write the LabResult rows correctly?
//
// ── HOW TO USE ────────────────────────────────────────────────────────────────
//  1. In the Laboratory screen, create a lab order for a patient. Note its
//     accession number (or order number).
//  2. Make sure a MachineIntegration exists with a testMapping that maps the
//     analyzer codes below to your LabTest ids, e.g.
//        testMapping = {"718-7":"<HemoglobinLabTestId>","789-8":"...","6690-2":"..."}
//  3. Run:  node scripts/hl7-inject.js --accession ACC456 --machine <machineIntegrationId>
//  4. Re-open the order — results should be there as "in progress".
//
//  Flags: --accession, --order, --mrn, --machine (MachineIntegration id), --critical

import 'dotenv/config'
import { db } from '../src/config/db.js'
import { enqueueRawMessage, processQueueItem } from '../src/integration/queueProcessor.js'

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return def
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}

async function main() {
  const accession = arg('accession', 'ACC456')
  const order = arg('order', 'ORD789')
  const mrn = arg('mrn', 'MRN12345')
  const critical = arg('critical', false) === true
  let machineId = arg('machine', null)

  // If no machine id given, grab/create one so the script is runnable standalone.
  if (!machineId) {
    const existing = await db.machineIntegration.findFirst({ where: { connectionType: 'hl7' } })
    if (existing) {
      machineId = existing.id
      console.log(`Using existing MachineIntegration: ${existing.machineName} (${machineId})`)
    } else {
      console.error('✖ No MachineIntegration found. Pass --machine <id> or create one first.')
      process.exit(1)
    }
  }
  const mi = await db.machineIntegration.findUnique({ where: { id: machineId } })
  if (!mi) { console.error(`✖ MachineIntegration ${machineId} not found`); process.exit(1) }

  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const hgb = critical
    ? 'OBX|1|NM|718-7^Hemoglobin^LN||4.1|g/dL|13.0-17.0|LL|||F'
    : 'OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.0-17.0|N|||F'
  const raw = [
    `MSH|^~\\&|SIMULATOR|LAB|HMS|HOSP|${ts}||ORU^R01|SIM${Date.now()}|P|2.3.1`,
    `PID|1||${mrn}^^^HOSP^MR||DOE^JOHN||19800101|M`,
    `OBR|1|${order}|${accession}|CBC^Complete Blood Count^L|||${ts}`,
    hgb,
    'OBX|2|NM|789-8^RBC^LN||4.8|10*6/uL|4.5-5.9|N|||F',
    'OBX|3|NM|6690-2^WBC^LN||7.5|10*3/uL|4.0-11.0|N|||F',
  ].join('\r')

  console.log(`\nInjecting result for accession=${accession} via machine=${mi.machineName}…`)
  const item = await enqueueRawMessage({ organizationId: mi.organizationId, machineIntegrationId: mi.id, raw })
  const result = await processQueueItem(item.id)

  console.log('\n── Result ──────────────────────────────')
  console.log(JSON.stringify(result, null, 2))
  if (result.status === 'imported') {
    console.log('\n✅ SUCCESS — results written. Open the order in the Lab screen to verify.')
  } else if (result.status === 'manual_review') {
    console.log('\n⚠️  manual_review — order matched but some codes unmapped, OR no matching order.')
    console.log('    Check: does a LabOrder exist with this accession/order number in this org?')
    console.log('    Check: does MachineIntegration.testMapping map 718-7/789-8/6690-2 to LabTest ids?')
  } else {
    console.log('\n✖ Status:', result.status)
  }
  await db.$disconnect()
  process.exit(0)
}

main().catch(async (e) => {
  console.error('✖ Error:', e.message)
  try { await db.$disconnect() } catch {}
  process.exit(1)
})
