import { Router } from 'express'
import { getAll, create, update, remove } from '../controllers/purchaseController.js'
import { requirePurchaseOn } from '../lib/purchaseAccess.js'

const router = Router()

// Nothing in Purchase answers while the hospital has it switched off.
router.use(requirePurchaseOn)

router.get('/', getAll)
router.post('/', create)
router.patch('/', update)
router.delete('/', remove)

export default router
