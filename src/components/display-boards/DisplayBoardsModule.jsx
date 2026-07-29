import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MonitorPlay, ExternalLink, Plus, Trash2, Edit, Search, GripVertical, DoorOpen, Megaphone, Building2, Users, RotateCw, CheckCircle2, X, Clock, ChevronLeft, Activity } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import DoctorTiming from '../doctor-accountability/DoctorTiming'
import ScreenHealth from './ScreenHealth'

// The hospital's OWN brand colours (Settings → Organization → colour picker),
// applied app-wide as CSS custom properties by App.jsx#applyBranding — not a
// one-off hardcoded colour. Whatever the hospital sets there, this panel now
// matches, instead of drifting from the rest of the app.
// Fallback matches Organization.primaryColor's own DB default — so this
// panel still looks right on the one render before App.jsx's branding fetch
// resolves and sets the real CSS variable.
const PRIMARY = 'var(--color-primary, #2563eb)'
/** PRIMARY lightened toward white by `pct` — for tints, borders, and muted
 * icon/text colour, all from the ONE brand colour instead of separate
 * hardcoded shades. */
const mix = (pct) => `color-mix(in srgb, ${PRIMARY} ${pct}%, white)`

// "30s" under a minute, "1m 30s" / "2m" at or above one — so the slider
// control reads in whichever unit is natural for the value, not a raw
// seconds count nobody can picture at a glance.
function formatSlideDuration(totalSeconds) {
  if (totalSeconds < 60) return `${totalSeconds}s`
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

function ScreenCard({ screen, onPreview, onEdit, onDelete }) {
  return (
    <Card className="flex h-full flex-col overflow-hidden shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: mix(12) }}>
            <MonitorPlay className="h-4 w-4" style={{ color: PRIMARY }} />
          </span>
          <span className="truncate text-lg">{screen.name}</span>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-3 pl-10 text-xs text-gray-500">
          <Badge variant={screen.rooms.length === 0 ? 'outline' : 'secondary'} className={screen.rooms.length === 0 ? 'text-red-600 border-red-200' : ''}>
            {screen.rooms.length} room{screen.rooms.length === 1 ? '' : 's'}
          </Badge>
          <span className="flex items-center gap-1" title="Max doctors shown at once"><Users className="h-3 w-3" />{screen.maxDoctors}</span>
          <span className="flex items-center gap-1" title="Slide rotation speed"><RotateCw className="h-3 w-3" />{screen.sliderSpeedSeconds}s</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 pb-3 text-sm text-gray-600">
        {screen.announcementText && (
          <div className="flex items-start gap-1.5 rounded-md border p-2 text-xs" style={{ backgroundColor: mix(5), borderColor: mix(20) }}>
            <Megaphone className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: PRIMARY }} />
            <span className="line-clamp-2" style={{ color: PRIMARY }}>{screen.announcementText}</span>
          </div>
        )}
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1">
          {screen.rooms.map(r => (
            <span key={r.id} className="inline-flex h-fit items-center gap-1 rounded-full border bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
              <DoorOpen className="h-3 w-3 text-gray-400" />{r.roomNumber}
            </span>
          ))}
          {screen.rooms.length === 0 && (
            <span className="italic text-xs text-red-500">No rooms mapped — this screen will show nothing</span>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between border-t bg-gray-50 p-3">
        <div className="space-x-1">
          <Button size="icon" variant="ghost" className="h-8 w-8" style={{ color: PRIMARY }} onClick={onPreview} title="Open TV Board">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-x-1">
          <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-600" onClick={onEdit} title="Edit">
            <Edit className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600 hover:bg-red-50" onClick={onDelete} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

export default function DisplayBoardsModule() {
  const [screens, setScreens] = useState([])
  const [rooms, setRooms] = useState([])
  const [floors, setFloors] = useState([])
  const [loading, setLoading] = useState(true)
  // Sub-view: manage TV screens, or set doctors' room + weekly timetable in the
  // same place (so the doctor→room and room→screen setup live side by side).
  const [view, setView] = useState('screens')

  const [showDialog, setShowDialog] = useState(false)
  const [editingScreen, setEditingScreen] = useState(null)

  const [formData, setFormData] = useState({
    name: '',
    maxDoctors: 5,
    sliderSpeedSeconds: 30,
    announcementText: '',
    roomIds: []
  })

  // Which floor's rooms the "Available Rooms" list is scoped to, plus a
  // free-text filter within that floor — a hospital can easily have 400+
  // rooms across floors, and picking from all of them in one flat list is
  // how an admin ends up scrolling forever looking for "their" floor.
  const [roomFloorFilter, setRoomFloorFilter] = useState('')
  const [roomSearch, setRoomSearch] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  // Defaults the filter to the first floor once floors load, so the dialog
  // never opens showing every room in the hospital unfiltered.
  useEffect(() => {
    if (!roomFloorFilter && floors.length) setRoomFloorFilter(floors[0].id)
  }, [floors]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    setLoading(true)
    try {
      const [screensRes, roomsRes, floorsRes] = await Promise.all([
        client.get('/screens'),
        client.get('/screens/rooms/all'),
        // The floor LIST comes from /rooms/floors, not derived from the room
        // list — a floor with no rooms yet (just created, or rooms not added
        // yet) still has to appear in the picker, or there's no way to ever
        // start assigning rooms to it.
        client.get('/rooms/floors'),
      ])
      setScreens(screensRes.data || [])
      setRooms(roomsRes.data || [])
      setFloors(floorsRes.data || [])
    } catch (error) {
      toast.error('Failed to load display board data')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenCreate = () => {
    setEditingScreen(null)
    setFormData({
      name: '',
      maxDoctors: 5,
      sliderSpeedSeconds: 30,
      announcementText: '',
      roomIds: []
    })
    setRoomSearch('')
    setShowDialog(true)
  }

  const handleOpenEdit = (screen) => {
    setEditingScreen(screen)
    setFormData({
      name: screen.name,
      maxDoctors: screen.maxDoctors,
      sliderSpeedSeconds: screen.sliderSpeedSeconds,
      announcementText: screen.announcementText || '',
      roomIds: screen.rooms.map(r => r.id)
    })
    setRoomSearch('')
    // Jump the floor filter to wherever this screen's rooms actually are,
    // so editing an existing "1st Floor North" screen doesn't land you on
    // whatever floor you were last looking at.
    const firstRoomId = screen.rooms[0]?.id
    const firstRoom = firstRoomId ? rooms.find(r => r.id === firstRoomId) : null
    if (firstRoom?.floor?.id) setRoomFloorFilter(firstRoom.floor.id)
    setShowDialog(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this TV display config?')) return
    try {
      await client.delete(`/screens/${id}`)
      toast.success('Screen deleted')
      fetchData()
    } catch (err) {
      toast.error('Failed to delete screen')
    }
  }

  const handleSave = async () => {
    try {
      // maxDoctors is kept as raw typed text in state while the dialog is open
      // (see the input's onChange) — coerce it to a real, valid number here so a
      // save triggered without the field ever blurring (e.g. Enter, or a click
      // that doesn't hand focus away first) can't send "" or a non-number.
      const payload = { ...formData, maxDoctors: Math.max(1, parseInt(formData.maxDoctors) || 1) }
      if (editingScreen) {
        await client.put(`/screens/${editingScreen.id}`, payload)
        toast.success('Screen updated')
      } else {
        await client.post('/screens', payload)
        toast.success('Screen created')
      }
      setShowDialog(false)
      fetchData()
    } catch (err) {
      toast.error('Failed to save screen config')
    }
  }

  const toggleRoom = (roomId) => {
    setFormData(prev => {
      if (prev.roomIds.includes(roomId)) {
        return { ...prev, roomIds: prev.roomIds.filter(id => id !== roomId) }
      }
      return { ...prev, roomIds: [...prev.roomIds, roomId] }
    })
  }

  const unassignedRooms = rooms.filter((r) => !r.displayScreenId)

  // How many rooms EXIST on each floor, regardless of screen assignment —
  // the denominator for each floor section's "X/Y rooms covered" line.
  const floorRoomTotals = useMemo(() => {
    const totals = new Map()
    for (const r of rooms) {
      const key = r.floor?.id || 'unassigned'
      totals.set(key, (totals.get(key) || 0) + 1)
    }
    return totals
  }, [rooms])

  // A screen or room number search that spans every floor — with 20+ screens,
  // "which screen has room 145 on it?" is a real question an admin asks, and
  // scrolling to find out doesn't scale.
  const [boardSearch, setBoardSearch] = useState('')

  // Screens grouped by floor (a screen's rooms are, in practice, all on one
  // floor — see the floor filter in the create/edit dialog). 24 flat cards in
  // one grid reads as noise; grouped under a floor heading it reads as "here's
  // what's covered, floor by floor."
  const screenGroups = useMemo(() => {
    const q = boardSearch.trim().toLowerCase()
    const matches = (s) => !q || s.name.toLowerCase().includes(q) || s.rooms.some(r => r.roomNumber.toLowerCase().includes(q))

    const byFloor = new Map()
    for (const s of screens) {
      if (!matches(s)) continue
      const f = s.rooms[0]?.floor
      const key = f ? f.id : 'unassigned'
      if (!byFloor.has(key)) byFloor.set(key, { key, label: f ? f.name : 'Unassigned', sortOrder: f ? f.sortOrder : 999, screens: [] })
      byFloor.get(key).screens.push(s)
    }
    return [...byFloor.values()].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [screens, boardSearch])

  if (loading) return <div className="p-8 text-center text-gray-500">Loading Display Boards...</div>

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: PRIMARY }}>
            <MonitorPlay className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Smart TV Display Boards</h1>
            <p className="text-sm text-gray-500">Map consultation rooms to specific TV screens for patient queue visibility.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {view === 'screens' ? (
            <>
              {/* Live health of every physical display — online/offline + pairing. */}
              <Button variant="outline" onClick={() => setView('health')}>
                <Activity className="w-4 h-4 mr-2" />
                Screen Health
              </Button>
              {/* Jump to the doctor room + weekly timetable setup, right here. */}
              <Button variant="outline" onClick={() => setView('timetable')}>
                <Clock className="w-4 h-4 mr-2" />
                Doctor's Timetable
              </Button>
              <Button variant="outline" onClick={() => window.open('/display', '_blank')}>
                <MonitorPlay className="w-4 h-4 mr-2" />
                Open Floor Overview
              </Button>
              <Button style={{ backgroundColor: PRIMARY }} className="hover:opacity-90" onClick={handleOpenCreate}>
                <Plus className="w-4 h-4 mr-2" />
                Add New Screen
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setView('screens')}>
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back to TV Screens
            </Button>
          )}
        </div>
      </div>

      {view === 'timetable' && <DoctorTiming />}

      {view === 'health' && <ScreenHealth screens={screens} />}

      {view === 'screens' && (<>


      {unassignedRooms.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <DoorOpen className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <strong>{unassignedRooms.length} room{unassignedRooms.length === 1 ? '' : 's'}</strong> not assigned to any screen —
            {' '}patients in {unassignedRooms.length === 1 ? 'it' : 'them'} won't appear on any TV board:{' '}
            <span className="font-medium">{unassignedRooms.slice(0, 8).map(r => r.roomNumber).join(', ')}{unassignedRooms.length > 8 ? `, +${unassignedRooms.length - 8} more` : ''}</span>
          </div>
        </div>
      )}

      {/* Finds a screen by name OR by any room number it holds — with 20+
          screens, scrolling to answer "which TV has room 145?" doesn't scale. */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <Input
          value={boardSearch}
          onChange={e => setBoardSearch(e.target.value)}
          placeholder="Search by screen name or room number..."
          className="pl-8"
        />
        {boardSearch && (
          <button onClick={() => setBoardSearch('')} className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {screenGroups.length === 0 && boardSearch && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-400">
          No screen or room matches "{boardSearch}"
        </div>
      )}

      {screenGroups.map(group => {
        const total = floorRoomTotals.get(group.key) || 0
        const covered = group.screens.reduce((n, s) => n + s.rooms.length, 0)
        const fullyCovered = total > 0 && covered >= total
        return (
        <div key={group.key} className="space-y-3">
          <div className="flex items-center gap-3">
            <Building2 className="h-4 w-4 shrink-0" style={{ color: PRIMARY }} />
            <h2 className="text-base font-bold text-slate-800">{group.label}</h2>
            <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${mix(35)}, transparent)` }} />
            {total > 0 && (
              <span className={`flex items-center gap-1 text-xs font-medium ${fullyCovered ? 'text-emerald-600' : 'text-amber-600'}`}>
                {fullyCovered && <CheckCircle2 className="h-3.5 w-3.5" />}
                {covered}/{total} rooms covered
              </span>
            )}
            <Badge variant="secondary">{group.screens.length} screen{group.screens.length === 1 ? '' : 's'}</Badge>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {group.screens.map(screen => (
              <ScreenCard
                key={screen.id}
                screen={screen}
                onPreview={() => window.open(`/display/screen/${screen.id}`, '_blank')}
                onEdit={() => handleOpenEdit(screen)}
                onDelete={() => handleDelete(screen.id)}
              />
            ))}
          </div>
        </div>
        )
      })}

      {screens.length === 0 && (
        <div className="p-12 text-center border-2 border-dashed rounded-xl text-gray-400">
          <MonitorPlay className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>No Display Screens configured yet.</p>
          <Button variant="link" onClick={handleOpenCreate}>Create your first screen</Button>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <MonitorPlay className="h-5 w-5" style={{ color: PRIMARY }} />
              {editingScreen ? 'Edit Display Screen' : 'Create Display Screen'}
            </DialogTitle>
            <DialogDescription>Configure the smart TV settings and assign physical consultation rooms.</DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto py-2 pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Screen Name</Label>
                <Input
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g. 1st Floor North Corridor"
                />
              </div>
              <div className="space-y-2">
                <Label>Max Doctors to Display at Once</Label>
                <Input
                  type="number"
                  min={1}
                  value={formData.maxDoctors}
                  // Keep whatever the user is typing, even "" or "0" mid-edit — forcing a
                  // fallback to 1 on every keystroke (the old `parseInt(...) || 1`) fought
                  // the user while they typed a 2-digit number (0 is falsy, so it snapped
                  // back to 1 before the next digit landed, garbling values like "02").
                  // Only clamp to a valid minimum once they're done, on blur.
                  onChange={e => setFormData({...formData, maxDoctors: e.target.value})}
                  onBlur={e => setFormData({...formData, maxDoctors: Math.max(1, parseInt(e.target.value) || 1)})}
                />
              </div>
            </div>

            {/* A plain number box for "30" doesn't tell an admin whether that's
                fast or slow — a drag slider with a live "30s" / "2m" readout
                does, the way a volume or brightness slider does on any device. */}
            <div className="space-y-2">
              <Label className="flex items-center justify-between">
                <span className="flex items-center gap-1.5"><RotateCw className="h-3.5 w-3.5 text-gray-400" />Slider Speed — how long each page stays up</span>
                <span className="text-sm font-bold" style={{ color: PRIMARY }}>{formatSlideDuration(formData.sliderSpeedSeconds)}</span>
              </Label>
              <input
                type="range"
                min={10}
                max={120}
                step={5}
                value={formData.sliderSpeedSeconds}
                onChange={e => setFormData({...formData, sliderSpeedSeconds: parseInt(e.target.value)})}
                className="h-2 w-full cursor-pointer rounded-full accent-current"
                style={{ accentColor: PRIMARY }}
              />
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>10s — rotates fast</span>
                <span>2m — rotates slow</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5 text-gray-400" />Emergency Ticker / Announcement Text</Label>
              <Input
                value={formData.announcementText}
                onChange={e => setFormData({...formData, announcementText: e.target.value})}
                placeholder="e.g. OPD Registration closes at 5:00 PM"
              />
              <p className="text-xs text-gray-500">Shown as a footer line on the TV screen — leave blank for none.</p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Map Consultation Rooms to this Screen</Label>
                <Badge variant="secondary">{formData.roomIds.length} room{formData.roomIds.length === 1 ? '' : 's'} assigned</Badge>
              </div>

              {/* Scope "Available Rooms" to one floor at a time — a hospital
                  can have hundreds of rooms; picking from all of them mixed
                  together defeats the point of a floor-by-floor TV setup. */}
              <div className="flex gap-2">
                <Select value={roomFloorFilter} onValueChange={setRoomFloorFilter}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Choose a floor" />
                  </SelectTrigger>
                  <SelectContent>
                    {floors.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    value={roomSearch}
                    onChange={e => setRoomSearch(e.target.value)}
                    placeholder="Search room number..."
                    className="pl-8"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 h-[300px]">
                {/* Available Rooms — scoped to the selected floor + search text. */}
                <div
                  className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const roomId = e.dataTransfer.getData('roomId');
                    if (roomId && formData.roomIds.includes(roomId)) {
                      setFormData({
                        ...formData,
                        roomIds: formData.roomIds.filter(id => id !== roomId)
                      });
                    }
                  }}
                >
                  <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
                    <div className="text-sm font-bold text-slate-600">Available Rooms</div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{floors.find(f => f.id === roomFloorFilter)?.name || 'All floors'} · drag →</div>
                  </div>
                  <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
                    {rooms
                      .filter(r => !formData.roomIds.includes(r.id))
                      .filter(r => !roomFloorFilter || r.floor?.id === roomFloorFilter)
                      .filter(r => !roomSearch.trim() || r.roomNumber.toLowerCase().includes(roomSearch.trim().toLowerCase()))
                      .map(room => (
                      <div
                        key={room.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('roomId', room.id)}
                        className="flex cursor-grab items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm shadow-sm transition-colors hover:border-slate-300 active:cursor-grabbing"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <DoorOpen className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate font-medium text-slate-700">Room {room.roomNumber}</span>
                          {room.displayScreenId && room.displayScreenId !== editingScreen?.id && (
                            <Badge variant="outline" className="shrink-0 border-amber-300 text-[10px] text-amber-700" title="Already on another screen — dragging it here moves it">
                              moves screens
                            </Badge>
                          )}
                        </span>
                        <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
                      </div>
                    ))}
                    {rooms
                      .filter(r => !formData.roomIds.includes(r.id))
                      .filter(r => !roomFloorFilter || r.floor?.id === roomFloorFilter)
                      .filter(r => !roomSearch.trim() || r.roomNumber.toLowerCase().includes(roomSearch.trim().toLowerCase()))
                      .length === 0 && (
                      <div className="mt-6 text-center">
                        <DoorOpen className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                        <p className="text-xs text-slate-400">
                          {roomSearch.trim() ? 'No rooms match your search' : 'No more rooms on this floor'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Assigned Rooms */}
                <div
                  className="flex flex-col overflow-hidden rounded-lg border transition-colors"
                  style={{ backgroundColor: mix(5), borderColor: mix(25) }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.backgroundColor = mix(13);
                  }}
                  onDragLeave={(e) => { e.currentTarget.style.backgroundColor = mix(5) }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.backgroundColor = mix(5);
                    const roomId = e.dataTransfer.getData('roomId');
                    if (roomId && !formData.roomIds.includes(roomId)) {
                      setFormData({
                        ...formData,
                        roomIds: [...formData.roomIds, roomId]
                      });
                    }
                  }}
                >
                  <div className="shrink-0 border-b px-3 py-2 text-white" style={{ backgroundColor: PRIMARY, borderColor: PRIMARY }}>
                    <div className="flex items-center gap-1.5 text-sm font-bold">
                      <MonitorPlay className="h-3.5 w-3.5 shrink-0 opacity-90" />
                      <span className="truncate">{formData.name.trim() || 'Name this screen above'}</span>
                    </div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-white/60">Rooms shown on this TV</div>
                  </div>
                  <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
                    {formData.roomIds.map(id => {
                      const room = rooms.find(r => r.id === id);
                      if (!room) return null;
                      return (
                        <div
                          key={room.id}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('roomId', room.id)}
                          className="flex cursor-grab items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm text-white shadow-sm active:cursor-grabbing"
                          style={{ backgroundColor: PRIMARY }}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <DoorOpen className="h-3.5 w-3.5 shrink-0 text-white/70" />
                            <span className="truncate font-medium">Room {room.roomNumber}</span>
                          </span>
                          <GripVertical className="h-4 w-4 shrink-0 text-white/50" />
                        </div>
                      )
                    })}
                    {formData.roomIds.length === 0 && (
                      <div className="mt-6 text-center">
                        <DoorOpen className="mx-auto mb-2 h-6 w-6" style={{ color: mix(50) }} />
                        <p className="text-xs" style={{ color: mix(60) }}>Drag rooms here</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t pt-4">
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button style={{ backgroundColor: PRIMARY }} className="hover:opacity-90" onClick={handleSave} disabled={!formData.name}>
              {editingScreen ? 'Save Changes' : 'Create Screen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>)}
    </div>
  )
}
