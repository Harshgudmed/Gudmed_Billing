import { useState } from 'react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { INDIAN_STATES, BLOOD_GROUPS, INSURANCE_PROVIDERS } from '../utils/patientUtils';

export default function PatientForm({ form, isSubmitting, onSubmitFn, submitLabel }) {
  const [otherProvider, setOtherProvider] = useState(false);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmitFn)} className="space-y-4">
        {/* Name */}
        <div className="grid grid-cols-3 gap-3">
          {['firstName', 'middleName', 'lastName'].map((name) => (
            <FormField key={name} control={form.control} name={name} render={({ field }) => (
              <FormItem>
                <FormLabel>{name === 'firstName' ? 'First Name *' : name === 'middleName' ? 'Middle Name' : 'Last Name *'}</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          ))}
        </div>

        {/* DOB & Gender */}
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="dateOfBirth" render={({ field }) => (
            <FormItem>
              <FormLabel>Date of Birth *</FormLabel>
              <FormControl><Input type="date" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="gender" render={({ field }) => (
            <FormItem>
              <FormLabel>Gender *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* Phone & Email */}
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="phonePrimary" render={({ field }) => (
            <FormItem>
              <FormLabel>Phone (Primary) *</FormLabel>
              <FormControl><Input placeholder="+91XXXXXXXXXX" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl><Input type="email" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* Address — the whole thing. This screen used to collect State alone,
            so a patient's house, street, locality, city, district and PIN had
            nowhere to be typed even though the table has a column for each. */}
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="houseNumber" render={({ field }) => (
            <FormItem>
              <FormLabel>House / Flat No.</FormLabel>
              <FormControl><Input placeholder="e.g. A-1204" {...field} value={field.value || ''} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="street" render={({ field }) => (
            <FormItem>
              <FormLabel>Street / Block</FormLabel>
              <FormControl><Input placeholder="e.g. Block G, MG Road" {...field} value={field.value || ''} /></FormControl>
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="locality" render={({ field }) => (
            <FormItem>
              <FormLabel>Locality / Area</FormLabel>
              <FormControl><Input placeholder="e.g. Andheri West" {...field} value={field.value || ''} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="city" render={({ field }) => (
            <FormItem>
              <FormLabel>Village / Town / City</FormLabel>
              <FormControl><Input placeholder="e.g. Mumbai" {...field} value={field.value || ''} /></FormControl>
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <FormField control={form.control} name="district" render={({ field }) => (
            <FormItem>
              <FormLabel>District</FormLabel>
              <FormControl><Input placeholder="e.g. Mumbai Suburban" {...field} value={field.value || ''} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="state" render={({ field }) => (
            <FormItem>
              <FormLabel>State</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger></FormControl>
                <SelectContent>
                  {INDIAN_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormItem>
          )} />
          <FormField control={form.control} name="pincode" render={({ field }) => (
            <FormItem>
              <FormLabel>PIN Code</FormLabel>
              <FormControl>
                <Input
                  placeholder="6-digit PIN" inputMode="numeric" maxLength={6}
                  {...field} value={field.value || ''}
                  onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ''))}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* Blood Group */}
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="bloodGroup" render={({ field }) => (
            <FormItem>
              <FormLabel>Blood Group</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                <SelectContent>
                  {BLOOD_GROUPS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormItem>
          )} />
        </div>

        {/* Emergency Contact */}
        <div className="grid grid-cols-3 gap-3">
          <FormField control={form.control} name="emergencyContactName" render={({ field }) => (
            <FormItem>
              <FormLabel>Emergency Contact</FormLabel>
              <FormControl><Input placeholder="Contact name" {...field} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="emergencyContactPhone" render={({ field }) => (
            <FormItem>
              <FormLabel>Contact Phone</FormLabel>
              <FormControl><Input placeholder="Phone number" {...field} /></FormControl>
            </FormItem>
          )} />
          <FormField control={form.control} name="emergencyContactRelationship" render={({ field }) => (
            <FormItem>
              <FormLabel>Relationship</FormLabel>
              <FormControl><Input placeholder="e.g. Spouse" {...field} /></FormControl>
            </FormItem>
          )} />
        </div>

        {/* Insurance */}
        {(() => {
          const hasIns = form.watch('hasInsurance')
          const provider = form.watch('insuranceProvider') || ''
          const inList = INSURANCE_PROVIDERS.includes(provider)
          const isOther = otherProvider || (!!provider && !inList)
          return (
            <div className="rounded-lg border p-3 space-y-3 bg-gray-50/50">
              {/* Step 1: ask if patient has insurance */}
              <FormField control={form.control} name="hasInsurance" render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => {
                        field.onChange(!!checked)
                        if (!checked) {
                          form.setValue('insuranceProvider', '')
                          form.setValue('insuranceId', '')
                          setOtherProvider(false)
                        }
                      }}
                    />
                  </FormControl>
                  <FormLabel className="cursor-pointer font-medium">Patient has health insurance</FormLabel>
                </FormItem>
              )} />

              {/* Step 2: only if insured, show provider + ID */}
              {hasIns && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <FormItem>
                    <FormLabel>Insurance Provider *</FormLabel>
                    <Select
                      value={isOther ? 'Other' : provider}
                      onValueChange={(v) => {
                        if (v === 'Other') { setOtherProvider(true); form.setValue('insuranceProvider', '') }
                        else { setOtherProvider(false); form.setValue('insuranceProvider', v) }
                      }}
                    >
                      <FormControl><SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {INSURANCE_PROVIDERS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        <SelectItem value="Other">Other (type below)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>

                  <FormField control={form.control} name="insuranceId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance ID / Policy No. *</FormLabel>
                      <FormControl><Input placeholder="e.g. POL123456789" {...field} /></FormControl>
                    </FormItem>
                  )} />

                  {/* Step 3: if "Other", let them type the provider name */}
                  {isOther && (
                    <FormField control={form.control} name="insuranceProvider" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Provider Name (Other) *</FormLabel>
                        <FormControl><Input placeholder="Type insurance company name" {...field} /></FormControl>
                      </FormItem>
                    )} />
                  )}
                </div>
              )}
            </div>
          )
        })()}

        <DialogFooter>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
