import { Router } from 'express'
import { list, getOne, create, update, retire, logMaintenance } from '../controllers/assetController.js'

const router = Router()

router.get('/', list)
router.get('/:id', getOne)
router.post('/', create)
router.patch('/:id', update)
router.patch('/:id/retire', retire)
router.post('/:id/maintenance', logMaintenance)

export default router
