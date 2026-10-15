// RazorpayX Payout API — Hospital → Vendor bank transfer (NEFT/IMPS/RTGS).
//
// Setup required before use:
//   1. Activate RazorpayX on your Razorpay dashboard (Business Banking).
//   2. Link a current bank account as your source of funds.
//   3. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the backend .env
//      (the same keys as your regular Razorpay account).
//   4. Add RAZORPAY_ACCOUNT_NUMBER to .env — the current account number linked
//      to your RazorpayX dashboard (not your key; the actual bank account no.).
//
// Flow for one vendor payment:
//   ensureContact  →  ensureFundAccount  →  createPayout
//   The contact and fund-account IDs are cached on the Vendor row so they are
//   not created again on the next payment to the same vendor.

import axios from 'axios'

const BASE = 'https://api.razorpay.com/v1'

function client() {
  const key    = process.env.RAZORPAY_KEY_ID
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!key || !secret) throw new Error('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not set in the environment')
  return axios.create({
    baseURL: BASE,
    auth: { username: key, password: secret },
    headers: { 'Content-Type': 'application/json' },
    timeout: 15_000,
  })
}

function rpError(e, fallback) {
  const msg = e?.response?.data?.error?.description || e?.message || fallback
  throw new Error(msg)
}

/**
 * Create or return the existing Razorpay Contact for a vendor.
 * A contact is the payee identity — name, email, phone.
 * If razorpayContactId is already on the vendor, it is returned as-is.
 */
export async function ensureContact(vendor) {
  if (vendor.razorpayContactId) return vendor.razorpayContactId
  try {
    const r = await client().post('/contacts', {
      name:         vendor.name,
      email:        vendor.email        || undefined,
      contact:      vendor.phone        || undefined,
      type:         'vendor',
      reference_id: vendor.id,
      notes:        { vendorCode: vendor.code || '', pan: vendor.pan || '' },
    })
    return r.data.id // ctr_xxxxxxxxxxxxxxxxxx
  } catch (e) {
    rpError(e, 'Could not create a Razorpay contact for this vendor')
  }
}

/**
 * Create or return the existing Fund Account (bank account) for a contact.
 * If razorpayFundAccountId is already on the vendor, it is returned as-is.
 * Requires vendor.bankAccountNumber, vendor.bankIfsc, vendor.bankAccountName.
 */
export async function ensureFundAccount(contactId, vendor) {
  if (vendor.razorpayFundAccountId) return vendor.razorpayFundAccountId
  if (!vendor.bankAccountNumber || !vendor.bankIfsc || !vendor.bankAccountName) {
    throw new Error(`Bank details missing for ${vendor.name} — add account number, IFSC and account holder name in Purchase → Vendors before paying`)
  }
  try {
    const r = await client().post('/fund_accounts', {
      contact_id:   contactId,
      account_type: 'bank_account',
      bank_account: {
        name:           vendor.bankAccountName,
        ifsc:           vendor.bankIfsc.toUpperCase(),
        account_number: vendor.bankAccountNumber,
      },
    })
    return r.data.id // fa_xxxxxxxxxxxxxxxxxx
  } catch (e) {
    rpError(e, 'Could not register the vendor\'s bank account with Razorpay')
  }
}

/**
 * Initiate a payout (NEFT / IMPS / RTGS) from the hospital's RazorpayX
 * account to the vendor's fund account.
 *
 * @param {string} fundAccountId  Razorpay fund account id (fa_…)
 * @param {number} amount         Amount in ₹ (will be converted to paise)
 * @param {string} referenceId    VendorPayment.number — shown on bank statement
 * @param {string} narration      Short note on the transfer (≤ 30 chars)
 * @returns {{ payoutId, utr, status }}
 *   status is one of: queued | pending | processing | processed | failed | cancelled | reversed
 */
export async function createPayout({ fundAccountId, amount, referenceId, narration = 'Vendor payment' }) {
  const accountNumber = process.env.RAZORPAY_ACCOUNT_NUMBER
  if (!accountNumber) throw new Error('RAZORPAY_ACCOUNT_NUMBER is not set — add your RazorpayX current account number to the backend .env')

  const amountPaise = Math.round(amount * 100)
  if (amountPaise < 100) throw new Error('Minimum payout is ₹1')

  // Use IMPS for amounts < ₹2 lakh (instant); NEFT otherwise.
  const mode = amountPaise < 20_000_000 ? 'IMPS' : 'NEFT'

  try {
    const r = await client().post('/payouts', {
      account_number:  accountNumber,
      fund_account_id: fundAccountId,
      amount:          amountPaise,
      currency:        'INR',
      mode,
      purpose:         'vendor_advance', // Razorpay-allowed purpose for B2B
      reference_id:    referenceId,      // shows on bank statement
      narration:       narration.slice(0, 30),
      queue_if_low_balance: true,        // queue instead of fail if balance is low
    })
    return {
      payoutId: r.data.id,
      utr:      r.data.utr || null,
      status:   r.data.status,
    }
  } catch (e) {
    rpError(e, 'Payout could not be initiated')
  }
}

/**
 * Fetch the latest status of a payout from Razorpay.
 * @returns {{ payoutId, utr, status, failureReason }}
 */
export async function fetchPayout(payoutId) {
  try {
    const r = await client().get(`/payouts/${payoutId}`)
    return {
      payoutId:      r.data.id,
      utr:           r.data.utr || null,
      status:        r.data.status,
      failureReason: r.data.error?.description || null,
    }
  } catch (e) {
    rpError(e, 'Could not fetch payout status')
  }
}
