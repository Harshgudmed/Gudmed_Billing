import { importCatalog, keyed, str, num, int, bool } from '../utils/catalogImport.js'
import { getOrgId } from "../lib/reqContext.js";

// Bulk import of radiology exams from Excel/CSV rows.
// POST /radiology/import  body: { rows:[...], mode:'validate'|'commit' }
function normalizeRadRow(raw) {
  const pick = keyed(raw)
  return {
    examName: str(pick('examname', 'name', 'exam', 'test', 'testname', 'investigation')),
    examCode: str(pick('examcode', 'code')),
    examCategory: str(pick('examcategory', 'category', 'type', 'modalitytype')),
    bodyPart: str(pick('bodypart', 'part', 'region', 'area', 'site')),
    modality: str(pick('modality', 'machine')),
    price: num(pick('price', 'rate', 'mrp', 'cost', 'amount', 'charges')),
    estimatedDuration: int(pick('estimatedduration', 'duration', 'minutes', 'time')),
    contrastRequired: bool(pick('contrastrequired', 'contrast')),
    preparationInstructions: str(pick('preparationinstructions', 'preparation', 'prep', 'instructions')),
    description: str(pick('description', 'notes', 'remarks')),
  }
}

export async function importExams(req, res, next) {
  try {
    const organizationId = getOrgId(req)
    const mode = req.body?.mode === 'commit' ? 'commit' : 'validate'
    const result = await importCatalog({
      model: 'radiologyExam',
      organizationId,
      rows: req.body?.rows,
      mode,
      nameField: 'examName',
      normalizeRow: normalizeRadRow,
    })
    res.json({
      success: true,
      mode,
      ...result,
      message: mode === 'validate'
        ? `Validation: ${result.summary.created} ready, ${result.summary.duplicates} duplicates, ${result.summary.errors} errors`
        : `Imported ${result.summary.created} exams (${result.summary.duplicates} duplicates skipped, ${result.summary.errors} errors)`,
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message })
    next(err)
  }
}
