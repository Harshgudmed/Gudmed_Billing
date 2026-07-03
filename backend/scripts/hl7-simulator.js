// HL7 Analyzer Simulator — pretend to be a real lab machine (Cobas/Sysmex/…)
// so you can test the whole result pipeline WITHOUT any hardware.
//
// It opens a TCP connection to your MLLP listener, sends a properly MLLP-framed
// ORU^R01 result message, and prints the ACK the server sends back.
//
// ── HOW TO USE ────────────────────────────────────────────────────────────────
//  1. Start the backend with listeners on:   ENABLE_HL7_LISTENERS=true npm run dev
//  2. Create a MachineIntegration (connectionDetails {"port":6661}) + a LabOrder.
//  3. Run this with the order's accession number:
//
//     node scripts/hl7-simulator.js --port 6661 --accession ACC456 --mrn MRN12345
//
//  Then open the Laboratory → Results screen — the result should appear as
//  "in progress", waiting for the pathologist to verify.
//
//  Flags:
//   --host       default 127.0.0.1
//   --port       default 6661
//   --accession  OBR-3  → matched against LabOrder.accessionNumber  (recommended)
//   --order      OBR-2  → matched against LabOrder.orderNumber       (fallback)
//   --mrn        PID-3  patient identifier (informational)
//   --critical   send a critically-low Hemoglobin (flag LL) to test critical path
//   --file       send a raw .hl7 file instead of the built-in sample

import net from 'node:net'
import fs from 'node:fs'

const VT = String.fromCharCode(0x0b) // MLLP start block
const FS = String.fromCharCode(0x1c) // MLLP end block
const CR = String.fromCharCode(0x0d)

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return def
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}

function buildSample({ accession, order, mrn, critical }) {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const hgb = critical
    ? 'OBX|1|NM|718-7^Hemoglobin^LN||4.1|g/dL|13.0-17.0|LL|||F'   // critical low
    : 'OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.0-17.0|N|||F'   // normal
  return [
    `MSH|^~\\&|SIMULATOR|LAB|HMS|HOSP|${ts}||ORU^R01|SIM${Date.now()}|P|2.3.1`,
    `PID|1||${mrn}^^^HOSP^MR||DOE^JOHN||19800101|M`,
    `OBR|1|${order}|${accession}|CBC^Complete Blood Count^L|||${ts}`,
    hgb,
    'OBX|2|NM|789-8^RBC^LN||4.8|10*6/uL|4.5-5.9|N|||F',
    'OBX|3|NM|6690-2^WBC^LN||7.5|10*3/uL|4.0-11.0|N|||F',
  ].join('\r')
}

const host = arg('host', '127.0.0.1')
const port = parseInt(arg('port', '6661'), 10)
const file = arg('file', null)

const message = file
  ? fs.readFileSync(file, 'utf8').replace(/\r\n|\n/g, '\r').trim()
  : buildSample({
      accession: arg('accession', 'ACC456'),
      order: arg('order', 'ORD789'),
      mrn: arg('mrn', 'MRN12345'),
      critical: arg('critical', false) === true,
    })

console.log(`\n→ Connecting to MLLP ${host}:${port} …`)
console.log('→ Sending message:\n' + message.replace(/\r/g, '\n') + '\n')

const sock = net.createConnection({ host, port }, () => {
  sock.write(VT + message + FS + CR)
})

let buf = ''
sock.on('data', (d) => {
  buf += d.toString()
  if (buf.includes(FS)) {
    const ack = buf.replace(new RegExp(`[${VT}${FS}${CR}]`, 'g'), '\n').trim()
    const accepted = /MSA\|AA/.test(buf)
    console.log(`← ACK received (${accepted ? 'ACCEPTED ✅' : 'check status ⚠️'}):\n${ack}\n`)
    sock.end()
    process.exit(accepted ? 0 : 1)
  }
})
sock.on('error', (e) => {
  console.error(`✖ Connection failed: ${e.message}`)
  console.error('  Is the backend running with ENABLE_HL7_LISTENERS=true and a MachineIntegration on this port?')
  process.exit(1)
})
setTimeout(() => { console.error('✖ Timed out waiting for ACK'); process.exit(1) }, 5000)
