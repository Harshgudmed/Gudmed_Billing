import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import client from '@/api/client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function DepartmentsManager({ departments = [], onChanged }) {
  const [isAdding, setIsAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return toast.error('Department name is required')
    setSaving(true)
    try {
      const res = await client.post('/settings', { 
        resource: 'department', 
        name: name.trim(), 
        description: description.trim() 
      })
      if (!res.success) throw new Error(res.error || 'Failed to add department')
      
      toast.success('Department added successfully')
      setIsAdding(false)
      setName('')
      setDescription('')
      if (onChanged) onChanged()
    } catch (err) {
      toast.error(err.message || 'Error saving department')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to remove this department?')) return
    
    setDeletingId(id)
    try {
      const res = await client.request({
        method: 'DELETE',
        url: '/settings',
        data: { resource: 'department', id }
      })
      if (!res.success) throw new Error(res.error || 'Failed to delete department')
      
      toast.success('Department removed successfully')
      if (onChanged) onChanged()
    } catch (err) {
      toast.error(err.message || 'Error deleting department')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-row items-start justify-between gap-4 pr-10">
        <div>
          <h2 className="text-xl font-semibold">Manage Departments</h2>
          <p className="text-sm text-gray-500 mt-1">Configure the internal departments for your facility layout and staff.</p>
        </div>
        {!isAdding && (
          <Button onClick={() => setIsAdding(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" /> Add Department
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="bg-gray-50/80 border p-4 rounded-lg relative">
          <Button 
            variant="ghost" 
            size="icon" 
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 h-6 w-6" 
            onClick={() => setIsAdding(false)}
          >
            <X className="h-4 w-4" />
          </Button>
          <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="font-medium text-sm">Add New Department</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name <span className="text-red-500">*</span></Label>
                <Input placeholder="e.g. Cardiology" value={name} onChange={e => setName(e.target.value)} autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Description <span className="text-gray-400 font-normal">(Optional)</span></Label>
                <Input placeholder="e.g. Heart specialists" value={description} onChange={e => setDescription(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-start">
              <Button type="submit" disabled={saving} size="sm">
                {saving ? 'Saving...' : 'Save Department'}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div>
        {departments.length === 0 ? (
          <div className="text-center py-10 text-gray-500 border border-dashed rounded-lg bg-gray-50/50">
            No departments created yet.
            {!isAdding && (
               <p className="mt-2 text-primary cursor-pointer text-sm font-medium hover:underline" onClick={() => setIsAdding(true)}>
                 Click here to add your first one
               </p>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader className="bg-gray-50/80">
                <TableRow>
                  <TableHead className="font-semibold text-gray-900">Department Name</TableHead>
                  <TableHead className="font-semibold text-gray-900">Description</TableHead>
                  <TableHead className="w-[80px] text-right font-semibold text-gray-900">Remove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map(dept => (
                  <TableRow key={dept.id}>
                    <TableCell className="font-medium">{dept.name}</TableCell>
                    <TableCell className="text-gray-500">{dept.description || '-'}</TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleDelete(dept.id)}
                        disabled={deletingId === dept.id}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8 p-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
