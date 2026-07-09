import { useState, useEffect } from 'react'
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2, ShieldCheck, Stethoscope, ConciergeBell, UserCog, ClipboardList, HeartPulse, Pill, FlaskConical, Scan, Receipt, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import Logo from '@/components/Logo'
import { useAuth } from '@/lib/auth'
import { ROLES, isKnownRole, homePathFor, LOGIN_HERO } from '@/lib/roleConfig'
import doctorImages from '../../public/login/Doctor.jpeg'

// Icon + accent per role so the login screen is recognisable without reading.
const ROLE_VISUAL = {
  admin:                { Icon: ShieldCheck,   color: '#2563eb' },
  doctor:               { Icon: Stethoscope,   color: '#0891b2' },
  receptionist:         { Icon: ConciergeBell, color: '#9333ea' },
  patient_crm:          { Icon: ClipboardList, color: '#e11d48' },
  nurse:                { Icon: HeartPulse,    color: '#0d9488' },
  pharmacist:           { Icon: Pill,          color: '#7c3aed' },
  lab_technician:       { Icon: FlaskConical,  color: '#0284c7' },
  radiology_technician: { Icon: Scan,          color: '#4f46e5' },
  billing:              { Icon: Receipt,       color: '#d97706' },
  housekeeping:         { Icon: Sparkles,      color: '#16a34a' },
}

// Demo credentials shown on the login screen (so clients don't have to ask).
// Falls back to the admin account for any role without its own demo login.
const DEMO_ACCOUNTS = {
  admin:              { email: 'admin@gudmed.in',       password: 'Gudmed@123' },
  doctor:             { email: 'priya@gudmed.in',       password: 'Gudmed@123' },
  patient_crm:        { email: 'coordinator@gudmed.in', password: 'Gudmed@123' },
  receptionist:       { email: 'reception@gudmed.in',   password: 'Gudmed@123' },
  finance_controller: { email: 'finance@gudmed.in',     password: 'Gudmed@123' },
}

// Per-role login page mounted at /:role/login. The hospital is resolved from the
// account on the backend, so we only ask for email + password.
export default function RoleLogin() {
  const { role } = useParams()
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const knownRole = isKnownRole(role)
  const isDoctorLogin = role === 'doctor'
  const hero = knownRole && LOGIN_HERO[role]
    ? {
        ...LOGIN_HERO[role],
        img: isDoctorLogin ? doctorImages : LOGIN_HERO[role].img,
      }
    : null

  // Preload hero image so it's ready before it's needed
  useEffect(() => {
    if (!hero?.img) return
    setImgLoaded(false)
    const img = new Image()
    img.src = hero.img
    img.onload = () => setImgLoaded(true)
  }, [hero?.img])

  // Unknown role in the URL → send home / to the root picker.
  if (!knownRole) {
    return <Navigate to={user ? homePathFor(user.role) : '/'} replace />
  }

  // Already logged in → go straight to that user's space.
  if (user) {
    return <Navigate to={homePathFor(user.role)} replace />
  }

  const roleLabel = ROLES[role].label
  const visual = ROLE_VISUAL[role] || { Icon: UserCog, color: '#2563eb' }
  const RoleIcon = visual.Icon
  const demo = DEMO_ACCOUNTS[role] || DEMO_ACCOUNTS.admin

  async function onSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const u = await login(email.trim(), password)
      if (!ROLES[u.role]) {
        toast.error('Your role is not enabled on the web app yet. Contact your administrator.')
        return
      }
      if (u.role !== role && u.role !== 'admin' && u.role !== 'super_admin') {
        toast.message(`Signed in as ${ROLES[u.role].label}`, { description: 'Taking you to your workspace.' })
      }
      navigate(homePathFor(u.role), { replace: true })
    } catch (err) {
      toast.error(err.message || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {hero && (
        <div
          className="relative hidden overflow-hidden lg:flex lg:w-1/2 flex-col justify-end p-12 transition-all duration-700"
          style={{
            backgroundColor: isDoctorLogin ? '#eaf7f8' : '#171717',
            backgroundImage: imgLoaded && !isDoctorLogin
              ? `linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0) 100%), url(${hero.img})`
              : isDoctorLogin
                ? 'linear-gradient(135deg, #f8fcfc 0%, #d9f0f3 45%, #b9dde6 100%)'
                : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: imgLoaded ? 1 : 0.85,
          }}
          >
          {/* Skeleton shimmer while image loads */}
          {!imgLoaded && (
            <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 animate-pulse" />
          )}
          {imgLoaded && isDoctorLogin && (
            <>
              <img
                src={hero.img}
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-[42%_top]"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/5 via-transparent to-white/10" />
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/65 via-black/28 to-transparent" />
            </>
          )}
          <div className="relative text-white">
            <h2 className="text-3xl font-bold leading-tight drop-shadow-md">{hero.title}</h2>
            <p className="mt-2 max-w-sm text-white/90 drop-shadow">{hero.subtitle}</p>
          </div>
        </div>
      )}
      <div className={`flex w-full items-center justify-center bg-gradient-to-br from-slate-50 via-cyan-50/35 to-blue-50 px-4 py-10 ${hero ? 'lg:w-1/2' : ''}`}>
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl" style={{ backgroundColor: `${visual.color}15`, color: visual.color }}>
              <RoleIcon className="h-7 w-7" />
            </span>
          </div>
          <div>
            <CardTitle className="text-xl">{roleLabel} Login</CardTitle>
            <CardDescription>Sign in to your hospital workspace</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@hospital.com"
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
            onClick={() => { setEmail(demo.email); setPassword(demo.password) }}
            className="mt-4 w-full rounded-lg border border-dashed border-blue-300 bg-blue-50/60 px-3 py-2 text-left transition hover:bg-blue-50"
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-blue-700">🔑 Demo login — tap to fill</span>
            <span className="mt-1 block text-xs text-gray-700">
              {demo.email} · <span className="font-mono font-medium">{demo.password}</span>
            </span>
          </button>

          <div className="mt-5 text-center text-xs text-gray-400">
            Not a {roleLabel.toLowerCase()}?{' '}
            <Link to="/" className="text-blue-600 hover:underline">Choose your role</Link>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
