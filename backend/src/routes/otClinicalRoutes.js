import { Router } from 'express'
import { getAll, update } from '../controllers/otClinicalController.js'

const router = Router()

// Read and save only. Each document is one per case and edited in place, so
// PATCH upserts and there is nothing to create or delete separately.
router.get('/', getAll)
router.patch('/', update)

export default router
