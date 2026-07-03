import { useState, useEffect } from 'react'
import { ShoppingCart, CreditCard, Banknote, Smartphone, Building2, CheckCircle, Loader2, Printer, Send, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import client from '@/api/client'
import { sendPrescriptionNotification } from '@/lib/whatsapp'
import { getOrgSettings } from '@/lib/orgSettings'
import { printPharmacyReceipt } from '@/components/billing/utils/printBilling'

const PAYMENT_METHODS = [
  { key: 'cash',         label: 'Cash',         icon: Banknote,    color: 'text-green-600'  },
  { key: 'upi',          label: 'UPI',           icon: Smartphone,  color: 'text-purple-600' },
  { key: 'card',         label: 'Card',          icon: CreditCard,  color: 'text-blue-600'   },
  { key: 'bank_transfer',label: 'Bank Transfer', icon: Building2,   color: 'text-orange-600' },
  { key: 'insurance',    label: 'Insurance',     icon: CheckCircle, color: 'text-teal-600'   },
]

function rupee(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}

/**
 * PrescriptionPurchaseModal
 *
 * Three-step flow:
 *   Step 1 — Review prescription items with prices
 *   Step 2 — Select payment method + reference
 *   Step 3 — Success: print receipt, send to patient WhatsApp
 *
 * Props:
 *   prescriptionId   — Prisma Prescription.id
 *   prescriptionItems — raw items array from consultation
 *   patientName, patientPhone, patientId
 *   consultationId
 *   onClose
 */
export default function PrescriptionPurchaseModal({
  prescriptionId,
  prescriptionItems = [],
  patientName,
  patientPhone,
  patientId,
  consultationId,
  onClose,
}) {
  const [step, setStep]           = useState(1) // 1=review, 2=payment, 3=success
  const [enrichedItems, setEnriched] = useState([])
  const [loadingPrices, setLoadingPrices] = useState(true)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentRef, setPaymentRef]       = useState('')
  const [processing, setProcessing]       = useState(false)
  const [invoice, setInvoice]             = useState(null)
  const [sale, setSale]                   = useState(null)
  const [orgInfo, setOrgInfo]             = useState({ name: 'Hospital', phone: '', upiId: '' })

  useEffect(() => {
    const loadOrgSettings = async () => {
      try {
        const org = await getOrgSettings()
        setOrgInfo(org)
      } catch (err) {
        console.error('Failed to load organization settings:', err)
      }
    }

    loadOrgSettings()
  }, [])

  // Enrich items with prices from pharmacy catalog
  useEffect(() => {
    async function fetchPrices() {
      setLoadingPrices(true)
      try {
        const drugsRes = await client.get('/pharmacy/drugs?limit=5000')
        const drugs = drugsRes?.data || []
        const enriched = prescriptionItems.map(item => {
          const match = drugs.find(d =>
            d.drugName?.toLowerCase().includes(item.drugName?.toLowerCase()) ||
            item.drugName?.toLowerCase().includes(d.drugName?.toLowerCase())
          )
          return { ...item, unitPrice: match?.sellingPrice || 0, drugCode: match?.id }
        })
        setEnriched(enriched)
      } catch {
        setEnriched(prescriptionItems.map(i => ({ ...i, unitPrice: 0 })))
      } finally {
        setLoadingPrices(false)
      }
    }
    if (prescriptionItems.length > 0) fetchPrices()
    else { setEnriched([]); setLoadingPrices(false) }
  }, [prescriptionItems])

  const medTotal = enrichedItems.reduce((s, i) => s + (i.unitPrice || 0) * (i.quantity || 1), 0)

  // ── Step 2: Process payment ──────────────────────────────────────────────
  async function confirmPurchase() {
    setProcessing(true)
    try {
      // 1. Create pharmacy sale (deducts stock, snapshots HSN/GST%/batch/expiry
      // per item server-side — see sale.controller.js) and print the receipt from.
      const saleItems = enrichedItems
        .filter(i => i.drugCode && i.unitPrice > 0)
        .map(i => ({
          drugId: i.drugCode,
          drugName: i.drugName,
          quantity: i.quantity || 1,
          unitPrice: i.unitPrice,
          total: i.unitPrice * (i.quantity || 1),
        }))

      let createdSale = null
      if (saleItems.length > 0) {
        const saleRes = await client.post('/pharmacy/sales', {
          patientId,
          prescriptionId,
          items: saleItems,
          paymentMethod,
          paymentStatus: 'paid',
          amountPaid: medTotal,
        })
        createdSale = saleRes?.data || null
      }

      // 2. Create billing invoice. Must send `items` with `serviceName` — that's
      // what invoiceItemSchema on the backend requires. The old shape here sent
      // `invoiceItems`/`description`, which failed validation on EVERY purchase
      // (400) and threw, landing in the catch below even though the pharmacy
      // sale above had already succeeded — the patient's payment silently
      // "failed" on screen while stock was already deducted and no invoice or
      // receipt was ever produced. `notes` is tagged `[Pharmacy]` so the Billing
      // module recognizes the department, same convention as Lab/Radiology.
      //
      // HSN/GST%/batch/expiry are pulled from the sale we just created (it's
      // the one that actually knows which batch FIFO drew from) so the Billing
      // module's pharmacy invoice print can show the same GST breakdown as the
      // pharmacy counter receipt, not just plain drug names.
      let saleItemsById = new Map()
      try {
        const parsedSaleItems = JSON.parse(createdSale?.items || '[]')
        saleItemsById = new Map(parsedSaleItems.map((it) => [it.drugId, it]))
      } catch { /* fall back to plain items below */ }

      const invoiceRes = await client.post('/billing', {
        resource: 'invoice',
        patientId,
        items: enrichedItems.map(i => {
          const saleItem = saleItemsById.get(i.drugCode)
          return {
            serviceName: `${i.drugName} ${i.strength || ''} (Qty: ${i.quantity || 1})`.trim(),
            quantity: i.quantity || 1,
            unitPrice: i.unitPrice || 0,
            tax: 0,
            total: (i.unitPrice || 0) * (i.quantity || 1),
            hsnCode: saleItem?.hsnCode || undefined,
            gstRate: saleItem?.gstRate || undefined,
            batchNumber: saleItem?.batchNumber || undefined,
            expiryDate: saleItem?.expiryDate || undefined,
          }
        }),
        notes: `[Pharmacy] Prescription ${prescriptionId || ''}`.trim(),
      })
      const inv = invoiceRes?.data || { invoiceNumber: `INV${Date.now()}`, totalAmount: medTotal }

      // 3. Record the payment against that invoice — the patient already paid
      // at the counter, so the invoice must be marked paid, not left as the
      // 'draft'/'unpaid' default a bare invoice-create leaves it in.
      if (inv.id) {
        await client.post('/billing', {
          resource: 'payment',
          invoiceId: inv.id,
          patientId,
          amount: medTotal,
          paymentMethod,
          paymentReference: paymentRef || undefined,
        }).catch(() => {}) // non-fatal — invoice still exists even if this step fails
      }

      setInvoice(inv)
      setSale(createdSale)
      setStep(3)
      toast.success('Payment confirmed — invoice created!')
    } catch (err) {
      toast.error('Failed to process payment: ' + (err.message || 'Unknown error'))
    } finally {
      setProcessing(false)
    }
  }

  // ── Step 3: Send receipt to patient ─────────────────────────────────────
  async function sendReceiptToPatient() {
    if (!prescriptionId || !invoice) return
    const result = await sendPrescriptionNotification(prescriptionId, { invoiceId: invoice.id })
    if (result?.sent) toast.success('Receipt sent via WhatsApp API')
    else if (result?.waLink) toast.success('WhatsApp opened — click Send')
    else toast.error('Could not send receipt')
  }

  // ── Print receipt ────────────────────────────────────────────────────────
  // Same SHARED GST-invoice format as Direct Sale / Sales & Reports — see
  // printPharmacyReceipt in printBilling.js. Uses the actual created sale (with
  // server-enriched HSN/GST%/batch/expiry) when available; falls back to the
  // reviewed items (no batch/HSN) if the sale wasn't created (all-free items).
  function printReceipt() {
    let clinic = {}
    try { clinic = JSON.parse(localStorage.getItem('gudmed-clinic-profile') || '{}') } catch { clinic = {} }
    const data = sale || {
      receiptNumber: invoice?.invoiceNumber,
      items: enrichedItems.map(i => ({
        drugName: `${i.drugName} ${i.strength || ''}`.trim(),
        quantity: i.quantity || 1,
        unitPrice: i.unitPrice,
        total: (i.unitPrice || 0) * (i.quantity || 1),
      })),
      totalAmount: medTotal,
      amountPaid: medTotal,
    }
    printPharmacyReceipt(
      { ...data, patientName, paymentMethod, prescribedBy: 'self' },
      orgInfo,
      clinic
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md flex flex-col p-0" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b shrink-0 flex items-center gap-3">
          <ShoppingCart className="h-5 w-5 text-purple-600 shrink-0" />
          <div className="flex-1">
            <DialogTitle className="text-base font-bold">
              {step === 1 ? 'Prescription Purchase' : step === 2 ? 'Select Payment' : 'Payment Confirmed'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {step === 1 && `Review medicines for ${patientName}`}
              {step === 2 && 'Choose how the patient will pay'}
              {step === 3 && 'Invoice created successfully'}
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ minHeight: 0 }}>

          {/* ── Step 1: Review ── */}
          {step === 1 && (
            <div className="space-y-3">
              {loadingPrices ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400 mr-2" />
                  <span className="text-sm text-gray-500">Fetching prices…</span>
                </div>
              ) : (
                <>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Medicine</th>
                          <th className="text-center px-3 py-2 font-medium text-gray-600">Qty</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600">Rate</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enrichedItems.map((item, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <div className="font-medium">{item.drugName}</div>
                              {item.strength && <div className="text-xs text-gray-400">{item.strength} · {item.frequency}</div>}
                            </td>
                            <td className="px-3 py-2 text-center">{item.quantity || 1}</td>
                            <td className="px-3 py-2 text-right">{rupee(item.unitPrice)}</td>
                            <td className="px-3 py-2 text-right font-medium">
                              {rupee((item.unitPrice || 0) * (item.quantity || 1))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50 border-t">
                          <td colSpan={3} className="px-3 py-2 text-right font-semibold">Grand Total</td>
                          <td className="px-3 py-2 text-right font-bold text-purple-700">{rupee(medTotal)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {enrichedItems.some(i => !i.unitPrice) && (
                    <p className="text-xs text-amber-600">⚠️ Some medicines have no price in pharmacy catalog.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Step 2: Payment ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg px-4 py-3 flex justify-between items-center">
                <span className="text-sm text-gray-600">Amount to Collect</span>
                <span className="text-xl font-bold text-purple-700">{rupee(medTotal)}</span>
              </div>

              <div>
                <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                  Payment Method
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map(({ key, label, icon: Icon, color }) => (
                    <button
                      key={key}
                      onClick={() => setPaymentMethod(key)}
                      className={`flex items-center gap-2 border rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                        paymentMethod === key
                          ? 'border-purple-500 bg-purple-50 text-purple-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${paymentMethod === key ? 'text-purple-600' : color}`} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {paymentMethod === 'upi' && (
                <div className="space-y-2">
                  <Label className="text-xs">UPI Reference / Transaction ID</Label>
                  <Input placeholder="e.g. 407623481291" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} />
                  {orgInfo.settings?.upiId && (
                    <p className="text-xs text-gray-500">UPI ID: <strong>{orgInfo.settings.upiId}</strong></p>
                  )}
                </div>
              )}
              {paymentMethod === 'card' && (
                <div className="space-y-2">
                  <Label className="text-xs">Card / Transaction Reference</Label>
                  <Input placeholder="Last 4 digits or approval code" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} />
                </div>
              )}
              {paymentMethod === 'bank_transfer' && (
                <div className="space-y-2">
                  <Label className="text-xs">Bank Reference / UTR Number</Label>
                  <Input placeholder="UTR / NEFT reference" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} />
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Success ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-4 text-center">
                <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
                  <CheckCircle className="h-7 w-7 text-green-600" />
                </div>
                <p className="font-semibold text-gray-800">Payment Confirmed!</p>
                <p className="text-sm text-gray-500">Invoice {invoice?.invoiceNumber || '—'}</p>
                <Badge className="mt-2 bg-green-100 text-green-700">{rupee(medTotal)} · {paymentMethod.replace('_', ' ').toUpperCase()}</Badge>
              </div>

              <div className="space-y-2">
                <Button className="w-full gap-2" variant="outline" onClick={printReceipt}>
                  <Printer className="h-4 w-4" /> Print Receipt
                </Button>
                {patientPhone && (
                  <Button className="w-full gap-2" variant="outline" onClick={sendReceiptToPatient}>
                    <Send className="h-4 w-4 text-green-600" /> Send Receipt to Patient WhatsApp
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t shrink-0 flex justify-between gap-2 bg-gray-50">
          {step === 1 && (
            <>
              <Button variant="outline" size="sm" onClick={onClose}>Skip</Button>
              <Button size="sm" disabled={loadingPrices || medTotal === 0} onClick={() => setStep(2)}>
                Proceed to Payment →
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>← Back</Button>
              <Button size="sm" disabled={processing} onClick={confirmPurchase}>
                {processing ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Processing…</> : 'Confirm Payment'}
              </Button>
            </>
          )}
          {step === 3 && (
            <Button size="sm" className="ml-auto" onClick={onClose}>Done</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
