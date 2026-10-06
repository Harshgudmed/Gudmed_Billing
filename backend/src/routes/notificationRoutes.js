import { Router } from 'express'
import {
  sendConsultationNotification,
  sendPrescriptionNotification,
  sendLabResultNotification,
  sendRadiologyNotification,
  notifyPharmacyTeam,
} from '../controllers/notificationController.js'
import { handleIncoming } from '../controllers/whatsappBotController.js'
import { inbox, markRead } from '../controllers/inboxController.js'

const router = Router()

// The signed-in person's own in-app notifications (the bell in the header).
router.get('/inbox',               inbox)
router.patch('/inbox',             markRead)

router.post('/consultation',       sendConsultationNotification)
router.post('/prescription',       sendPrescriptionNotification)
router.post('/lab-result',         sendLabResultNotification)
router.post('/radiology-report',   sendRadiologyNotification)
router.post('/pharmacy-team',      notifyPharmacyTeam)

// WhatsApp two-way bot webhook (Twilio calls this when patient replies)
router.get('/whatsapp-webhook',    (_req, res) => res.sendStatus(200))
router.post('/whatsapp-webhook',   handleIncoming)

export default router
