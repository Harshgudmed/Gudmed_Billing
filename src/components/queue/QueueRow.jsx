import { memo } from 'react'
import { Clock, CheckCircle, DoorOpen, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge } from '@/components/common/StatusBadge'
import { getFullName } from '@/lib/patient'

// One patient's row in the queue table. Split out of QueueModule so the module's
// render tree stays shallow enough to read; all behaviour still lives with the
// module, which passes the three actions in.
//
// `updatingId` is the module-wide "which row+action is mid-flight" key. It is
// compared per action (`${entry.id}_call` etc.) rather than as one boolean, so
// pressing one row's button never disables a different row's.

function fmtWait(minutes) {
  if (minutes == null) return '—'
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// memo, because every row carries its own priority <Select> and that Select
// rebuilds all five options each time the row renders. Without this, typing one
// character into the queue search re-rendered all ten rows and produced 722
// SelectItem renders for a search box the rows do not read.
//
// This only bails out while the props stay referentially equal, so the four
// shared tables and the three handlers in QueueModule are hoisted / useCallback'd.
// A fresh object or arrow function passed here defeats the whole thing silently.
export const QueueRow = memo(function QueueRow({
  entry,
  rowNumber,
  updatingId,
  statusColors,
  priorityColors,
  priorityLevels,
  onCallNext,
  onSetStatus,
  onChangePriority,
}) {
  const patientName = entry.patient ? getFullName(entry.patient) || '—' : '—'
  const status = entry.status || 'waiting'
  const priority = entry.priority || 'normal'
  const isCompleted = ['completed', 'cancelled'].includes(status)

  return (
    <TableRow className={isCompleted ? 'opacity-50' : ''}>
      <TableCell className="font-bold text-gray-500">{rowNumber}</TableCell>

      <TableCell>
        <div className="font-medium">{patientName}</div>
        {entry.patient?.phonePrimary && (
          <div className="text-xs text-gray-400">{entry.patient.phonePrimary}</div>
        )}
      </TableCell>

      <TableCell className="font-mono text-sm">{entry.patient?.mrn || '—'}</TableCell>

      <TableCell><StatusBadge status={status} map={statusColors} /></TableCell>

      <TableCell className="text-sm text-gray-600">
        <div className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5 text-gray-400" />
          {fmtWait(entry.waitTime)}
        </div>
      </TableCell>

      {/* Priority is only editable while the patient is still in the queue —
          re-ranking someone who has already left has no meaning. */}
      <TableCell>
        {isCompleted ? (
          <StatusBadge status={priority} map={priorityColors} />
        ) : (
          <Select
            value={priority}
            onValueChange={(value) => onChangePriority(entry, value)}
            disabled={updatingId === `${entry.id}_priority`}
          >
            <SelectTrigger className={`h-7 w-[110px] px-2 py-1 border-none focus:ring-0 capitalize font-semibold text-xs ${priorityColors[priority] || 'bg-gray-100 text-gray-800'}`}>
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              {priorityLevels.map(level => (
                <SelectItem key={level} value={level} className="capitalize text-xs font-medium">
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>

      <TableCell>
        <div className="flex gap-1 flex-wrap">
          {/* The main action: this patient walks in, the one before them is
              finished, and the person behind them starts reading "You are next"
              on the wall board — one press, one server transaction. */}
          {!isCompleted && status !== 'in_progress' && (
            <Button
              size="sm"
              className="bg-[#2E4168] text-white hover:bg-[#253453]"
              disabled={updatingId === `${entry.id}_call`}
              onClick={() => onCallNext(entry)}
            >
              <DoorOpen className="h-3.5 w-3.5 mr-1" />
              Call in
            </Button>
          )}

          {/* Puts "YOU ARE NEXT — PLEASE BE READY" against this patient on the
              wall board. Nothing appears there unless this is pressed — the
              board never decides on its own that someone should stand up. */}
          {!isCompleted && status !== 'called' && status !== 'in_progress' && (
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              disabled={updatingId === `${entry.id}_called`}
              onClick={() => onSetStatus(entry, 'called', `${patientName} alerted — "You are next" is now on the display board`)}
            >
              <Bell className="h-3.5 w-3.5 mr-1" />
              Alert next
            </Button>
          )}

          {status === 'called' && (
            <Button
              size="sm"
              variant="ghost"
              className="text-gray-500"
              disabled={updatingId === `${entry.id}_waiting`}
              onClick={() => onSetStatus(entry, 'waiting', 'Alert removed from the display board')}
            >
              Undo alert
            </Button>
          )}

          {!isCompleted && (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={updatingId === `${entry.id}_completed`}
              onClick={() => onSetStatus(entry, 'completed', 'Marked as completed')}
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              Complete
            </Button>
          )}

          {isCompleted && <span className="text-xs text-gray-400 italic">Done</span>}
        </div>
      </TableCell>
    </TableRow>
  )
})
