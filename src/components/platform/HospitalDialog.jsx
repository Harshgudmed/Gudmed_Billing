import { useState, useEffect, useMemo } from 'react'
import { Loader2, Check, KeyRound, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldError } from '@/components/common/FieldError'
import { MODULE_CATALOG, MODULE_GROUPS, MODULE_PRESETS, ALWAYS_INCLUDED } from './moduleCatalog'

// Add a hospital (with its first administrator) or edit one: its plan and the
// modules it has bought. The dialog only collects and checks; saving is the
// parent's `onSubmit(payload)` — it must reject with an Error to keep the dialog
// open, and the message is shown here.
//
// The checks repeat the server's (platformController.js) so a mistake is
// pointed at before the round trip; the server stays the one that decides.

const PLANS = [{ value: 'basic', label: 'Basic' }, { value: 'standard', label: 'Standard' }, { value: 'pro', label: 'Pro' }]
const PLAN_STATUSES = [
  { value: 'trial', label: 'Trial' }, { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' }, { value: 'expired', label: 'Expired' },
]
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// The hospital's code is part of its link, so the name makes a readable one.
const slugFrom = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')

// Letters and digits that cannot be mistaken for each other when read out or typed.
const PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generatePassword(length = 14) {
  const values = crypto.getRandomValues(new Uint32Array(length))
  return Array.from(values, (v) => PASSWORD_CHARS[v % PASSWORD_CHARS.length]).join('')
}

// What a hospital has bought. A hospital from before plans has no list, only the
// switches its administrator kept: the modules on today, so saving changes nothing.
function boughtOf(hospital) {
  if (!hospital) return new Set()
  if (hospital.modulesAllowed) return new Set(Object.keys(hospital.modulesAllowed).filter((t) => hospital.modulesAllowed[t] === true))
  const on = hospital.modulesEnabled || {}
  return new Set(MODULE_CATALOG.map((m) => m.toggle).filter((t) => (t === 'purchase' ? on[t] === true : on[t] !== false)))
}

const blankForm = () => ({
  name: '', slug: '', city: '', region: '', email: '', phone: '',
  plan: 'basic', planStatus: 'active', endsOn: '', isActive: true,
  adminName: '', adminEmail: '', adminPassword: '',
})

const formOf = (hospital) => ({
  ...blankForm(),
  name: hospital.name || '', slug: hospital.slug || '', city: hospital.city || '', region: hospital.region || '',
  email: hospital.email || '', phone: hospital.phone || '',
  plan: hospital.subscriptionTier || 'basic', planStatus: hospital.subscriptionStatus || 'active',
  endsOn: hospital.subscriptionEndsAt ? String(hospital.subscriptionEndsAt).slice(0, 10) : '',
  isActive: hospital.isActive !== false,
})

export default function HospitalDialog({ open, onOpenChange, hospital = null, onSubmit }) {
  const editing = !!hospital
  const [form, setForm] = useState(blankForm)
  const [bought, setBought] = useState(() => new Set())
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  // Start fresh each time it opens (the parent keeps the dialog mounted).
  useEffect(() => {
    if (!open) return
    setForm(hospital ? formOf(hospital) : blankForm())
    setBought(boughtOf(hospital))
    setSlugTouched(false)
    setErrors({})
    setFormError('')
  }, [open, hospital])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const setName = (name) => set(editing || slugTouched ? { name } : { name, slug: slugFrom(name) })
  const toggle = (t) => setBought((b) => { const next = new Set(b); next.has(t) ? next.delete(t) : next.add(t); return next })
  const legacy = editing && !hospital.modulesAllowed
  const link = useMemo(() => (form.slug ? `${window.location.origin}/h/${form.slug}` : ''), [form.slug])

  function validate() {
    const e = {}
    if (form.name.trim().length < 2) e.name = 'Enter the hospital name'
    if (!editing && !SLUG_PATTERN.test(form.slug)) e.slug = '3 to 40 letters, digits or dashes; no dash at the start or end'
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) e.email = 'Enter a valid e-mail'
    if (!editing) {
      if (form.adminName.trim().length < 2) e.adminName = 'Enter the administrator\'s name'
      if (!EMAIL_PATTERN.test(form.adminEmail.trim())) e.adminEmail = 'Enter the administrator\'s e-mail'
      if (form.adminPassword.length < 8) e.adminPassword = 'At least 8 characters'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(ev) {
    ev.preventDefault()
    if (saving || !validate()) return
    const payload = {
      name: form.name.trim(),
      city: form.city.trim(), region: form.region.trim(), email: form.email.trim(), phone: form.phone.trim(),
      subscriptionTier: form.plan, subscriptionStatus: form.planStatus,
      subscriptionEndsAt: form.endsOn || null,
      modulesAllowed: Object.fromEntries([...bought].map((t) => [t, true])),
    }
    if (editing) payload.isActive = form.isActive
    else Object.assign(payload, { slug: form.slug, admin: { fullName: form.adminName.trim(), email: form.adminEmail.trim(), password: form.adminPassword } })
    setSaving(true)
    setFormError('')
    try {
      await onSubmit(payload)
    } catch (err) {
      setFormError(err?.message || 'Could not save — try again')
    } finally {
      setSaving(false)
    }
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error(`Could not copy — select the ${what.toLowerCase()} and copy it by hand`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-1rem)] max-w-3xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${hospital.name}` : 'Add a hospital'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Change its plan, what it has bought, or switch it off.' : 'Set up the hospital, choose what it can use, and give it its first administrator.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-6" noValidate>
          {formError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}

          <section aria-labelledby="hosp-details" className="space-y-3">
            <h3 id="hosp-details" className="text-sm font-semibold text-gray-900">Hospital</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="hosp-name">Name *</Label>
                <Input id="hosp-name" value={form.name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ABC Hospital" maxLength={120} autoFocus />
                <FieldError message={errors.name} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="hosp-slug">Hospital code *</Label>
                <Input id="hosp-slug" value={form.slug} disabled={editing} maxLength={40} className="font-mono"
                  onChange={(e) => { setSlugTouched(true); set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }) }} />
                {editing
                  ? <p className="mt-1 text-xs text-gray-500">The code is in the hospital's links, so it cannot be changed.</p>
                  : <FieldError message={errors.slug} />}
                {link && (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    Sign-in link: <span className="break-all font-mono text-gray-700">{link}</span>
                    <button type="button" onClick={() => copy(link, 'Link')} className="inline-flex items-center gap-1 text-blue-600 hover:underline"><Copy className="h-3 w-3" aria-hidden="true" />Copy</button>
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="hosp-city">City</Label>
                <Input id="hosp-city" value={form.city} onChange={(e) => set({ city: e.target.value })} maxLength={80} />
              </div>
              <div>
                <Label htmlFor="hosp-region">State</Label>
                <Input id="hosp-region" value={form.region} onChange={(e) => set({ region: e.target.value })} maxLength={80} />
              </div>
              <div>
                <Label htmlFor="hosp-email">Hospital e-mail</Label>
                <Input id="hosp-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
                <FieldError message={errors.email} />
              </div>
              <div>
                <Label htmlFor="hosp-phone">Phone</Label>
                <Input id="hosp-phone" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={30} />
              </div>
            </div>
          </section>

          <section aria-labelledby="hosp-plan" className="space-y-3">
            <h3 id="hosp-plan" className="text-sm font-semibold text-gray-900">Plan</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="hosp-tier">Plan</Label>
                <Select value={form.plan} onValueChange={(plan) => set({ plan })}>
                  <SelectTrigger id="hosp-tier"><SelectValue /></SelectTrigger>
                  <SelectContent>{PLANS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="hosp-status">Plan status</Label>
                <Select value={form.planStatus} onValueChange={(planStatus) => set({ planStatus })}>
                  <SelectTrigger id="hosp-status"><SelectValue /></SelectTrigger>
                  <SelectContent>{PLAN_STATUSES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="hosp-ends">Plan ends on</Label>
                <Input id="hosp-ends" type="date" value={form.endsOn} onChange={(e) => set({ endsOn: e.target.value })} />
              </div>
            </div>
          </section>

          <section aria-labelledby="hosp-modules" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="hosp-modules" className="text-sm font-semibold text-gray-900">
                Modules bought <span className="font-normal text-gray-500">· {bought.size} of {MODULE_CATALOG.length}</span>
              </h3>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick choices">
                {MODULE_PRESETS.map((p) => (
                  <Button key={p.key} type="button" size="sm" variant="outline" onClick={() => setBought(new Set(p.toggles))}>{p.title}</Button>
                ))}
                <Button type="button" size="sm" variant="ghost" onClick={() => setBought(new Set())} disabled={bought.size === 0}>Clear</Button>
              </div>
            </div>
            {legacy && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                This hospital has no plan limit yet. What is ticked now is what it uses today; saving makes it the limit, and anything you untick is switched off for it.
              </p>
            )}
            {MODULE_GROUPS.map((group) => (
              <fieldset key={group.key} className="space-y-2">
                <legend className="text-xs font-medium uppercase tracking-wide text-gray-500">{group.title}</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {MODULE_CATALOG.filter((m) => m.group === group.key).map(({ toggle: t, label, description, Icon }) => {
                    const on = bought.has(t)
                    return (
                      <label key={t} className={`relative flex cursor-pointer gap-3 rounded-lg border p-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-2 ${on ? 'border-blue-600 bg-blue-50/60 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`}>
                        <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(t)} />
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${on ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1 pr-6">
                          <span className="block text-sm font-semibold text-gray-900">{label}</span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-gray-600">{description}</span>
                        </span>
                        <span className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'}`} aria-hidden="true">{on && <Check className="h-3 w-3" />}</span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            ))}
            <p className="text-xs text-gray-500">Always included: {ALWAYS_INCLUDED.join(', ')}.</p>
          </section>

          {!editing && (
            <section aria-labelledby="hosp-admin" className="space-y-3">
              <h3 id="hosp-admin" className="text-sm font-semibold text-gray-900">First administrator</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="admin-name">Name *</Label>
                  <Input id="admin-name" value={form.adminName} onChange={(e) => set({ adminName: e.target.value })} maxLength={100} autoComplete="off" />
                  <FieldError message={errors.adminName} />
                </div>
                <div>
                  <Label htmlFor="admin-email">E-mail (the sign-in) *</Label>
                  <Input id="admin-email" type="email" value={form.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} autoComplete="off" />
                  <FieldError message={errors.adminEmail} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="admin-password">Password *</Label>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <PasswordInput id="admin-password" value={form.adminPassword} onChange={(e) => set({ adminPassword: e.target.value })} autoComplete="new-password" />
                    </div>
                    <Button type="button" variant="outline" onClick={() => set({ adminPassword: generatePassword() })}><KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />Generate</Button>
                    <Button type="button" variant="outline" disabled={!form.adminPassword} onClick={() => copy(form.adminPassword, 'Password')} aria-label="Copy password"><Copy className="h-4 w-4" aria-hidden="true" /></Button>
                  </div>
                  <FieldError message={errors.adminPassword} />
                  <p className="mt-1 text-xs text-gray-500">Give it to the hospital safely; it cannot be shown again after you save.</p>
                </div>
              </div>
            </section>
          )}

          {editing && (
            <section className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3">
              <div>
                <Label htmlFor="hosp-active" className="text-sm font-semibold text-gray-900">Hospital is active</Label>
                <p className="mt-0.5 text-xs text-gray-500">Switching it off marks the hospital as inactive in this list.</p>
              </div>
              <Switch id="hosp-active" checked={form.isActive} onCheckedChange={(isActive) => set({ isActive })} />
            </section>
          )}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Add hospital'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
