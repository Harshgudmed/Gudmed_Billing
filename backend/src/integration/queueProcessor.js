// Lab analyzer result pipeline — the "glue" between a parsed HL7 message and
// your existing LabOrder / LabResult / MachineResultsQueue tables.
//
// Flow (matches your manual lab flow, just automated up to verification):
//
//   raw HL7  ──enqueueRawMessage──▶  MachineResultsQueue (status: pending)
//                                         │
//                                processQueueItem
//                                         │  parse → match order by accession
//                                         │  map analyzer codes → LabTest via
//                                         │  MachineIntegration.testMapping
//                                         ▼
//   LabResult rows created  +  LabOrder.status = "in_progress"
//   (resultsEnteredAt set; verification stays MANUAL — your pathologist screen)
//
// Queue end-states (your QueueStatus enum):
//   imported       → all results mapped & written
//   manual_review  → no matching order, OR some analyzer codes unmapped
//   failed         → parse/processing error

import { db } from '../config/db.js'
import { parseOru } from './hl7Parser.js'

/** Build LabResult create-rows from a parsed message. PURE (no DB) → testable.
 *  @returns {{ rows: object[], unmapped: string[] }} */
export function mapResultsToRows(parsed, testMapping, { organizationId, orderId, instrument }) {
  const map = testMapping || {}
  const rows = []
  const unmapped = []
  for (const r of parsed.results) {
    const testId = map[r.code]
    if (!testId) {
      unmapped.push(r.code)
      continue
    }
    rows.push({
      organizationId,
      orderId,
      testId,
      resultValue: r.value ?? '',
      resultUnit: r.unit ?? null,
      isAbnormal: r.isAbnormal,
      isCritical: r.isCritical,
      flag: r.flag,
      referenceRangeMin: r.referenceRange.min,
      referenceRangeMax: r.referenceRange.max,
      referenceRangeText: r.referenceRange.text,
      instrumentUsed: instrument || null,
      enteredById: null, // machine-entered (no human)
      technicianNotes: 'Auto-imported via HL7 interface',
    })
  }
  return { rows, unmapped }
}

/** Store an incoming raw HL7 message as a pending queue row. */
export async function enqueueRawMessage({ organizationId, machineIntegrationId, raw }) {
  return db.machineResultsQueue.create({
    data: {
      organizationId,
      machineIntegrationId,
      rawData: String(raw),
      status: 'pending',
      receivedAt: new Date(),
    },
  })
}

async function writeLog(machineIntegrationId, organizationId, { logType, message, details, imported = 0, failed = 0 }) {
  try {
    await db.integrationLog.create({
      data: {
        organizationId: organizationId || null,
        machineIntegrationId: machineIntegrationId || null,
        logType,
        message,
        details: details ? JSON.stringify(details) : null,
        resultsImported: imported,
        resultsFailed: failed,
      },
    })
  } catch {
    /* logging must never break the pipeline */
  }
}

/**
 * Process ONE queue row: parse, match order, write results, advance statuses.
 * Idempotent on results: a test that already has a result on the order is
 * skipped (never overwrites a value the lab may have already verified).
 *
 * @returns {{status: string, imported: number, skipped: number, unmapped: string[]}}
 */
export async function processQueueItem(queueId) {
  const item = await db.machineResultsQueue.findUnique({
    where: { id: queueId },
    include: { machineIntegration: true },
  })
  if (!item) throw new Error(`Queue item ${queueId} not found`)

  const mi = item.machineIntegration
  const organizationId = item.organizationId

  try {
    const parsed = parseOru(item.rawData)

    // testMapping is stored as JSON text: { "<analyzer code>": "<LabTest.id>" }
    let testMapping = {}
    try {
      testMapping = JSON.parse(mi?.testMapping || '{}')
    } catch {
      testMapping = {}
    }

    // ── 1. Match the LabOrder: accession (OBR-3) first, then orderNumber (OBR-2)
    let order = null
    if (parsed.fillerOrderNumber) {
      order = await db.labOrder.findFirst({
        where: { organizationId, accessionNumber: parsed.fillerOrderNumber },
      })
    }
    if (!order && parsed.placerOrderNumber) {
      order = await db.labOrder.findFirst({
        where: { organizationId, orderNumber: parsed.placerOrderNumber },
      })
    }

    if (!order) {
      await db.machineResultsQueue.update({
        where: { id: queueId },
        data: {
          status: 'manual_review',
          parsedData: JSON.stringify(parsed),
          patientIdentifier: parsed.patientIdentifier,
          testResults: JSON.stringify(parsed.results),
          errorMessage: `No matching lab order (accession=${parsed.fillerOrderNumber || '-'}, order=${parsed.placerOrderNumber || '-'})`,
          processedAt: new Date(),
        },
      })
      await writeLog(mi?.id, organizationId, {
        logType: 'result_import',
        message: 'Result received but no matching order — sent to manual review',
        details: { accession: parsed.fillerOrderNumber, patient: parsed.patientIdentifier },
        failed: parsed.results.length,
      })
      return { status: 'manual_review', imported: 0, skipped: 0, unmapped: [] }
    }

    // ── 2. Map analyzer codes → LabTest ids
    const { rows, unmapped } = mapResultsToRows(parsed, testMapping, {
      organizationId,
      orderId: order.id,
      instrument: mi?.machineName,
    })

    // ── 3. Skip tests that already have a result on this order (no overwrite)
    const existing = await db.labResult.findMany({
      where: { orderId: order.id },
      select: { testId: true },
    })
    const existingTestIds = new Set(existing.map((e) => e.testId))
    const toCreate = rows.filter((r) => !existingTestIds.has(r.testId))
    const skipped = rows.length - toCreate.length

    // ── 4. Write results + advance order, atomically
    await db.$transaction([
      ...toCreate.map((data) => db.labResult.create({ data })),
      db.labOrder.update({
        where: { id: order.id },
        data: {
          status: 'in_progress', // results in; verification is manual (pathologist)
          resultsEnteredAt: new Date(),
        },
      }),
    ])

    const finalStatus = unmapped.length > 0 ? 'manual_review' : 'imported'

    await db.machineResultsQueue.update({
      where: { id: queueId },
      data: {
        status: finalStatus,
        matchedPatientId: order.patientId,
        patientIdentifier: parsed.patientIdentifier,
        parsedData: JSON.stringify(parsed),
        testResults: JSON.stringify(parsed.results),
        errorMessage: unmapped.length ? `Unmapped analyzer codes: ${unmapped.join(', ')}` : null,
        processedAt: new Date(),
      },
    })

    if (mi?.id) {
      await db.machineIntegration.update({
        where: { id: mi.id },
        data: { lastResultReceivedAt: new Date(), connectionStatus: 'connected' },
      })
    }

    await writeLog(mi?.id, organizationId, {
      logType: 'result_import',
      message: `Imported ${toCreate.length} result(s) for order ${order.orderNumber}` +
        (skipped ? `, skipped ${skipped} existing` : '') +
        (unmapped.length ? `, ${unmapped.length} unmapped` : ''),
      details: { orderId: order.id, unmapped },
      imported: toCreate.length,
      failed: unmapped.length,
    })

    return { status: finalStatus, imported: toCreate.length, skipped, unmapped }
  } catch (err) {
    await db.machineResultsQueue.update({
      where: { id: queueId },
      data: { status: 'failed', errorMessage: err.message, processedAt: new Date() },
    }).catch(() => {})
    await writeLog(mi?.id, organizationId, {
      logType: 'error',
      message: `Failed to process queue item: ${err.message}`,
    })
    throw err
  }
}

/** Process every pending queue row (optionally for one org). Best-effort. */
export async function processPending(organizationId) {
  const where = { status: 'pending' }
  if (organizationId) where.organizationId = organizationId
  const pending = await db.machineResultsQueue.findMany({ where, select: { id: true } })
  const results = []
  for (const { id } of pending) {
    try {
      results.push({ id, ...(await processQueueItem(id)) })
    } catch (e) {
      results.push({ id, status: 'failed', error: e.message })
    }
  }
  return results
}
