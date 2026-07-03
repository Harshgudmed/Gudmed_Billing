import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { startListener, stopListener } from '../hl7Listener.js'
import { parseOru } from '../hl7Parser.js'

const PORT = 16661
const MI = { id: 'mi-test', organizationId: 'org-demo', machineName: 'TestAnalyzer', connectionDetails: '{}' }

const ORU = [
  'MSH|^~\\&|SYSMEX|LAB|HMS|HOSP|20260630120000||ORU^R01|MSGX|P|2.3.1',
  'PID|1||MRN999^^^HOSP^MR||SMITH^JANE||19900202|F',
  'OBR|1|ORD111|ACC222|CBC^Complete Blood Count^L',
  'OBX|1|NM|718-7^Hemoglobin^LN||14.5|g/dL|13.0-17.0|N|||F',
].join('\r')

// MLLP frame: <VT> message <FS><CR>
const VT = String.fromCharCode(0x0b)
const FS = String.fromCharCode(0x1c)
const CR = String.fromCharCode(0x0d)

test('MLLP listener receives message over TCP and returns an ACK', async () => {
  let captured = null
  const onMessage = ({ organizationId, machineIntegrationId, raw }) => {
    captured = { organizationId, machineIntegrationId, raw }
    return Promise.resolve()
  }

  startListener(MI, { port: PORT, onMessage })

  // give the server a tick to bind
  await new Promise((r) => setTimeout(r, 150))

  const ack = await new Promise((resolve, reject) => {
    const sock = net.createConnection({ port: PORT, host: '127.0.0.1' }, () => {
      sock.write(VT + ORU + FS + CR)
    })
    let buf = ''
    sock.on('data', (d) => {
      buf += d.toString()
      if (buf.includes(FS)) { sock.end(); resolve(buf) }
    })
    sock.on('error', reject)
    setTimeout(() => reject(new Error('timed out waiting for ACK')), 3000)
  })

  // 1) handler was invoked with our integration's identity
  assert.ok(captured, 'handler should have been called')
  assert.equal(captured.organizationId, 'org-demo')
  assert.equal(captured.machineIntegrationId, 'mi-test')

  // 2) the raw the handler got parses back to the right result
  const parsed = parseOru(captured.raw)
  assert.equal(parsed.patientIdentifier, 'MRN999')
  assert.equal(parsed.fillerOrderNumber, 'ACC222')
  assert.equal(parsed.results[0].value, '14.5')

  // 3) analyzer received an HL7 ACK (MSA segment, accept code AA)
  assert.match(ack, /MSA\|AA/)

  stopListener(MI.id)
})
