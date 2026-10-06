// The category tree (resource=categories: groups, each with its categories)
// as the pickers need it. One place, so the item form, the Items filter and
// the request form list categories the same way.

/** Every group and category in one list, each category knowing its group. */
export const flattenCategories = (tree = []) => tree.flatMap((top) => [
  { ...top, parentName: null },
  ...top.children.map((c) => ({ ...c, parentName: top.name })),
])

/**
 * Options for a SearchableSelect. A group reads "Medical (all)": choosing it
 * means everything filed under it too — the items list and search treat a
 * group's id that way.
 */
export const categoryPickerOptions = (flat, { showGst = true } = {}) => flat.map((c) => ({
  value: c.id,
  label: c.parentName ? c.name : `${c.name} (all)`,
  sublabel: c.parentName
    ? (showGst ? `${c.parentName} · GST ${c.defaultGstRate ?? 'per item'}${c.defaultGstRate != null ? '%' : ''}` : c.parentName)
    : 'Group',
  keywords: [c.parentName, c.expenseHead].filter(Boolean).join(' '),
}))

/** Options for a category filter (FilterSelect): everything, then each group (all of it) and each category in it. */
export const categoryFilterOptions = (flat, allValue) => [
  { value: allValue, label: 'All categories' },
  ...flat.map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} › ${c.name}` : `${c.name} (all)` })),
]
