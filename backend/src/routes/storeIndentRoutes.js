// A department's own side of store indents (the storeIndent module): raise an
// indent, read its own, cancel one nothing has been issued against. The store's
// side — issuing — is in /api/purchase (purchaseIndentController.js).
import { Router } from 'express'
import { requirePurchaseOn } from '../lib/purchaseAccess.js'
import { deptIndentGet, deptIndentCreate, deptIndentUpdate } from '../controllers/purchaseIndentController.js'

const router = Router()

// The store's stock is Purchase's: with Purchase off there is nothing to indent from.
router.use(requirePurchaseOn)

router.get('/', deptIndentGet)
router.post('/', deptIndentCreate)
router.patch('/', deptIndentUpdate)

export default router
