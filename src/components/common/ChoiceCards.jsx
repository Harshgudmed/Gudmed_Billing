// A setting chosen from a few ways of working, shown as cards that say what
// each choice does. A drop-down hid the choices behind one line, and the
// person setting up the hospital could not tell what "officer_finance" or
// "approval" would mean for their staff. Each card is a real radio button
// (arrow keys move between them), so it works by keyboard and screen reader.
import { Check, ArrowRight } from 'lucide-react'

// Full class strings: Tailwind does not ship names built at run time.
const COLS = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }

/**
 * @param legend    the question, e.g. "Who pays vendors"
 * @param name      the radio group's name (unique on the page)
 * @param value     the chosen option's value
 * @param onChange  (value) => void
 * @param options   [{ value, title, description, Icon?, steps? }]  steps: short labels shown as a flow, in order
 * @param columns   1 | 2 | 3 on wider screens (one column on a phone)
 */
export function ChoiceCards({ legend, name, value, onChange, options, columns = options.length, disabled = false }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium text-gray-900">{legend}</legend>
      <div className={`grid grid-cols-1 gap-3 ${COLS[Math.min(columns, 3)] || ''}`}>
        {options.map(({ value: optionValue, title, description, Icon, steps }) => {
          const chosen = value === optionValue
          return (
            <label
              key={optionValue}
              className={`relative flex cursor-pointer gap-3 rounded-lg border p-4 transition
                has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-2
                ${chosen ? 'border-blue-600 bg-blue-50/60 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}
                ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                type="radio" className="sr-only" name={name} value={optionValue}
                checked={chosen} onChange={() => onChange(optionValue)}
              />
              {Icon && (
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${chosen ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  <Icon className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0 flex-1 pr-6">
                <span className="block text-sm font-semibold text-gray-900">{title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-gray-600">{description}</span>
                {steps && (
                  <span className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="How it works, in order">
                    {steps.map((step, i) => (
                      <span key={step} className="inline-flex items-center gap-1.5">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${chosen ? 'bg-white text-blue-800 ring-1 ring-blue-200' : 'bg-gray-100 text-gray-600'}`}>{step}</span>
                        {i < steps.length - 1 && <ArrowRight className="h-3 w-3 text-gray-400" aria-hidden="true" />}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span
                className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border
                  ${chosen ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'}`}
                aria-hidden="true"
              >
                {chosen && <Check className="h-3.5 w-3.5" />}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** One on/off setting as a card: what it does, and whether it is on. */
export function ToggleCard({ title, description, checked, onChange, disabled = false, disabledNote }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition
        has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-2
        ${checked ? 'border-blue-600 bg-blue-50/60' : 'border-gray-200 bg-white hover:bg-gray-50'}
        ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
        checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-gray-600">{description}</span>
        {disabled && disabledNote && <span className="mt-1 block text-xs font-medium text-amber-700">{disabledNote}</span>}
      </span>
    </label>
  )
}
