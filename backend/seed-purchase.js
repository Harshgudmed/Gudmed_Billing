// Seed the Purchase & Supply Chain modules with one connected story, so every
// screen has something to show and the numbers agree across them:
//
//   Items → Purchase requests → RFQs → Purchase orders → Goods receipts (stock)
//   → Vendor bills → Vendor payments → Purchase returns (debit notes)
//   → Store indents → Store issues (stock out, oldest expiry first)
//
// Numbers (PR-…, PO-…, GRN-…) come from the same counters the screens use.
// Needs vendors first:  node seed-vendors.js
// Run:                  node seed-purchase.js
// Re-running is refused once seeded (looks for the SEED marker on POs).
import { db } from './src/config/db.js'
import { nextMasterCode, nextSeriesNumber } from './src/lib/counters.js'
import { ensurePurchaseDefaults } from './src/lib/purchaseDefaults.js'
import { gstTypeFor, lineAmounts, orderTotals } from './src/lib/purchaseOrders.js'
import { stateCodeByName } from './src/lib/gst.js'
import { round2 } from './src/lib/money.js'

const SEED = '[seed-purchase]'
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n) => new Date(Date.now() - n * DAY)
const daysAhead = (n) => new Date(Date.now() + n * DAY)
const roundQty = (n) => Math.round((Number(n) || 0) * 1000) / 1000

// unit: stock unit; buy: [unit, factor] = how the item is bought (1 BOX = 100 PCS)
const ITEMS = [
  { name: 'Nitrile Examination Gloves (M)', cat: 'SURGICAL_CONSUMABLES', unit: 'PCS', buy: ['BOX', 100], hsn: '40151900', gst: 12, rate: 4.5, reorder: 500, vendor: 'MediEquip Surgicals', aliases: 'gloves, dastane' },
  { name: 'Disposable Syringe 5 ml', cat: 'SURGICAL_CONSUMABLES', unit: 'PCS', buy: ['BOX', 50], hsn: '90183100', gst: 12, rate: 6, reorder: 300, vendor: 'MediEquip Surgicals' },
  { name: 'IV Cannula 20G', cat: 'SURGICAL_CONSUMABLES', unit: 'PCS', buy: ['BOX', 100], hsn: '90183930', gst: 12, rate: 28, reorder: 200, vendor: 'MediEquip Surgicals' },
  { name: 'Surgical Gauze Roll', cat: 'SURGICAL_CONSUMABLES', unit: 'ROLL', hsn: '30059040', gst: 12, rate: 85, reorder: 50, vendor: 'MediEquip Surgicals' },
  { name: 'Paracetamol 500 mg Tablet', cat: 'MEDICINE', unit: 'STRIP', buy: ['BOX', 10], hsn: '30049099', gst: 12, rate: 18, reorder: 100, vendor: 'Sun Pharma Distributors' },
  { name: 'Normal Saline 500 ml', cat: 'MEDICINE', unit: 'BTL', buy: ['BOX', 24], hsn: '30049099', gst: 12, rate: 32, reorder: 120, vendor: 'Cipla Medical Supplies' },
  { name: 'CBC Reagent Kit', cat: 'LAB_REAGENTS', unit: 'PACK', hsn: '38220090', gst: 12, rate: 4200, reorder: 4, vendor: 'Apex Diagnostics Reagents' },
  { name: 'Blood Glucose Test Strips', cat: 'LAB_REAGENTS', unit: 'BOX', hsn: '38220090', gst: 12, rate: 650, reorder: 10, vendor: 'Apex Diagnostics Reagents' },
  { name: 'Medical Oxygen Cylinder (Refill)', cat: 'MEDICAL_DEVICE', unit: 'PCS', hsn: '28044000', gst: 12, rate: 350, reorder: 20, vendor: 'Oxygen Gas Suppliers' },
  { name: 'Bed Sheet (Single, White)', cat: 'LINEN', unit: 'PCS', hsn: '63023100', gst: 5, rate: 240, reorder: 80, aliases: 'chadar, bedsheet' },
  { name: 'Floor Disinfectant 5 L', cat: 'CLEANING_SUPPLIES', unit: 'BTL', hsn: '38089400', gst: 18, rate: 520, reorder: 15 },
  { name: 'A4 Paper Ream', cat: 'STATIONERY_PRINTING', unit: 'PACK', hsn: '48025690', gst: 18, rate: 310, reorder: 20, aliases: 'paper, rim' },
  { name: 'Ventilator AMC (Annual)', cat: 'AMC_REPAIRS', unit: 'YEAR', hsn: '998719', gst: 18, rate: 85000, vendor: 'BioMed Equipment Maintenance' },
  { name: 'Housekeeping Manpower', cat: 'MANPOWER', unit: 'MONTH', hsn: '998519', gst: 18, rate: 18000, vendor: 'CleanCare Housekeeping Services' },
]

const DEPARTMENTS = ['ICU', 'General Ward', 'Operation Theatre', 'Laboratory', 'Housekeeping', 'Administration']

async function main() {
  console.log('Seeding Purchase & Supply Chain...\n')
  const org = await db.organization.findFirst({ select: { id: true, name: true, region: true } })
  if (!org) throw new Error('No organization found.')
  const ORG = org.id
  const hospitalState = stateCodeByName(org.region)
  console.log('Organization:', org.name, `(${ORG})`)

  if (await db.purchaseOrder.findFirst({ where: { organizationId: ORG, notes: { contains: SEED } } })) {
    console.log('Already seeded (found seeded purchase orders). Nothing to do.')
    return
  }

  const vendors = await db.vendor.findMany({ where: { organizationId: ORG, isActive: true } })
  if (vendors.length < 3) throw new Error('Need at least 3 vendors — run `node seed-vendors.js` first.')
  const vendorByName = Object.fromEntries(vendors.map((v) => [v.name, v]))
  const vendor = (name) => vendorByName[name] || vendors[0]

  const user = await db.user.findFirst({ where: { organizationId: ORG }, select: { id: true, fullName: true } })
  const actor = { id: user?.id || null, name: user?.fullName || 'Store Admin' }

  // ── Masters: units, categories, departments, items ─────────────────────────
  await ensurePurchaseDefaults(ORG)
  const units = Object.fromEntries((await db.unit.findMany({ where: { organizationId: ORG } })).map((u) => [u.code, u]))
  const cats = Object.fromEntries((await db.itemCategory.findMany({ where: { organizationId: ORG, systemCode: { not: null } } })).map((c) => [c.systemCode, c]))

  const depts = {}
  for (const name of DEPARTMENTS) {
    depts[name] = await db.department.upsert({
      where: { organizationId_name: { organizationId: ORG, name } },
      update: {},
      create: { organizationId: ORG, name },
    })
  }
  console.log(`Departments ready: ${DEPARTMENTS.join(', ')}`)

  const items = {}
  for (const it of ITEMS) {
    let item = await db.item.findFirst({ where: { organizationId: ORG, name: it.name }, include: { conversions: true } })
    if (!item) {
      const cat = cats[it.cat]
      item = await db.$transaction(async (tx) => {
        const code = await nextMasterCode(tx, ORG, 'ITEM', 'ITM')
        return tx.item.create({
          data: {
            organizationId: ORG, code, name: it.name, aliases: it.aliases || null,
            categoryId: cat.id, purchaseType: cat.purchaseType, hsnCode: it.hsn, gstRate: it.gst,
            stockUnitId: units[it.unit].id, reorderLevel: it.reorder ?? null,
            preferredVendorId: it.vendor ? vendor(it.vendor).id : null,
            createdById: actor.id,
            conversions: it.buy ? { create: { organizationId: ORG, unitId: units[it.buy[0]].id, factor: it.buy[1], isPurchaseDefault: true } } : undefined,
          },
          include: { conversions: true },
        })
      })
      console.log(`  ✅ Item ${item.code}  ${item.name}`)
    }
    items[it.name] = { ...item, seed: it }
  }

  // The unit a document line uses: the item's purchase unit when it has one.
  const lineUnit = (name) => {
    const { seed } = items[name]
    return seed.buy
      ? { unit: units[seed.buy[0]], factor: seed.buy[1], rate: round2(seed.rate * seed.buy[1]) }
      : { unit: units[seed.unit], factor: 1, rate: seed.rate }
  }

  // ── Purchase requests ──────────────────────────────────────────────────────
  const PRS = [
    { dept: 'ICU', status: 'approved', priority: 'urgent', purpose: 'Monthly ICU consumables', ago: 20, lines: [['Nitrile Examination Gloves (M)', 10], ['Disposable Syringe 5 ml', 20], ['IV Cannula 20G', 5]] },
    { dept: 'Laboratory', status: 'approved', priority: 'normal', purpose: 'Reagent restock for haematology', ago: 18, lines: [['CBC Reagent Kit', 6], ['Blood Glucose Test Strips', 20]] },
    { dept: 'General Ward', status: 'submitted', priority: 'normal', purpose: 'Replace worn bed linen', ago: 3, lines: [['Bed Sheet (Single, White)', 120]] },
    { dept: 'Housekeeping', status: 'draft', priority: 'normal', purpose: 'Cleaning supplies for next month', ago: 1, lines: [['Floor Disinfectant 5 L', 25]] },
    { dept: 'Administration', status: 'rejected', priority: 'normal', purpose: 'Extra printer paper', ago: 10, lines: [['A4 Paper Ream', 200]] },
    { dept: 'Operation Theatre', status: 'cancelled', priority: 'emergency', purpose: 'Gauze for OT — bought locally instead', ago: 8, lines: [['Surgical Gauze Roll', 40]] },
  ]
  const prs = []
  for (const p of PRS) {
    const pr = await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG, 'PURCHASE_REQUEST', 'PR')
      const lines = p.lines.map(([name, qty], i) => {
        const it = items[name]; const u = lineUnit(name)
        return {
          organizationId: ORG, itemId: it.id, itemCode: it.code, itemName: it.name, unitId: u.unit.id, unitCode: u.unit.code,
          unitFactor: u.factor, quantity: qty, estimatedRate: u.rate, gstRate: it.gstRate,
          lineTotal: round2(qty * u.rate * (1 + it.gstRate / 100)), sortOrder: i,
        }
      })
      const created = daysAgo(p.ago)
      return tx.purchaseRequest.create({
        data: {
          organizationId: ORG, number, status: p.status, departmentId: depts[p.dept].id,
          requestedById: actor.id, requestedByName: actor.name, priority: p.priority, purpose: p.purpose,
          requiredBy: daysAhead(7), estimatedTotal: round2(lines.reduce((s, l) => s + l.lineTotal, 0)),
          submittedAt: p.status !== 'draft' ? created : null,
          decidedAt: ['approved', 'rejected'].includes(p.status) ? new Date(created.getTime() + DAY) : null,
          cancelledAt: p.status === 'cancelled' ? new Date(created.getTime() + DAY) : null,
          cancelReason: p.status === 'cancelled' ? 'Bought locally in an emergency' : null,
          createdAt: created,
          lines: { create: lines },
        },
        include: { lines: true },
      })
    })
    prs.push(pr)
    console.log(`  ✅ ${pr.number}  ${p.dept} — ${p.status}`)
  }

  // ── Purchase orders ────────────────────────────────────────────────────────
  // receive: fraction of each line received; bill/pay describe what follows.
  const POS = [
    { vendor: 'MediEquip Surgicals', status: 'received', ago: 16, pr: prs[0], receive: 1, bill: 'approved', pay: 'full', lines: [['Nitrile Examination Gloves (M)', 10], ['Disposable Syringe 5 ml', 20], ['IV Cannula 20G', 5]] },
    { vendor: 'Apex Diagnostics Reagents', status: 'received', ago: 14, pr: prs[1], receive: 1, bill: 'approved', pay: 'part', returns: true, lines: [['CBC Reagent Kit', 6], ['Blood Glucose Test Strips', 20]] },
    { vendor: 'Cipla Medical Supplies', status: 'partly_received', ago: 9, receive: 0.5, bill: 'on_hold', lines: [['Normal Saline 500 ml', 10]] },
    { vendor: 'Sun Pharma Distributors', status: 'received', ago: 12, receive: 1, bill: 'draft', lines: [['Paracetamol 500 mg Tablet', 30]] },
    { vendor: 'Oxygen Gas Suppliers', status: 'sent', ago: 4, lines: [['Medical Oxygen Cylinder (Refill)', 40]] },
    { vendor: 'BioMed Equipment Maintenance', status: 'approved', ago: 3, lines: [['Ventilator AMC (Annual)', 1]] },
    { vendor: 'CleanCare Housekeeping Services', status: 'submitted', ago: 2, lines: [['Housekeeping Manpower', 3]] },
    { vendor: 'MediEquip Surgicals', status: 'draft', ago: 0, lines: [['Surgical Gauze Roll', 30]] },
  ]
  const pos = []
  for (const p of POS) {
    const v = vendor(p.vendor)
    const gstType = gstTypeFor(v, hospitalState)
    const created = daysAgo(p.ago)
    const po = await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG, 'PURCHASE_PO', 'PO')
      const lines = p.lines.map(([name, qty], i) => {
        const it = items[name]; const u = lineUnit(name)
        const prLine = p.pr?.lines.find((l) => l.itemId === it.id)
        const amt = lineAmounts({ quantity: qty, rate: u.rate, discountPct: 0, gstRate: it.gstRate }, gstType)
        return {
          organizationId: ORG, itemId: it.id, itemCode: it.code, itemName: it.name, hsnCode: it.hsnCode,
          unitId: u.unit.id, unitCode: u.unit.code, unitFactor: u.factor, quantity: qty, rate: u.rate,
          gstRate: it.gstRate, ...amt, requestLineId: prLine?.id || null, sortOrder: i,
        }
      })
      const after = (s) => ['approved', 'sent', 'partly_received', 'received'].includes(s)
      return tx.purchaseOrder.create({
        data: {
          organizationId: ORG, number, status: p.status, vendorId: v.id, vendorName: v.name,
          orderDate: created, expectedDate: new Date(created.getTime() + 5 * DAY), gstType,
          paymentTermsDays: v.paymentTermsDays, terms: 'Quote this PO number on the invoice and the delivery challan.',
          notes: `${SEED} Demo order`, ...orderTotals(lines, gstType),
          createdById: actor.id, createdByName: actor.name,
          submittedAt: p.status !== 'draft' ? created : null,
          decidedAt: after(p.status) ? created : null,
          sentAt: after(p.status) && p.status !== 'approved' ? new Date(created.getTime() + DAY / 2) : null,
          createdAt: created,
          lines: { create: lines },
        },
        include: { lines: true },
      })
    })
    if (p.pr) await db.purchaseRequest.update({ where: { id: p.pr.id }, data: { status: 'ordered' } }).catch(() => {})
    pos.push({ ...po, plan: p, vendor: v })
    console.log(`  ✅ ${po.number}  ${v.name} — ${p.status}  ₹${po.total}`)
  }

  // ── Goods receipts (stock in) ──────────────────────────────────────────────
  const grns = {}
  for (const po of pos.filter((o) => o.plan.receive)) {
    const receivedAt = new Date(po.orderDate.getTime() + 3 * DAY)
    const grn = await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG, 'PURCHASE_GRN', 'GRN')
      const receipt = await tx.goodsReceipt.create({
        data: {
          organizationId: ORG, number, orderId: po.id, vendorId: po.vendorId, vendorName: po.vendorName,
          receivedAt, challanNumber: `DC-${Math.floor(1000 + Math.random() * 9000)}`, challanDate: receivedAt,
          receivedById: actor.id, receivedByName: actor.name, createdAt: receivedAt,
        },
      })
      let totalValue = 0
      for (const [i, ol] of po.lines.entries()) {
        const qty = roundQty(ol.quantity * po.plan.receive)
        // One damaged box on the first line of the first order, turned back at the door.
        const rejected = po === pos[0] && i === 0 ? 1 : 0
        const accepted = qty - rejected
        const stockQty = roundQty(accepted * ol.unitFactor)
        const unitCost = round2(ol.rate / ol.unitFactor)
        const before = (await tx.stockBatch.aggregate({ where: { organizationId: ORG, itemId: ol.itemId }, _sum: { quantity: true } }))._sum.quantity || 0
        const batchNumber = `B${receivedAt.getFullYear()}${String(i + 1).padStart(2, '0')}${Math.floor(100 + Math.random() * 900)}`
        const expiryDate = items[ol.itemName]?.seed.cat.match(/MEDICINE|LAB|SURGICAL/) ? daysAhead(i === 0 ? 400 : 200 + i * 30) : null
        const batch = await tx.stockBatch.create({
          data: { organizationId: ORG, itemId: ol.itemId, batchNumber, expiryDate, quantity: stockQty, receivedQty: stockQty, unitCost, receivedAt },
        })
        await tx.stockMovement.create({
          data: {
            organizationId: ORG, itemId: ol.itemId, batchId: batch.id, type: 'receipt', quantity: stockQty, balanceAfter: roundQty(before + stockQty),
            reference: number, referenceId: receipt.id, note: `From ${po.vendorName} on ${po.number}`, createdById: actor.id, createdByName: actor.name, createdAt: receivedAt,
          },
        })
        await tx.goodsReceiptLine.create({
          data: {
            organizationId: ORG, receiptId: receipt.id, orderLineId: ol.id, itemId: ol.itemId, itemCode: ol.itemCode, itemName: ol.itemName,
            unitId: ol.unitId, unitCode: ol.unitCode, unitFactor: ol.unitFactor, receivedQty: qty, acceptedQty: accepted,
            rejectedQty: rejected, rejectReason: rejected ? 'Box crushed in transit' : null,
            batchNumber, expiryDate, rate: ol.rate, stockQty, batchId: batch.id,
          },
        })
        await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { receivedQty: accepted } })
        await tx.item.update({ where: { id: ol.itemId }, data: { lastPurchasePrice: unitCost, lastPurchaseDate: receivedAt } })
        ol.receivedQty = accepted; ol.batchId = batch.id; ol.batchNumber = batchNumber
        totalValue += accepted * ol.rate
      }
      return tx.goodsReceipt.update({ where: { id: receipt.id }, data: { totalValue: round2(totalValue) } })
    })
    grns[po.id] = grn
    console.log(`  ✅ ${grn.number}  against ${po.number}  ₹${grn.totalValue}`)
  }

  // ── Vendor bills (three-way matched against PO + GRN) ─────────────────────
  const bills = {}
  for (const po of pos.filter((o) => o.plan.bill)) {
    const v = po.vendor
    const invoiceDate = new Date(po.orderDate.getTime() + 4 * DAY)
    const bill = await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG, 'PURCHASE_BILL', 'BILL')
      const lines = po.lines.map((ol, i) => {
        const amt = lineAmounts({ quantity: ol.receivedQty, rate: ol.rate, gstRate: ol.gstRate }, po.gstType)
        return {
          organizationId: ORG, orderLineId: ol.id, itemId: ol.itemId, itemCode: ol.itemCode, itemName: ol.itemName, hsnCode: ol.hsnCode,
          unitCode: ol.unitCode, quantity: ol.receivedQty, rate: ol.rate, gstRate: ol.gstRate, ...amt,
          orderRate: ol.rate, billableQty: ol.receivedQty, sortOrder: i,
        }
      })
      const totals = orderTotals(lines, po.gstType)
      const tdsRate = v.defaultTdsSection === '194J' ? 10 : v.defaultTdsSection === '194C' ? 2 : 0
      const tdsAmount = Math.round(totals.subtotal * tdsRate / 100)
      const invNo = `INV/${invoiceDate.getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`
      const status = po.plan.bill
      const sentOn = status !== 'draft'
      const b = await tx.vendorBill.create({
        data: {
          organizationId: ORG, number, status, vendorId: v.id, vendorName: v.name, orderId: po.id,
          vendorInvoiceNumber: invNo, vendorInvoiceKey: invNo.replace(/\s+/g, '').toUpperCase(), vendorInvoiceDate: invoiceDate,
          invoiceTotal: totals.total, gstType: po.gstType, ...totals,
          tdsSection: v.defaultTdsSection, tdsRate, tdsAmount, payable: round2(totals.total - tdsAmount),
          paymentTermsDays: v.paymentTermsDays, dueDate: v.paymentTermsDays != null ? new Date(invoiceDate.getTime() + v.paymentTermsDays * DAY) : null,
          matched: status !== 'on_hold', mismatch: status === 'on_hold' ? 'Invoice rate for Normal Saline does not match the order — on hold until the vendor confirms.' : null,
          createdById: actor.id, createdByName: actor.name,
          submittedAt: sentOn ? invoiceDate : null,
          decidedAt: status === 'approved' ? new Date(invoiceDate.getTime() + DAY) : null,
          decidedById: status === 'approved' ? actor.id : null, decidedByName: status === 'approved' ? actor.name : null,
          createdAt: invoiceDate,
          lines: { create: lines },
        },
      })
      if (sentOn) for (const ol of po.lines) await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { billedQty: ol.receivedQty } })
      return b
    })
    bills[po.id] = bill
    console.log(`  ✅ ${bill.number}  ${v.name} — ${bill.status}  payable ₹${bill.payable}`)
  }

  // ── Purchase return + debit note (before payment, so the bill nets it off) ─
  for (const po of pos.filter((o) => o.plan.returns)) {
    const bill = bills[po.id]
    const ol = po.lines[1] // two boxes of glucose strips came near expiry
    const plans = [{ status: 'posted', qty: 2, reason: 'near_expiry' }, { status: 'pending_approval', qty: 1, reason: 'damaged' }]
    for (const r of plans) {
      await db.$transaction(async (tx) => {
        const number = await nextSeriesNumber(tx, ORG, 'PURCHASE_RETURN', 'RTV')
        const amt = lineAmounts({ quantity: r.qty, rate: ol.rate, gstRate: ol.gstRate }, po.gstType)
        const stockQty = roundQty(r.qty * ol.unitFactor)
        const posted = r.status === 'posted'
        const ret = await tx.purchaseReturn.create({
          data: {
            organizationId: ORG, number, status: r.status, vendorId: po.vendorId, vendorName: po.vendorName, orderId: po.id,
            receiptId: grns[po.id].id, billId: bill.id, reason: r.reason,
            notes: posted ? 'Expiry under 3 months — vendor agreed to take back' : 'Seal broken on one box',
            subtotal: amt.taxable, gstAmount: amt.gstAmount, total: amt.lineTotal,
            debitNoteNumber: posted ? await nextSeriesNumber(tx, ORG, 'DEBIT_NOTE', 'DN') : null,
            createdById: actor.id, createdByName: actor.name,
            decidedAt: posted ? new Date() : null, decidedById: posted ? actor.id : null, decidedByName: posted ? actor.name : null, postedAt: posted ? new Date() : null,
            lines: {
              create: {
                organizationId: ORG, orderLineId: ol.id, itemId: ol.itemId, itemCode: ol.itemCode, itemName: ol.itemName, unitCode: ol.unitCode,
                unitFactor: ol.unitFactor, quantity: r.qty, stockQty, batchId: ol.batchId, batchNumber: ol.batchNumber,
                rate: ol.rate, gstRate: ol.gstRate, ...amt,
              },
            },
          },
        })
        if (posted) {
          const batch = await tx.stockBatch.update({ where: { id: ol.batchId }, data: { quantity: { decrement: stockQty } } })
          const left = (await tx.stockBatch.aggregate({ where: { organizationId: ORG, itemId: ol.itemId }, _sum: { quantity: true } }))._sum.quantity || 0
          await tx.stockMovement.create({
            data: { organizationId: ORG, itemId: ol.itemId, batchId: batch.id, type: 'return', quantity: -stockQty, balanceAfter: roundQty(left), reference: number, referenceId: ret.id, note: `Returned to ${po.vendorName} — Near expiry`, createdById: actor.id, createdByName: actor.name },
          })
          await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { returnedQty: r.qty } })
          bill.debitNoteTotal = round2((bill.debitNoteTotal || 0) + amt.lineTotal)
          await tx.vendorBill.update({ where: { id: bill.id }, data: { debitNoteTotal: bill.debitNoteTotal } })
        }
        console.log(`  ✅ ${number}  ${po.vendorName} — ${r.status}  ₹${amt.lineTotal}`)
      })
    }
  }

  // ── Vendor payments ────────────────────────────────────────────────────────
  for (const po of pos.filter((o) => o.plan.pay)) {
    const bill = bills[po.id]
    const due = round2(bill.payable - (bill.debitNoteTotal || 0))
    const parts = po.plan.pay === 'full'
      ? [{ amount: due, mode: 'neft', status: 'posted' }]
      : [{ amount: round2(due * 0.5), mode: 'rtgs', status: 'posted' }, { amount: round2(due * 0.25), mode: 'cheque', status: 'pending_approval' }]
    for (const [i, p] of parts.entries()) {
      const pay = await db.$transaction(async (tx) => {
        const number = await nextSeriesNumber(tx, ORG, 'VENDOR_PAYMENT', 'VPAY')
        const posted = p.status === 'posted'
        const row = await tx.vendorPayment.create({
          data: {
            organizationId: ORG, number, status: p.status, vendorId: po.vendorId, vendorName: po.vendorName, billId: bill.id,
            amount: p.amount, mode: p.mode, reference: p.mode === 'cheque' ? `CHQ${100200 + i}` : `UTR${Date.now().toString().slice(-10)}${i}`,
            paidOn: daysAgo(2 - i), createdById: actor.id, createdByName: actor.name,
            decidedAt: posted ? daysAgo(2 - i) : null, decidedById: posted ? actor.id : null, decidedByName: posted ? actor.name : null,
          },
        })
        if (posted) await tx.vendorBill.update({ where: { id: bill.id }, data: { amountPaid: { increment: p.amount } } })
        return row
      })
      console.log(`  ✅ ${pay.number}  ${po.vendorName} — ${pay.status}  ₹${pay.amount} (${pay.mode})`)
    }
  }

  // ── RFQs ───────────────────────────────────────────────────────────────────
  const RFQS = [
    { title: 'Bed linen for General Ward', status: 'open', pr: prs[2], lines: [['Bed Sheet (Single, White)', 120]], vendors: [['MediEquip Surgicals', 235, 7], ['CleanCare Housekeeping Services', 250, 5], ['Sun Pharma Distributors', null, null]] },
    { title: 'Floor disinfectant — quarterly', status: 'draft', lines: [['Floor Disinfectant 5 L', 60]], vendors: [['CleanCare Housekeeping Services'], ['MediEquip Surgicals']] },
    { title: 'Oxygen refills — annual rate contract', status: 'awarded', order: pos[4], lines: [['Medical Oxygen Cylinder (Refill)', 40]], vendors: [['Oxygen Gas Suppliers', 350, 1], ['MediEquip Surgicals', 380, 3]] },
  ]
  for (const r of RFQS) {
    const rfq = await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG, 'PURCHASE_RFQ', 'RFQ')
      const sent = r.status !== 'draft'
      const awarded = r.status === 'awarded'
      const created = await tx.rfq.create({
        data: {
          organizationId: ORG, number, status: r.status, title: r.title, requestId: r.pr?.id || null, dueDate: daysAhead(5),
          awardedVendorId: awarded ? vendor(r.vendors[0][0]).id : null, orderId: awarded ? r.order.id : null,
          awardedAt: awarded ? r.order.orderDate : null, awardNote: awarded ? 'Lowest rate and next-day delivery' : null,
          createdById: actor.id, createdByName: actor.name, sentAt: sent ? daysAgo(2) : null,
          lines: {
            create: r.lines.map(([name, qty], i) => {
              const it = items[name]; const u = lineUnit(name)
              return {
                organizationId: ORG, itemId: it.id, itemCode: it.code, itemName: it.name, unitId: u.unit.id, unitCode: u.unit.code,
                unitFactor: u.factor, quantity: qty, sortOrder: i, requestLineId: r.pr?.lines.find((l) => l.itemId === it.id)?.id || null,
              }
            }),
          },
        },
        include: { lines: true },
      })
      for (const [vname, rate, days] of r.vendors) {
        const v = vendor(vname)
        const quoted = sent && rate != null
        await tx.rfqVendor.create({
          data: {
            organizationId: ORG, rfqId: created.id, vendorId: v.id, vendorName: v.name,
            status: !sent ? 'invited' : quoted ? 'quoted' : rate === null ? 'declined' : 'invited',
            quotedAt: quoted ? daysAgo(1) : null, deliveryDays: days ?? null, validTill: quoted ? daysAhead(30) : null,
            quotes: quoted ? { create: created.lines.map((l) => ({ organizationId: ORG, rfqLineId: l.id, rate, gstRate: items[l.itemName].gstRate })) } : undefined,
          },
        })
      }
      return created
    })
    console.log(`  ✅ ${rfq.number}  ${r.title} — ${r.status}`)
  }

  // ── Store indents and issues (stock out, oldest expiry first) ─────────────
  const INDENTS = [
    { dept: 'ICU', status: 'issued', lines: [['Nitrile Examination Gloves (M)', 300, 300], ['Disposable Syringe 5 ml', 200, 200]] },
    { dept: 'Operation Theatre', status: 'partly_issued', priority: 'urgent', lines: [['IV Cannula 20G', 150, 80], ['Nitrile Examination Gloves (M)', 200, 200]] },
    { dept: 'Laboratory', status: 'submitted', lines: [['CBC Reagent Kit', 2, 0], ['Blood Glucose Test Strips', 3, 0]] },
    { dept: 'General Ward', status: 'submitted', lines: [['Paracetamol 500 mg Tablet', 50, 0]] },
  ]
  for (const ind of INDENTS) {
    await db.$transaction(async (tx) => {
      const number = await nextSeriesNumber(tx, ORG, 'STORE_INDENT', 'IND')
      const indent = await tx.storeIndent.create({
        data: {
          organizationId: ORG, number, status: ind.status, departmentId: depts[ind.dept].id,
          requestedById: actor.id, requestedByName: actor.name, priority: ind.priority || 'normal',
          neededBy: daysAhead(2), purpose: `Ward stock for ${ind.dept}`,
          lines: {
            create: ind.lines.map(([name, qty, issued], i) => {
              const it = items[name]
              return { organizationId: ORG, itemId: it.id, itemCode: it.code, itemName: it.name, unitId: it.stockUnitId, unitCode: it.seed.unit, unitFactor: 1, quantity: qty, issuedQty: issued, sortOrder: i }
            }),
          },
        },
        include: { lines: true },
      })
      if (!indent.lines.some((l) => l.issuedQty > 0)) return console.log(`  ✅ ${number}  ${ind.dept} — ${ind.status}`)

      const issueNo = await nextSeriesNumber(tx, ORG, 'STORE_ISSUE', 'ISS')
      const issue = await tx.storeIssue.create({
        data: { organizationId: ORG, number: issueNo, indentId: indent.id, departmentId: depts[ind.dept].id, issuedById: actor.id, issuedByName: actor.name, receivedByName: `${ind.dept} nurse in-charge` },
      })
      let totalValue = 0
      for (const line of indent.lines.filter((l) => l.issuedQty > 0)) {
        let need = line.issuedQty
        const batches = await tx.stockBatch.findMany({ where: { organizationId: ORG, itemId: line.itemId, quantity: { gt: 0 } }, orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }] })
        for (const b of batches) {
          if (need <= 0) break
          const qty = Math.min(need, b.quantity)
          need -= qty
          await tx.stockBatch.update({ where: { id: b.id }, data: { quantity: roundQty(b.quantity - qty) } })
          const left = (await tx.stockBatch.aggregate({ where: { organizationId: ORG, itemId: line.itemId }, _sum: { quantity: true } }))._sum.quantity || 0
          await tx.stockMovement.create({
            data: { organizationId: ORG, itemId: line.itemId, batchId: b.id, type: 'issue', quantity: -qty, balanceAfter: roundQty(left), reference: issueNo, referenceId: issue.id, note: `Issued to ${ind.dept} on ${number}`, createdById: actor.id, createdByName: actor.name },
          })
          await tx.storeIssueLine.create({
            data: {
              organizationId: ORG, issueId: issue.id, indentLineId: line.id, itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName,
              unitCode: line.unitCode, unitFactor: 1, quantity: qty, stockQty: qty, batchId: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, unitCost: b.unitCost,
            },
          })
          totalValue += qty * b.unitCost
        }
        if (need > 0) throw new Error(`Not enough stock of ${line.itemName} to issue on ${number}`)
      }
      await tx.storeIssue.update({ where: { id: issue.id }, data: { totalValue: round2(totalValue) } })
      console.log(`  ✅ ${number}  ${ind.dept} — ${ind.status}  (issue ${issueNo}, ₹${round2(totalValue)})`)
    })
  }

  console.log('\n🎉 Purchase & Supply Chain seeded.')
}

main()
  .catch((e) => { console.error('Seed failed:', e.message); process.exit(1) })
  .finally(() => db.$disconnect())
