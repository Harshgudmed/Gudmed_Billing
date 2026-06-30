// Phase 3A — Unified "orderable" search (VIRTUAL UNION, read-only).
//
// Doctors search one flat list; the order *type* is intrinsic to the catalog the
// item comes from (NOT guessed from the name). We union four existing catalogs at
// query time and tag each row with its orderType + serviceGroup. No new table,
// no writes, no drift. basePrice is informational only — pricing is resolved by
// the tariff engine later (3B+); 3A never bills.
import { db } from '../config/db.js'

const TAKE = 25

// Map an orderType → the catalog it reads + a normalizer to the unified shape.
const SOURCES = {
  LAB: async (organizationId, q) => {
    const rows = await db.labTest.findMany({
      where: { organizationId, isActive: true, ...(q ? { OR: [{ testName: { contains: q, mode: 'insensitive' } }, { testCode: { contains: q, mode: 'insensitive' } }] } : {}) },
      take: TAKE, orderBy: { testName: 'asc' },
      select: { id: true, testName: true, testCode: true, testCategory: true, price: true },
    })
    return rows.map((r) => ({ orderType: 'LAB', serviceGroup: 'LAB', catalogModel: 'LabTest', catalogItemId: r.id, name: r.testName, code: r.testCode || null, category: r.testCategory || null, basePrice: r.price ?? null }))
  },
  RADIOLOGY: async (organizationId, q) => {
    const rows = await db.radiologyExam.findMany({
      where: { organizationId, isActive: true, ...(q ? { OR: [{ examName: { contains: q, mode: 'insensitive' } }, { examCode: { contains: q, mode: 'insensitive' } }] } : {}) },
      take: TAKE, orderBy: { examName: 'asc' },
      select: { id: true, examName: true, examCode: true, examCategory: true, price: true },
    })
    return rows.map((r) => ({ orderType: 'RADIOLOGY', serviceGroup: 'RADIOLOGY', catalogModel: 'RadiologyExam', catalogItemId: r.id, name: r.examName, code: r.examCode || null, category: r.examCategory || null, basePrice: r.price ?? null }))
  },
  PHARMACY: async (organizationId, q) => {
    const rows = await db.pharmacyDrug.findMany({
      where: { organizationId, isActive: true, ...(q ? { OR: [{ drugName: { contains: q, mode: 'insensitive' } }, { drugCode: { contains: q, mode: 'insensitive' } }] } : {}) },
      take: TAKE, orderBy: { drugName: 'asc' },
      select: { id: true, drugName: true, drugCode: true, drugCategory: true, sellingPrice: true, mrp: true },
    })
    return rows.map((r) => ({ orderType: 'PHARMACY', serviceGroup: 'PHARMACY', catalogModel: 'PharmacyDrug', catalogItemId: r.id, name: r.drugName, code: r.drugCode || null, category: r.drugCategory || null, basePrice: r.sellingPrice ?? r.mrp ?? null }))
  },
  PROCEDURE: async (organizationId, q) => {
    const rows = await db.chargeMaster.findMany({
      where: { organizationId, isActive: true, serviceGroup: 'PROCEDURE', ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}) },
      take: TAKE, orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, basePrice: true },
    })
    return rows.map((r) => ({ orderType: 'PROCEDURE', serviceGroup: 'PROCEDURE', catalogModel: 'ChargeMaster', catalogItemId: r.id, name: r.name, code: r.code || null, category: null, basePrice: r.basePrice ?? null }))
  },
  // Medical supplies / consumables / additional chargeable items (own price — non-tariffable).
  SUPPLY: async (organizationId, q) => {
    const rows = await db.chargeMaster.findMany({
      where: { organizationId, isActive: true, serviceGroup: 'SUPPLY', ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}) },
      take: TAKE, orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, basePrice: true },
    })
    return rows.map((r) => ({ orderType: 'SUPPLY', serviceGroup: 'SUPPLY', catalogModel: 'ChargeMaster', catalogItemId: r.id, name: r.name, code: r.code || null, category: null, basePrice: r.basePrice ?? null }))
  },
  // Specialty / implant orders (pacemaker, stent, gene test, hearing aid… — own price).
  IMPLANT: async (organizationId, q) => {
    const rows = await db.chargeMaster.findMany({
      where: { organizationId, isActive: true, serviceGroup: 'IMPLANT', ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}) },
      take: TAKE, orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, basePrice: true },
    })
    return rows.map((r) => ({ orderType: 'IMPLANT', serviceGroup: 'IMPLANT', catalogModel: 'ChargeMaster', catalogItemId: r.id, name: r.name, code: r.code || null, category: null, basePrice: r.basePrice ?? null }))
  },
}

/**
 * Unified search. `type` (optional) restricts to one catalog; otherwise unions all four.
 * Returns [{ orderType, serviceGroup, catalogModel, catalogItemId, name, code, category, basePrice }].
 */
export async function search(organizationId, { q, type } = {}) {
  const query = (q || '').trim()
  const types = type && SOURCES[type] ? [type] : Object.keys(SOURCES)
  const results = await Promise.all(types.map((t) => SOURCES[t](organizationId, query)))
  const flat = results.flat()
  // Light relevance: exact/prefix name matches first, then alphabetical.
  if (query) {
    const ql = query.toLowerCase()
    flat.sort((a, b) => {
      const ai = a.name.toLowerCase().startsWith(ql) ? 0 : 1
      const bi = b.name.toLowerCase().startsWith(ql) ? 0 : 1
      return ai - bi || a.name.localeCompare(b.name)
    })
  }
  return flat.slice(0, TAKE)
}
