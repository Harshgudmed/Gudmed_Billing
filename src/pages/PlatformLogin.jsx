import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2, Building2, Layers, ShieldCheck, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import Logo from '@/components/Logo'
import { useAuth } from '@/lib/auth'
import { homePathFor } from '@/lib/roleConfig'

// What this sign-in is for, said plainly — each line is a thing the owner does here.
const PLATFORM_POINTS = [
  { Icon: Building2, text: 'Add a hospital and give it its first administrator' },
  { Icon: Layers, text: 'Choose the modules each hospital has bought' },
  { Icon: ListChecks, text: 'Switch a hospital on or off, and see them all in one list' },
  { Icon: ShieldCheck, text: 'Hospital records stay private — this page never shows them' },
]

// The GudMed team's own sign-in, at /platform/login. Not a hospital role, so it
// is not in the role picker or in ROLES, and no demo account is offered here.
export default function PlatformLogin() {
  const navigate = useNavigate()
  const { user, login, logout } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Already signed in: the platform owner goes to the platform; hospital staff
  // go back to their own workspace (this page is not theirs).
  if (user) return <Navigate to={user.role === 'platform_owner' ? '/platform' : homePathFor(user.role)} replace />

  async function onSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const signedIn = await login(email.trim(), password)
      if (signedIn.role !== 'platform_owner') {
        // login() has already opened a hospital session; close it, this door is not theirs.
        await logout()
        toast.error('This sign-in is for the GudMed platform team. Hospital staff sign in from their hospital\'s page.')
        return
      }
      navigate('/platform', { replace: true })
    } catch (err) {
      toast.error(err.message || 'Sign-in failed — check the e-mail and password and try again')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* Identity panel: on a phone it is a compact header above the form. */}
      <aside className="relative overflow-hidden bg-gradient-to-br from-[#1f2f4f] via-[#2E4168] to-[#1d5f74] px-6 py-8 text-white sm:px-10 lg:flex lg:min-h-screen lg:w-[46%] lg:flex-col lg:justify-between lg:px-14 lg:py-14">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <Logo size={44} rounded="rounded-xl" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">GudMed Platform</p>
            <p className="text-xs text-white/70">For the GudMed team</p>
          </div>
        </div>
        <div className="relative mt-6 lg:mt-0">
          <h1 className="text-2xl font-semibold leading-tight [text-wrap:balance] lg:text-4xl">
            Every hospital, in one place
          </h1>
          <p className="mt-3 max-w-md text-sm text-white/75 lg:text-base">
            Set up a hospital, decide what it can use, and keep its plan in order.
          </p>
          <ul className="mt-6 hidden space-y-3 lg:block">
            {PLATFORM_POINTS.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/85">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-6 hidden text-xs text-white/50 lg:block">Signed-in access is recorded.</p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8 lg:py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Use the platform account you were given.</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="space-y-1.5">
              <Label htmlFor="platform-email">Email</Label>
              <Input
                id="platform-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="platform-password">Password</Label>
              <PasswordInput
                id="platform-password"
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
          <p className="mt-5 text-center text-xs text-slate-400">
            Hospital staff: sign in from your hospital&apos;s own page.
          </p>
        </div>
      </main>
    </div>
  )
}
