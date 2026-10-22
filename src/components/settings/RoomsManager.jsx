import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, Clock, ShieldAlert, X, Info, Search, ChevronDown, ChevronRight, Building2, Download, Upload, FileSpreadsheet } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import client from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { FilterBar } from '@/components/common/FilterBar'
import { useLiveData } from '@/lib/useLiveData'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { drName } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const DAY_SHORT = { Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' }
// Week starts Monday for display — a clinic's week does, and it makes
// "Mon–Sat" collapse into one run instead of wrapping around Sunday.
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** "Mon–Sat", "Mon, Wed, Fri", "Tue" — consecutive days collapse into a range. */
function formatDays(days) {
  const idx = [...new Set(days)].map((d) => WEEK.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b)
  if (idx.length === 0) return ''
  const runs = []
  let start = idx[0]
  let prev = idx[0]
  for (const i of idx.slice(1)) {
    if (i === prev + 1) { prev = i; continue }
    runs.push([start, prev]); start = i; prev = i
  }
  runs.push([start, prev])
  return runs
    .map(([a, b]) => (a === b ? DAY_SHORT[WEEK[a]] : b - a === 1 ? `${DAY_SHORT[WEEK[a]]}, ${DAY_SHORT[WEEK[b]]}` : `${DAY_SHORT[WEEK[a]]}–${DAY_SHORT[WEEK[b]]}`))
    .join(', ')
}

/**
 * The raw schedule is one row per doctor PER DAY — a doctor working Mon-Sat
 * rendered as six near-identical lines, so a 3-doctor room listed 18 rows of
 * noise. Collapse to one line per (doctor, time): "Dr X · Mon–Sat · 14:00–17:00".
 */
function groupSchedule(schedule = []) {
  const byShift = new Map()
  for (const s of schedule) {
    const key = `${s.doctorId}|${s.start}|${s.end}`
    if (!byShift.has(key)) byShift.set(key, { doctorName: s.doctorName, start: s.start, end: s.end, days: [] })
    byShift.get(key).days.push(s.dayName)
  }
  return [...byShift.values()].sort((a, b) => a.start.localeCompare(b.start) || a.doctorName.localeCompare(b.doctorName))
}

// ── Bulk Upload (Template / Import / Export) ────────────────────────────────────────────────────────────────────────────────
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const BULK_SETUP = {
  label: 'Bulk Setup',
  title: 'Room Setup Import Result',
  path: '/rooms/setup',
  templateFile: 'room_setup_template.xlsx',
  exportPrefix: 'room_setup_export',
  stats: [
    { key: 'total', label: 'Total Rows' },
    { key: 'floorsCreated', label: 'Floors Created', tone: 'green' },
    { key: 'roomsCreated', label: 'Rooms Created', tone: 'green' },
    { key: 'shiftsAdded', label: 'Shifts Added', tone: 'green' },
    { key: 'skipped', label: 'Skipped (already exist)' },
    { key: 'failed', label: 'Failed', tone: 'red' },
  ],
  changed: (s) => s.floorsCreated + s.roomsCreated + s.shiftsAdded > 0,
  successToast: (s) => `Added ${s.floorsCreated} floor(s), ${s.roomsCreated} room(s), ${s.shiftsAdded} shift(s)`,
}

const STAT_TONE = {
  green: { box: 'border-green-200 bg-green-50', text: 'text-green-700' },
  red:   { box: 'border-red-200 bg-red-50',     text: 'text-red-700' },
}

function BulkMenu({ config, onImported }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)

  function downloadTemplate() {
    client.get(`${config.path}/template`, { responseType: 'blob' })
      .then((blob) => saveBlob(blob, config.templateFile))
      .catch(() => toast.error('Failed to download template'))
  }

  function exportData() {
    const date = new Date().toISOString().slice(0, 10)
    client.get(`${config.path}/export`, { responseType: 'blob' })
      .then((blob) => saveBlob(blob, `${config.exportPrefix}_${date}.xlsx`))
      .catch(() => toast.error('Export failed'))
  }

  function downloadErrorFile(errorFile) {
    if (!errorFile?.base64) return
    const bytes = atob(errorFile.base64)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    saveBlob(new Blob([arr], { type: errorFile.mimeType }), errorFile.filename)
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'xlsx' && ext !== 'csv') return toast.error('Please select an .xlsx or .csv file')
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await client.postForm(`${config.path}/import`, fd)
      setResult(res)
      const s = res.summary || {}
      if (config.changed(s)) { toast.success(config.successToast(s)); onImported?.() }
      if (s.failed > 0) toast.warning(`${s.failed} row(s) had errors — see the report`)
    } catch (err) {
      toast.error(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFile} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={uploading}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />{uploading ? 'Uploading…' : config.label}<ChevronDown className="h-4 w-4 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={downloadTemplate}><Download className="h-4 w-4 mr-2" />Template</DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2" />Import</DropdownMenuItem>
          <DropdownMenuItem onClick={exportData}><FileSpreadsheet className="h-4 w-4 mr-2" />Export</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{config.title}</DialogTitle></DialogHeader>
          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {config.stats.map((st) => {
                  const tone = STAT_TONE[st.tone]
                  return (
                    <div key={st.key} className={`rounded-lg border p-3 ${tone?.box || ''}`}>
                      <p className={`text-xs ${tone?.text || 'text-gray-500'}`}>{st.label}</p>
                      <p className={`text-xl font-semibold ${tone?.text || ''}`}>{result.summary?.[st.key] ?? 0}</p>
                    </div>
                  )
                })}
              </div>

              {result.warnings?.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-amber-700 mb-2">Warnings</p>
                  <div className="rounded-lg border divide-y text-sm max-h-40 overflow-y-auto">
                    {result.warnings.map((w, i) => (
                      <div key={i} className="p-2">
                        <span className="font-medium">Row {w.row}</span>{w.name && <> · {w.name}</>}
                        <p className="text-xs text-amber-700 mt-0.5">{w.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.errors?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-red-700">Failed Rows</p>
                    {result.errorFile && (
                      <Button size="sm" variant="outline" onClick={() => downloadErrorFile(result.errorFile)}>
                        <Download className="h-4 w-4 mr-2" />Download Error Report
                      </Button>
                    )}
                  </div>
                  <div className="rounded-lg border divide-y text-sm max-h-64 overflow-y-auto">
                    {result.errors.map((er, i) => (
                      <div key={i} className="p-2">
                        <span className="font-medium">Row {er.row}</span>{er.name && <> · {er.name}</>}
                        <p className="text-xs text-red-600 mt-0.5">{er.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter><Button onClick={() => setResult(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Add Floor ────────────────────────────────────────────────────────────
function AddFloorDialog({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim()) return toast.error('Floor name is required')
    setSaving(true)
    try {
      const res = await client.post('/rooms/floors', { name: name.trim() })
      toast.success('Floor added')
      onCreated(res.data)
      setOpen(false)
      setName('')
    } catch (err) {
      toast.error(err.message || 'Failed to add floor')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Floor</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Floor</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2">
          <Label>Floor name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2nd Floor" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving}>{saving ? 'Adding…' : 'Add Floor'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Add / Edit Room ──────────────────────────────────────────────────────
function RoomDialog({ floorId, departments, onSaved, trigger, room }) {
  const [open, setOpen] = useState(false)
  const [roomNumber, setRoomNumber] = useState(room?.roomNumber || '')
  const [departmentId, setDepartmentId] = useState(room?.department?.id || '')
  const [sittingType, setSittingType] = useState(room?.sittingType || 'single')
  const [saving, setSaving] = useState(false)
  const [rangeHint, setRangeHint] = useState('')

  // Suggests the next free number in this floor's numbering block (1st floor →
  // 100-199, 2nd → 200-299, ...) so numbers read the way a real hospital's do —
  // purely a default, still fully editable.
  useEffect(() => {
    if (room || !open || !floorId) return
    client.get('/rooms/suggest-number', { params: { floorId } }).then((res) => {
      setRoomNumber(res.data.suggested)
      setRangeHint(`This floor's rooms run ${res.data.blockStart}–${res.data.blockEnd}`)
    }).catch(() => {})
  }, [open, floorId, room])

  const submit = async () => {
    if (!roomNumber.trim()) return toast.error('Room number is required')
    setSaving(true)
    try {
      const payload = { roomNumber: roomNumber.trim(), departmentId: departmentId || null, sittingType }
      const res = room
        ? await client.patch(`/rooms/${room.id}`, payload)
        : await client.post('/rooms', { ...payload, floorId })
      toast.success(room ? 'Room updated' : 'Room added')
      onSaved(res.data)
      setOpen(false)
    } catch (err) {
      toast.error(err.message || 'Failed to save room')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{room ? 'Edit Room' : 'Add Room'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label>Room number</Label>
            <Input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="e.g. 204" />
            {rangeHint && <p className="text-xs text-gray-400">{rangeHint}</p>}
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            {/* SearchableSelect, not Select: a hospital with ten departments is
                fine to scroll, one with sixty is not, and the plain Select has
                no way to type. The component is the same one the booking form
                and OPD already use — no server call here, the departments are
                already loaded, so it filters the list it was handed. */}
            <SearchableSelect
              className="w-full"
              value={departmentId}
              onChange={setDepartmentId}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="Select department"
              searchPlaceholder="Type to search departments…"
              emptyText="No matching department"
              minSearchLength={0}
            />
          </div>
          <div className="space-y-2">
            <Label>Label</Label>
            <Select value={sittingType} onValueChange={setSittingType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single Doctor</SelectItem>
                <SelectItem value="multiple">Shared / Multiple Doctors</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">Cosmetic only — who's actually shown as active here is decided by each doctor's own Timetable (Doctor Accountability → Timetable), not this label.</p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Room'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Set Override ─────────────────────────────────────────────────────────
function OverrideDialog({ roomId, doctors, currentOverrideSetAt, onSet }) {
  const [open, setOpen] = useState(false)
  const [doctorId, setDoctorId] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!doctorId) return toast.error('Select a doctor')
    setSaving(true)
    try {
      await client.post(`/rooms/${roomId}/override`, { doctorId, expectedOverrideSetAt: currentOverrideSetAt ?? null })
      toast.success('Override set — this doctor is now shown as active')
      onSet()
      setOpen(false)
    } catch (err) {
      if (err.status === 409) {
        toast.error(err.message || 'Someone else just changed this room\'s override — reloading')
        onSet()
      } else {
        toast.error(err.message || 'Failed to set override')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><ShieldAlert className="h-3.5 w-3.5 mr-1" />Cover / Override</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Set the doctor covering this room</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-500 -mt-2">Use this when the scheduled doctor is absent. It doesn't need to be a doctor whose timetable normally points here.</p>
        <div className="py-2">
          <Select value={doctorId} onValueChange={setDoctorId}>
            <SelectTrigger><SelectValue placeholder="Select covering doctor" /></SelectTrigger>
            <SelectContent>
              {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{drName(d.fullName)} {d.specialization ? `— ${d.specialization}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !doctorId}>{saving ? 'Setting…' : 'Set Override'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Room card (expandable) ───────────────────────────────────────────────
// One room = one table row, expandable for its schedule + actions. A table (not
// a card grid) because a real floor carries 90-180 rooms — a card per room is
// unscannable and unsearchable at that size.
function RoomRow({ room, floorId, departments, doctors, onChanged }) {
  const [expanded, setExpanded] = useState(false)
  const active = room.activeDoctor

  const remove = async () => {
    if (!window.confirm(`Delete Room ${room.roomNumber}? This cannot be undone.`)) return
    try {
      await client.delete(`/rooms/${room.id}`)
      toast.success('Room deleted')
      onChanged()
    } catch (err) {
      toast.error(err.message || 'Failed to delete room')
    }
  }

  const removeDoctor = async (link) => {
    if (!window.confirm(`Remove ${drName(link.doctorName)} from Room ${room.roomNumber}? Their shift times are kept, just without this room.`)) return
    try {
      await client.delete(`/rooms/${room.id}/doctors/${link.doctorId}`)
      toast.success('Doctor removed from room')
      onChanged()
    } catch (err) {
      toast.error(err.message || 'Failed to remove doctor')
      if (err.status === 409) onChanged()
    }
  }

  const clearOverride = async () => {
    try {
      await client.delete(`/rooms/${room.id}/override`, { data: { expectedOverrideSetAt: room.override?.setAt ?? null } })
      toast.success('Override cleared')
      onChanged()
    } catch (err) {
      if (err.status === 409) {
        toast.error(err.message || 'Someone else just changed this room\'s override — reloading')
        onChanged()
      } else {
        toast.error(err.message || 'Failed to clear override')
      }
    }
  }

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-gray-50" onClick={() => setExpanded((v) => !v)}>
        <TableCell className="w-8 text-gray-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-mono font-semibold text-[#2E4168]">{room.roomNumber}</TableCell>
        <TableCell className="text-sm">{room.department?.name || <span className="text-gray-400">—</span>}</TableCell>
        <TableCell>
          {/* Counts the doctors actually linked, never the `sittingType` label:
              that label is picked by hand when the room is created and nothing
              touches it afterwards, so a room read "Single" with three doctors
              in it. Deliberately quiet — a solid badge on every row fought the
              room number and doctor name for attention. */}
          {(() => {
            const n = room.doctorLinks?.length || 0
            const shared = n > 1
            return (
              <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 border ${
                shared ? 'bg-[#2E4168]/8 text-[#2E4168] border-[#2E4168]/20' : 'bg-gray-50 text-gray-500 border-gray-200'
              }`}>
                {shared ? `Shared · ${n}` : n === 1 ? 'Single' : 'Empty'}
              </span>
            )
          })()}
        </TableCell>
        <TableCell className="text-sm">
          {active.unassigned ? <span className="text-gray-400 italic">No doctor linked</span>
            : active.onBreak ? <span className="text-gray-400 italic">On break</span>
            : (
              <span className="font-medium">
                {drName(active.doctorName)}
                {active.manual && <Badge variant="outline" className="ml-2 text-amber-700 border-amber-300 text-[10px]">Override</Badge>}
              </span>
            )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
          <TableCell colSpan={5} className="p-4 space-y-4">
            <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
              <RoomDialog
                floorId={floorId} departments={departments} room={room} onSaved={onChanged}
                trigger={<Button size="sm" variant="outline">Edit Room</Button>}
              />
              <OverrideDialog roomId={room.id} doctors={doctors} currentOverrideSetAt={room.override?.setAt ?? null} onSet={onChanged} />
              {room.override && (
                <Button size="sm" variant="ghost" onClick={clearOverride}><X className="h-3.5 w-3.5 mr-1" />Clear Override</Button>
              )}
              <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700 ml-auto" onClick={remove}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />Delete Room
              </Button>
            </div>

            <div className="rounded-md bg-blue-50 border border-blue-100 p-3 flex gap-2 text-sm text-blue-800">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Who sits here and when is set on each doctor's own Timetable (Doctor Accountability → Timetable) — pick this room for a shift there, not here.</span>
            </div>

            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />Schedule (from doctors' timetables)
              </div>
              {room.schedule.length === 0 ? (
                <p className="text-sm text-gray-400">No doctor has a shift pointing at this room yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {groupSchedule(room.schedule).map((s, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-md border bg-white px-3 py-2 text-sm">
                      <span className="font-semibold text-gray-900 min-w-[160px]">{drName(s.doctorName)}</span>
                      <span className="text-gray-500">{formatDays(s.days)}</span>
                      <span className="ml-auto font-mono text-xs text-[#2E4168] bg-[#2E4168]/8 rounded px-2 py-0.5">{s.start}–{s.end}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {room.doctorLinks?.length > 0 && (
              <div onClick={(e) => e.stopPropagation()}>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Linked doctors</div>
                <div className="flex flex-wrap gap-2">
                  {room.doctorLinks.map((l) => (
                    <span key={l.doctorId} className="inline-flex items-center gap-1.5 rounded-full border bg-white pl-3 pr-1 py-0.5 text-sm">
                      {drName(l.doctorName)}
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-red-600 hover:text-red-700" onClick={() => removeDoctor(l)}>
                        <X className="h-3.5 w-3.5 mr-0.5" />Remove
                      </Button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ── Main manager ─────────────────────────────────────────────────────────
export default function RoomsManager() {
  const [floors, setFloors] = useState([])
  const [activeFloorId, setActiveFloorId] = useState(null)
  const [rooms, setRooms] = useState([])
  const [departments, setDepartments] = useState([])
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('all')

  const loadFloors = useCallback(async () => {
    const res = await client.get('/rooms/floors')
    setFloors(res.data)
    return res.data
  }, [])

  const loadRooms = useCallback(async (floorId) => {
    if (!floorId) return setRooms([])
    const res = await client.get('/rooms', { params: { floorId } })
    setRooms(res.data)
  }, [])

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [floorList, deptRes, userRes] = await Promise.all([
          loadFloors(),
          client.get('/settings', { params: { resource: 'departments' } }),
          client.get('/settings', { params: { resource: 'users' } }),
        ])
        setDepartments(deptRes.data)
        setDoctors(userRes.data.filter((u) => u.role === 'doctor'))
        const firstFloor = floorList[0]?.id || null
        setActiveFloorId(firstFloor)
        if (firstFloor) await loadRooms(firstFloor)
      } catch (err) {
        toast.error(err.message || 'Failed to load rooms settings')
      } finally {
        setLoading(false)
      }
    })()
  }, [loadFloors, loadRooms])

  const refreshRooms = () => loadRooms(activeFloorId)

  // Live: a room added or a doctor re-assigned by another administrator shows
  // up on this floor's list by itself.
  useLiveData('rooms', refreshRooms)

  const selectFloor = async (id) => {
    setActiveFloorId(id)
    // A search/filter from the previous floor would silently hide the new
    // floor's rooms ("this floor is empty?!") — clear it on every switch.
    setSearch('')
    setDeptFilter('all')
    await loadRooms(id)
  }

  const deleteFloor = async (floor) => {
    if (!window.confirm(`Delete "${floor.name}"?`)) return
    try {
      await client.delete(`/rooms/floors/${floor.id}`)
      toast.success('Floor deleted')
      const updated = await loadFloors()
      const next = updated[0]?.id || null
      setActiveFloorId(next)
      await loadRooms(next)
    } catch (err) {
      toast.error(err.message || 'Failed to delete floor')
    }
  }

  // Search + department filter run client-side: /rooms already returns this
  // floor's rooms in one payload, and a floor tops out in the low hundreds —
  // filtering locally keeps typing instant instead of round-tripping per keystroke.
  const filteredRooms = useMemo(() => {
    let list = rooms
    if (deptFilter !== 'all') list = list.filter((r) => r.department?.id === deptFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((r) =>
        r.roomNumber.toLowerCase().includes(q) ||
        (r.department?.name || '').toLowerCase().includes(q) ||
        (r.activeDoctor?.doctorName || '').toLowerCase().includes(q) ||
        (r.doctorLinks || []).some((l) => (l.doctorName || '').toLowerCase().includes(q))
      )
    }
    return list
  }, [rooms, search, deptFilter])

  const activeFloor = floors.find((f) => f.id === activeFloorId)

  // First load only — a live refresh or a floor switch keeps the current view
  // instead of blanking the whole panel to this spinner.
  if (loading && floors.length === 0) return <p className="text-gray-400 text-sm py-8 text-center">Loading rooms…</p>

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Floors & Rooms</CardTitle>
            <CardDescription>Set up floors, departments, and consulting rooms for the queue display board. Doctor scheduling happens on each doctor's own Timetable.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <BulkMenu config={BULK_SETUP} onImported={async () => { const f = await loadFloors(); if (activeFloorId) refreshRooms(); else selectFloor(f[0]?.id) }} />
            <AddFloorDialog onCreated={async () => { const f = await loadFloors(); if (!activeFloorId) selectFloor(f[0]?.id) }} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {floors.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No floors yet — add one to get started.</p>
        ) : (
          <div className="flex flex-col md:flex-row gap-5">
            {/* Floors: a real list, not delete-able chips. Selecting a floor is the
                primary action; deleting is a hover-revealed secondary one (and the
                server refuses to delete a floor that still has rooms). */}
            {/* A self-contained panel, not a bare column with a hairline rule —
                with only a handful of floors the old version left a long dead
                white gutter down the page. */}
            <div className="md:w-56 shrink-0 bg-gray-50/70 border border-gray-200 rounded-lg p-2 h-fit">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 px-2 py-1.5 mb-1 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />Floors
              </div>
              <div className="space-y-0.5">
                {floors.map((f) => {
                  const selected = activeFloorId === f.id
                  return (
                    <div key={f.id} className={`group flex items-center rounded-md transition-colors ${selected ? 'bg-primary text-primary-foreground' : 'hover:bg-gray-100'}`}>
                      <button type="button" className="flex-1 text-left px-3 py-2 min-w-0" onClick={() => selectFloor(f.id)}>
                        <div className="text-sm font-medium truncate">{f.name}</div>
                        <div className={`text-xs ${selected ? 'text-primary-foreground/70' : 'text-gray-500'}`}>{f.roomCount} room{f.roomCount === 1 ? '' : 's'}</div>
                      </button>
                      <button
                        type="button"
                        title={`Delete ${f.name}`}
                        aria-label={`Delete ${f.name}`}
                        onClick={() => deleteFloor(f)}
                        className={`px-2 py-2 rounded-r-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity ${selected ? 'text-primary-foreground/60 hover:text-primary-foreground' : 'text-gray-400 hover:text-red-600'}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Rooms table for the selected floor */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <div className="font-semibold text-gray-900">{activeFloor?.name}</div>
                  <div className="text-xs text-gray-500">
                    {filteredRooms.length === rooms.length
                      ? `${rooms.length} room${rooms.length === 1 ? '' : 's'}`
                      : `${filteredRooms.length} of ${rooms.length} rooms`}
                  </div>
                </div>
                {activeFloorId && (
                  <RoomDialog
                    floorId={activeFloorId} departments={departments} onSaved={refreshRooms}
                    trigger={<Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Room</Button>}
                  />
                )}
              </div>

              {/* The shared filter row (components/common/FilterBar). The
                  department picker stays a SearchableSelect — a hospital can have
                  sixty departments, too many to scroll. */}
              <FilterBar
                className="mb-3"
                search={search}
                onSearchChange={setSearch}
                placeholder="Search room number, department, or doctor…"
                active={!!search || deptFilter !== 'all'}
                onClear={() => { setSearch(''); setDeptFilter('all') }}
              >
                {/* Searchable, like the department field in the Add Room
                    dialog above — the same list, the same component, so a
                    department can be typed rather than scrolled to. The filter
                    itself (filteredRooms) is unchanged: this only changes how
                    the department is picked. */}
                <SearchableSelect
                  className="w-[220px]"
                  value={deptFilter}
                  onChange={(v) => setDeptFilter(v || 'all')}
                  options={[
                    { value: 'all', label: 'All departments' },
                    ...departments.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                  placeholder="All departments"
                  searchPlaceholder="Type to search departments…"
                  emptyText="No matching department"
                  minSearchLength={0}
                />
              </FilterBar>

              {rooms.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">No rooms on this floor yet.</p>
              ) : filteredRooms.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">No rooms match this search.</p>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <div className="max-h-[560px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-gray-50 z-10">
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead className="w-24">Room</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead className="w-28">Type</TableHead>
                          <TableHead>Doctor right now</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRooms.map((r) => (
                          <RoomRow key={r.id} room={r} floorId={activeFloorId} departments={departments} doctors={doctors} onChanged={refreshRooms} />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
