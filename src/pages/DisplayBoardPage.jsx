import { Routes, Route } from 'react-router-dom'
import { OverviewScreen } from '@/components/wall-display/OverviewScreen'
import { FloorScreen } from '@/components/wall-display/FloorScreen'
import { RoomScreen } from '@/components/wall-display/RoomScreen'
import { FloorGridScreen } from '@/components/wall-display/FloorGridScreen'
import { ScreenBoardView } from '@/components/wall-display/ScreenBoardView'

// Wall-facing live queue display — routed at /display/*. See
// src/components/wall-display/ for the screens, shared layout, and the
// masking/idle-return/paging behaviour they share.
export default function DisplayBoardPage() {
  return (
    <Routes>
      <Route index element={<OverviewScreen />} />
      <Route path="floor/:floorId" element={<FloorScreen />} />
      <Route path="room/:roomId" element={<RoomScreen />} />
      <Route path="grid/:floorId" element={<FloorGridScreen />} />
      <Route path="screen/:screenId" element={<ScreenBoardView />} />
    </Routes>
  )
}
