import { Navigate } from 'react-router-dom'
import { PageLoader } from '@/components/ui/spinner'
import { useAuth } from '@/lib/auth'
import { homePathFor } from '@/lib/roleConfig'
import PlatformModule from '@/components/platform/PlatformModule'

// /platform — for the platform owner alone. Not under a hospital's role layout
// (ProtectedRoute / RoleLayout), so the door is kept here: no session goes to the
// platform sign-in, and a hospital's staff go back to their own workspace. The
// server refuses them as well; this only keeps the page from opening.
export default function PlatformPage() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/platform/login" replace />
  if (user.role !== 'platform_owner') return <Navigate to={homePathFor(user.role)} replace />
  return <PlatformModule />
}
