import { useState, useRef, useCallback, useMemo } from 'react'
import { purchaseApi } from '@/api/purchaseApi'
import { formatMoney } from '@/lib/format'
import { showApiError } from '@/lib/apiRequest'
import { flattenCategories, categoryPickerOptions } from './categoryOptions'

// Choosing items on a purchase document — a request and an order alike: a
// category per line, then an item picker that offers only that category's
// items, shown the moment it opens. One copy, so both forms pick the same way.

/** "All categories" in the picker; stored on a line as ''. */
export const ALL = '__all'
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** The units an item can be bought in: its stock unit, then its conversions. */
export function unitsOf(item) {
  if (!item) return []
  return [
    { id: item.stockUnit.id, code: item.stockUnit.code, factor: 1, allowsFraction: item.stockUnit.allowsFraction },
    ...item.conversions.map((c) => ({ id: c.unitId, code: c.unit.code, factor: c.factor, isPurchaseDefault: c.isPurchaseDefault, allowsFraction: c.unit.allowsFraction })),
  ]
}

/** The last price paid, scaled to a unit (a box of 100 at ₹2 a piece is ₹200), or ''. */
export const suggestedRate = (item, factor) => (item?.lastPurchasePrice != null ? String(round2(item.lastPurchasePrice * factor)) : '')

// Default lookup: the purchase item master, with its last price. A caller with
// a different source of items (the store indent's own stock-only search) passes
// its own `fetchItems`/`formatOption` — stable references (module-level, not
// defined inline per render) so callers that don't override them keep the same
// memoized `searchItems` they always had.
const defaultFetchItems = (params) => purchaseApi.getItems(params).then((r) => r?.data ?? [])
const defaultFormatOption = (it) =>
  `${it.code} · ${it.category?.name || ''} · ${it.stockUnit?.code}${it.lastPurchasePrice != null ? ` · last ${formatMoney(it.lastPurchasePrice)}` : ''}`

/**
 * Per-line item search. `categories` is the tree from resource=categories.
 * searchItems(lineKey, query, categoryId) fills itemOptions[lineKey]; `found`
 * keeps every item seen, so a picked id can be turned back into the item.
 */
export function useItemSearch(categories, { fetchItems = defaultFetchItems, formatOption = defaultFormatOption, errorMessage = 'Could not search the items' } = {}) {
  const [itemOptions, setItemOptions] = useState({}) // line key → options
  const [searchingLine, setSearchingLine] = useState(null)
  const found = useRef(new Map())
  const firstPages = useRef(new Map()) // categoryId ('' = all) → options shown before typing
  const searchItems = useCallback(async (key, q, categoryId = '') => {
    const show = (options) => setItemOptions((o) => ({ ...o, [key]: options }))
    if (!q && firstPages.current.has(categoryId)) { show(firstPages.current.get(categoryId)); return }
    setSearchingLine(key)
    try {
      const rows = await fetchItems({ search: q, status: 'active', categoryId: categoryId || undefined, page: 1, limit: 30 })
      rows.forEach((it) => found.current.set(it.id, it))
      const options = rows.map((it) => ({ value: it.id, label: it.name, sublabel: formatOption(it) }))
      if (!q) firstPages.current.set(categoryId, options)
      show(options)
    } catch (err) {
      // Say so, and leave the list as it was: an empty one read as "no such
      // item" and sent people to create a duplicate.
      showApiError(err, errorMessage)
    } finally { setSearchingLine((s) => (s === key ? null : s)) }
  }, [fetchItems, formatOption, errorMessage])
  const categoryOptions = useMemo(() => [
    { value: ALL, label: 'All categories', sublabel: 'Every item' },
    ...categoryPickerOptions(flattenCategories(categories), { showGst: false }),
  ], [categories])
  return { itemOptions, searchingLine, searchItems, found, categoryOptions }
}
