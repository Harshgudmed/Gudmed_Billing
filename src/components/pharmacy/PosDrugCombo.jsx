import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Search, Loader2 } from 'lucide-react'
import client from '@/api/client'

function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debouncedValue
}

export default function PosDrugCombo({ onSelect, selectedName = '' }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const debouncedSearch = useDebounce(search, 300)

  useEffect(() => {
    if (debouncedSearch.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    const term = debouncedSearch
    ;(async () => {
      setLoading(true)
      try {
        const res = await client.get('/pharmacy/drugs', { params: { search: term, limit: 10 } })
        if (!cancelled && term === debouncedSearch) {
          // Only show drugs in stock
          setResults((res.data || []).filter(d => (d.quantityInStock || 0) > 0))
          setOpen(true)
        }
      } catch {} finally {
        if (!cancelled && term === debouncedSearch) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [debouncedSearch])

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input 
          className="pl-9 h-9"
          placeholder="Search drug..." 
          value={open ? search : (selectedName || '')} 
          onChange={e => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => { if (!open) { setSearch(''); setOpen(true) } }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />}
      </div>
      {open && (
         <div className="absolute top-full mt-1 left-0 z-50 w-full bg-white border border-gray-200 shadow-lg rounded-md max-h-60 overflow-y-auto">
           {search.length < 2 ? (
             <div className="p-3 text-sm text-gray-500 text-center">Type at least 2 characters...</div>
           ) : results.length === 0 && !loading ? (
             <div className="p-3 text-sm text-gray-500 text-center">No stock found</div>
           ) : (
             results.map(d => (
               <div 
                 key={d.id} 
                 className="p-2 hover:bg-blue-50 cursor-pointer text-sm border-b last:border-b-0"
                 onMouseDown={(e) => {
                   e.preventDefault(); // Prevent onBlur before click registers
                   onSelect(d)
                   setSearch('')
                   setOpen(false)
                 }}
               >
                 <div className="font-medium">{d.drugName}</div>
                 <div className="text-xs text-gray-500">Stock: {d.quantityInStock} | Rate: ₹{d.sellingPrice}</div>
               </div>
             ))
           )}
         </div>
      )}
    </div>
  )
}
