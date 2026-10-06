import { Router } from 'express'
import { getAll, create, update, remove } from '../controllers/insuranceController.js'
import { billingAllows, BILLING_REFUSED } from '../lib/billingAccess.js'

const router = Router()

// Reading is guarded at the door (routes/index.js, INSURANCE_READERS); raising
// or changing a claim is the billing desk's — Finance reviews, it does not file.
router.use((req, res, next) => (req.method === 'GET' || billingAllows(req, 'claims')
  ? next()
  : res.status(403).json({ success: false, error: BILLING_REFUSED.claims, code: 'FORBIDDEN' })))

router.get('/', getAll)
router.post('/', create)
router.patch('/', update)
router.delete('/', remove)

export default router
