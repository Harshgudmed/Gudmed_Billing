import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import client from '@/api/client'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { GridBoard } from './GridBoard'
import { DEFAULT_MAX_VISIBLE } from './constants'

// ── OPD wall grid: the EXACT rooms an admin assigned to ONE screen ──────────
// Settings → TV Boards → drag rooms onto a screen, then open this URL on that
// screen's actual TV. Unlike FloorGridScreen's even split, this always shows
// the same physical rooms — the point being "the screen on the north wall
// only ever shows north rooms," whatever doctors happen to be in them today.
//   /display/screen/:screenId
export function ScreenBoardView() {
  const { screenId } = useParams()
  const [data, setData] = useState(null)

  const load = useCallback(async () => {
    const res = await client.get('/display/screen-queue', { params: { screenId } })
    setData(res.data)
  }, [screenId])

  // Live push (with a slow polling fallback) instead of a 3s poll — see useLiveRefresh.
  useLiveRefresh(load)

  // When this board was reached from the self-pairing page (/display/auto), a
  // deviceId rides along in the URL. Keep sending heartbeats so Screen Health
  // still shows this TV as online while it displays the board.
  //
  // The heartbeat's reply also carries the device's CURRENT assignment, which
  // is the only way a board can notice an admin re-assigning it: the screenId
  // it renders comes from its own URL, so nothing else would ever tell this TV
  // to move. On a change we send it to the new screen (or back to pairing if
  // it was unpaired), replacing history so the TV can't navigate back.
  useEffect(() => {
    const deviceId = new URLSearchParams(window.location.search).get('deviceId')
    if (!deviceId) return
    const beat = () => client
      .post(`/display/devices/${deviceId}/heartbeat`, { appVersion: '1.0.0' })
      .then((res) => {
        if (res?.status === 'unpaired' || !res?.screenId) {
          if (res?.status === 'unpaired') window.location.replace(`/display/auto?deviceId=${encodeURIComponent(deviceId)}`)
          return
        }
        if (res.screenId !== screenId) {
          window.location.replace(`/display/screen/${res.screenId}?deviceId=${encodeURIComponent(deviceId)}`)
        }
      })
      .catch(() => {})
    beat()
    const id = setInterval(beat, 15_000)
    return () => clearInterval(id)
  }, [screenId])

  return (
    <GridBoard
      resetKey={screenId}
      headerTitle={data?.screen?.name || 'Display Screen'}
      columns={data?.columns || []}
      maxVisible={data?.screen?.maxDoctors || DEFAULT_MAX_VISIBLE}
      slideMs={(data?.screen?.sliderSpeedSeconds || 30) * 1000}
      tickerText={data?.screen?.announcementText}
    />
  )
}
