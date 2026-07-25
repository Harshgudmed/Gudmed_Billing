import { Router } from 'express'
import { getScreens, getAllRoomsForScreens, createScreen, updateScreen, deleteScreen } from '../controllers/screenController.js'

const router = Router()

router.get('/rooms/all', getAllRoomsForScreens)
router.get('/', getScreens)
router.post('/', createScreen)
router.put('/:id', updateScreen)
router.delete('/:id', deleteScreen)

export default router
