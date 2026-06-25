import { Router } from 'express'
import { getSlabs, createSlab, updateSlab, deleteSlab, calculateFee } from '../controllers/feeSlabController.js'

export const router = Router()

// GET fee slabs
router.get('/', getSlabs)

// GET calculate fee for appointment
router.get('/calculate', calculateFee)

// POST create fee slab
router.post('/', createSlab)

// PATCH update fee slab
router.patch('/:id', updateSlab)

// DELETE fee slab
router.delete('/:id', deleteSlab)
