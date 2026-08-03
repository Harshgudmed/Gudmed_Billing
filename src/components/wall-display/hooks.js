import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { IDLE_RETURN_MS, ACTIVITY_EVENTS } from './constants'

export function useLiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function useIdleReturn(active) {
  const navigate = useNavigate()
  const lastActivity = useRef(Date.now())

  useEffect(() => {
    if (!active) return

    // A timestamp + one slow interval, rather than clearing and re-arming a
    // timeout on every event — `mousemove` alone fires hundreds of times a
    // second, and re-arming a timer that often on a wall panel is pure waste.
    const mark = () => { lastActivity.current = Date.now() }
    for (const e of ACTIVITY_EVENTS) {
      document.addEventListener(e, mark, { passive: true })
    }

    lastActivity.current = Date.now()
    const check = setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_RETURN_MS) navigate('/display')
    }, 1000)

    return () => {
      clearInterval(check)
      for (const e of ACTIVITY_EVENTS) document.removeEventListener(e, mark)
    }
  }, [active, navigate])
}
