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
      // Generous — the raw paste (e.g. "+91 98765 43210") can be longer than
      // 10 chars before sanitizePhoneInput trims it down on the same change.
      maxLength={10}
      value={value}
      onChange={(e) => onChange(sanitizePhoneInput(e.target.value))}
      className={className}
      {...props}
    />
  )
}
