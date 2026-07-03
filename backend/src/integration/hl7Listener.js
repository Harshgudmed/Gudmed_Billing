// MLLP (Minimal Lower Layer Protocol) TCP listener — the network endpoint an
// analyzer connects to and streams HL7 ORU messages into. simple-hl7's tcp()
// server handles MLLP framing AND sends the HL7 ACK back automatically when we
// call res.end().
//
// One listener = one MachineIntegration row (each analyzer gets its own port,
// configured in MachineIntegration.connectionDetails JSON: { "port": 6661 }).
//
// onMessage is injected so the whole TCP→parse→handle→ACK path can be tested
// without a database (see __tests__).

import hl7 from 'simple-hl7'
import { db } from '../config/db.js'
import { enqueueRawMessage, processQueueItem } from './queueProcessor.js'

const servers = new Map() // machineIntegrationId -> { server, port }

/** Default production handler: persist to queue, then process immediately. */
async function defaultHandler({ organizationId, machineIntegrationId, raw }) {
  const item = await enqueueRawMessage({ organizationId, machineIntegrationId, raw })
  // Process out-of-band so a slow DB write never blocks the analyzer's ACK.
  processQueueItem(item.id).catch((e) =>
    console.error(`[HL7] processQueueItem ${item.id} failed:`, e.message)
  )
  return item
}

/**
 * Start one MLLP server for a MachineIntegration.
 * @param {{id:string, organizationId:string, machineName:string, connectionDetails:string}} mi
 * @param {object} [opts]
 * @param {number} [opts.port]        override port (else read from connectionDetails)
 * @param {Function} [opts.onMessage] override handler (for tests)
 * @returns {{port:number, stop:Function}}
 */
export function startListener(mi, opts = {}) {
  let port = opts.port
  if (!port) {
    try {
      port = JSON.parse(mi.connectionDetails || '{}').port
    } catch {
      port = undefined
    }
  }
  if (!port) throw new Error(`MachineIntegration ${mi.id} has no port configured`)

  const handler = opts.onMessage || defaultHandler
  const app = hl7.tcp()

  app.use((req, res, next) => {
    const raw = req.msg?.log ? req.msg.log() : String(req.msg)
    Promise.resolve(handler({ organizationId: mi.organizationId, machineIntegrationId: mi.id, raw }))
      .then(() => res.end()) // res.end() => sends positive HL7 ACK (AA)
      .catch((err) => {
        console.error(`[HL7:${mi.machineName}] handler error:`, err.message)
        try { res.end() } catch { /* socket may be gone */ }
      })
    if (typeof next === 'function') next()
  })

  app.start(port)
  servers.set(mi.id, { server: app, port })
  console.log(`[HL7] Listening for ${mi.machineName} on MLLP port ${port}`)
  return { port, stop: () => stopListener(mi.id) }
}

export function stopListener(machineIntegrationId) {
  const entry = servers.get(machineIntegrationId)
  if (!entry) return
  try {
    entry.server.stop() // simple-hl7 tcp() app → TcpServer.stop() → net.Server.close()
  } catch { /* ignore */ }
  servers.delete(machineIntegrationId)
}

/** Boot listeners for all active HL7 lab-analyzer integrations. Non-fatal. */
export async function startAllListeners() {
  let integrations = []
  try {
    integrations = await db.machineIntegration.findMany({
      where: { isActive: true, connectionType: 'hl7' },
    })
  } catch (e) {
    console.warn('[HL7] Could not load machine integrations:', e.message)
    return []
  }
  const started = []
  for (const mi of integrations) {
    try {
      const { port } = startListener(mi)
      started.push({ id: mi.id, name: mi.machineName, port })
    } catch (e) {
      console.warn(`[HL7] Skipped ${mi.machineName}:`, e.message)
    }
  }
  return started
}

export function stopAllListeners() {
  for (const id of [...servers.keys()]) stopListener(id)
}
