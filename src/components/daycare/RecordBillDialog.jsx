import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import PaymentFields from '@/components/billing/PaymentFields'
import { raiseRecordBill } from '@/lib/billing'
import { formatMoney as inr } from '@/lib/format'

// How a case's / trip's money reads on its screen. Shared by Day Care and
// Ambulance, which bill the same way.
export const PAY_STYLES = {
  pending: 'bg-orange-100 text-orange-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  refunded: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-gray-200 text-gray-600',
}

/** The Payment cell of a case / trip row: what its bill says. */
export function BillSummary({ record, onOpen }) {
  const bill = record.bill
  return (
    <div className="flex flex-col items-start gap-1">
      {bill ? (
        <>
          <Badge className={`capitalize ${PAY_STYLES[record.paymentStatus] || ''}`}>{record.paymentStatus}</Badge>
          <span className="text-xs text-gray-500">{inr(bill.amountPaid)} of {inr(bill.totalAmount)} · {bill.invoiceNumber}</span>
        </>
      ) : record.paidOutsideBilling > 0 ? (
        <span className="text-xs text-gray-600" title="Recorded here before this screen was linked to Billing">{inr(record.paidOutsideBilling)} paid outside Billing (before sync)</span>
      ) : (
        <span className="text-xs text-gray-500">Not billed</span>
      )}
      <Button type="button" variant="outline" size="sm" className="h-7" onClick={onOpen}>Bill</Button>
    </div>
  )
}

/**
 * The bill of one day-care case or ambulance trip: see it, take money on it,
 * change its charge while nothing is paid, or raise it if it was never raised.
 * Money is always a payment on the Billing invoice — the same ledger Billing
 * shows — never a figure kept on the case.
 *
 *  kind         'daycare' | 'ambulance'
 *  record       the row from GET /day-care or /ambulance (with `bill`)
 *  number       its case / trip number
 *  charge       its fee / charge
 *  serviceName  the bill line's wording
 *  saveCharge   (amount) => Promise — PATCHes the module's own fee / charge
 *  onChanged    () => void — reload the list
 */
export default function RecordBillDialog({ open, onOpenChange, kind, record, number, charge, serviceName, saveCharge, onChanged }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [newCharge, setNewCharge] = useState('')
  const [busy, setBusy] = useState(false)
  // A fresh key each time the dialog opens: a double-clicked Collect is
  // recorded once, a second collection later is a new payment.
  const [paymentKey, setPaymentKey] = useState('')

  useEffect(() => {
    if (!open) return
    setAmount(''); setMethod('cash'); setNewCharge(String(charge ?? ''))
    setPaymentKey(`${kind}-${number}-${Date.now()}`)
    // Only on opening — a live refresh of the list must not wipe what is typed.
  }, [open])

  if (!record) return null
  const bill = record.bill
  const isOpenBill = bill && bill.status !== 'cancelled'
  const balance = Number(bill?.balanceDue ?? 0)

  async function run(action, success) {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      onChanged?.()
      onOpenChange(false)
    } catch (e) {
      toast.error(e.message || 'That did not go through — please try again')
    } finally { setBusy(false) }
  }

  const collect = () => {
    const amt = Number(amount)
    if (!(amt > 0)) { toast.error('Enter the amount received'); return }
    if (amt > balance + 0.005) { toast.error(`Only ${inr(balance)} is due on this bill`); return }
    run(() => client.post('/billing', { resource: 'payment', invoiceId: bill.id, amount: amt, paymentMethod: method, idempotencyKey: paymentKey }), `${inr(amt)} received on ${bill.invoiceNumber}`)
  }

  const raise = () => run(async () => {
    const amt = Number(amount) || 0
    if (amt > Number(charge)) throw new Error(`The charge is ${inr(charge)} — the amount received cannot be more`)
    const result = await raiseRecordBill(kind, { number, patientId: record.patientId, serviceName, charge, amountPaid: amt, paymentMethod: method })
    if (!result?.invoice) throw new Error('The bill could not be raised — please try again')
  }, 'Bill raised in Billing')

  const changeCharge = () => {
    const v = Number(newCharge)
    if (newCharge === '' || Number.isNaN(v) || v < 0) { toast.error('Enter the new charge (0 or more)'); return }
    run(() => saveCharge(v), v > 0 ? `Charge changed to ${inr(v)}; the bill follows` : 'Charge set to 0; its unpaid bill is cancelled')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bill — {number}</DialogTitle>
          <DialogDescription>Payments here and in Billing go on the same bill.</DialogDescription>
        </DialogHeader>

        {bill ? (
          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Invoice</span><span className="font-mono">{bill.invoiceNumber}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Status</span><Badge className={`capitalize ${PAY_STYLES[record.paymentStatus] || ''}`}>{record.paymentStatus}</Badge></div>
              <div className="flex justify-between"><span className="text-gray-500">Total</span><span>{inr(bill.totalAmount)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Paid</span><span>{inr(bill.amountPaid)}</span></div>
              <div className="flex justify-between font-medium"><span>Balance</span><span>{inr(balance)}</span></div>
            </div>

            {isOpenBill && balance > 0.005 && (
              <div className="space-y-2">
                <PaymentFields amount={amount} method={method} onAmountChange={setAmount} onMethodChange={setMethod} label="COLLECT PAYMENT" />
                <Button className="w-full" onClick={collect} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Collect</Button>
              </div>
            )}

            {isOpenBill && Number(bill.amountPaid) <= 0.005 ? (
              <div className="space-y-2">
                <hr />
                <Label htmlFor="record-charge">Change the charge (₹)</Label>
                <div className="flex gap-2">
                  <Input id="record-charge" type="number" min={0} value={newCharge} onChange={(e) => setNewCharge(e.target.value)} />
                  <Button variant="outline" onClick={changeCharge} disabled={busy}>Update</Button>
                </div>
              </div>
            ) : isOpenBill ? (
              <p className="text-xs text-gray-500">Money has been taken on this bill, so its charge is changed in Billing (a refund, or an added charge). To cancel, use "Cancel &amp; refund" in Billing.</p>
            ) : (
              <p className="text-xs text-gray-500">This bill is cancelled.</p>
            )}
          </div>
        ) : record.paidOutsideBilling > 0 ? (
          <p className="text-sm text-gray-600">
            {inr(record.paidOutsideBilling)} was recorded as paid on this screen before it was linked to Billing. That money is not in Billing, so no bill is raised for it here — it is left as it was recorded.
          </p>
        ) : !record.patientId ? (
          <p className="text-sm text-gray-600">No patient is linked, so there is no one to bill. Add the patient first.</p>
        ) : !(Number(charge) > 0) ? (
          <p className="text-sm text-gray-600">There is no charge, so there is nothing to bill.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">No bill has been raised for {inr(charge)} yet.</p>
            <PaymentFields amount={amount} method={method} onAmountChange={setAmount} onMethodChange={setMethod} charge={charge} />
            <Button className="w-full" onClick={raise} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Raise bill</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
