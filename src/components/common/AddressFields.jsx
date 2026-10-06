import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FieldError } from './FieldError'

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry',
]

/**
 * The Indian address, in the parts a front desk asks for: house, street,
 * locality, city, district, state, PIN. Patient registration and the vendor
 * form both use it, so an address is entered the same way everywhere.
 *
 *   <AddressFields values={form} setField={setField} fieldErrors={errors} />
 *
 * values      { houseNumber, street, locality, city, district, [stateKey], pincode }
 * setField    (key, value) — every field goes through it unless the two below are given
 * setTextField / setNameField  optional cleaners for free text and for place
 *             names (patient registration passes its own)
 * required    City, State and PIN are required (default) — false makes the
 *             whole address optional, as a vendor's is
 * stateKey    the key the state is stored under (default 'state')
 * stateOptions [{ value, label }] — default: the state names; a vendor passes
 *             GST state codes
 * stateDisabled / stateHint  a vendor's state comes from its GSTIN
 */
export default function AddressFields({
  values,
  setField,
  setTextField = setField,
  setNameField = setField,
  fieldErrors = {},
  required = true,
  stateKey = 'state',
  stateOptions,
  stateDisabled = false,
  stateHint,
  title = 'Address',
}) {
  const star = required ? <span className="text-red-500">*</span> : null
  const states = stateOptions || INDIAN_STATES.map((s) => ({ value: s, label: s }))
  return (
    <section className="rounded-lg border bg-gray-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
        <MapPin className="h-4 w-4 text-blue-600" />{title}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>div]:min-w-0">
        <div>
          <Label className="text-xs text-gray-600">House / Flat / Building No.</Label>
          <Input className="mt-1" value={values.houseNumber || ''} onChange={e => setTextField('houseNumber', e.target.value)} placeholder="e.g. Flat 12B" />
        </div>
        <div>
          <Label className="text-xs text-gray-600">Street / Block</Label>
          <Input className="mt-1" value={values.street || ''} onChange={e => setTextField('street', e.target.value)} placeholder="e.g. Block G, MG Road" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-gray-600">Locality / Area</Label>
          <Input className="mt-1" value={values.locality || ''} onChange={e => setNameField('locality', e.target.value)} placeholder="e.g. Andheri West" />
        </div>
        <div>
          <Label className="text-xs text-gray-600">Village / Town / City {star}</Label>
          <Input className={cn('mt-1', fieldErrors.city && 'border-red-500')} value={values.city || ''} onChange={e => setNameField('city', e.target.value)} placeholder="e.g. Mumbai" required={required} />
          <FieldError message={fieldErrors.city} />
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3 [&>div]:min-w-0">
        <div>
          <Label className="text-xs text-gray-600">District</Label>
          <Input className="mt-1" value={values.district || ''} onChange={e => setNameField('district', e.target.value)} placeholder="e.g. Mumbai Suburban" />
        </div>
        <div>
          <Label className="text-xs text-gray-600">State {star}</Label>
          <Select value={values[stateKey] ?? ''} onValueChange={v => setField(stateKey, v)} disabled={stateDisabled}>
            <SelectTrigger className={cn('mt-1', fieldErrors[stateKey] && 'border-red-500')} aria-label="State"><SelectValue placeholder="Select State" /></SelectTrigger>
            <SelectContent>
              {states.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {stateHint && <p className="mt-1 text-xs text-gray-500">{stateHint}</p>}
          <FieldError message={fieldErrors[stateKey]} />
        </div>
        <div>
          <Label className="text-xs text-gray-600">PIN Code {star}</Label>
          <Input className={cn('mt-1', fieldErrors.pincode && 'border-red-500')} value={values.pincode || ''} onChange={e => setField('pincode', e.target.value.replace(/\D/g, ''))} placeholder="Enter 6-digit PIN code" inputMode="numeric" maxLength={6} required={required} />
          <FieldError message={fieldErrors.pincode} />
        </div>
      </div>
    </section>
  )
}
