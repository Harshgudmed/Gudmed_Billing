// The platform owner's API: the hospitals on GudMed and the modules each has
// bought (controllers/platformController.js). Mounted under /api/platform, below
// `authenticate` in routes/index.js — the guard reads who is signed in.
import { Router } from 'express'
import { requirePlatformOwner } from '../middleware/auth.js'
import { listHospitals, createHospital, updateHospital, deleteHospital } from '../controllers/platformController.js'

const router = Router()

// On the router itself, not only at the mount: whoever mounts it elsewhere still
// cannot open it to a hospital's administrator (authorize() would).
router.use(requirePlatformOwner)

router.get('/hospitals', listHospitals)
router.post('/hospitals', createHospital)
router.patch('/hospitals/:id', updateHospital)
router.delete('/hospitals/:id', deleteHospital)

export default router
