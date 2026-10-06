import { useState, useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { purchaseApi } from '@/api/purchaseApi'
import { showApiError } from '@/lib/apiRequest'
import { formatMoney, formatDateTime, localYmd } from '@/lib/format'
import { STOCK_STATUS } from './requestMeta'

// One item's stock: how much is on the shelf, in which batches (soonest expiry
// first — the one to use next), and every movement in and out, newest first,
// with the balance after each. Money (cost, value) only for those who see it;
// the server leaves it out for the store.

const MOVE = {
  receipt:        { label: 'Received',          cls: 'text-green-700' },
  receipt_cancel: { label: 'Receipt cancelled', cls: 'text-red-700' },
  issue:          { label: 'Issued',            cls: 'text-blue-700' },
  issue_cancel:   { label: 'Issue cancelled',   cls: 'text-red-700' },
  return:         { label: 'Returned to vendor', cls: 'text-purple-700' },
  return_cancel:  { label: 'Return cancelled',  cls: 'text-red-700' },
  adjustment:     { label: 'Adjusted',          cls: 'text-amber-700' },
}

export default function StockItemDialog({ id, open, onOpenChange, onOpenReceipt }) {
  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(false)

  // Held in a ref so a parent's refresh (a new inline arrow) does not re-read the item.
  const close = useRef(onOpenChange)
  close.current = onOpenChange
  useEffect(() => {
    if (!open || !id) return
    let live = true
    setLoading(true)
    purchaseApi.getStockItem(id)
      .then((r) => { if (live) setItem(r.data) })
      .catch((err) => { showApiError(err, 'Could not open the item'); close.current(false) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [open, id])

  const unit = item?.stockUnit?.code || ''
  const money = item && item.value !== undefined
  const status = item && (STOCK_STATUS[item.status] || STOCK_STATUS.none)
  const soon = localYmd(new Date(), 60)
  const today = localYmd()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        {loading || !item ? (
          <div className="flex items-center justify-center py-16"><DialogTitle className="sr-only">Loading</DialogTitle><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2 pr-6">
                <DialogTitle>{item.name}</DialogTitle>
                <Badge variant="outline" className={status.cls}>{status.label}</Badge>
                {!item.isActive && <Badge variant="outline">Retired</Badge>}
              </div>
              <DialogDescription>{item.code} · {item.category?.name}{item.reorderLevel != null && <> · reorder at {item.reorderLevel} {unit}</>}</DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div className="flex flex-wrap gap-x-10 gap-y-2">
                <div><div className="text-xs text-gray-500">On hand</div><div className="text-3xl font-bold tabular-nums">{item.onHand} <span className="text-base font-medium text-gray-500">{unit}</span></div></div>
                {money && <div><div className="text-xs text-gray-500">Value, before GST</div><div className="text-3xl font-bold tabular-nums">{formatMoney(item.value)}</div></div>}
                {item.conversions?.length > 0 && (
                  <div className="self-end text-sm text-gray-500">{item.conversions.map((c) => `1 ${c.unit.code} = ${c.factor} ${unit}`).join(' · ')}</div>
                )}
              </div>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Batches</h3>
                {item.batches.length === 0 ? (
                  <p className="rounded-md border border-dashed py-6 text-center text-sm text-gray-500">Nothing received yet</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="text-left font-medium px-3 py-2">Batch</th>
                          <th className="text-left font-medium px-3 py-2">Expiry</th>
                          <th className="text-left font-medium px-3 py-2">Received</th>
                          <th className="text-right font-medium px-3 py-2">Left of</th>
                          {money && <th className="text-right font-medium px-3 py-2">Cost / {unit}</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {item.batches.map((b) => {
                          const exp = b.expiryDate ? String(b.expiryDate).slice(0, 10) : null
                          return (
                            <tr key={b.id} className={b.quantity <= 0 ? 'text-gray-400' : undefined}>
                              <td className="px-3 py-2">{b.batchNumber || '—'}</td>
                              <td className={`px-3 py-2 ${b.quantity > 0 && exp && exp < today ? 'text-red-700 font-medium' : b.quantity > 0 && exp && exp <= soon ? 'text-amber-700 font-medium' : ''}`}>
                                {exp ? formatDateTime(b.expiryDate, { withTime: false }) : '—'}
                              </td>
                              <td className="px-3 py-2">
                                {formatDateTime(b.receivedAt, { withTime: false })}
                                {b.receipt && (onOpenReceipt
                                  ? <> · <button type="button" className="font-mono text-blue-700 hover:underline" onClick={() => onOpenReceipt(b.receipt.id)}>{b.receipt.number}</button></>
                                  : <span className="font-mono"> · {b.receipt.number}</span>)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums"><b>{b.quantity}</b> / {b.receivedQty}</td>
                              {money && <td className="px-3 py-2 text-right tabular-nums">{formatMoney(b.unitCost)}</td>}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Stock ledger <span className="font-normal text-gray-500">— every movement, newest first</span></h3>
                {item.movements.length === 0 ? (
                  <p className="rounded-md border border-dashed py-6 text-center text-sm text-gray-500">No movements yet</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border max-h-80">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="text-left font-medium px-3 py-2">When</th>
                          <th className="text-left font-medium px-3 py-2">What</th>
                          <th className="text-right font-medium px-3 py-2">In / out</th>
                          <th className="text-right font-medium px-3 py-2">Balance</th>
                          <th className="text-left font-medium px-3 py-2">By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {item.movements.map((m) => {
                          const t = MOVE[m.type] || { label: m.type, cls: '' }
                          return (
                            <tr key={m.id}>
                              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                              <td className="px-3 py-2">
                                <span className={`font-medium ${t.cls}`}>{t.label}</span>
                                {m.reference && (onOpenReceipt && m.referenceId && m.type.startsWith('receipt')
                                  ? <> · <button type="button" className="font-mono text-blue-700 hover:underline" onClick={() => onOpenReceipt(m.referenceId)}>{m.reference}</button></>
                                  : <span className="font-mono"> · {m.reference}</span>)}
                                {m.note && <div className="text-xs text-gray-500">{m.note}</div>}
                              </td>
                              <td className={`px-3 py-2 text-right font-semibold tabular-nums ${m.quantity < 0 ? 'text-red-700' : 'text-green-700'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{m.balanceAfter}</td>
                              <td className="px-3 py-2 text-gray-600">{m.createdByName || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
