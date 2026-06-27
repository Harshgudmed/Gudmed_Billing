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
      // 1. Create pharmacy sale (deducts stock)
      const saleItems = enrichedItems
        .filter(i => i.drugCode && i.unitPrice > 0)
        .map(i => ({
          drugId: i.drugCode,
          drugName: i.drugName,
          quantity: i.quantity || 1,
          unitPrice: i.unitPrice,
          total: i.unitPrice * (i.quantity || 1),
        }))

      if (saleItems.length > 0) {
        await client.post('/pharmacy/sales', {
          patientId,
          prescriptionId,
          items: saleItems,
          paymentMethod,
          paymentStatus: 'paid',
          amountPaid: medTotal,
        })
      }

      // 2. Create billing invoice
      const invoiceRes = await client.post('/billing', {
        resource: 'invoice',
        patientId,
        invoiceItems: enrichedItems.map(i => ({
          type: 'pharmacy',
          description: `${i.drugName} ${i.strength || ''} (Qty: ${i.quantity || 1})`,
          quantity: i.quantity || 1,
          unitPrice: i.unitPrice || 0,
          discount: 0,
          tax: 0,
          total: (i.unitPrice || 0) * (i.quantity || 1),
        })),
        paymentMethod,
        paymentReference: paymentRef || undefined,
        totalAmount: medTotal,
        amountPaid: medTotal,
        paymentStatus: 'paid',
      })

      const inv = invoiceRes?.data || { invoiceNumber: `INV${Date.now()}`, totalAmount: medTotal }
      setInvoice(inv)
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
  function printReceipt() {
    const now = new Date().toLocaleString('en-IN')
    const rows = enrichedItems.map(i => `
      <tr>
        <td>${i.drugName} ${i.strength || ''}</td>
        <td style="text-align:center">${i.quantity || 1}</td>
        <td style="text-align:right">${rupee(i.unitPrice)}</td>
        <td style="text-align:right">${rupee((i.unitPrice || 0) * (i.quantity || 1))}</td>
      </tr>`).join('')

    const win = window.open('', '_blank', 'width=480,height=700')
    if (!win) { toast.error('Allow pop-ups to print'); return }
    win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11pt;padding:20px;color:#000}
.hosp{font-size:16pt;font-weight:bold;color:#1e3a5f;text-align:center}.sub{font-size:9pt;color:#555;text-align:center;margin-bottom:14px}
.banner{background:#1e3a5f;color:#fff;text-align:center;padding:5px;font-size:11pt;font-weight:bold;margin-bottom:12px}
table{width:100%;border-collapse:collapse}th{background:#1e3a5f;color:#fff;padding:5px 8px;text-align:left;font-size:9pt}
td{padding:5px 8px;border-bottom:1px solid #eee}.total-row td{font-weight:bold;background:#f0f4f8;border-top:2px solid #1e3a5f}
.footer{text-align:center;font-size:8pt;color:#aaa;margin-top:12px}@media print{body{padding:6px}}</style>
</head><body>
<div class="hosp">${orgInfo.name}</div>
<div class="sub">Pharmacy Department${orgInfo.phone ? ' · ' + orgInfo.phone : ''}</div>
<div class="banner">PRESCRIPTION RECEIPT</div>
<p style="font-size:10pt;margin-bottom:8px">
  <strong>Patient:</strong> ${patientName} &nbsp;|&nbsp;
  <strong>Date:</strong> ${now} &nbsp;|&nbsp;
  <strong>Invoice:</strong> ${invoice?.invoiceNumber || '—'}<br/>
  <strong>Payment:</strong> ${paymentMethod.toUpperCase()}${paymentRef ? ' · Ref: ' + paymentRef : ''}
</p>
<table><thead><tr><th>Medicine</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
<tbody>${rows}
<tr class="total-row"><td colspan="3" style="text-align:right">TOTAL</td><td style="text-align:right">${rupee(medTotal)}</td></tr>
</tbody></table>
<div class="footer">Thank you for visiting ${orgInfo.name}!</div>
<script>window.onload=function(){window.print()}</script>
</body></html>`)
    win.document.close()
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
