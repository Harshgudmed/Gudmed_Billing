// Purchase reports (read only): purchase register, vendor ledger and ageing, stock valuation and consumption.
// Dispatched from purchaseController.js by resource name.
// Placeholder until the module is built: every handler answers 501.

export const REPORT_READS = new Set(['report'])
export const REPORT_WRITES = new Set()

const notBuilt = (res) => res.status(501).json({ success: false, error: 'Purchase reports is not built yet' })

export async function reportGet(req, res) { return notBuilt(res) }
export async function reportCreate(req, res) { return notBuilt(res) }
export async function reportUpdate(req, res) { return notBuilt(res) }
export async function reportRemove(req, res) { return notBuilt(res) }
