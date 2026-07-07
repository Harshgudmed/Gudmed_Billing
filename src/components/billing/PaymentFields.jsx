import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Payment methods offered at booking — shared so every module lists the same set.
export const PAYMENT_METHODS = ['cash', 'card', 'upi', 'insurance']

// ── Shared "payment collected at booking" fields ──────────────────────────────
// Amount Paid + Payment Method, used by every module dialog (Lab, Radiology,
// Pharmacy, OPD, Procedure…) so payment capture looks and behaves identically.
// A plain native <select> keeps this dependency-light and drop-in anywhere.
//   amount / method        — controlled values (strings)
//   onAmountChange / onMethodChange — receive the new value
//   charge (optional)      — shows the item/exam charge as a hint
export default function PaymentFields({
  amount,
  method,
  onAmountChange,
  onMethodChange,
  charge,
  label = 'PAYMENT (Optional)',
}) {
  return (
    <div className="space-y-2">
      <hr />
      <div className="text-xs font-semibold text-gray-600">{label}</div>
      {Number(charge) > 0 && (
        <div className="text-xs text-gray-500">Charge: ₹{Number(charge).toLocaleString('en-IN')}</div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Amount Paid (₹)</Label>
          <Input
            type="number"
            min={0}
            placeholder="0 (leave blank if unpaid)"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
          />
        </div>
        <div>
          <Label>Payment Method</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={method}
            onChange={(e) => onMethodChange(e.target.value)}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
