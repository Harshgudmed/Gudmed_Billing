import { useState, useEffect } from 'react'
import { clearOrgCache } from '@/lib/orgSettings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Settings, Building2, Users, Package, Link2, Database,
  Save, Plus, Edit, Eye, CheckCircle, XCircle, AlertCircle, RefreshCw, Loader2, Clock, Palette,
  MessageCircle, Bell,
} from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import client from '@/api/client'
import { useServerPagination } from '@/lib/useServerPagination'
import { Pagination } from '@/components/common/Pagination'
import IntegrationsHub from './IntegrationsHub'

const ORG_ID = 'org-demo'
const ITEMS_PER_PAGE = 10

const ROLE_LABELS = {
  super_admin: 'Super Administrator',
  admin: 'Hospital Administrator',
  doctor: 'Doctor/Physician',
  nurse: 'Nurse',
  receptionist: 'Receptionist',
  pharmacist: 'Pharmacist',
  billing_clerk: 'Billing Clerk',
  inventory_manager: 'Inventory Manager',
}

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry',
]

const userSchema = z.object({
  fullName: z.string().min(2, 'Name is required'),
  email: z.string().email('Valid email required'),
  role: z.string().min(1, 'Role is required'),
  departmentId: z.string().optional(),
  phone: z.string().optional(),
  specialization: z.string().optional(),
  // Required when creating (validated in onSubmitUser); on edit, blank means "keep".
  password: z.string().optional().or(z.literal('')),
})

// All toggleable system modules (Dashboard & Settings are always available).
// `key` must match the keys used by the sidebar's MODULE_BY_PATH map in App.jsx.
const ALL_MODULES = [
  { key: 'patients',             label: 'Patients',             description: 'Patient records and registration' },
  { key: 'consultations',        label: 'Consultations',        description: 'Doctor consultations and notes' },
  { key: 'preTriage',            label: 'Pre-Triage',           description: 'Initial screening before registration/triage' },
  { key: 'queue',                label: 'Queue',                description: 'Unified patient queue across service areas' },
  { key: 'laboratory',           label: 'Laboratory',           description: 'Lab test catalog, orders, and results' },
  { key: 'radiology',            label: 'Radiology',            description: 'Radiology exam catalog, orders, and reports' },
  { key: 'dayCare',              label: 'Day Care',             description: 'Same-day procedures with same-day discharge' },
  { key: 'ambulance',            label: 'Ambulance',            description: 'Patient transport trips and charges' },
  { key: 'insurance',            label: 'Insurance / TPA',      description: 'Payer policies and claim tracking' },
  { key: 'deathCertificate',     label: 'Death Certificates',   description: 'Issue and track death certificates' },
  { key: 'inpatient',            label: 'Inpatient (IPD)',      description: 'Admissions, wards/beds, IPD billing, and discharge' },
  { key: 'pharmacy',             label: 'Pharmacy',             description: 'Drug inventory, dispensing, and sales' },
  { key: 'doctorAccountability', label: 'Doctor Accountability', description: 'Doctor commissions and settlements' },
  { key: 'inventory',            label: 'Inventory',            description: 'Stock management across departments' },
  { key: 'accounting',           label: 'Accounting',           description: 'Financial accounting and reporting' },
]

export default function SettingsModule() {
  const [activeTab, setActiveTab] = useState('organization')
  const [showUserDialog, setShowUserDialog] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [savingOrg, setSavingOrg] = useState(false)
  const [departments, setDepartments] = useState([])
  const [organization, setOrganization] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Server-side paginated users list (Settings → Users). The DB slices, so the
  // browser only ever holds one page — the same endpoint still returns the full
  // list to the app's doctor dropdowns when called without page/limit.
  const usersPagination = useServerPagination('/settings', { perPage: ITEMS_PER_PAGE, params: { resource: 'users' } })

  const [orgForm, setOrgForm] = useState({
    name: '', slug: '', email: '', phone: '', address: '', city: '',
    region: 'Maharashtra', openingTime: '08:00', closingTime: '17:00',
    appointmentDuration: '30', primaryColor: '#2563eb', secondaryColor: '#7c3aed',
    navbarColor: '#ffffff', moduleHeaderColor: '', logoUrl: '',
    // Lab / receipt settings (hospital-controlled, shown on printed receipts)
    website: '', gstNo: '', cin: '', sacCode: '', labCode: '',
    homeCollectionCharge: '', showEmptyReceiptFields: false, receiptFooter: '',
  })

  const [modules, setModules] = useState(
    Object.fromEntries(ALL_MODULES.map(m => [m.key, true]))
  )

  const userForm = useForm({
    resolver: zodResolver(userSchema),
    defaultValues: { fullName: '', email: '', role: '', departmentId: '', phone: '', specialization: '', password: '' },
  })

  async function fetchAll() {
    setLoading(true)
    setError(null)
    try {
      const [orgRes, deptsRes] = await Promise.all([
        client.get('/settings'),
        client.get('/settings?resource=departments'),
      ])
      if (orgRes.success && orgRes.data) {
        setOrganization(orgRes.data)
        setOrgForm({
          name: orgRes.data.name || '',
          slug: orgRes.data.slug || '',
          email: orgRes.data.email || '',
          phone: orgRes.data.phone || '',
          address: orgRes.data.address || '',
          city: orgRes.data.city || '',
          region: orgRes.data.region || 'Maharashtra',
          openingTime: orgRes.data.settings?.workingHours?.start || '08:00',
          closingTime: orgRes.data.settings?.workingHours?.end || '17:00',
          appointmentDuration: String(orgRes.data.settings?.appointmentDuration || 30),
          primaryColor: orgRes.data.primaryColor || '#2563eb',
          secondaryColor: orgRes.data.secondaryColor || '#7c3aed',
          navbarColor: orgRes.data.settings?.navbarColor || '#ffffff',
          moduleHeaderColor: orgRes.data.settings?.moduleHeaderColor || '',
          logoUrl: orgRes.data.logoUrl || '',
          website: orgRes.data.settings?.website || '',
          gstNo: orgRes.data.settings?.gstNo || '',
          cin: orgRes.data.settings?.cin || '',
          sacCode: orgRes.data.settings?.sacCode || '',
          labCode: orgRes.data.settings?.labCode || '',
          homeCollectionCharge: String(orgRes.data.settings?.homeCollectionCharge || ''),
          showEmptyReceiptFields: orgRes.data.settings?.showEmptyReceiptFields ?? false,
          receiptFooter: orgRes.data.settings?.receiptFooter || '',
        })
        if (orgRes.data.modulesEnabled) setModules(prev => ({ ...prev, ...orgRes.data.modulesEnabled }))
      }
      if (deptsRes.success) setDepartments(deptsRes.data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])


  useEffect(() => {
    if (editingUser) {
      userForm.reset({
        fullName: editingUser.fullName,
        email: editingUser.email,
        role: editingUser.role,
        departmentId: editingUser.departmentId || '',
        phone: editingUser.phone || '',
        specialization: editingUser.specialization || '',
        password: '',
      })
    } else {
      userForm.reset({ fullName: '', email: '', role: '', departmentId: '', phone: '', specialization: '', password: '' })
    }
  }, [editingUser])

  async function saveOrganization() {
    setSavingOrg(true)
    try {
      const res = await client.patch('/settings', {
        resource: 'organization',
        name: orgForm.name, slug: orgForm.slug, email: orgForm.email,
        phone: orgForm.phone, address: orgForm.address, city: orgForm.city,
        region: orgForm.region, primaryColor: orgForm.primaryColor,
        secondaryColor: orgForm.secondaryColor, logoUrl: orgForm.logoUrl,
        settings: {
          ...(organization?.settings || {}), // preserve other keys (integrations, logo, …)
          workingHours: { start: orgForm.openingTime, end: orgForm.closingTime },
          appointmentDuration: parseInt(orgForm.appointmentDuration),
          navbarColor: orgForm.navbarColor,
          moduleHeaderColor: orgForm.moduleHeaderColor,
          // Lab / receipt settings — hospital controls what shows on receipts
          website: orgForm.website,
          gstNo: orgForm.gstNo,
          cin: orgForm.cin,
          sacCode: orgForm.sacCode,
          labCode: orgForm.labCode,
          homeCollectionCharge: Number(orgForm.homeCollectionCharge) || 0,
          showEmptyReceiptFields: orgForm.showEmptyReceiptFields,
          receiptFooter: orgForm.receiptFooter,
        },
      })
      if (res.success) {
        toast.success('Organization settings saved successfully')
        clearOrgCache() // invalidate print cache so next print uses new org details
        window.dispatchEvent(new CustomEvent('navbarColorChange', { detail: orgForm.navbarColor }))
        window.dispatchEvent(new CustomEvent('hospitalNameChange', { detail: orgForm.name }))
        window.dispatchEvent(new CustomEvent('brandingChange', { detail: {
          navbarColor: orgForm.navbarColor,
          primaryColor: orgForm.primaryColor,
          secondaryColor: orgForm.secondaryColor,
          headerColor: orgForm.moduleHeaderColor,
          hospitalName: orgForm.name,
        }}))
        window.dispatchEvent(new CustomEvent('organizationSettingsChange', { detail: orgForm }))
      } else toast.error(res.error || 'Failed to save')
    } catch { toast.error('Failed to save organization settings') }
    finally { setSavingOrg(false) }
  }

  async function toggleModule(key) {
    const newModules = { ...modules, [key]: !modules[key] }
    setModules(newModules)
    // Update the sidebar immediately (it listens for this event)
    window.dispatchEvent(new CustomEvent('modulesChange', { detail: newModules }))
    try {
      await client.patch('/settings', { resource: 'organization', modulesEnabled: newModules })
      toast.success(`${key} module ${newModules[key] ? 'enabled' : 'disabled'}`)
    } catch {
      toast.error('Failed to update module settings')
      setModules(modules)
      window.dispatchEvent(new CustomEvent('modulesChange', { detail: modules }))
    }
  }

  async function onSubmitUser(data) {
    try {
      // Drop an empty password so an edit without a reset keeps the existing one.
      const password = (data.password || '').trim()
      const payload = { ...data, password: password || undefined, departmentId: data.departmentId || null }
      if (editingUser) {
        const res = await client.patch('/settings', { resource: 'user', id: editingUser.id, ...payload })
        if (!res.success) throw new Error(res.error || 'Failed to update user')
        toast.success('User updated successfully')
      } else {
        if (password.length < 6) {
          userForm.setError('password', { message: 'Set a password (min 6 characters) so the user can log in' })
          return
        }
        const res = await client.post('/settings', { resource: 'user', organizationId: ORG_ID, ...payload, isActive: true })
        if (!res.success) throw new Error(res.error || 'Failed to create user')
        toast.success('User added successfully')
      }
      setShowUserDialog(false)
      setEditingUser(null)
      userForm.reset()
      usersPagination.refresh()
    } catch (e) { toast.error(e.message) }
  }

  async function handleToggleUserStatus(user) {
    try {
      const res = await client.patch('/settings', { resource: 'user-status', id: user.id, isActive: !user.isActive })
      if (res.success) { toast.success('User status updated'); usersPagination.refresh() }
      else toast.error(res.error || 'Failed')
    } catch { toast.error('Failed to update user status') }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
          <p className="text-gray-500">Loading settings...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium mb-2">Failed to Load Settings</h3>
          <p className="text-gray-500 mb-4">{error}</p>
          <Button onClick={fetchAll}><RefreshCw className="h-4 w-4 mr-2" />Retry</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings className="h-8 w-8 text-gray-600" />
            Settings
          </h1>
          <p className="text-gray-500">Configure your hospital management system</p>
        </div>
        <Button variant="outline" onClick={fetchAll}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="organization"><Building2 className="h-4 w-4 mr-2" />Organization</TabsTrigger>
          <TabsTrigger value="users"><Users className="h-4 w-4 mr-2" />Users</TabsTrigger>
          <TabsTrigger value="modules"><Package className="h-4 w-4 mr-2" />Modules</TabsTrigger>
          <TabsTrigger value="integrations"><Link2 className="h-4 w-4 mr-2" />Integrations</TabsTrigger>
          {/* Notifications tab hidden — to show again: uncomment this trigger AND its <TabsContent>, then set grid-cols to 6 */}
          {/* <TabsTrigger value="notifications"><MessageCircle className="h-4 w-4 mr-2" />Notifications</TabsTrigger> */}
          <TabsTrigger value="backup"><Database className="h-4 w-4 mr-2" />Backup</TabsTrigger>
        </TabsList>

        {/* Organization Tab */}
        <TabsContent value="organization" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Hospital Information</CardTitle>
              <CardDescription>Basic information about your healthcare facility</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Hospital Name</Label>
                  <Input value={orgForm.name} onChange={e => setOrgForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>URL Slug</Label>
                  <Input value={orgForm.slug} onChange={e => setOrgForm(p => ({ ...p, slug: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={orgForm.email} onChange={e => setOrgForm(p => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={orgForm.phone} onChange={e => setOrgForm(p => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Address</Label>
                <Textarea value={orgForm.address} onChange={e => setOrgForm(p => ({ ...p, address: e.target.value }))} rows={2} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input value={orgForm.city} onChange={e => setOrgForm(p => ({ ...p, city: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>State</Label>
                  <Select value={orgForm.region} onValueChange={v => setOrgForm(p => ({ ...p, region: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INDIAN_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Input defaultValue="India" disabled />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" />Working Hours</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Opening Time</Label>
                  <Input type="time" value={orgForm.openingTime} onChange={e => setOrgForm(p => ({ ...p, openingTime: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Closing Time</Label>
                  <Input type="time" value={orgForm.closingTime} onChange={e => setOrgForm(p => ({ ...p, closingTime: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Appointment Duration</Label>
                  <Select value={orgForm.appointmentDuration} onValueChange={v => setOrgForm(p => ({ ...p, appointmentDuration: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="45">45 minutes</SelectItem>
                      <SelectItem value="60">60 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select defaultValue="kolkata">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kolkata">Asia/Kolkata (IST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" />Branding</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Primary Color</Label>
                  <div className="flex gap-2">
                    <Input type="color" value={orgForm.primaryColor} onChange={e => setOrgForm(p => ({ ...p, primaryColor: e.target.value }))} className="w-16 h-10" />
                    <Input value={orgForm.primaryColor} onChange={e => setOrgForm(p => ({ ...p, primaryColor: e.target.value }))} className="flex-1" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Secondary Color</Label>
                  <div className="flex gap-2">
                    <Input type="color" value={orgForm.secondaryColor} onChange={e => setOrgForm(p => ({ ...p, secondaryColor: e.target.value }))} className="w-16 h-10" />
                    <Input value={orgForm.secondaryColor} onChange={e => setOrgForm(p => ({ ...p, secondaryColor: e.target.value }))} className="flex-1" />
                  </div>
                </div>
              </div>

              {/* Navbar Color */}
              <div className="space-y-2">
                <Label>Sidebar / Navbar Color</Label>
                <p className="text-xs text-gray-500">Sets the background color of the left navigation sidebar across all pages.</p>
                <div className="flex gap-2 items-center">
                  <Input type="color" value={orgForm.navbarColor} onChange={e => setOrgForm(p => ({ ...p, navbarColor: e.target.value }))} className="w-16 h-10" />
                  <Input value={orgForm.navbarColor} onChange={e => setOrgForm(p => ({ ...p, navbarColor: e.target.value }))} className="w-36" placeholder="#ffffff" />
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-gray-600 underline"
                    onClick={() => setOrgForm(p => ({ ...p, navbarColor: '#ffffff' }))}
                  >
                    Reset to white
                  </button>
                </div>
               
              </div>

              {/* Module Header Color */}
              <div className="space-y-2">
                <Label>Module Header Color</Label>
                <p className="text-xs text-gray-500">Applied to the title bar at the top of every module. Leave blank to keep the default transparent background.</p>
                <div className="flex gap-2 items-center">
                  <Input type="color" value={orgForm.moduleHeaderColor || '#f0f4f8'} onChange={e => setOrgForm(p => ({ ...p, moduleHeaderColor: e.target.value }))} className="w-16 h-10" />
                  <Input value={orgForm.moduleHeaderColor} onChange={e => setOrgForm(p => ({ ...p, moduleHeaderColor: e.target.value }))} placeholder="Leave blank for default" className="flex-1" />
                  {orgForm.moduleHeaderColor && (
                    <Button variant="outline" size="sm" onClick={() => setOrgForm(p => ({ ...p, moduleHeaderColor: '' }))}>Reset</Button>
                  )}
                </div>
                {orgForm.moduleHeaderColor && (() => {
                  const c = orgForm.moduleHeaderColor.replace('#', '')
                  const r = parseInt(c.substring(0, 2), 16)
                  const g = parseInt(c.substring(2, 4), 16)
                  const b = parseInt(c.substring(4, 6), 16)
                  const textColor = (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5 ? '#fff' : '#111'
                  return (
                    <div className="rounded-lg px-4 py-3 text-sm border flex items-center justify-between mt-1" style={{ backgroundColor: orgForm.moduleHeaderColor, color: textColor }}>
                      <span className="font-bold text-base">Module Title</span>
                      <span className="text-xs opacity-75">Preview of header area</span>
                    </div>
                  )
                })()}
              </div>

              <div className="space-y-2">
                <Label>Hospital Logo URL</Label>
                <Input placeholder="https://example.com/logo.png" value={orgForm.logoUrl} onChange={e => setOrgForm(p => ({ ...p, logoUrl: e.target.value }))} />
              </div>
            </CardContent>
          </Card>

          {/* Lab / Receipt settings — hospital decides what appears on printed receipts */}
          <Card>
            <CardHeader>
              <CardTitle>Lab / Receipt Settings</CardTitle>
              <CardDescription>These appear on lab bills &amp; receipts. Leave blank to hide (pathology is GST-exempt).</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>GST No</Label>
                <Input placeholder="e.g. 06AABC...1Z5" value={orgForm.gstNo} onChange={e => setOrgForm(p => ({ ...p, gstNo: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>CIN No</Label>
                <Input placeholder="Company Identification No." value={orgForm.cin} onChange={e => setOrgForm(p => ({ ...p, cin: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>SAC Code</Label>
                <Input placeholder="e.g. 999316 (healthcare)" value={orgForm.sacCode} onChange={e => setOrgForm(p => ({ ...p, sacCode: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Lab Code / CC Code</Label>
                <Input placeholder="e.g. S02" value={orgForm.labCode} onChange={e => setOrgForm(p => ({ ...p, labCode: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Website</Label>
                <Input placeholder="www.yourhospital.com" value={orgForm.website} onChange={e => setOrgForm(p => ({ ...p, website: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Default Home Collection Charge (₹)</Label>
                <Input type="number" min="0" placeholder="e.g. 150" value={orgForm.homeCollectionCharge} onChange={e => setOrgForm(p => ({ ...p, homeCollectionCharge: e.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Receipt Footer Note (optional)</Label>
                <Input placeholder="Extra note printed at bottom of receipts" value={orgForm.receiptFooter} onChange={e => setOrgForm(p => ({ ...p, receiptFooter: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 md:col-span-2 text-sm cursor-pointer">
                <input type="checkbox" checked={orgForm.showEmptyReceiptFields} onChange={e => setOrgForm(p => ({ ...p, showEmptyReceiptFields: e.target.checked }))} />
                Show empty fields as "NA" on receipts  Unchecked = hide empty fields (cleaner).
              </label>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={saveOrganization} disabled={savingOrg}>
              {savingOrg ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Settings
            </Button>
          </div>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>User Management</CardTitle>
                <CardDescription>Add, edit, and manage user accounts</CardDescription>
              </div>
              <Dialog open={showUserDialog} onOpenChange={open => { setShowUserDialog(open); if (!open) setEditingUser(null) }}>
                <DialogTrigger asChild>
                  <Button onClick={() => { setEditingUser(null) }}>
                    <Plus className="h-4 w-4 mr-2" />Add User
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
                    <DialogDescription>{editingUser ? 'Update user information' : 'Create a new user account'}</DialogDescription>
                  </DialogHeader>
                  <Form {...userForm}>
                    <form onSubmit={userForm.handleSubmit(onSubmitUser)} className="space-y-4">
                      <FormField control={userForm.control} name="fullName" render={({ field }) => (
                        <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input placeholder="Dr. Priya Mehta" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={userForm.control} name="email" render={({ field }) => (
                        <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="user@hospital.in" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={userForm.control} name="password" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{editingUser ? 'New Password' : 'Password'}</FormLabel>
                          <FormControl>
                            <PasswordInput
                              autoComplete="new-password"
                              placeholder={editingUser ? 'Leave blank to keep current password' : 'Min 6 characters'}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={userForm.control} name="role" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Role</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {Object.entries(ROLE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={userForm.control} name="departmentId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Department</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={userForm.control} name="phone" render={({ field }) => (
                        <FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="+91 98765 43210" {...field} /></FormControl></FormItem>
                      )} />
                      <FormField control={userForm.control} name="specialization" render={({ field }) => (
                        <FormItem><FormLabel>Specialization</FormLabel><FormControl><Input placeholder="General Practice" {...field} /></FormControl></FormItem>
                      )} />
                      <DialogFooter>
                        <Button type="submit">{editingUser ? 'Update' : 'Create'} User</Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {!usersPagination.loading && usersPagination.rows.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-medium mb-2">No Users Found</h3>
                  <p className="text-gray-500 mb-4">Add your first user to get started.</p>
                  <Button onClick={() => setShowUserDialog(true)}><Plus className="h-4 w-4 mr-2" />Add User</Button>
                </div>
              ) : (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usersPagination.rows.map(user => (
                          <TableRow key={user.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback>{user.fullName.split(' ').map(n => n[0]).join('').slice(0, 2)}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium">{user.fullName}</p>
                                  <p className="text-xs text-gray-500">{user.email}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell><Badge variant="outline">{ROLE_LABELS[user.role] || user.role}</Badge></TableCell>
                            <TableCell>{user.department?.name || '-'}</TableCell>
                            <TableCell>
                              <Badge variant={user.isActive ? 'default' : 'secondary'}>
                                {user.isActive ? 'active' : 'inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="sm" onClick={() => { setEditingUser(user); setShowUserDialog(true) }}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleToggleUserStatus(user)}>
                                  {user.isActive ? <XCircle className="h-4 w-4 text-red-500" /> : <CheckCircle className="h-4 w-4 text-green-500" />}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                  <Pagination page={usersPagination.page} totalPages={usersPagination.totalPages} onPageChange={usersPagination.setPage} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Modules Tab */}
        <TabsContent value="modules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Module Configuration</CardTitle>
              <CardDescription>Enable or disable system modules</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ALL_MODULES.map(({ key, label, description }) => {
                  const enabled = modules[key] !== false
                  return (
                    <div key={key} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${enabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                          <Package className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium">{label}</p>
                          <p className="text-sm text-gray-500">{description}</p>
                        </div>
                      </div>
                      <Switch checked={enabled} onCheckedChange={() => toggleModule(key)} />
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations Tab — 4-card launcher; click a card to open its screen */}
        <TabsContent value="integrations" className="space-y-4">
          <IntegrationsHub
            settings={organization?.settings || {}}
            onSaved={(newSettings) => setOrganization((o) => ({ ...o, settings: newSettings }))}
          />
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-4">
          <Card>
            {/* <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-green-600" />
                WhatsApp Notifications
              </CardTitle>
              <CardDescription>
                Configure how the system sends WhatsApp messages to patients and staff.
                Currently uses <strong>wa.me links</strong> (free). Set an API key below to enable
                fully automatic sending without any staff action.
              </CardDescription>
            </CardHeader> */}
            <CardContent className="space-y-5">

              {/* wa.me mode info */}
              {/* <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                <strong>Current mode: wa.me links</strong> — After each action a WhatsApp chat opens
                with the message pre-filled. Staff clicks Send. No cost, no API needed.
              </div> */}

              {/* Pharmacy team number */}
              {/* <div className="space-y-1.5">
                <Label className="text-sm font-medium">Pharmacy Team WhatsApp Number</Label>
                <Input
                  placeholder="e.g. 9876543210 (without +91)"
                  defaultValue={typeof window !== 'undefined' ? localStorage.getItem('wa_pharmacy_team') || '' : ''}
                  onChange={e => localStorage.setItem('wa_pharmacy_team', e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Used to notify pharmacy staff when a new prescription is created.
                  Also set <code>WHATSAPP_PHARMACY_TEAM_PHONE</code> in backend .env for server-side sending.
                </p>
              </div> */}

              {/* Post-consultation auto-prompt */}
              {/* <div className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">Post-consultation workflow prompt</p>
                  <p className="text-xs text-gray-500">Show WhatsApp & purchase options after every consultation is saved</p>
                </div>
                <Switch
                  defaultChecked={typeof window !== 'undefined' ? localStorage.getItem('wa_post_consultation') !== 'false' : true}
                  onCheckedChange={v => localStorage.setItem('wa_post_consultation', String(v))}
                />
              </div> */}

              {/* WhatsApp API section */}
              {/* <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-orange-500" />
                  <p className="text-sm font-semibold">Upgrade to Automatic Sending (WhatsApp Business API)</p>
                </div>
                <p className="text-xs text-gray-500">
                  When an API key is set in the backend <code>.env</code> file, messages are sent
                  automatically without any staff action. Supported providers:
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { name: 'WATI', env: 'WHATSAPP_PROVIDER=wati', url: 'app.wati.io' },
                    { name: 'Twilio', env: 'WHATSAPP_PROVIDER=twilio', url: 'twilio.com' },
                    { name: 'Meta Cloud API', env: 'WHATSAPP_PROVIDER=meta', url: 'developers.facebook.com' },
                    { name: '360dialog', env: 'WHATSAPP_PROVIDER=360dialog', url: '360dialog.com' },
                  ].map(p => (
                    <div key={p.name} className="border rounded p-2 bg-gray-50">
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-gray-400 font-mono">{p.env}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <strong>How to activate:</strong> Add <code>WHATSAPP_API_KEY</code>, <code>WHATSAPP_API_URL</code>,
                  and <code>WHATSAPP_PROVIDER</code> to <code>backend/.env</code> then restart the server.
                  The system will automatically switch from wa.me links to direct API sending.
                </div>
              </div> */}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Backup Tab */}
        <TabsContent value="backup" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" />Backup & Restore</CardTitle>
              <CardDescription>Manage database backups and data recovery</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-5 w-5 text-blue-600" />
                  <span className="font-medium text-blue-800">Automatic Backups</span>
                </div>
                <p className="text-sm text-blue-700">Daily backups are automatically created at 2:00 AM. Last backup: Today at 2:00 AM</p>
              </div>
              <div className="mt-4">
                <h4 className="font-medium mb-2">Recent Backups</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Today, 2:00 AM</TableCell>
                      <TableCell>245 MB</TableCell>
                      <TableCell><Badge variant="outline">Automatic</Badge></TableCell>
                      <TableCell><Button variant="ghost" size="sm">Download</Button></TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Yesterday, 2:00 AM</TableCell>
                      <TableCell>243 MB</TableCell>
                      <TableCell><Badge variant="outline">Automatic</Badge></TableCell>
                      <TableCell><Button variant="ghost" size="sm">Download</Button></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
