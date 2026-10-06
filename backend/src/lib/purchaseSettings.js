// How this hospital runs the money side of Purchase — its own choice, set in
// Settings → Purchase (src/lib/orgSettingsSchema.js keeps the same keys for
// the screen). Read on the server for every decision; never taken from a
// request body.
//
// Missing or unknown values fall back to the stricter reading.

/** Who pays vendors: Finance records it | only an administrator | the purchase officer records it and Finance approves. */
export const PAYMENT_MODES = ['finance', 'admin', 'officer_finance']
/** Purchase returns: the purchase officer approves the store's return | the store's return posts at once. */
export const RETURN_MODES = ['approval', 'direct']

export const PURCHASE_SETTING_DEFAULTS = {
  purchasePaymentMode: 'finance',
  purchaseReturnMode: 'approval',
  rfqEmailVendors: false,
}

/** The purchase settings out of an organisation row (its `settings` JSON). */
export function purchaseSettings(organization) {
  let stored = {}
  try {
    stored = typeof organization?.settings === 'string'
      ? JSON.parse(organization.settings)
      : (organization?.settings || {})
  } catch { stored = {} }
  return {
    paymentMode: PAYMENT_MODES.includes(stored.purchasePaymentMode) ? stored.purchasePaymentMode : PURCHASE_SETTING_DEFAULTS.purchasePaymentMode,
    returnMode: RETURN_MODES.includes(stored.purchaseReturnMode) ? stored.purchaseReturnMode : PURCHASE_SETTING_DEFAULTS.purchaseReturnMode,
    rfqEmailVendors: stored.rfqEmailVendors === true,
  }
}

/** Read them for one hospital (`client` is the db or a transaction). */
export async function loadPurchaseSettings(client, organizationId) {
  const org = await client.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
  return purchaseSettings(org)
}
