// The checks every purchase document makes on its lines — a request and an
// order alike: the item is this hospital's and live, the unit is one the item
// is bought in (its stock unit or a conversion, e.g. Box = 100), a whole-number
// unit gets a whole number, and an item+unit is on the document once.
import { bad } from './reqContext.js'

/**
 * Resolves typed lines ({ itemId, unitId?, quantity }) against the items.
 * Returns [{ line, item, unit: { id, code, factor, allowsFraction } }] in the
 * same order, or throws a 400 naming the line. `noun` words the duplicate
 * message ("on the request twice").
 */
export async function resolveLines(client, organizationId, lines, { noun = 'document' } = {}) {
  const ids = [...new Set(lines.map((l) => l.itemId))]
  const items = await client.item.findMany({
    where: { organizationId, id: { in: ids } },
    include: {
      stockUnit: { select: { id: true, code: true, allowsFraction: true } },
      conversions: { select: { unitId: true, factor: true, isPurchaseDefault: true, unit: { select: { code: true, allowsFraction: true } } } },
    },
  })
  const byId = new Map(items.map((i) => [i.id, i]))
  const seen = new Set()

  return lines.map((line, i) => {
    const n = i + 1
    const item = byId.get(line.itemId)
    if (!item) throw bad(`Line ${n}: choose an item from the list`)
    if (!item.isActive) throw bad(`Line ${n}: ${item.name} is retired`)

    // No unit sent → the unit the item is usually bought in, else its stock unit.
    const conv = item.conversions
    const unitId = line.unitId || conv.find((c) => c.isPurchaseDefault)?.unitId || item.stockUnitId
    let unit
    if (unitId === item.stockUnitId) {
      unit = { id: item.stockUnit.id, code: item.stockUnit.code, factor: 1, allowsFraction: item.stockUnit.allowsFraction }
    } else {
      const c = conv.find((x) => x.unitId === unitId)
      if (!c) throw bad(`Line ${n}: ${item.name} is not bought in that unit — choose one of its units`)
      unit = { id: c.unitId, code: c.unit.code, factor: c.factor, allowsFraction: c.unit.allowsFraction }
    }
    if (!unit.allowsFraction && !Number.isInteger(line.quantity)) {
      throw bad(`Line ${n}: ${item.name} is counted in whole ${unit.code} — ${line.quantity} is not a whole number`)
    }

    const key = `${item.id}:${unit.id}`
    if (seen.has(key)) throw bad(`${item.name} (${unit.code}) is on the ${noun} twice — put the total on one line`)
    seen.add(key)
    return { line, item, unit }
  })
}

/**
 * The item filter every item list shares — the Items master and the store's
 * stock: a top-level category takes in everything filed under it, and the
 * search looks at name, code, other names and HSN. Adds to `where`.
 */
export function itemSearchWhere(where, { search, categoryId } = {}) {
  if (categoryId) where.OR = [{ categoryId: String(categoryId) }, { category: { parentId: String(categoryId) } }]
  const term = String(search || '').trim()
  if (term) {
    const bySearch = ['name', 'code', 'aliases', 'hsnCode'].map((f) => ({ [f]: { contains: term, mode: 'insensitive' } }))
    where.AND = [...(where.AND || []), { OR: bySearch }]
  }
  return where
}
