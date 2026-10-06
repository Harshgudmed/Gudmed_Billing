import client from './client'

// Requests for quotation and the hospital's e-mail (SMTP) settings — the
// /purchase resources answered by backend/src/controllers/purchaseRfqController.js.
// The RFQ list is paged with useServerPagination (PURCHASE_ENDPOINT, resource 'rfqs',
// { view: 'draft' | 'open' | 'due' | 'awarded', status, search }).

const patch = (body) => client.patch('/purchase', { resource: 'rfq', ...body })

export const rfqApi = {
  get:      (id)       => client.get('/purchase', { params: { resource: 'rfq', id } }), // lines, vendors + quotes, comparison, cheaper, email
  create:   (body)     => client.post('/purchase', { resource: 'rfq', ...body }),      // a draft: { title, dueDate, notes, vendorIds, lines }
  save:     (id, body) => patch({ id, action: 'save', ...body }),
  send:     (id)       => patch({ id, action: 'send' }),                                // → open; e-mails vendors when the hospital's setting says so
  quote:    (id, body) => patch({ id, action: 'quote', ...body }),                      // { rfqVendorId, declined, deliveryDays, validTill, notes, quotes }
  award:    (id, rfqVendorId, awardNote) => patch({ id, action: 'award', rfqVendorId, awardNote }),
  cancel:   (id, reason) => patch({ id, action: 'cancel', reason }),
  email:    (id, rfqVendorId) => patch({ id, action: 'email', rfqVendorId }),          // re-send: one vendor, or all not yet e-mailed
  remove:   (id)       => client.delete('/purchase', { params: { resource: 'rfq', id } }),

  // Settings → Integrations → E-mail (SMTP): administrator only. The password
  // is never sent back — `passwordSaved` says whether one is kept.
  getEmailSettings:  ()     => client.get('/purchase', { params: { resource: 'email-settings' } }),
  saveEmailSettings: (body) => client.patch('/purchase', { resource: 'email-settings', ...body }),
  sendTestEmail:     (to)   => client.post('/purchase', { resource: 'email-test', to }),
}
