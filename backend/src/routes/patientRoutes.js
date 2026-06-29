import { Router } from 'express'
import { getAll, getOne, getRecords, create, update, remove } from '../controllers/patientController.js'
import { getOrgId } from '../lib/reqContext.js'

const router = Router()

// One guard for every patient route, instead of repeating the same check in
// each controller handler. If the org is missing, auth middleware misconfigured.
router.use((req, res, next) => {
  if (!getOrgId(req)) {
    console.error('Missing organizationId on patient route - authentication middleware failure')
    return res.status(500).json({ success: false, error: 'Server configuration error' })
  }
  next()
})

router.get('/', getAll)
router.get('/:id/records', getRecords)
router.get('/:id', getOne)
router.post('/', create)
router.patch('/:id', update)
router.put('/:id', update)
router.delete('/:id', remove)

export default router
