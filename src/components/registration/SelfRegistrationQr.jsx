import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { QrCode, Download } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import client from '@/api/client'

// The hospital's QR poster — the link a patient scans to self-register.
//
// Its own file so Settings can show it without importing the reception screen
// (and the whole registration form that comes with it). The link carries THIS
// hospital's id, so pass `orgId` when the caller already has it; otherwise the
// logged-in user's hospital is read from /settings.
export default function SelfRegistrationQr({ orgId: orgIdProp }) {
  const [fetchedOrgId, setFetchedOrgId] = useState('')
  const orgId = orgIdProp || fetchedOrgId
  const [dataUrl, setDataUrl] = useState('')
  const link = `${window.location.origin}/self-register?org=${orgId}`

  useEffect(() => {
    if (orgIdProp) return
    let live = true
    client.get('/settings').then((res) => { if (live) setFetchedOrgId(res.data?.id || '') }).catch(() => {})
    return () => { live = false }
  }, [orgIdProp])

  useEffect(() => {
    if (!orgId) return
    // High error-correction so the code still scans when printed small or if the
    // poster gets a little scuffed on a hospital wall.
    QRCode.toDataURL(link, { width: 220, margin: 2, errorCorrectionLevel: 'H' })
      .then(setDataUrl)
      .catch(() => setDataUrl(''))
  }, [link, orgId])

  const download = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `self-registration-qr-${orgId}.png`
    a.click()
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-5 sm:flex-row sm:items-center">
        <div className="shrink-0 rounded-lg border bg-white p-2">
          {dataUrl
            ? <img src={dataUrl} alt="Self-registration QR code" className="h-40 w-40" />
            : <div className="flex h-40 w-40 items-center justify-center text-slate-300"><QrCode className="h-10 w-10" /></div>}
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h3 className="flex items-center justify-center gap-2 text-base font-semibold text-slate-800 sm:justify-start">
            <QrCode className="h-4 w-4 text-blue-600" /> Patient self-registration QR
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Print this and put it at the entrance. Patients scan it to fill their own
            details before the counter — reception just finds and confirms them.
          </p>
          <p className="mt-2 break-all rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">{link}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={download} disabled={!dataUrl}>
            <Download className="mr-1.5 h-4 w-4" /> Download QR
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
