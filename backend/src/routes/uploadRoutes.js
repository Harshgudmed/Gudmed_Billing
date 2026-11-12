import { Router } from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { db } from '../config/db.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { getOrgId } from '../lib/reqContext.js'
import { canManageMasters, canSeeBills, canSeeVendors, canReceive, requirePurchaseOn } from '../lib/purchaseAccess.js'
import { PATIENT_DOC_MIME, PATIENT_DOC_EXT, PATIENT_DOC_MAX_BYTES, PATIENT_DOC_TYPES_LABEL, PATIENT_DOC_ROLES, patientDocUploadError } from '../lib/patientDocumentUpload.js'
import { canManageAssets } from '../lib/assetAccess.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads')

export const router = Router()

// ─── Vendor document upload ───────────────────────────────────────────────────
// Finance and purchase roles upload compliance documents (PAN cert, GST cert)
// against a vendor. Served back only to staff of the same hospital.

const VENDOR_DOC_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const VENDOR_DOC_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' }

const vendorDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'vendor-documents')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `vendordoc-${suffix}${VENDOR_DOC_EXT[file.mimetype] || ''}`)
  },
})

const uploadVendorDoc = multer({
  storage: vendorDocStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (VENDOR_DOC_MIME.has(file.mimetype)) return cb(null, true)
    cb(new Error('Only JPG, PNG or PDF files are allowed'))
  },
})

// POST /uploads/vendor-documents  — upload one document for a vendor
router.post('/vendor-documents', authenticate, requirePurchaseOn, (req, res, next) => {
  if (!canManageMasters(req)) return res.status(403).json({ success: false, error: 'Only the purchase officer or an administrator can upload vendor documents' })
  uploadVendorDoc.single('document')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' })
    next()
  })
}, async (req, res, next) => {
  try {
    const orgId = getOrgId(req)
    const { vendorId, docType, label } = req.body
    if (!vendorId || !docType) return res.status(400).json({ success: false, error: 'vendorId and docType are required' })
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' })

    // Confirm the vendor belongs to this hospital (IDOR guard)
    const vendor = await db.vendor.findFirst({ where: { id: vendorId, organizationId: orgId }, select: { id: true } })
    if (!vendor) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, error: 'Vendor not found' })
    }

    const fileUrl = `/uploads/vendor-documents/${req.file.filename}`
    const doc = await db.vendorDocument.create({
      data: {
        organizationId: orgId,
        vendorId,
        docType,
        label: label?.trim() || null,
        fileName: req.file.originalname,
        fileUrl,
        uploadedById: req.user?.id || null,
      },
    })
    res.json({ success: true, data: doc })
  } catch (err) {
    // If DB write fails, remove the file so disk and DB stay in sync
    if (req.file) fs.unlink(req.file.path, () => {})
    next(err)
  }
})

// GET /uploads/vendor-documents/:filename  — serve a vendor document
// Only this hospital's staff can fetch it; 404 for wrong org or missing file.
router.get('/vendor-documents/:filename', authenticate, requirePurchaseOn, async (req, res, next) => {
  try {
    if (!canSeeVendors(req)) return res.status(403).json({ success: false, error: 'Vendor documents are for the purchase team and Finance' })
    const { filename } = req.params
    if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes('..')) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    const doc = await db.vendorDocument.findFirst({
      where: { fileUrl: `/uploads/vendor-documents/${filename}` },
      select: { organizationId: true },
    })
    if (!doc || getOrgId(req) !== doc.organizationId) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    const filePath = path.join(UPLOAD_ROOT, 'vendor-documents', filename)
    if (!filePath.startsWith(UPLOAD_ROOT) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    res.setHeader('Cache-Control', 'private, no-store')
    return res.sendFile(filePath)
  } catch (err) { next(err) }
})

// ─── Vendor-bill document upload (invoice PDF/Word + supporting) ───────────────
// Finance / purchase roles attach the vendor's actual invoice and any supporting
// papers to a bill. One bill can carry several (a PO may be billed across
// invoices). Served back only to staff of the same hospital.

const BILL_DOC_MIME = new Set([
  'image/jpeg', 'image/png', 'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
])
const BILL_DOC_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
}

const billDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'bill-documents')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `billdoc-${suffix}${BILL_DOC_EXT[file.mimetype] || ''}`)
  },
})

const uploadBillDoc = multer({
  storage: billDocStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (BILL_DOC_MIME.has(file.mimetype)) return cb(null, true)
    cb(new Error('Only PDF, Word (.doc/.docx), JPG or PNG files are allowed'))
  },
})

// POST /uploads/bill-documents — attach one invoice/supporting file to a vendor bill
router.post('/bill-documents', authenticate, requirePurchaseOn, (req, res, next) => {
  if (!canSeeBills(req)) return res.status(403).json({ success: false, error: 'Vendor bill documents are for the purchase team and Finance' })
  uploadBillDoc.single('document')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' })
    next()
  })
}, async (req, res, next) => {
  try {
    const orgId = getOrgId(req)
    const { billId, docType, label } = req.body
    if (!billId || !docType) return res.status(400).json({ success: false, error: 'billId and docType are required' })
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' })

    // Confirm the bill belongs to this hospital (IDOR guard)
    const bill = await db.vendorBill.findFirst({ where: { id: billId, organizationId: orgId }, select: { id: true } })
    if (!bill) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, error: 'Bill not found' })
    }

    const fileUrl = `/uploads/bill-documents/${req.file.filename}`
    const doc = await db.vendorBillDocument.create({
      data: {
        organizationId: orgId,
        billId,
        docType,
        label: label?.trim() || null,
        fileName: req.file.originalname,
        fileUrl,
        uploadedById: req.user?.id || null,
      },
    })
    res.json({ success: true, data: doc })
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {})
    next(err)
  }
})

// DELETE /uploads/bill-documents/:id — remove an attachment (its file + row)
router.delete('/bill-documents/:id', authenticate, requirePurchaseOn, async (req, res, next) => {
  try {
    if (!canSeeBills(req)) return res.status(403).json({ success: false, error: 'Vendor bill documents are for the purchase team and Finance' })
    const orgId = getOrgId(req)
    const doc = await db.vendorBillDocument.findFirst({ where: { id: req.params.id, organizationId: orgId } })
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' })
    await db.vendorBillDocument.delete({ where: { id: doc.id } })
    const filePath = path.join(UPLOAD_ROOT, 'bill-documents', path.basename(doc.fileUrl))
    if (filePath.startsWith(UPLOAD_ROOT)) fs.unlink(filePath, () => {})
    res.json({ success: true })
  } catch (err) { next(err) }
})

// GET /uploads/bill-documents/:filename — serve a bill document to this hospital's staff
router.get('/bill-documents/:filename', authenticate, requirePurchaseOn, async (req, res, next) => {
  try {
    if (!canSeeBills(req)) return res.status(403).json({ success: false, error: 'Vendor bill documents are for the purchase team and Finance' })
    const { filename } = req.params
    if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes('..')) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    const doc = await db.vendorBillDocument.findFirst({
      where: { fileUrl: `/uploads/bill-documents/${filename}` },
      select: { organizationId: true },
    })
    if (!doc || getOrgId(req) !== doc.organizationId) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    const filePath = path.join(UPLOAD_ROOT, 'bill-documents', filename)
    if (!filePath.startsWith(UPLOAD_ROOT) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    res.setHeader('Cache-Control', 'private, no-store')
    return res.sendFile(filePath)
  } catch (err) { next(err) }
})

// ─── Goods-receipt document upload (invoice / delivery challan / logistics challan) ─
// Store and purchase staff — whoever may receive goods — attach the vendor's
// invoice and the challan scans to a GRN. Several files can go up, each its
// own GoodsReceiptDocument. Served back only to this hospital's staff.

const RECEIPT_DOC_MIME = BILL_DOC_MIME
const RECEIPT_DOC_EXT = BILL_DOC_EXT

const receiptDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'receipt-documents')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `receiptdoc-${suffix}${RECEIPT_DOC_EXT[file.mimetype] || ''}`)
  },
})

const uploadReceiptDoc = multer({
  storage: receiptDocStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (RECEIPT_DOC_MIME.has(file.mimetype)) return cb(null, true)
    cb(new Error('Only PDF, Word (.doc/.docx), JPG or PNG files are allowed'))
  },
})

// POST /uploads/receipt-documents — attach one invoice/challan file to a GRN
router.post('/receipt-documents', authenticate, requirePurchaseOn, (req, res, next) => {
  if (!canReceive(req)) return res.status(403).json({ success: false, error: 'Only store and purchase staff attach documents to a goods receipt' })
  uploadReceiptDoc.single('document')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' })
    next()
  })
}, async (req, res, next) => {
  try {
    const orgId = getOrgId(req)
    const { receiptId, docType, label } = req.body
    if (!receiptId || !docType) return res.status(400).json({ success: false, error: 'receiptId and docType are required' })
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' })

    // Confirm the receipt belongs to this hospital (IDOR guard)
    const receipt = await db.goodsReceipt.findFirst({ where: { id: receiptId, organizationId: orgId }, select: { id: true } })
    if (!receipt) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, error: 'Goods receipt not found' })
    }

    const fileUrl = `/uploads/receipt-documents/${req.file.filename}`
    const doc = await db.goodsReceiptDocument.create({
      data: {
        organizationId: orgId,
        receiptId,
        docType,
        label: label?.trim() || null,
        fileName: req.file.originalname,
        fileUrl,
        uploadedById: req.user?.id || null,
      },
    })
    res.json({ success: true, data: doc })
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {})
    next(err)
  }
})

// DELETE /uploads/receipt-documents/:id — remove an attachment (its file + row)
router.delete('/receipt-documents/:id', authenticate, requirePurchaseOn, async (req, res, next) => {
  try {
    if (!canReceive(req)) return res.status(403).json({ success: false, error: 'Only store and purchase staff remove goods-receipt documents' })
    const orgId = getOrgId(req)
    const doc = await db.goodsReceiptDocument.findFirst({ where: { id: req.params.id, organizationId: orgId } })
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' })
    await db.goodsReceiptDocument.delete({ where: { id: doc.id } })
    const filePath = path.join(UPLOAD_ROOT, 'receipt-documents', path.basename(doc.fileUrl))
    if (filePath.startsWith(UPLOAD_ROOT)) fs.unlink(filePath, () => {})
    res.json({ success: true })
  } catch (err) { next(err) }
})

// GET /uploads/receipt-documents/:filename — serve a GRN document to this hospital's staff
router.get('/receipt-documents/:filename', authenticate, requirePurchaseOn, async (req, res, next) => {
  try {
    if (!canReceive(req) && !canSeeBills(req)) return res.status(403).json({ success: false, error: 'Goods-receipt documents are for store and purchase staff' })
    const { filename } = req.params
    if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes('..')) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    const doc = await db.goodsReceiptDocument.findFirst({
      where: { fileUrl: `/uploads/receipt-documents/${filename}` },
      select: { organizationId: true },
    })
    if (!doc || getOrgId(req) !== doc.organizationId) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    const filePath = path.join(UPLOAD_ROOT, 'receipt-documents', filename)
    if (!filePath.startsWith(UPLOAD_ROOT) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    res.setHeader('Cache-Control', 'private, no-store')
    return res.sendFile(filePath)
  } catch (err) { next(err) }
})

// ─── Asset maintenance document upload (bill / receipt / invoice) ────────────
// Admin and the Purchase/Store side attach the service bill or receipt to a
// maintenance log entry. Several files can go up against the same entry.

const ASSET_MAINT_DOC_MIME = BILL_DOC_MIME
const ASSET_MAINT_DOC_EXT = BILL_DOC_EXT

const assetMaintDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'asset-maintenance-documents')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `assetmaintdoc-${suffix}${ASSET_MAINT_DOC_EXT[file.mimetype] || ''}`)
  },
})

const uploadAssetMaintDoc = multer({
  storage: assetMaintDocStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ASSET_MAINT_DOC_MIME.has(file.mimetype)) return cb(null, true)
    cb(new Error('Only PDF, Word (.doc/.docx), JPG or PNG files are allowed'))
  },
})

// POST /uploads/asset-maintenance-documents — attach a bill/receipt to a maintenance log entry
router.post('/asset-maintenance-documents', authenticate, (req, res, next) => {
  if (!canManageAssets(req)) return res.status(403).json({ success: false, error: 'Only an administrator or the Purchase/Store team attach asset maintenance documents' })
  uploadAssetMaintDoc.single('document')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' })
    next()
  })
}, async (req, res, next) => {
  try {
    const orgId = getOrgId(req)
    const { maintenanceLogId, label } = req.body
    if (!maintenanceLogId) return res.status(400).json({ success: false, error: 'maintenanceLogId is required' })
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' })

    // Confirm the log entry belongs to this hospital (IDOR guard)
    const log = await db.assetMaintenanceLog.findFirst({ where: { id: maintenanceLogId, organizationId: orgId }, select: { id: true } })
    if (!log) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, error: 'Maintenance log entry not found' })
    }

    const fileUrl = `/uploads/asset-maintenance-documents/${req.file.filename}`
    const doc = await db.assetMaintenanceDocument.create({
      data: {
        organizationId: orgId,
        maintenanceLogId,
        label: label?.trim() || null,
        fileName: req.file.originalname,
        fileUrl,
        uploadedById: req.user?.id || null,
      },
    })
    res.json({ success: true, data: doc })
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {})
    next(err)
  }
})

// DELETE /uploads/asset-maintenance-documents/:id — remove an attachment (its file + row)
router.delete('/asset-maintenance-documents/:id', authenticate, async (req, res, next) => {
  try {
    if (!canManageAssets(req)) return res.status(403).json({ success: false, error: 'Only an administrator or the Purchase/Store team remove asset maintenance documents' })
    const orgId = getOrgId(req)
    const doc = await db.assetMaintenanceDocument.findFirst({ where: { id: req.params.id, organizationId: orgId } })
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' })
    await db.assetMaintenanceDocument.delete({ where: { id: doc.id } })
    const filePath = path.join(UPLOAD_ROOT, 'asset-maintenance-documents', path.basename(doc.fileUrl))
    if (filePath.startsWith(UPLOAD_ROOT)) fs.unlink(filePath, () => {})
    res.json({ success: true })
  } catch (err) { next(err) }
})

// GET /uploads/asset-maintenance-documents/:filename — serve one to this hospital's staff
// (read is open to every role that can reach Asset Management — not just managers)
router.get('/asset-maintenance-documents/:filename', authenticate, async (req, res, next) => {
  try {
    const { filename } = req.params
    if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes('..')) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    const doc = await db.assetMaintenanceDocument.findFirst({
      where: { fileUrl: `/uploads/asset-maintenance-documents/${filename}` },
      select: { organizationId: true },
    })
    if (!doc || getOrgId(req) !== doc.organizationId) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    const filePath = path.join(UPLOAD_ROOT, 'asset-maintenance-documents', filename)
    if (!filePath.startsWith(UPLOAD_ROOT) || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' })
    }
    res.setHeader('Cache-Control', 'private, no-store')
    return res.sendFile(filePath)
  } catch (err) { next(err) }
})

// ─── Patient clinical document upload (doctor / nurse) ────────────────────────
// A doctor or nurse attaches reports — lab, radiology, prescriptions, consent,
// clinical photos — to a patient, optionally tagged to the OPD consultation or
// IPD admission they are working in. Several files can go up at once; each
// becomes its own PatientDocument row. Served back by the GET route below.

const patientDocStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'patient-documents')
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `patientdoc-${suffix}${PATIENT_DOC_EXT[file.mimetype] || ''}`)
  },
})

const uploadPatientDoc = multer({
  storage: patientDocStorage,
  limits: { fileSize: PATIENT_DOC_MAX_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (PATIENT_DOC_MIME.has(file.mimetype)) return cb(null, true)
    cb(new Error(`Only ${PATIENT_DOC_TYPES_LABEL} files are allowed`))
  },
})

const removeFiles = (files = []) => { for (const f of files) fs.unlink(f.path, () => {}) }

// POST /uploads/patient-documents  — upload one or more documents for a patient,
// optionally tagged to the OPD consultation or IPD admission it was taken in.
router.post('/patient-documents', authenticate, authorize(...PATIENT_DOC_ROLES), (req, res, next) => {
  uploadPatientDoc.array('documents', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: patientDocUploadError(err) })
    next()
  })
}, async (req, res, next) => {
  const files = req.files || []
  try {
    const orgId = getOrgId(req)
    const { patientId, consultationId, admissionId, documentType, title } = req.body
    if (!patientId || !documentType) { removeFiles(files); return res.status(400).json({ success: false, error: 'patientId and documentType are required' }) }
    if (!files.length) return res.status(400).json({ success: false, error: 'No files uploaded' })

    // IDOR guards: the patient — and any visit named — must belong to this
    // hospital, and the visit must belong to this patient.
    const patient = await db.patient.findFirst({ where: { id: patientId, organizationId: orgId }, select: { id: true } })
    if (!patient) { removeFiles(files); return res.status(404).json({ success: false, error: 'Patient not found' }) }
    if (consultationId) {
      const c = await db.consultation.findFirst({ where: { id: consultationId, organizationId: orgId, patientId }, select: { id: true } })
      if (!c) { removeFiles(files); return res.status(404).json({ success: false, error: 'Consultation not found for this patient' }) }
    }
    if (admissionId) {
      const a = await db.admission.findFirst({ where: { id: admissionId, organizationId: orgId, patientId }, select: { id: true } })
      if (!a) { removeFiles(files); return res.status(404).json({ success: false, error: 'Admission not found for this patient' }) }
    }

    // One row per file, all or nothing — a failed write must not leave half the
    // batch recorded. The files that did reach disk are removed on failure.
    const created = await db.$transaction(
      files.map((f) => db.patientDocument.create({
        data: {
          organizationId: orgId,
          patientId,
          consultationId: consultationId || null,
          admissionId: admissionId || null,
          documentType,
          title: title?.trim() || f.originalname,
          fileUrl: `/uploads/patient-documents/${f.filename}`,
          fileType: f.mimetype,
          uploadedById: req.user?.id || null,
        },
      })),
    )
    res.json({ success: true, data: created, count: created.length })
  } catch (err) {
    removeFiles(files)
    next(err)
  }
})

// DELETE /uploads/patient-documents/:id  — remove a document (row + file).
// Doctor, nurse and admin may delete; only within their own hospital.
router.delete('/patient-documents/:id', authenticate, authorize(...PATIENT_DOC_ROLES), async (req, res, next) => {
  try {
    const orgId = getOrgId(req)
    const doc = await db.patientDocument.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      select: { id: true, fileUrl: true },
    })
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' })

    await db.patientDocument.delete({ where: { id: doc.id } })

    // Remove the file only after the row is gone; a stray file is harmless, a
    // served row with no file is not. The path is taken from the stored URL, not
    // the request, and kept inside the uploads root.
    const name = path.basename(doc.fileUrl || '')
    const filePath = path.join(UPLOAD_ROOT, 'patient-documents', name)
    if (name && filePath.startsWith(UPLOAD_ROOT)) fs.unlink(filePath, () => {})

    res.json({ success: true })
  } catch (err) { next(err) }
})

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
