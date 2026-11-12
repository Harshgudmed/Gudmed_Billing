// Who may create, edit, retire an asset or log its maintenance — Admin and the
// Purchase/Store side, since assets are usually bought and received through
// Purchase. Every other role that can open the module (roleModules.js) reads
// it read-only. Mirrored on the frontend by src/lib/assetAccess.js.
export const ASSET_MANAGERS = ['admin', 'super_admin', 'purchase_officer', 'store_keeper']

// With login switched off (the demo) there is no req.user and nothing is
// refused, as on every other route.
export function canManageAssets(req) {
  if (!req.user) return true
  return ASSET_MANAGERS.includes(req.user.role)
}
