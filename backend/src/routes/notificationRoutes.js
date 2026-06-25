import { Router } from 'express'
import {
  sendConsultationNotification,
  sendPrescriptionNotification,
  sendLabResultNotification,
  sendRadiologyNotification,
  notifyPharmacyTeam,
} from '../controllers/notificationController.js'
import { handleIncoming } from '../controllers/whatsappBotController.js'

const router = Router()

router.post('/consultation',       sendConsultationNotification)
router.post('/prescription',       sendPrescriptionNotification)
router.post('/lab-result',         sendLabResultNotification)
router.post('/radiology-report',   sendRadiologyNotification)
router.post('/pharmacy-team',      notifyPharmacyTeam)

// WhatsApp two-way bot webhook (Twilio calls this when patient replies)
router.get('/whatsapp-webhook',    (_req, res) => res.sendStatus(200))
router.post('/whatsapp-webhook',   handleIncoming)

export default router
