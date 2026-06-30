import { Router } from 'express'
import { getAll, create, update, remove } from '../controllers/deathCertificateController.js'

export const router = Router()

router.get('/', getAll)
router.post('/', create)
router.patch('/', update)
router.delete('/', remove)
