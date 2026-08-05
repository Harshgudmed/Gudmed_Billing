export const SEARCHABLE_PATIENT_FIELDS = ['firstName', 'middleName', 'lastName', 'mrn', 'phonePrimary']

/**
 * Builds a search where clause that splits by whitespace and requires all terms to match (AND of ORs).
 * @param {string} search - The search string
 * @param {string|null} relation - The relation name to prefix the fields (e.g. 'patient'). If null, searches fields directly.
 * @param {function} extraOrConditions - A function `(term) => object[]` returning additional OR conditions for each term.
 */
export function patientSearchWhere(search, relation = 'patient', extraOrConditions = null) {
  const terms = String(search || '').trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return null

  return {
    AND: terms.map((term) => {
      const orArray = []
      
      if (extraOrConditions && typeof extraOrConditions === 'function') {
        orArray.push(...extraOrConditions(term))
      }
      
      for (const field of SEARCHABLE_PATIENT_FIELDS) {
        const condition = { [field]: { contains: term, mode: 'insensitive' } }
        orArray.push(relation ? { [relation]: condition } : condition)
      }
      
      return { OR: orArray }
    })
  }
}
