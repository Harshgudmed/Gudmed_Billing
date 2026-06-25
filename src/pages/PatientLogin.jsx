import { useState, useEffect } from 'react'
import { useNavigate, Navigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2, HeartPulse } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import Logo from '@/components/Logo'
import { useAuth } from '@/lib/auth'
import { LOGIN_HERO } from '@/lib/roleConfig'

// Patient portal login at /patient/login. Patients sign in with their phone number,
// UHID, or email (whichever the hospital registered) + a password.
export default function PatientLogin() {
  const navigate = useNavigate()
  const { user, patientLogin } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) {
    return <Navigate to={user.role === 'patient' ? '/patient' : '/'} replace />
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      await patientLogin(identifier.trim(), password)
      navigate('/patient', { replace: true })
    } catch (err) {
      toast.error(err.message || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  const hero = LOGIN_HERO.patient
  const [imgLoaded, setImgLoaded] = useState(false)

  useEffect(() => {
    if (!hero?.img) return
    setImgLoaded(false)
    const img = new Image()
    img.src = hero.img
    img.onload = () => setImgLoaded(true)
  }, [hero?.img])

  return (
    <div className="min-h-screen flex">
      {hero && (
        <div
          className="relative hidden lg:flex lg:w-1/2 flex-col justify-end bg-cover bg-center p-12 transition-all duration-700"
          style={{
            backgroundColor: '#171717',
            backgroundImage: imgLoaded
              ? `linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0) 100%), url(${hero.img})`
              : 'none',
          }}
        >
          {!imgLoaded && (
            <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 animate-pulse" />
          )}
          <div className="relative text-white">
            <h2 className="text-3xl font-bold leading-tight drop-shadow-md">{hero.title}</h2>
            <p className="mt-2 max-w-sm text-white/90 drop-shadow">{hero.subtitle}</p>
          </div>
        </div>
      )}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-gray-50 px-4 py-10">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
              <HeartPulse className="h-7 w-7" />
            </span>
          </div>
          <div>
            <CardTitle className="text-xl">Patient Portal</CardTitle>
            <CardDescription>View your appointments, reports & bills</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="identifier">Phone / UHID / Email</Label>
              <Input
                id="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="e.g. 9876543210 or UHID..."
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          {/* Demo credentials — visible so clients can sign in without asking. */}
          <button
            type="button"
            onClick={() => { setIdentifier('99999999999'); setPassword('Gudmed@123') }}
            className="mt-4 w-full rounded-lg border border-dashed border-teal-300 bg-teal-50/60 px-3 py-2 text-left transition hover:bg-teal-50"
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-teal-700">🔑 Demo login — tap to fill</span>
            <span className="mt-1 block text-xs text-gray-700">
              99999999999 · <span className="font-mono font-medium">Gudmed@123</span>
            </span>
          </button>

          <div className="mt-5 text-center text-xs text-gray-400">
            Hospital staff?{' '}
            <Link to="/" className="text-teal-600 hover:underline">Staff login</Link>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
