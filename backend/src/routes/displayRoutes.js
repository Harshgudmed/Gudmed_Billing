import { Router } from 'express'
import { getFloorsOverview, getRoomQueue, getFloorQueue, getScreenQueue } from '../controllers/displayController.js'
import { registerDevice, getDeviceStatusEndpoint, heartbeatDevice, listDevices, assignDevice, removeDevice } from '../controllers/deviceController.js'

const router = Router()

router.get('/floors', getFloorsOverview)
router.get('/queue', getRoomQueue)
router.get('/floor-queue', getFloorQueue)
router.get('/screen-queue', getScreenQueue)

// Display devices (the physical TVs/boxes): self-register, poll pairing status,
// heartbeat, and — for admins — list + assign to a screen. All org-scoped.
router.get('/devices', listDevices)
router.post('/devices/register', registerDevice)
router.get('/devices/:deviceId/status', getDeviceStatusEndpoint)
router.post('/devices/:deviceId/heartbeat', heartbeatDevice)
router.post('/devices/:deviceId/assign', assignDevice)
router.delete('/devices/:deviceId', removeDevice)

export default router
