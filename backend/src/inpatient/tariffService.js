// Enterprise IPD Tariff Engine.
// Resolves the price of any billable item for a given admission by walking:
//   admission → locked PatientTariff (or org default plan)
//            → active BedOccupancy segment's bed category
//            → most-specific TariffRule effective on the service date
//            → apply adjustment (PERCENT | FIXED_DELTA | ABSOLUTE_OVERRIDE)
// And computes a segment-aware running bill (bed charges per occupancy window).
import { db } from '../config/db.js'

const MS_PER_DAY = 1000 * 60 * 60 * 24

// Client billing rule: ONLY these service groups are plan-priced via the tariff
// engine (different rate per payer plan — Cash/Insurance/Govt). Everything else
// (Pharmacy, Lab/Pathology, Radiology, Implant/Other) is billed at its OWN
// catalog/MRP/price-list — the same for every plan, no tariff markup.
const TARIFFABLE_GROUPS = new Set(["BED", "DOCTOR_VISIT", "PROCEDURE", "SURGERY"]);

function applyAdjustment(base, rule) {
  if (!rule) return base
  const v = rule.adjustmentValue || 0
  if (rule.adjustmentType === 'PERCENT') return base * (1 + v / 100)
  if (rule.adjustmentType === 'FIXED_DELTA') return base + v
  if (rule.adjustmentType === 'ABSOLUTE_OVERRIDE') return v
  return base
}

// Most-specific rule wins:
//   item-specific (serviceItemId) > group-specific > any-group
//   category-specific > any-category
function pickBestRule(rules, { bedCategoryId, serviceGroup, serviceItemId }, serviceDate = new Date()) {
  const candidates = rules.filter((r) => {
    if (r.validFrom && new Date(r.validFrom) > serviceDate) return false
    if (r.validTo && new Date(r.validTo) < serviceDate) return false
    if (r.bedCategoryId && r.bedCategoryId !== bedCategoryId) return false
    if (r.serviceItemId && r.serviceItemId !== serviceItemId) return false
    if (r.serviceGroup && r.serviceGroup !== serviceGroup) return false
    return true
  })
  const score = (r) =>
    (r.serviceItemId ? 4 : 0) +
    (r.serviceGroup ? 2 : 0) +
    (r.bedCategoryId ? 1 : 0)
  return candidates.sort((a, b) => score(b) - score(a))[0] || null
}

// Resolve the tariff plan that applies to an admission (locked snapshot, else org default CASH).
export async function resolvePlanForAdmission(organizationId, admissionId) {
  const locked = await db.patientTariff.findUnique({ where: { admissionId } })
  if (locked) {
    const plan = await db.tariffPlan.findUnique({ where: { id: locked.planId } })
    if (plan) return plan
  }
  return (
    (await db.tariffPlan.findFirst({ where: { organizationId, payerType: 'CASH', isDefault: true } })) ||
    (await db.tariffPlan.findFirst({ where: { organizationId, isActive: true } }))
  )
}

// Find the bed category that applies to an admission on a given date.
// Prefers the occupancy segment active on that date; falls back to the current bed.
export async function resolveBedCategory(organizationId, admissionId, serviceDate = new Date()) {
  const segments = await db.bedOccupancy.findMany({
    where: { organizationId, admissionId },
    orderBy: { startAt: 'asc' },
  })
  const seg = segments.find(
    (s) => new Date(s.startAt) <= serviceDate && (!s.endAt || new Date(s.endAt) >= serviceDate)
  ) || segments[segments.length - 1]
  if (seg?.bedCategoryId) return seg.bedCategoryId

  // Fallback: current bed on the admission
  const adm = await db.admission.findFirst({ where: { id: admissionId, organizationId }, select: { bedId: true } })
  if (adm?.bedId) {
    const bed = await db.bed.findUnique({ where: { id: adm.bedId }, select: { bedCategoryId: true } })
    return bed?.bedCategoryId || null
  }
  return null
}

/**
 * Resolve the price of one service item for an admission.
 * @param itemCode  ChargeMaster.code (preferred) OR
 * @param base/serviceGroup  for ad-hoc items not in the charge master
 * Returns { price, base, rule, plan, bedCategoryId, chargeItem }
 */
export async function resolvePrice(organizationId, admissionId, { itemCode, base, serviceGroup, serviceItemId, serviceDate } = {}) {
  const when = serviceDate ? new Date(serviceDate) : new Date()
  const plan = await resolvePlanForAdmission(organizationId, admissionId)
  if (!plan) throw Object.assign(new Error('No tariff plan configured'), { status: 400 })

  let chargeItem = null
  let basePrice = base
  let group = serviceGroup
  let itemId = serviceItemId

  if (itemCode) {
    chargeItem = await db.chargeMaster.findUnique({
      where: { organizationId_code: { organizationId, code: itemCode } },
    })
    if (!chargeItem) throw Object.assign(new Error(`Unknown charge item: ${itemCode}`), { status: 404 })
    basePrice = chargeItem.basePrice
    group = chargeItem.serviceGroup
    itemId = chargeItem.id
  }
  if (basePrice === undefined || basePrice === null) {
    throw Object.assign(new Error('Provide itemCode or a base price'), { status: 400 })
  }

  // Non-tariffable groups (Pharmacy/Lab/Radiology/Implant) bill at their OWN price —
  // skip the tariff engine entirely (no plan markup, same for every payer plan).
  if (group && !TARIFFABLE_GROUPS.has(group)) {
    return {
      price: Math.round(basePrice * 100) / 100,
      base: basePrice,
      serviceGroup: group,
      bedCategoryId: null,
      plan: { id: plan.id, name: plan.name, payerType: plan.payerType },
      rule: null,
      chargeItem: chargeItem
        ? { id: chargeItem.id, code: chargeItem.code, name: chargeItem.name }
        : null,
    }
  }

  const bedCategoryId = await resolveBedCategory(organizationId, admissionId, when)
  const rules = await db.tariffRule.findMany({ where: { organizationId, planId: plan.id } })
  const rule = pickBestRule(rules, { bedCategoryId, serviceGroup: group, serviceItemId: itemId }, when)

  const price = Math.round(applyAdjustment(basePrice, rule) * 100) / 100
  return {
    price,
    base: basePrice,
    serviceGroup: group,
    bedCategoryId,
    plan: { id: plan.id, name: plan.name, payerType: plan.payerType },
    rule: rule
      ? { id: rule.id, type: rule.adjustmentType, value: rule.adjustmentValue }
      : null,
    chargeItem: chargeItem ? { id: chargeItem.id, code: chargeItem.code, name: chargeItem.name } : null,
  }
}

const round2pub = (n) => Math.round(n * 100) / 100

/**
 * Hidden, backend-driven price for a PHARMACY item (medicine / injection / consumable).
 * Base price comes from the pharmacy catalog (PharmacyDrug.sellingPrice → mrp).
 * The ward/bed-category markup is applied via the PHARMACY-group TariffRule for the
 * admission's locked plan (NOT hardcoded). GST comes from the drug's gstRate.
 *
 * Returns the final per-unit price + line totals, plus a `breakdown` the caller
 * may choose to expose only to admins.
 */
export async function priceForPharmacyItem(organizationId, admissionId, drugId, { quantity = 1, serviceDate } = {}) {
  const drug = await db.pharmacyDrug.findFirst({
    where: { id: drugId, organizationId },
    select: { id: true, drugName: true, drugCategory: true, dosageForm: true, unitOfMeasure: true, sellingPrice: true, mrp: true, gstRate: true, quantityInStock: true, isActive: true },
  })
  if (!drug) throw Object.assign(new Error('Pharmacy item not found'), { status: 404 })
  if (drug.isActive === false) throw Object.assign(new Error('Pharmacy item is inactive'), { status: 400 })

  const basePrice = drug.sellingPrice ?? drug.mrp ?? 0

  // Route through resolvePrice for ONE pricing path, but PHARMACY is a
  // non-tariffable group — the gate inside resolvePrice short-circuits and
  // returns the catalog price unchanged (no plan/ward markup, rule = null),
  // same for every payer plan. Per the client rule, pharmacy never gets a tariff.
  // serviceItemId = drug id is kept so an admin *could* add a drug-specific
  // override rule in future, but today no markup is applied.
  const priced = await resolvePrice(organizationId, admissionId, {
    base: basePrice,
    serviceGroup: 'PHARMACY',
    serviceItemId: drug.id,
    serviceDate,
  })

  const qty = Math.max(1, Number(quantity) || 1)
  const unitPrice = round2pub(priced.price) // catalog price, pre-tax (no markup for pharmacy)
  const lineSubtotal = round2pub(unitPrice * qty)
  const taxPct = drug.gstRate || 0
  const taxAmount = round2pub(lineSubtotal * taxPct / 100)
  const lineTotal = round2pub(lineSubtotal + taxAmount)

  return {
    drug: { id: drug.id, name: drug.drugName, category: drug.drugCategory, form: drug.dosageForm, uom: drug.unitOfMeasure },
    quantity: qty,
    unitPrice,            // ← the only number a normal user needs
    lineSubtotal,
    taxPct,
    taxAmount,
    lineTotal,            // ← grand line total shown in UI
    stockAvailable: drug.quantityInStock,
    inStock: drug.quantityInStock >= qty,
    // Internal calculation — caller decides whether to expose (admins only).
    breakdown: {
      basePrice: round2pub(basePrice),
      markup: priced.rule ? { type: priced.rule.type, value: priced.rule.value } : null,
      adjustedUnitPrice: unitPrice,
      plan: priced.plan,
      bedCategoryId: priced.bedCategoryId,
      gstPct: taxPct,
    },
  }
}

// Compute bed-day charges per occupancy segment, priced at each segment's category tariff.
// Falls back to a single window from admissionDate if no segments exist (legacy admissions).
export async function computeBedCharges(organizationId, admissionId, { upToDate } = {}) {
  const end = upToDate ? new Date(upToDate) : new Date()
  const adm = await db.admission.findFirst({
    where: { id: admissionId, organizationId },
    select: { admissionDate: true, dischargeDate: true, bedId: true },
  })
  if (!adm) throw Object.assign(new Error('Admission not found'), { status: 404 })
  const stayEnd = adm.dischargeDate ? new Date(adm.dischargeDate) : end

  let segments = await db.bedOccupancy.findMany({
    where: { organizationId, admissionId },
    orderBy: { startAt: 'asc' },
  })

  // Legacy fallback: synthesize one segment spanning the whole stay at the current bed's category
  if (segments.length === 0) {
    let bedCategoryId = null
    if (adm.bedId) {
      const bed = await db.bed.findUnique({ where: { id: adm.bedId }, select: { bedCategoryId: true } })
      bedCategoryId = bed?.bedCategoryId || null
    }
    segments = [{ bedCategoryId, startAt: adm.admissionDate, endAt: null }]
  }

  const plan = await resolvePlanForAdmission(organizationId, admissionId)
  const rules = plan ? await db.tariffRule.findMany({ where: { organizationId, planId: plan.id } }) : []
  const categories = await db.bedCategory.findMany({ where: { organizationId } })
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]))

  // Day-counting policy: bill by *calendar days* across the whole stay, charging
  // each calendar day to the segment the patient occupied at a fixed census hour
  // (midday). This avoids the old per-segment Math.ceil bug that billed two
  // bed-days for a same-day transfer. A 0-night (admit & discharge same day)
  // stay bills exactly 1 day, attributed to the admitting segment.
  const CENSUS_HOUR = 12 // noon snapshot, standard hospital midnight/census convention proxy
  const dayKey = (d) => { const x = new Date(d); x.setHours(CENSUS_HOUR, 0, 0, 0); return x.getTime() }
  const firstDay = dayKey(segments[0].startAt)
  const lastDay = dayKey(stayEnd)
  // Inclusive count of calendar days; same-day stay => 1.
  const totalDays = Math.max(1, Math.round((lastDay - firstDay) / MS_PER_DAY) + 1)

  // Assign each calendar day to the active segment at the census hour.
  const segDayCount = new Map() // segmentIndex -> days
  for (let i = 0; i < totalDays; i++) {
    const census = firstDay + i * MS_PER_DAY
    let idx = 0
    for (let s = 0; s < segments.length; s++) {
      const st = dayKey(segments[s].startAt)
      const en = segments[s].endAt ? dayKey(segments[s].endAt) : Infinity
      if (census >= st && census < en) idx = s
      else if (census >= st && segments[s].endAt && census === en) idx = s // boundary day stays with prior
    }
    // For the day a transfer happens, attribute to the NEW segment (patient sleeps there).
    for (let s = segments.length - 1; s >= 0; s--) {
      if (census >= dayKey(segments[s].startAt)) { idx = s; break }
    }
    segDayCount.set(idx, (segDayCount.get(idx) || 0) + 1)
  }

  const lines = []
  const warnings = []
  let total = 0
  segments.forEach((seg, i) => {
    const days = segDayCount.get(i) || 0
    if (days === 0) return
    const segStart = new Date(seg.startAt)
    const segEnd = seg.endAt ? new Date(seg.endAt) : stayEnd
    const cat = seg.bedCategoryId ? catById[seg.bedCategoryId] : null
    const rule = pickBestRule(rules, { bedCategoryId: seg.bedCategoryId, serviceGroup: 'BED' }, segEnd)
    const baseRate = cat?.defaultBedDayRate ?? 0
    const rate = Math.round(applyAdjustment(baseRate, rule) * 100) / 100

    // H7: warn when the BED override rule diverges from the category's own day-rate
    // (silent stale pricing — admin edited one but not the other).
    if (rule && rule.adjustmentType === 'ABSOLUTE_OVERRIDE' && cat && Math.abs(rule.adjustmentValue - (cat.defaultBedDayRate ?? 0)) > 0.001) {
      warnings.push(`Tariff divergence for ${cat.name}: rule override ₹${rule.adjustmentValue} ≠ category rate ₹${cat.defaultBedDayRate}. Using override.`)
    }
    if (!cat) warnings.push('A stay segment has no bed category — bed-day billed at ₹0. Assign a category to this bed.')

    const amount = Math.round(rate * days * 100) / 100
    total += amount
    lines.push({ bedCategory: cat?.name || 'Unspecified', from: segStart, to: segEnd, days, dailyRate: rate, amount })
  })
  return { lines, total: Math.round(total * 100) / 100, totalDays, warnings }
}

const round2 = (n) => Math.round(n * 100) / 100

// Full running bill: bed charges (segment-aware) + posted IpdCharge line items,
// with per-line GST from the charge master (M5).
export async function computeRunningBill(organizationId, admissionId, { upToDate } = {}) {
  const bed = await computeBedCharges(organizationId, admissionId, { upToDate })
  // Only ACTIVE charges are billable — CANCELLED/RETURNED are kept for audit but excluded.
  const charges = await db.ipdCharge.findMany({
    where: { organizationId, admissionId, status: 'ACTIVE' },
    orderBy: { serviceDate: 'asc' },
  })

  // Legacy fallback only: charge-master tax for pre-Phase-1 charges with no frozen tax.
  const legacy = charges.filter((c) => !(c.taxAmount > 0) && !(c.taxPct > 0) && !(c.lineTotal > 0))
  const itemIds = [...new Set(legacy.map((c) => c.chargeItemId).filter(Boolean))]
  const items = itemIds.length
    ? await db.chargeMaster.findMany({ where: { organizationId, id: { in: itemIds } }, select: { id: true, taxRatePct: true } })
    : []
  const taxById = Object.fromEntries(items.map((i) => [i.id, i.taxRatePct || 0]))

  let serviceSubtotal = 0
  let serviceTax = 0
  const lines = charges.map((c) => {
    const gross = round2((c.unitPrice || 0) * (c.quantity || 1))
    const discount = round2(c.discountAmount || 0)
    const amount = round2(gross - discount) // taxable base after discount
    // Snapshot integrity: prefer the FROZEN tax stored on the line. Fall back to
    // master/resolvedFrom only for legacy rows that predate frozen tax.
    let taxPct, tax
    if (c.taxAmount > 0 || c.taxPct > 0) {
      taxPct = c.taxPct || 0
      tax = round2(c.taxAmount || (amount * taxPct) / 100)
    } else {
      const rfGst = c.resolvedFrom && typeof c.resolvedFrom === 'object' ? Number(c.resolvedFrom.gstPct) || 0 : 0
      taxPct = c.chargeItemId ? (taxById[c.chargeItemId] || 0) : rfGst
      tax = round2((amount * taxPct) / 100)
    }
    serviceSubtotal += amount
    serviceTax += tax
    return {
      id: c.id, description: c.description, serviceGroup: c.serviceGroup,
      unitPrice: c.unitPrice, quantity: c.quantity, discount, amount, taxPct, tax,
      lineTotal: round2(amount + tax),
      serviceDate: c.serviceDate, sourceModule: c.sourceModule, sourceRef: c.sourceRef, status: c.status,
    }
  })

  const subtotal = round2(bed.total + serviceSubtotal)
  const taxTotal = round2(serviceTax) // bed-day tax = 0 by default; add bed tax here if configured
  const grandTotal = round2(subtotal + taxTotal)
  return {
    bedCharges: bed,
    serviceCharges: { lines, total: round2(serviceSubtotal), tax: round2(serviceTax) },
    subtotal,
    taxTotal,
    grandTotal,
    warnings: bed.warnings || [],
  }
}
