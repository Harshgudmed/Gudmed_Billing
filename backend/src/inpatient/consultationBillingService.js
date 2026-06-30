// consultationBillingService.js
//
// Auto-billing for COMPLETED IpdConsultations.
// Pattern: identical to orderBillingService.js (Procedure billing).
// Reuses resolvePrice() from tariffService.js — UNCHANGED.
// Idempotent via existing @@unique([organizationId, sourceModule, sourceRef]).
// Also auto-creates DoctorCommission using the doctor's DoctorCommissionConfig.

import { db } from '../config/db.js'
import { resolvePrice } from './tariffService.js'

const r2 = (n) => Math.round((n || 0) * 100) / 100

/**
 * Called inside a transaction when IpdConsultation.status → COMPLETED.
 * Idempotent: safe to call multiple times — duplicate sourceRef is silently skipped.
 * Returns { charge, commission, deduped }
 *
 * @param {object} tx       - Prisma transaction client
 * @param {string} orgId    - organizationId
 * @param {object} consult  - IpdConsultation row (must have: id, admissionId, consultingDoctorId)
 * @param {object} actor    - { id, name } of the user performing the action
 */
export async function billConsultation(tx, orgId, consult, actor) {

  // ── 1. IDEMPOTENCY CHECK ──────────────────────────────────────────────────────
  const existing = await tx.ipdCharge.findFirst({
    where: { organizationId: orgId, sourceModule: 'IPD_CONSULTATION', sourceRef: consult.id },
  })
  if (existing) return { charge: existing, commission: null, deduped: true }

  // ── 2. RESOLVE CHARGE MASTER ITEM ────────────────────────────────────────────
  // Fixed generic consultation charge item code
  const itemCode = 'CONSULT-SPECIALIST'

  // ── 3. PRICE VIA EXISTING TARIFF ENGINE (resolvePrice — NOT modified) ─────────
  // Reads: PatientTariff(locked plan) + BedOccupancy(current category) + TariffRule
  let priced
  try {
    priced = await resolvePrice(orgId, consult.admissionId, {
      itemCode,
      serviceGroup: 'DOCTOR_VISIT',
      serviceDate:  consult.createdAt || new Date(),
    })
  } catch (e) {
    // If ChargeMaster code not found, fall back to ad-hoc base price of 0
    // so billing doesn't block the status update. Admin can fix catalog later.
    if (e.status === 404) {
      priced = { price: 0, base: 0, serviceGroup: 'DOCTOR_VISIT', bedCategoryId: null, plan: null, rule: null, chargeItem: null }
    } else {
      throw e
    }
  }

  // ── 4. FREEZE TAX FROM CHARGE MASTER ─────────────────────────────────────────
  let taxPct = 0
  if (priced.chargeItem?.id) {
    const cm = await db.chargeMaster.findUnique({
      where: { id: priced.chargeItem.id }, select: { taxRatePct: true },
    }).catch(() => null)
    taxPct = cm?.taxRatePct || 0
  }

  const qty           = 1 // per-visit — always 1
  const gross         = r2(priced.price * qty)
  const discountAmt   = 0
  const taxable       = r2(gross - discountAmt)
  const taxAmount     = r2(taxable * taxPct / 100)
  const lineTotal     = r2(taxable + taxAmount)

  // ── 5. CREATE IPDCHARGE (frozen snapshot — identical pattern to orderBillingService) ──
  const chargeData = {
    organizationId: orgId,
    admissionId:    consult.admissionId,
    chargeItemId:   priced.chargeItem?.id || null,
    description:    `Specialist Consultation${priced.chargeItem?.name ? ` – ${priced.chargeItem.name}` : ''}`,
    serviceGroup:   'DOCTOR_VISIT',
    unitPrice:      priced.price,
    quantity:       qty,
    taxPct,
    taxAmount,
    discountPct:    0,
    discountAmount: 0,
    lineTotal,
    resolvedFrom: {
      planId:        priced.plan?.id || null,
      bedCategoryId: priced.bedCategoryId || null,
      ruleId:        priced.rule?.id || null,
      base:          priced.base,
    },
    status:         'ACTIVE',
    postedById:     actor?.id   || null,
    postedByName:   actor?.name || null,
    serviceDate:    consult.createdAt ? new Date(consult.createdAt) : new Date(),
    sourceModule:   'IPD_CONSULTATION',
    sourceRef:      consult.id,    // ← idempotency key
  }

  // Race-safe idempotent insert (same pattern as orderBillingService)
  await tx.ipdCharge.createMany({ data: [chargeData], skipDuplicates: true })
  const charge = await tx.ipdCharge.findFirst({
    where: { organizationId: orgId, sourceModule: 'IPD_CONSULTATION', sourceRef: consult.id },
  })

  // ── 6. LINK CHARGE BACK TO CONSULTATION ──────────────────────────────────────
  await tx.ipdConsultation.update({
    where: { id: consult.id },
    data: { ipdChargeId: charge.id, feeApplied: lineTotal, status: 'BILLED' },
  })

  // ── 7. DOCTOR COMMISSION (uses existing DoctorCommissionConfig) ───────────────
  let commission = null
  const config = await db.doctorCommissionConfig.findUnique({
    where: { doctorId: consult.consultingDoctorId },
  }).catch(() => null)

  if (config?.isActive && lineTotal > 0) {
    const commAmount = config.commissionType === 'percentage'
      ? r2(lineTotal * config.commissionRate / 100)
      : r2(config.commissionRate)  // fixed_per_consultation

    const now    = new Date()
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    commission = await tx.doctorCommission.create({
      data: {
        organizationId:   orgId,
        doctorId:         consult.consultingDoctorId,
        invoiceId:        charge.id,       // maps to IpdCharge id
        invoiceAmount:    lineTotal,
        commissionRate:   config.commissionRate,
        commissionType:   config.commissionType,
        commissionAmount: commAmount,
        status:           'pending',
        period,
      },
    })

    // Snapshot commission on the consultation row for quick display
    await tx.ipdConsultation.update({
      where: { id: consult.id },
      data: { commissionAmount: commAmount },
    })
  }

  return { charge, commission, deduped: false }
}
