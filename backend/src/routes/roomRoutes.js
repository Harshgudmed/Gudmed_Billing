import { Router } from 'express'
import {
  getFloors, createFloor, deleteFloor,
  getRooms, getRoom, createRoom, updateRoom, deleteRoom, suggestRoomNumber, getRoomsPickerList,
  setOverride, clearOverride,
} from '../controllers/roomController.js'
import { downloadFloorTemplate, importFloors, exportFloors } from '../controllers/bulkFloorController.js'
import { uploadSingleExcel } from '../lib/uploadExcel.js'

const router = Router()

router.get('/floors', getFloors)
router.post('/floors', createFloor)
// Bulk routes sit before /floors/:id so "template"/"export" aren't read as ids.
router.get('/floors/template', downloadFloorTemplate)
router.get('/floors/export', exportFloors)
router.post('/floors/import', uploadSingleExcel, importFloors)
router.delete('/floors/:id', deleteFloor)

router.get('/suggest-number', suggestRoomNumber)
router.get('/picker-list', getRoomsPickerList)

router.get('/', getRooms)
router.get('/:id', getRoom)
router.post('/', createRoom)
router.patch('/:id', updateRoom)
router.delete('/:id', deleteRoom)

router.post('/:id/override', setOverride)
router.delete('/:id/override', clearOverride)

export default router
