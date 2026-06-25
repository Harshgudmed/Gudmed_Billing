import { Router } from 'express'
import { getAll, getOne, getRecords, create, update, remove } from '../controllers/patientController.js'

const router = Router()

router.get('/', getAll)
router.get('/:id/records', getRecords)
router.get('/:id', getOne)
router.post('/', create)
router.patch('/:id', update)
router.put('/:id', update)
router.delete('/:id', remove)

export default router
