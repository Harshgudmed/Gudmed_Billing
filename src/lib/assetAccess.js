// Mirrors backend/src/lib/assetAccess.js — the server decides every write
// again; this only chooses which buttons a role is shown. Admin and the
// Purchase/Store side manage the register; every other role reads it.
const ASSET_MANAGERS = ['admin', 'super_admin', 'purchase_officer', 'store_keeper']

/** May `role` create/edit/retire an asset or log its maintenance? No role (login off, the demo) may do everything. */
export function canManageAssets(role) {
  return !role || ASSET_MANAGERS.includes(role)
}
