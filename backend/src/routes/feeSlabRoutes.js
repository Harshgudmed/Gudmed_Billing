import { Router } from 'express'
import { getSlabs, createSlab, updateSlab, deleteSlab, calculateFee } from '../controllers/feeSlabController.js'
import { authorize } from '../middleware/auth.js'

export const router = Router()

// Reading the slabs and working out a fee is for whoever books appointments.
// Changing them changes what patients pay: the hospital administrator only
// (authorize lets an administrator through; every other role is refused) —
// any staff login could rewrite a doctor's follow-up fees.
const adminOnly = authorize('admin')

// GET fee slabs
router.get('/', getSlabs)

// GET calculate fee for appointment
router.get('/calculate', calculateFee)

// POST create fee slab
router.post('/', adminOnly, createSlab)

// PATCH update fee slab
router.patch('/:id', adminOnly, updateSlab)

// DELETE fee slab
router.delete('/:id', adminOnly, deleteSlab)
