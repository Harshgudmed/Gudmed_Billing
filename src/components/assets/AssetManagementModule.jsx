import { useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import { StatCard } from '@/components/common/StatCard'
import { FilterBar, FilterSelect } from '@/components/common/FilterBar'
import { useDateFilter } from '@/components/common/DateFilter'
import { useServerPagination } from '@/lib/useServerPagination'
import { useDebounce } from '@/lib/useDebounce'
import { useLiveData } from '@/lib/useLiveData'
import { useAuth } from '@/lib/auth'
import { formatMoney, formatDateTime } from '@/lib/format'
import { canManageAssets } from '@/lib/assetAccess'
import {
  Boxes, Plus, Layers, CheckCircle2, Wrench, Archive, Clock, AlertCircle,
} from 'lucide-react'
import AssetForm from './AssetForm'
import AssetDetail from './AssetDetail'

const ASSET_ENDPOINT = '/assets'

// Each tile filters the list to what it counts — the server counts with the
// same search/category/department filters (assetController.js's summary).
const TILES = [
  { key: 'all', label: 'All Assets', tone: 'purple', icon: Layers, value: (s) => s.total },
  { key: 'ACTIVE', label: 'Active', tone: 'green', icon: CheckCircle2, value: (s) => s.ACTIVE },
  { key: 'UNDER_REPAIR', label: 'Under Repair', tone: 'orange', icon: Wrench, value: (s) => s.UNDER_REPAIR },
  { key: 'RETIRED', label: 'Retired', tone: 'blue', icon: Archive, value: (s) => s.RETIRED },
  { key: 'dueSoon', label: 'Maintenance Due Soon', tone: 'yellow', icon: Clock, value: (s) => s.dueSoon },
  { key: 'overdue', label: 'Maintenance Overdue', tone: 'red', icon: AlertCircle, value: (s) => s.overdue },
]

const STATUS_BADGE = {
  ACTIVE: 'bg-green-50 text-green-700 border-green-200',
  UNDER_REPAIR: 'bg-orange-50 text-orange-700 border-orange-200',
  RETIRED: 'bg-blue-50 text-blue-700 border-blue-200',
  DISPOSED: 'bg-gray-100 text-gray-500 border-gray-200',
}

export default function AssetManagementModule() {
  const { user } = useAuth()
  const canManage = canManageAssets(user?.role)

  const [tile, setTile] = useState('all')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  // Filters by purchase date, this register's one natural date, false by default.
  const dateFilter = useDateFilter('all', { showClear: false })

  const params = {
    search: debounced, category: category === 'all' ? '' : category,
    startDate: dateFilter.range.startDate, endDate: dateFilter.range.endDate,
  }
  if (tile === 'dueSoon') params.dueSoon = 'true'
  else if (tile === 'overdue') params.overdue = 'true'
  else if (tile !== 'all') params.status = tile

  const list = useServerPagination(ASSET_ENDPOINT, { params })
  useLiveData('assets', list.refresh)
  const counts = list.summary || {}

  const [formOpen, setFormOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState(null)
  const [openId, setOpenId] = useState(null)
  const changed = useCallback(() => list.refresh(), [list])

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Boxes className="h-8 w-8 text-blue-600" />
            Asset Management
          </h1>
          <p className="text-gray-500">Equipment, furniture, IT and vehicles — register, warranty/AMC and maintenance</p>
        </div>
        {canManage && (
          <Button onClick={() => { setEditingAsset(null); setFormOpen(true) }}><Plus className="h-4 w-4 mr-2" />Add asset</Button>
        )}
      </div>

      <div role="group" aria-label="Which assets" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {TILES.map((t) => (
          <StatCard key={t.key} tone={t.tone} icon={t.icon} label={t.label}
            value={t.value(counts) ?? 0} selected={tile === t.key} onClick={() => setTile(t.key)} />
        ))}
      </div>

      <FilterBar search={search} onSearchChange={setSearch} placeholder="Search asset tag, name or serial number…"
        active={!!search || category !== 'all' || tile !== 'all' || dateFilter.active}
        onClear={() => { setSearch(''); setCategory('all'); setTile('all'); dateFilter.reset() }}>
        <FilterSelect value={category} onChange={setCategory} className="w-44" options={[
          { value: 'all', label: 'All Categories' },
          { value: 'Medical Equipment', label: 'Medical Equipment' },
          { value: 'Furniture', label: 'Furniture' },
          { value: 'IT Equipment', label: 'IT Equipment' },
          { value: 'Vehicle', label: 'Vehicle' },
          { value: 'Other', label: 'Other' },
        ]} />
        {dateFilter.control}
      </FilterBar>

      <Card>
        <CardContent className="p-0">
          <PaginatedTable
            pagination={list}
            empty={search || category !== 'all' || tile !== 'all' || dateFilter.active ? 'No asset matches this search' : 'No assets yet — press Add asset to start the register'}
            columns={[{ header: 'Asset' }, { header: 'Category' }, { header: 'Department' }, { header: 'Status' }, { header: 'Next Maintenance' }, { header: 'Book Value' }]}
            renderRow={(a) => (
              <TableRow key={a.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenId(a.id)}
                tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(a.id) }}>
                <TableCell>
                  <div className="font-medium text-blue-700">{a.name}</div>
                  <div className="font-mono text-xs text-gray-500">{a.assetTag}{a.serialNumber ? ` · SN ${a.serialNumber}` : ''}</div>
                </TableCell>
                <TableCell>{a.category}</TableCell>
                <TableCell>{a.department?.name || <span className="text-gray-400">—</span>}</TableCell>
                <TableCell><Badge variant="outline" className={STATUS_BADGE[a.status] || ''}>{a.status.replace('_', ' ')}</Badge></TableCell>
                <TableCell className="whitespace-nowrap">
                  {a.nextMaintenanceDue ? (
                    <div>
                      <div>{formatDateTime(a.nextMaintenanceDue, { withTime: false })}</div>
                      {a.maintenanceOverdue && <Badge variant="outline" className="mt-0.5 bg-red-50 text-red-700 border-red-200 text-[11px]">Overdue</Badge>}
                      {!a.maintenanceOverdue && a.maintenanceDueSoon && <Badge variant="outline" className="mt-0.5 bg-yellow-50 text-yellow-700 border-yellow-200 text-[11px]">Due soon</Badge>}
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </TableCell>
                <TableCell>{a.bookValue != null ? formatMoney(a.bookValue) : <span className="text-gray-400">—</span>}</TableCell>
              </TableRow>
            )}
          />
        </CardContent>
      </Card>

      <AssetForm open={formOpen} onOpenChange={setFormOpen} asset={editingAsset} onSaved={(asset) => { changed(); setOpenId(asset.id) }} />
      <AssetDetail
        id={openId} open={!!openId && !formOpen} onOpenChange={(v) => { if (!v) setOpenId(null) }}
        onChanged={changed} canManage={canManage}
        onEdit={(asset) => { setEditingAsset(asset); setFormOpen(true) }}
      />
    </div>
  )
}
