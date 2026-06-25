import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/**
 * Format a doctor's name with exactly one "Dr." prefix.
 * Handles names already stored with a title (e.g. "Dr. Suresh Patel")
 * so we never end up with "Dr. Dr. Suresh Patel".
 */
export function drName(name) {
  if (!name) return ''
  const clean = String(name).replace(/^\s*(dr\.?\s+)+/i, '').trim()
  return clean ? `Dr. ${clean}` : ''
}

/**
 * Body-temperature unit conversion.
 * Values are STORED and SCORED in Celsius (the clinical NEWS2 early-warning score
 * is Celsius-based). We convert only at the UI edge so staff see/enter Fahrenheit
 * (e.g. 98.6 / 100 / 101) while storage + scoring stay safe in Celsius.
 *
 *   cToF → use when DISPLAYING a stored value
 *   fToC → use before SAVING a value the user typed
 * Both return null for empty input and round to 1 decimal.
 */
export function cToF(c) {
  if (c === null || c === undefined || c === '') return null
  return Math.round(((Number(c) * 9) / 5 + 32) * 10) / 10
}

export function fToC(f) {
  if (f === null || f === undefined || f === '') return null
  return Math.round((((Number(f) - 32) * 5) / 9) * 10) / 10
}
