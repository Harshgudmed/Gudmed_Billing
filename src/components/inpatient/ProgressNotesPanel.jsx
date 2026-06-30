import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Loader2, Plus, CornerDownRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import client from '@/api/client'
import { useAuth } from '@/lib/auth'

// Doctor Progress Notes — reuses the existing note-v2 / clinical-notes-v2 endpoints
// (no backend change). Notes are append-only: an "edit" is an addendum (parentId),
// never an overwrite — preserving the legal medical record.
export default function ProgressNotesPanel({ admitted = [], admissionId: controlledId }) {
  const { user } = useAuth()
  const canWrite = !user || ['doctor', 'nurse', 'admin', 'super_admin'].includes(user.role)
  // Controlled patient (combined view) hides the internal picker.
  const [innerId, setInnerId] = useState('')
  const selectedId = controlledId || innerId
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [addTo, setAddTo] = useState(null) // parent note id for an addendum

  useEffect(() => { if (!controlledId && !innerId && admitted.length) setInnerId(admitted[0].id) }, [admitted, innerId, controlledId])

  const load = useCallback(async (id) => {
    if (!id) return
    setLoading(true)
    try {
      const res = await client.get(`/inpatient?resource=clinical-notes-v2&admissionId=${id}`)
      setNotes(res.data || [])
    } catch { toast.error('Failed to load notes') }
    setLoading(false)
  }, [])
  useEffect(() => { if (selectedId) load(selectedId) }, [selectedId, load])

  const save = async () => {
    if (!body.trim()) { toast.error('Note text required'); return }
    setSaving(true)
    try {
      const res = await client.post('/inpatient', { resource: 'note-v2', admissionId: selectedId, noteType: 'PROGRESS', body: body.trim(), parentId: addTo || undefined })
      if (res.success) { toast.success(addTo ? 'Addendum added' : 'Progress note saved'); setBody(''); setAddTo(null); load(selectedId) }
      else toast.error(res.error || 'Failed')
    } catch (e) { toast.error(e.message || 'Failed to save note') }
    setSaving(false)
  }

  if (!admitted.length) {
    return <Card><CardContent className="py-14 text-center text-gray-400">No admitted patients.</CardContent></Card>
  }

  // group: parents first, addenda nested by parentId
  const parents = notes.filter((n) => !n.parentId)
  const addenda = (pid) => notes.filter((n) => n.parentId === pid)

  return (
    <div className="space-y-4">
      {!controlledId && (
        <div className="flex items-center gap-3">
          <Label className="text-sm text-gray-600">Patient</Label>
          <Select value={selectedId} onValueChange={setInnerId}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Select admitted patient" /></SelectTrigger>
            <SelectContent>
              {admitted.map((a) => (
                <SelectItem key={a.id} value={a.id}>{(a.patient?.firstName || '') + ' ' + (a.patient?.lastName || '')} · Bed {a.bed?.bedNumber || '—'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {canWrite && (
        <Card>
          <CardContent className="py-4 space-y-2">
            {addTo && (
              <div className="text-xs text-amber-700 flex items-center gap-1">
                <CornerDownRight className="h-3 w-3" />Adding an addendum · <button className="underline" onClick={() => setAddTo(null)}>cancel</button>
              </div>
            )}
            <Textarea rows={3} placeholder="Progress note (e.g. Patient improving; continue antibiotics; repeat CBC tomorrow)" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-1" />}{addTo ? 'Add Addendum' : 'Save Note'}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Loading…</div>
      ) : parents.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-gray-400">No progress notes yet.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {parents.map((n) => (
            <Card key={n.id}>
              <CardContent className="py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="bg-cyan-100 text-cyan-800">{n.noteType}</Badge>
                  <span className="text-xs text-gray-500">{n.authorName || '—'} · {n.authoredAt ? format(new Date(n.authoredAt), 'dd MMM yyyy HH:mm') : ''}</span>
                  <div className="flex-1" />
                  {canWrite && <Button variant="ghost" size="sm" onClick={() => { setAddTo(n.id); setBody('') }}>+ Addendum</Button>}
                </div>
                <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                {addenda(n.id).map((a) => (
                  <div key={a.id} className="mt-2 ml-4 pl-3 border-l-2 border-amber-200">
                    <div className="text-xs text-gray-500">↳ addendum · {a.authorName || '—'} · {a.authoredAt ? format(new Date(a.authoredAt), 'dd MMM HH:mm') : ''}</div>
                    <p className="text-sm whitespace-pre-wrap">{a.body}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
