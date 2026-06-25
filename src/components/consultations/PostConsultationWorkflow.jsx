import { useState } from 'react'
import { CheckCircle, MessageCircle, ShoppingCart, Users, X, Loader2, Send } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  sendConsultationNotification,
  sendPrescriptionNotification,
  notifyPharmacyTeam,
  buildWaLink,
  openWhatsApp,
} from '@/lib/whatsapp'
import PrescriptionPurchaseModal from '@/components/pharmacy/PrescriptionPurchaseModal'

function rupee(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}

function SentBadge() {
  return (
    <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 text-xs">
      <CheckCircle className="h-3 w-3" /> Sent
    </Badge>
  )
}

/**
 * PostConsultationWorkflow
 *
 * Shown automatically after a consultation is saved.
 * Props:
 *   consultation — the saved consultation object (with patient, doctor, prescriptionItems)
 *   prescriptionId — id of the created prescription (if any)
 *   onClose — callback
 */
export default function PostConsultationWorkflow({ consultation, prescriptionId, onClose }) {
  const [sending, setSending]   = useState({})
  const [done, setDone]         = useState({})
  const [showPurchase, setShowPurchase] = useState(false)

  const patient  = consultation?.patient
  const patName  = [patient?.firstName, patient?.lastName].filter(Boolean).join(' ') || 'Patient'
  const phone    = patient?.phonePrimary

  // Parse prescription items from consultation
  let prescItems = []
  try {
    const raw = typeof consultation?.prescriptionItems === 'string'
      ? JSON.parse(consultation.prescriptionItems)
      : (consultation?.prescriptionItems || [])
    prescItems = Array.isArray(raw) ? raw : []
  } catch { prescItems = [] }

  const hasPrescription = prescItems.length > 0 && prescriptionId

  async function act(key, fn) {
    setSending(p => ({ ...p, [key]: true }))
    try {
      const result = await fn()
      if (result?.error) {
        toast.error(`WhatsApp: ${result.error}`)
      } else if (result?.sent) {
        toast.success('Message sent automatically via WhatsApp API')
        setDone(p => ({ ...p, [key]: true }))
      } else if (result?.waLink) {
        toast.success('WhatsApp opened — click Send in the chat')
        setDone(p => ({ ...p, [key]: true }))
      } else if (result?.note) {
        toast.info(result.note)
      }
    } catch (e) {
      toast.error('Could not send notification')
    } finally {
      setSending(p => ({ ...p, [key]: false }))
    }
  }

  function sendConsultation() {
    act('consultation', () => sendConsultationNotification(consultation.id))
  }

  function sendPrescription() {
    if (!prescriptionId) return
    act('prescription', () => sendPrescriptionNotification(prescriptionId))
  }

  async function sendPharmacyTeam() {
    if (!prescriptionId) return
    act('pharmacyTeam', async () => {
      const result = await notifyPharmacyTeam(prescriptionId)
      // If no team phone configured, build a wa.me from message text
      if (result?.type === 'no_team_phone' && result.message) {
        const pharmacyPhone = prompt('Enter pharmacy team WhatsApp number (or set WHATSAPP_PHARMACY_TEAM_PHONE in .env):')
        if (pharmacyPhone) {
          const url = buildWaLink(pharmacyPhone, result.message)
          if (url) openWhatsApp(url)
        }
      }
      return result
    })
  }

  return (
    <>
      <Dialog open={true} onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="max-w-lg">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">Consultation Saved</DialogTitle>
              <DialogDescription className="text-xs">
                What would you like to do next for <strong>{patName}</strong>?
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-3 mt-2">

            {/* Card 1 — Consultation Summary */}
            <div className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-semibold">Consultation Summary</span>
                {done.consultation && <SentBadge />}
              </div>
              <p className="text-xs text-gray-500">
                Send visit summary with diagnosis, vitals, and follow-up instructions to {patName}.
              </p>
              {phone ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={sending.consultation || done.consultation}
                  onClick={sendConsultation}
                >
                  {sending.consultation
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Send className="h-3.5 w-3.5 text-green-600" />}
                  {done.consultation ? 'Sent' : 'Send via WhatsApp'}
                </Button>
              ) : (
                <p className="text-xs text-amber-600">No phone number on file for this patient.</p>
              )}
            </div>

            {/* Card 2 — Prescription */}
            {hasPrescription && (
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-purple-600" />
                  <span className="text-sm font-semibold">Prescription</span>
                  <Badge variant="outline" className="text-xs">{prescItems.length} item{prescItems.length !== 1 ? 's' : ''}</Badge>
                </div>

                {/* Medicine list preview */}
                <div className="bg-gray-50 rounded p-2 space-y-1">
                  {prescItems.slice(0, 4).map((m, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span>{m.drugName} {m.strength || ''}</span>
                      <span className="text-gray-500">{m.frequency} · Qty {m.quantity}</span>
                    </div>
                  ))}
                  {prescItems.length > 4 && (
                    <p className="text-xs text-gray-400">+{prescItems.length - 4} more…</p>
                  )}
                </div>

                <div className="flex gap-2">
                  {phone && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1.5"
                      disabled={sending.prescription || done.prescription}
                      onClick={sendPrescription}
                    >
                      {sending.prescription
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Send className="h-3.5 w-3.5 text-green-600" />}
                      {done.prescription ? 'Sent' : 'Send to Patient'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="flex-1 gap-1.5 bg-purple-600 hover:bg-purple-700"
                    onClick={() => setShowPurchase(true)}
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    Purchase at Counter
                  </Button>
                </div>
                {done.prescription && <SentBadge />}
              </div>
            )}

            {/* Card 3 — Notify Pharmacy Team */}
            {hasPrescription && (
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-orange-600" />
                  <span className="text-sm font-semibold">Pharmacy Team</span>
                  {done.pharmacyTeam && <SentBadge />}
                </div>
                <p className="text-xs text-gray-500">
                  Notify pharmacy staff to prepare the prescription for this patient.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={sending.pharmacyTeam || done.pharmacyTeam}
                  onClick={sendPharmacyTeam}
                >
                  {sending.pharmacyTeam
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Send className="h-3.5 w-3.5 text-orange-600" />}
                  {done.pharmacyTeam ? 'Notified' : 'Notify Pharmacy Team'}
                </Button>
              </div>
            )}

          </div>

          <div className="flex justify-end pt-2 border-t mt-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Purchase modal — opens on top */}
      {showPurchase && (
        <PrescriptionPurchaseModal
          prescriptionId={prescriptionId}
          prescriptionItems={prescItems}
          patientName={patName}
          patientPhone={phone}
          patientId={patient?.id}
          consultationId={consultation?.id}
          onClose={() => setShowPurchase(false)}
        />
      )}
    </>
  )
}
