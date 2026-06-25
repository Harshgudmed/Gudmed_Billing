import { Router } from 'express'
import { handleGet, handlePost, handlePatch, handleDelete } from '../controllers/doctorAccountabilityController.js'

export const router = Router()

router.get('/', handleGet)
router.post('/', handlePost)
router.patch('/', handlePatch)
router.delete('/', handleDelete)
