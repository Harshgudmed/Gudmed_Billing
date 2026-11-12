// Seed Asset Management demo data (register + maintenance history) against the
// real demo hospital, using its existing departments/vendors/admin.
// Mirrors seed-insurance.js's shape.
//
// Run:  node seed-assets.js
import { db } from './src/config/db.js'
import { nextMasterCode } from './src/lib/counters.js'

const ORG_ID = 'org-demo' // getOrgId(req)'s fallback — the real demo hospital, not whatever findFirst() happens to return first among the test orgs left behind by unit tests.

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n) => new Date(Date.now() - n * DAY)
const daysFromNow = (n) => new Date(Date.now() + n * DAY)

function pick(arr, i) { return arr[i % arr.length] }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

// Each row: category, name, department name to link (or null), vendor name to
// link (or null), status, purchase age (days), cost, useful life, warranty
// days from purchase, AMC on/off + its days left, maintenance interval +
// how many days until next due (negative = already overdue), and 1-2
// maintenance log entries (days ago, cost, note).
const ASSETS = [
  {
    category: 'Medical Equipment', name: 'Patient Monitor — ICU 3', dept: 'Cardiology', vendor: 'Surgimed Healthcare Pvt Ltd',
    status: 'ACTIVE', purchasedDaysAgo: 420, cost: 185000, usefulLifeYears: 7, warrantyDays: 365, amcVendor: 'Surgimed Healthcare Pvt Ltd', amcDaysLeft: 54, serialNumber: 'PM-ICU3-2025',
    maintenanceIntervalDays: 90, nextDueInDays: 6,
    logs: [{ daysAgo: 84, cost: 3500, note: 'Routine calibration — all parameters within range' }],
  },
  {
    category: 'Medical Equipment', name: 'Ventilator — ICU 2', dept: 'Cardiology', vendor: 'Surgimed Healthcare Pvt Ltd',
    status: 'UNDER_REPAIR', purchasedDaysAgo: 760, cost: 420000, usefulLifeYears: 8, warrantyDays: 730, amcVendor: 'Surgimed Healthcare Pvt Ltd', amcDaysLeft: -12, serialNumber: 'VNT-ICU2-2024',
    maintenanceIntervalDays: 60, nextDueInDays: -4,
    logs: [
      { daysAgo: 190, cost: 8200, note: 'Oxygen sensor replaced' },
      { daysAgo: 7, cost: 0, note: 'Compressor fault reported — sent for repair' },
    ],
  },
  {
    category: 'Medical Equipment', name: 'Digital X-Ray Machine', dept: 'Orthopedics', vendor: 'Precision Diagnostics Supplies',
    status: 'ACTIVE', purchasedDaysAgo: 540, cost: 950000, usefulLifeYears: 10, warrantyDays: 1095, amcVendor: 'Precision Diagnostics Supplies', amcDaysLeft: 210, serialNumber: 'XRAY-OPD-2024',
    maintenanceIntervalDays: 180, nextDueInDays: 35,
    logs: [{ daysAgo: 145, cost: 12000, note: 'Annual safety inspection — AERB compliance check passed' }],
  },
  {
    category: 'Medical Equipment', name: 'Ultrasound Scanner', dept: 'General Medicine', vendor: 'Precision Diagnostics Supplies',
    status: 'ACTIVE', purchasedDaysAgo: 300, cost: 680000, usefulLifeYears: 8, warrantyDays: 730, amcVendor: null, amcDaysLeft: null, serialNumber: 'USG-GM-2025',
    maintenanceIntervalDays: 120, nextDueInDays: 88,
    logs: [],
  },
  {
    category: 'Medical Equipment', name: 'Defibrillator', dept: 'Cardiology', vendor: 'OxyCare Medical Gases LLP',
    status: 'ACTIVE', purchasedDaysAgo: 200, cost: 145000, usefulLifeYears: 6, warrantyDays: 365, amcVendor: null, amcDaysLeft: null, serialNumber: 'DEF-CARD-2025',
    maintenanceIntervalDays: 30, nextDueInDays: 2,
    logs: [{ daysAgo: 28, cost: 1200, note: 'Battery and pad check — replaced pads' }],
  },
  {
    category: 'Medical Equipment', name: 'Oxygen Concentrator — Ward B', dept: 'General Medicine', vendor: 'OxyCare Medical Gases LLP',
    status: 'RETIRED', purchasedDaysAgo: 1800, cost: 65000, usefulLifeYears: 5, warrantyDays: 365, amcVendor: null, amcDaysLeft: null, serialNumber: 'OXY-WB-2021',
    maintenanceIntervalDays: null, nextDueInDays: null,
    logs: [{ daysAgo: 400, cost: 2200, note: 'Filter replacement' }],
  },
  {
    category: 'IT Equipment', name: 'Reception Desktop — Front Office', dept: null, vendor: 'TechNova IT Solutions',
    status: 'ACTIVE', purchasedDaysAgo: 260, cost: 48000, usefulLifeYears: 4, warrantyDays: 1095, amcVendor: 'TechNova IT Solutions', amcDaysLeft: 300, serialNumber: 'PC-FRONT-01',
    maintenanceIntervalDays: 180, nextDueInDays: 70,
    logs: [],
  },
  {
    category: 'IT Equipment', name: 'Server — Hospital Information System', dept: null, vendor: 'TechNova IT Solutions',
    status: 'ACTIVE', purchasedDaysAgo: 540, cost: 320000, usefulLifeYears: 5, warrantyDays: 1095, amcVendor: 'TechNova IT Solutions', amcDaysLeft: 9, serialNumber: 'SRV-HIS-2024',
    maintenanceIntervalDays: 90, nextDueInDays: 9,
    logs: [{ daysAgo: 81, cost: 5000, note: 'Firmware update, backup drive health check' }],
  },
  {
    category: 'Furniture', name: 'ICU Bed — Electric (Bed 4)', dept: 'Cardiology', vendor: 'ABC Furniture',
    status: 'ACTIVE', purchasedDaysAgo: 650, cost: 95000, usefulLifeYears: 10, warrantyDays: 730, amcVendor: null, amcDaysLeft: null, serialNumber: 'BED-ICU4-2024',
    maintenanceIntervalDays: 180, nextDueInDays: -18,
    logs: [{ daysAgo: 198, cost: 1800, note: 'Hydraulic mechanism serviced' }],
  },
  {
    category: 'Furniture', name: 'Waiting Area Chairs (Set of 20)', dept: null, vendor: 'ABC Furniture',
    status: 'ACTIVE', purchasedDaysAgo: 900, cost: 120000, usefulLifeYears: 8, warrantyDays: 365, amcVendor: null, amcDaysLeft: null, serialNumber: null,
    maintenanceIntervalDays: null, nextDueInDays: null,
    logs: [],
  },
  {
    category: 'Vehicle', name: 'Ambulance — AP 09 XY 4521', dept: null, vendor: null,
    status: 'ACTIVE', purchasedDaysAgo: 1100, cost: 1850000, usefulLifeYears: 8, warrantyDays: 1095, amcVendor: null, amcDaysLeft: null, serialNumber: 'MH12AB4521',
    maintenanceIntervalDays: 45, nextDueInDays: -2,
    logs: [
      { daysAgo: 410, cost: 15000, note: 'Engine service + tyre replacement' },
      { daysAgo: 47, cost: 3200, note: 'Routine service, oil change' },
    ],
  },
  {
    category: 'Other', name: 'Industrial Laundry Washer', dept: null, vendor: 'CleanPro Facility Services',
    status: 'ACTIVE', purchasedDaysAgo: 380, cost: 310000, usefulLifeYears: 7, warrantyDays: 730, amcVendor: 'CleanPro Facility Services', amcDaysLeft: 45, serialNumber: 'LDY-01-2025',
    maintenanceIntervalDays: 60, nextDueInDays: 21,
    logs: [{ daysAgo: 39, cost: 2800, note: 'Drum bearing replaced' }],
  },
]

async function main() {
  console.log('Seeding Asset Management demo data against org-demo (GudMed Super Speciality Hospital)...\n')
  const org = await db.organization.findUnique({ where: { id: ORG_ID }, select: { id: true, name: true } })
  if (!org) throw new Error(`Organization ${ORG_ID} not found.`)
  console.log('Organization:', org.name, `(${org.id})`)

  const departments = await db.department.findMany({ where: { organizationId: ORG_ID }, select: { id: true, name: true } })
  const vendors = await db.vendor.findMany({ where: { organizationId: ORG_ID }, select: { id: true, name: true } })
  const admin = await db.user.findFirst({ where: { organizationId: ORG_ID, role: 'admin' }, select: { id: true } })
  const deptByName = Object.fromEntries(departments.map((d) => [d.name, d.id]))
  const vendorByName = Object.fromEntries(vendors.map((v) => [v.name, v.id]))
  console.log(`Found ${departments.length} departments, ${vendors.length} vendors.\n`)

  let created = 0, logsCreated = 0

  for (const a of ASSETS) {
    const assetTag = await db.$transaction((tx) => nextMasterCode(tx, ORG_ID, 'ASSET', 'AST'))
    const purchaseDate = daysAgo(a.purchasedDaysAgo)
    const warrantyExpiry = a.warrantyDays != null ? new Date(purchaseDate.getTime() + a.warrantyDays * DAY) : null
    const amcExpiry = a.amcDaysLeft != null ? daysFromNow(a.amcDaysLeft) : null
    const nextMaintenanceDue = a.nextDueInDays != null ? daysFromNow(a.nextDueInDays) : null

    const asset = await db.asset.create({
      data: {
        organizationId: ORG_ID,
        assetTag,
        name: a.name,
        category: a.category,
        serialNumber: a.serialNumber,
        departmentId: a.dept ? deptByName[a.dept] || null : null,
        status: a.status,
        vendorId: a.vendor ? vendorByName[a.vendor] || null : null,
        purchaseDate,
        purchaseCost: a.cost,
        warrantyExpiry,
        amcVendorId: a.amcVendor ? vendorByName[a.amcVendor] || null : null,
        amcStartDate: a.amcVendor ? purchaseDate : null,
        amcExpiry,
        amcCost: a.amcVendor ? Math.round(a.cost * 0.06) : null,
        usefulLifeYears: a.usefulLifeYears,
        residualValue: Math.round(a.cost * 0.05),
        maintenanceIntervalDays: a.maintenanceIntervalDays,
        nextMaintenanceDue,
        createdById: admin?.id,
      },
    })
    created++

    let lastScheduled = null
    for (const log of a.logs) {
      await db.assetMaintenanceLog.create({
        data: {
          organizationId: ORG_ID,
          assetId: asset.id,
          scheduledFor: lastScheduled,
          performedAt: daysAgo(log.daysAgo),
          performedBy: a.vendor || null,
          vendorId: a.vendor ? vendorByName[a.vendor] || null : null,
          cost: log.cost,
          notes: log.note,
          createdById: admin?.id,
        },
      })
      logsCreated++
      lastScheduled = a.maintenanceIntervalDays ? new Date(daysAgo(log.daysAgo).getTime() + a.maintenanceIntervalDays * DAY) : null
    }

    console.log(`  ✅ ${assetTag}  ${a.name}  [${a.category}]  ${a.status}${a.dept ? ` · ${a.dept}` : ''} — ${a.logs.length} log(s)`)
  }

  const totalAssets = await db.asset.count({ where: { organizationId: ORG_ID } })
  const totalLogs = await db.assetMaintenanceLog.count({ where: { organizationId: ORG_ID } })
  console.log(`\n🎉 Created ${created} assets + ${logsCreated} maintenance entries. Totals — assets: ${totalAssets}, logs: ${totalLogs}`)
}

main()
  .catch((e) => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
