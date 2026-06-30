import { importCatalog, keyed, str, num, int } from '../utils/catalogImport.js'
import { getOrgId } from "../lib/reqContext.js";

// Bulk import of pathology / laboratory tests from Excel/CSV rows.
// POST /laboratory/import  body: { rows:[...], mode:'validate'|'commit' }
function normalizeLabRow(raw) {
  const pick = keyed(raw)
  return {
    testName: str(pick('testname', 'name', 'test', 'testtitle', 'investigation')),
    testCode: str(pick('testcode', 'code')),
    testCategory: str(pick('testcategory', 'category')),
    testType: str(pick('testtype', 'type')),
    specimenType: str(pick('specimentype', 'specimen', 'sample', 'sampletype')),
    specimenContainer: str(pick('specimencontainer', 'container', 'tube', 'vial')),
    unit: str(pick('unit', 'units', 'uom')),
    resultType: str(pick('resulttype')),
    referenceRanges: str(pick('referenceranges', 'referencerange', 'normalrange', 'range', 'biologicalreference')),
    price: num(pick('price', 'rate', 'mrp', 'cost', 'amount', 'charges')),
    turnaroundTime: int(pick('turnaroundtime', 'tat', 'turnaround', 'reporttime', 'hours')),
    department: str(pick('department', 'dept')),
    preparationInstructions: str(pick('preparationinstructions', 'preparation', 'prep', 'instructions')),
    clinicalSignificance: str(pick('clinicalsignificance', 'significance', 'remarks')),
  }
}

export async function importTests(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const mode = req.body?.mode === 'commit' ? 'commit' : 'validate'
    const result = await importCatalog({
      model: 'labTest',
      organizationId,
      rows: req.body?.rows,
      mode,
      nameField: 'testName',
      normalizeRow: normalizeLabRow,
    })
    res.json({
      success: true,
      mode,
      ...result,
      message: mode === 'validate'
        ? `Validation: ${result.summary.created} ready, ${result.summary.duplicates} duplicates, ${result.summary.errors} errors`
        : `Imported ${result.summary.created} tests (${result.summary.duplicates} duplicates skipped, ${result.summary.errors} errors)`,
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message })
    next(err)
  }
}
