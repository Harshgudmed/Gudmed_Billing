// HL7 v2 parser for lab analyzer results (ORU^R01).
//
// Pure functions only — NO database, NO side effects. This is the part that
// turns a raw HL7 message coming off an analyzer (Cobas, Sysmex, Mindray, …)
// into a plain JS object our queueProcessor can match against a LabOrder.
//
// Keeping it pure means it is 100% unit-testable without Postgres or a TCP
// socket (see __tests__/hl7Parser.test.js).

import hl7 from 'simple-hl7'

const parser = new hl7.Parser()

/** Safe field/component readers — never throw, always return a trimmed string. */
function fld(seg, n) {
  try {
    const v = seg.getField(n)
    return v == null ? '' : String(v).trim()
  } catch {
    return ''
  }
}
function comp(seg, f, c) {
  try {
    const v = seg.getComponent(f, c)
    return v == null ? '' : String(v).trim()
  } catch {
    return ''
  }
}

/**
 * Read MSH-9 (message type, e.g. "ORU^R01") directly from the raw text.
 * simple-hl7 numbers MSH fields with an off-by-one quirk (MSH-1 IS the field
 * separator), so we read it from the raw segment to stay correct & predictable.
 */
function readMessageType(raw) {
  const line = String(raw).split(/[\r\n]+/).find((l) => l.startsWith('MSH'))
  if (!line) return ''
  const sep = line[3] || '|' // MSH-1 = the field separator character
  const fields = line.split(sep)
  return (fields[8] || '').split('^')[0] // MSH-9.1 = message code (ORU)
}

/**
 * Turn an HL7 abnormal-flag (OBX-8) into our LabResult booleans.
 * H/L/A/>/< = abnormal · HH/LL/AA/panic = critical. Empty/N = normal.
 */
export function interpretAbnormalFlag(flag) {
  const f = String(flag || '').trim().toUpperCase()
  if (!f || f === 'N') return { isAbnormal: false, isCritical: false, flag: null }
  const critical = ['HH', 'LL', 'AA', '>>', '<<'].includes(f)
  const abnormal = ['H', 'L', 'A', '>', '<', 'H>', 'L<'].includes(f) || critical
  return { isAbnormal: abnormal, isCritical: critical, flag: f }
}

/**
 * Parse an OBX-7 reference range string into { min, max, text }.
 * Handles "13.0-17.0", "<200", ">40", "Negative", "" gracefully.
 */
export function parseReferenceRange(text) {
  const t = String(text || '').trim()
  if (!t) return { min: null, max: null, text: null }
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/)
  if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]), text: t }
  return { min: null, max: null, text: t }
}

/**
 * Parse a full ORU^R01 message into a structured result object.
 *
 * @param {string} raw  raw HL7 text (segments separated by \r, \n or \r\n)
 * @returns {{
 *   messageType: string,
 *   controlId: string,
 *   patientIdentifier: string|null,
 *   patientName: string|null,
 *   placerOrderNumber: string|null,   // OBR-2  → our LabOrder.orderNumber
 *   fillerOrderNumber: string|null,   // OBR-3  → our LabOrder.accessionNumber
 *   results: Array<{
 *     code: string, name: string, value: string, unit: string|null,
 *     referenceRange: {min:number|null,max:number|null,text:string|null},
 *     status: string, ...interpretAbnormalFlag()
 *   }>
 * }}
 */
export function parseOru(raw) {
  if (!raw || !String(raw).trim()) throw new Error('Empty HL7 message')

  // Normalise line endings to \r — HL7's canonical segment separator. Some
  // analyzers / file dumps use \n or \r\n; simple-hl7 expects \r.
  const normalised = String(raw).replace(/\r\n|\n/g, '\r').trim()

  const msg = parser.parse(normalised)
  const messageType = readMessageType(normalised)

  const pid = msg.getSegment('PID')
  const obr = msg.getSegment('OBR')

  const results = msg.getSegments('OBX').map((obx) => {
    const refText = fld(obx, 7)
    return {
      code: comp(obx, 3, 1) || fld(obx, 3),
      name: comp(obx, 3, 2) || null,
      value: fld(obx, 5),
      unit: fld(obx, 6) || null,
      referenceRange: parseReferenceRange(refText),
      status: fld(obx, 11) || null,
      ...interpretAbnormalFlag(fld(obx, 8)),
    }
  })

  return {
    messageType: messageType || 'UNKNOWN',
    controlId: (normalised.split(/\r/)[0].split(normalised[3] || '|')[9] || '').trim() || null,
    patientIdentifier: pid ? comp(pid, 3, 1) || fld(pid, 3) || null : null,
    patientName: pid ? [comp(pid, 5, 2), comp(pid, 5, 1)].filter(Boolean).join(' ') || null : null,
    placerOrderNumber: obr ? fld(obr, 2) || null : null,
    fillerOrderNumber: obr ? fld(obr, 3) || null : null,
    results,
  }
}
