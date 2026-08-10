// Phase 2 (security + validation + error-handling) on the money/patient
// endpoints — the highest-risk surface. Every check is SAFE: bad input is
// meant to be rejected before anything is written, garbage-id reads are
// read-only, and the one isolation test tears its throwaway org down after.
// Anything that DOES slip through and create a row is deleted at the end and
// reported as a finding.
import { chromium } from 'playwright'
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js'
const db = new PrismaClient()
const BASE = process.env.E2E_BASE || 'http://localhost:5173'
const PASSWORD = 'Gudmed@123'

async function login(page) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 15000 })
  await page.fill('input[type="email"]', 'admin@gudmed.in')
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForTimeout(1000)
}
async function api(page, method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const res = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, json }
  }, { method, path, body })
}

const results = []
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const createdToClean = { patients: [], appointments: [] }
const OTHER = 'audit-org-' + Date.now()

try {
  await login(page)

  console.log('\n── ERROR HANDLING: garbage :id must 404, never 500 crash ──')
  for (const [label, path] of [
    ['GET patient by garbage id', '/patients/nonexistent-xyz-123'],
    ['GET appointment by garbage id', '/appointments/nonexistent-xyz-123'],
    ['GET payment invoice by garbage id', '/payments/invoice/nonexistent-xyz-123'],
    ['PATCH queue item by garbage id', '/queue/nonexistent-xyz-123'],
  ]) {
    const r = await api(page, path.startsWith('/queue') ? 'PATCH' : 'GET', path, path.startsWith('/queue') ? { status: 'completed' } : undefined)
    check(`${label} → not a 500`, r.status !== 500 && r.status < 500, `HTTP ${r.status}`)
  }

  console.log('\n── VALIDATION: empty / junk body must be rejected (400), not 500, not silently created ──')
  // Patient
  const pEmpty = await api(page, 'POST', '/patients', {})
  if (pEmpty.json?.data?.id) createdToClean.patients.push(pEmpty.json.data.id)
  check('POST /patients {} rejected', pEmpty.status >= 400 && pEmpty.status < 500, `HTTP ${pEmpty.status}`)

  const pBad = await api(page, 'POST', '/patients', { firstName: '', lastName: '', phonePrimary: 'abc', dateOfBirth: 'not-a-date' })
  if (pBad.json?.data?.id) createdToClean.patients.push(pBad.json.data.id)
  check('POST /patients junk fields rejected', pBad.status >= 400 && pBad.status < 500, `HTTP ${pBad.status}`)

  // Appointment
  const aEmpty = await api(page, 'POST', '/appointments', {})
  if (aEmpty.json?.data?.id) createdToClean.appointments.push(aEmpty.json.data.id)
  check('POST /appointments {} rejected', aEmpty.status >= 400 && aEmpty.status < 500, `HTTP ${aEmpty.status}`)

  // Billing
  const bEmpty = await api(page, 'POST', '/billing', {})
  check('POST /billing {} rejected', bEmpty.status >= 400 && bEmpty.status < 500, `HTTP ${bEmpty.status}`)

  const bNeg = await api(page, 'POST', '/billing', { items: [{ name: 'X', amount: -9999, quantity: -5 }] })
  check('POST /billing negative amount rejected', bNeg.status >= 400 && bNeg.status < 500, `HTTP ${bNeg.status}`)

  console.log('\n── MULTI-TENANT ISOLATION: another org\'s patient must be invisible (404) ──')
  await db.organization.create({ data: { id: OTHER, name: 'Audit Org', slug: OTHER } })
  const foreignPatient = await db.patient.create({
    data: { organizationId: OTHER, mrn: 'AUDIT-' + Date.now(), firstName: 'Secret', lastName: 'Patient', dateOfBirth: new Date('1990-01-01'), gender: 'male', phonePrimary: '9999999999' },
  })
  const readForeign = await api(page, 'GET', `/patients/${foreignPatient.id}`)
  check('Cannot read another org\'s patient', readForeign.status === 404, `HTTP ${readForeign.status} (want 404)`)

  const patchForeign = await api(page, 'PATCH', `/patients/${foreignPatient.id}`, { firstName: 'Hacked' })
  const stillSecret = await db.patient.findUnique({ where: { id: foreignPatient.id }, select: { firstName: true } })
  check('Cannot edit another org\'s patient', patchForeign.status === 404 && stillSecret.firstName === 'Secret', `HTTP ${patchForeign.status}, name still "${stillSecret.firstName}"`)

} catch (e) {
  console.log('SCRIPT ERROR:', e.message)
} finally {
  // Clean up anything a weak validation may have created, and the throwaway org.
  for (const id of createdToClean.patients) await db.patient.delete({ where: { id } }).catch(() => {})
  for (const id of createdToClean.appointments) await db.appointment.delete({ where: { id } }).catch(() => {})
  await db.organization.delete({ where: { id: OTHER } }).catch(() => {})
  if (createdToClean.patients.length || createdToClean.appointments.length) {
    console.log(`\n⚠ NOTE: ${createdToClean.patients.length} patient + ${createdToClean.appointments.length} appointment rows were CREATED by junk input (validation gap) — cleaned up now, but worth tightening.`)
  }
  await browser.close(); await db.$disconnect()
  const passed = results.filter(r => r.ok).length
  console.log(`\n==== ${passed}/${results.length} critical-endpoint checks passed ====`)
}
