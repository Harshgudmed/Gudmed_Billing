import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { Bell, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { notificationApi } from '@/api/notificationApi'
import { showApiError } from '@/lib/apiRequest'
import { useLiveData } from '@/lib/useLiveData'
import { cn } from '@/lib/utils'

// The bell: this person's notifications, live.
//
// The server writes a notification and pushes "notifications changed" on the
// hospital's socket (backend lib/notify.js); this re-reads the inbox through
// the person's own login, so the push itself carries nothing. Anything new
// since the last read pops up as a toast with "Open", and the bell keeps the
// unread count.
//
// One <InboxProvider> holds the inbox for the page, so the bell can sit in two
// places (the desktop top bar and the phone's) without reading it twice or
// toasting twice. Opening a notification marks it read and goes to the
// document it is about.

const InboxContext = createContext(null)

// Where a notification's document opens. `base` is the role's root ("/store_keeper").
const PATHS = {
  'purchase.request': (base, id) => `${base}/purchase?open=request:${id}`,
  'purchase.order':   (base, id) => `${base}/purchase?open=order:${id}`,
  'purchase.receipt': (base, id) => `${base}/purchase?open=receipt:${id}`,
  'purchase.bill':    (base, id) => `${base}/purchase?open=bill:${id}`,
  'purchase.indent':  (base, id) => `${base}/purchase?open=indent:${id}`,
  'purchase.issue':   (base, id) => `${base}/purchase?open=issue:${id}`,
  'purchase.return':  (base, id) => `${base}/purchase?open=return:${id}`,
  'purchase.rfq':     (base, id) => `${base}/purchase?open=rfq:${id}`,
  'purchase.payment': (base, id) => `${base}/purchase?open=payment:${id}`,
  // A department's own indent opens on its Store Indent screen.
  'store.indent':     (base, id) => `${base}/store-indent?open=${id}`,
}

export function InboxProvider({ base, children }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  // The last read failed: the bell shows what it last had and says so; the
  // next poll or push tries again and clears it.
  const [loadFailed, setLoadFailed] = useState(false)
  const seen = useRef(null) // ids already shown; null until the first read
  const loadRef = useRef(null) // `load`, for openOne (declared after it)

  const openOne = useCallback(async (n) => {
    if (!n.isRead) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)))
      setUnread((u) => Math.max(0, u - 1))
      notificationApi.markRead([n.id]).catch((err) => {
        // Not marked on the server: put it back as unread (it would only have
        // come back on the next reload), say so, and re-read the real count.
        setItems((list) => list.map((x) => (x.id === n.id ? { ...x, isRead: false } : x)))
        setUnread((u) => u + 1)
        showApiError(err, 'Could not mark the notification as read — it is still unread')
        loadRef.current?.()
      })
    }
    const to = PATHS[n.entityType]?.(base, n.entityId)
    if (to) navigate(to)
  }, [base, navigate])

  const load = useCallback(async () => {
    try {
      const r = await notificationApi.inbox()
      const list = r?.data ?? []
      // Toast what arrived since the last read — not the backlog on first load.
      if (seen.current) {
        const fresh = list.filter((n) => !n.isRead && !seen.current.has(n.id)).reverse()
        for (const n of fresh.slice(-3)) {
          toast(n.title, { description: n.message, duration: 8000, action: PATHS[n.entityType] ? { label: 'Open', onClick: () => openOne(n) } : undefined })
        }
      }
      seen.current = new Set(list.map((n) => n.id))
      setItems(list)
      setUnread(r?.unread ?? 0)
      setLoadFailed(false)
    } catch {
      // Offline or the server did not answer: keep the last list, and the bell
      // says "Could not refresh" until a read works again (a toast on every
      // poll would bury the screen).
      setLoadFailed(true)
    }
  }, [openOne])
  loadRef.current = load

  useEffect(() => { load() }, [load])
  useLiveData('notifications', load, { fallbackMs: 120000 })

  const markAll = useCallback(async () => {
    const before = { items, unread }
    setItems((list) => list.map((x) => ({ ...x, isRead: true })))
    setUnread(0)
    try { await notificationApi.markAllRead() } catch (err) {
      setItems(before.items)
      setUnread(before.unread)
      showApiError(err, 'Could not mark the notifications as read — they are still unread')
      load()
    }
  }, [items, unread, load])

  const value = useMemo(() => ({ items, unread, loadFailed, retry: load, openOne, markAll }), [items, unread, loadFailed, load, openOne, markAll])
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}

/** The bell button and its list. `dark` for a coloured bar (the phone's top bar in the hospital colour). */
export function NotificationBell({ dark = false, className, side = 'bottom', align = 'end' }) {
  const inbox = useContext(InboxContext)
  const [open, setOpen] = useState(false)
  if (!inbox) return null
  const { items, unread, loadFailed, retry, openOne, markAll } = inbox

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          className={cn('relative flex items-center gap-2 rounded-md p-1.5 text-sm font-medium transition-colors',
            dark ? 'text-white/85 hover:bg-white/10 hover:text-white' : 'text-gray-600 hover:bg-gray-100', className)}>
          <span className="relative">
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white tabular-nums">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="text-sm font-semibold">Notifications{unread > 0 && <span className="ml-1 font-normal text-gray-500">· {unread} new</span>}</div>
          {unread > 0 && (
            <button type="button" onClick={markAll} className="flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
              <CheckCheck className="h-3.5 w-3.5" />Mark all read
            </button>
          )}
        </div>
        {loadFailed && (
          <p role="status" className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
            {items.length ? 'Could not refresh — showing what was last loaded.' : 'Could not load your notifications.'} It retries on its own.
            <button type="button" onClick={retry} className="ml-1 font-medium underline underline-offset-2">Try now</button>
          </p>
        )}
        {items.length === 0 ? (
          !loadFailed && <p className="px-4 py-10 text-center text-sm text-gray-500">Nothing yet. Approvals, deliveries and anything that needs you will show here.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => { setOpen(false); openOne(n) }}
                  className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-gray-50', !n.isRead && 'bg-blue-50/50')}>
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : n.priority === 'high' ? 'bg-red-500' : 'bg-blue-500')} />
                  <span className="min-w-0">
                    <span className={cn('block text-sm leading-snug', !n.isRead && 'font-semibold')}>{n.title}</span>
                    {n.message && <span className="mt-0.5 block text-xs text-gray-600">{n.message}</span>}
                    <span className="mt-1 block text-[11px] text-gray-400">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
