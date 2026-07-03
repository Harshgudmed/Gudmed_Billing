import { Router } from 'express'
import { getAll, create, update, reprocess, drain } from '../controllers/machineIntegrationController.js'
import { db } from '../config/db.js'

const router = Router()

router.get('/health', async (_req, res) => {
  try {
    await Promise.all([
      db.machineIntegration.count(),
      db.machineResultsQueue.count(),
      db.integrationLog.count(),
    ])
    res.json({ success: true, message: 'Machine integration tables OK' })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, code: err.code })
  }
})

router.post('/reprocess', reprocess) // re-run one queue item
router.post('/drain', drain)         // process all pending

router.get('/', getAll)              // ?resource=integrations|queue|logs
router.post('/', create)
router.patch('/', update)

export default router
