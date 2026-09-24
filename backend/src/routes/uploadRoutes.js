import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { db } from '../config/db.js'
import { authenticate } from '../middleware/auth.js'
import { getOrgId } from '../lib/reqContext.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads')

export const router = Router()

/**
 * An uploaded patient document — a scan, a report, an identity card.
 *
 * These used to be handed out by `express.static`, mounted before any login
 * check: anyone holding the URL — forwarded, pasted into a chat, found in a
 * browser history on a shared desk — could open a patient's records from the
 * open internet, for ever, with nothing recorded. The random filename was the
 * only thing standing in the way, and a filename is not a password.
 *
 * So the file is served the way its record is: the row is looked up first, and
 * it is handed over only to this hospital's staff, or to the patient it belongs
 * to. Anything else is a 404 — the same answer for "no such file" and "not
 * yours", so the endpoint cannot be used to find out which files exist.
 */
router.get('/patient-documents/:filename', authenticate, async (req, res, next) => {
  try {
    const { filename } = req.params
    // The filename is the only part that comes from the caller, and it is used
    // to build a path — so it may contain nothing but a plain file name.
    if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes('..')) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }

    const doc = await db.patientDocument.findFirst({
      where: { fileUrl: `/uploads/patient-documents/${filename}` },
      select: { organizationId: true, patientId: true, fileType: true },
    })
    if (!doc) return res.status(404).json({ success: false, error: 'File not found' })

    const isThePatient = req.user?.patientId && req.user.patientId === doc.patientId
    const isTheHospital = req.user && !req.user.patientId && getOrgId(req) === doc.organizationId
    if (!isThePatient && !isTheHospital) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }

    const filePath = path.join(UPLOAD_ROOT, 'patient-documents', filename)
    if (!filePath.startsWith(UPLOAD_ROOT) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }

    // A health record must not sit in a shared cache or a proxy.
    res.setHeader('Cache-Control', 'private, no-store')
    if (doc.fileType) res.type(doc.fileType)
    return res.sendFile(filePath)
  } catch (err) { next(err) }
})

export default router
