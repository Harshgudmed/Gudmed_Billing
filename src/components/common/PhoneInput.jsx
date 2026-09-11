import { Input } from '@/components/ui/input'
import { sanitizePhoneInput } from './phoneValidation'

/**
 * Indian mobile number input. `value` is always the clean, ≤10-digit string
 * (never a raw +91/0-prefixed one) — country codes, leading zeros, spaces and
 * dashes are stripped live as the user types or pastes, so the parent never
 * has to clean up after this field. Letters and symbols simply can't land in
 * it (browsers still deliver them to onChange; we just filter them out here).
 *
 * `onChange` is called with the cleaned string directly (not an event) so
 * callers can drop it straight into their form state, e.g.
 * `onChange={v => setField('phonePrimary', v)}`.
 */
export function PhoneInput({ value, onChange, className, ...props }) {
  return (
    <Input
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      spellCheck={false}
      // Generous, and it has to be: the raw value (e.g. "+91 98765 43210", 15
      // characters) must be allowed to LAND before sanitizePhoneInput can strip
      // the country code from it.
      //
      // This said 10, which quietly broke the thing the comment promised. Typing
      // "+91 98765 43210" filled the ten slots with "9198765432" and the field
      // stopped accepting input, so the 91 was never in a 12-digit string and
      // never stripped. The result is ten digits starting with 9 — it passes
      // `^[6-9]\d{9}$` and saves as a real-looking number that reaches nobody.
      // Patient registration uses this field too.
      //
      // Anything still too long after sanitising is left alone and refused by
      // the schema, which is deliberate: a 12-digit number with no recognisable
      // country code is junk, and trimming it would fabricate a number.
      maxLength={16}
      value={value}
      onChange={(e) => onChange(sanitizePhoneInput(e.target.value))}
      className={className}
      {...props}
    />
  )
}
