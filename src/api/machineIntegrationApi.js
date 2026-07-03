import client from './client'

// ─────────────────────────────────────────────────────────────────────────────
// Machine Integration API (lab analyzers, radiology equipment, …).
// Every call is automatically HOSPITAL-SCOPED on the backend via the auth
// session (getOrgId) — a logged-in hospital only ever sees/edits its own
// machines. No org id is sent from the client.
// `client` (axios) already unwraps to response.data.
// ─────────────────────────────────────────────────────────────────────────────

const machineIntegrationApi = {
  listIntegrations: () => client.get('/machine-integration', { params: { resource: 'integrations' } }),
  listQueue: (params = {}) => client.get('/machine-integration', { params: { resource: 'queue', ...params } }),
  listLogs: (params = {}) => client.get('/machine-integration', { params: { resource: 'logs', ...params } }),
  create: (body) => client.post('/machine-integration', body),
  update: (body) => client.patch('/machine-integration', body),
  reprocess: (id) => client.post('/machine-integration/reprocess', { id }),
  drain: () => client.post('/machine-integration/drain', {}),
  health: () => client.get('/machine-integration/health'),
}

export default machineIntegrationApi
