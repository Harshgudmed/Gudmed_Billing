import { Router } from 'express'
import { authorize } from '../middleware/auth.js'
import {
  getOrganization, updateOrganization,
  getUsers, createUser, updateUser, toggleUserStatus,
  getDepartments, createDepartment, getBillingServices,
} from '../controllers/settingsController.js'

const router = Router()

// Reading stays open to all staff — the user list fills doctor pickers on eight
// screens. CHANGING settings is the administrator's: without this any logged-in
// account (a receptionist was proven to) could create an admin, reset the
// admin's password and log in as them, or rename the hospital. authorize()
// always passes admin / super_admin, so naming 'admin' admits only them.
const adminOnly = authorize('admin')
router.post('/', adminOnly)
router.patch('/', adminOnly)

router.get('/', (req, res, next) => {
  const { resource } = req.query
  if (resource === 'users') return getUsers(req, res, next)
  if (resource === 'departments') return getDepartments(req, res, next)
  if (resource === 'billingServices') return getBillingServices(req, res, next)
  return getOrganization(req, res, next)
})

router.post('/', (req, res, next) => {
  const { resource } = req.body
  if (resource === 'user') return createUser(req, res, next)
  if (resource === 'department') return createDepartment(req, res, next)
  return res.status(400).json({ success: false, error: 'Unknown resource' })
})

router.patch('/', (req, res, next) => {
  const { resource } = req.body
  if (resource === 'user') return updateUser(req, res, next)
  if (resource === 'user-status') return toggleUserStatus(req, res, next)
  if (resource === 'organization') return updateOrganization(req, res, next)
  return res.status(400).json({ success: false, error: 'Unknown resource' })
})

export default router
