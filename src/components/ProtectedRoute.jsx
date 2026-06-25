import { Navigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { isKnownRole, homePathFor } from '@/lib/roleConfig'

// Gates the /:role/* space:
//  - while the session is being restored, show a spinner
//  - not logged in            → /:role/login
//  - logged in, wrong role    → bounce to the user's own home (admin may go anywhere)
//  - unknown role in the URL  → home / login
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const { role } = useParams()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!isKnownRole(role)) {
    return <Navigate to={user ? homePathFor(user.role) : '/'} replace />
  }

  if (!user) {
    return <Navigate to={`/${role}/login`} replace />
  }

  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  if (user.role !== role && !isAdmin) {
    return <Navigate to={homePathFor(user.role)} replace />
  }

  return children
}
