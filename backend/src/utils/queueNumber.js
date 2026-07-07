// Shared by triageController.js (walk-in queue entries) and
// appointmentController.js (check-in-derived queue entries) so both paths
// generate queue numbers the same way.
export function generateQueueNumber(serviceArea) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  const prefix = (serviceArea || 'gen').substring(0, 3).toUpperCase()
  return `${prefix}${date}${random}`
}
