import { useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import client from '@/api/client'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { GridBoard } from './GridBoard'

// ── OPD wall grid: one FLOOR, every open room a COLUMN ──────────────────────
// The board the client sketched. Meant to run full-screen on a waiting-room TV.
//   /display/grid/:floorId                    — whole floor (one screen / video wall)
//   /display/grid/:floorId?screen=2&screens=4 — this TV's slice of the floor,
//                                                evenly divided (no admin setup)
export function FloorGridScreen() {
  const { floorId } = useParams()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState(null)
  const screen = searchParams.get('screen') || ''
  const screens = searchParams.get('screens') || ''

  const load = useCallback(async () => {
    const res = await client.get('/display/floor-queue', { params: { floorId, screen, screens } })
    setData(res.data)
  }, [floorId, screen, screens])

  // Live push (with a slow polling fallback) instead of a 3s poll — see useLiveRefresh.
  useLiveRefresh(load)

  return (
    <GridBoard
      resetKey={floorId}
      headerTitle={data?.floor?.name || 'Floor'}
      headerSubtitle={data?.screens > 1 ? `Screen ${data.screen}/${data.screens}` : ''}
      columns={data?.columns || []}
      horizontalScroll={!screens}
    />
  )
}
