import { useState, useEffect } from 'react'
import { getOrgSettings } from '@/lib/orgSettings'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableCell, TableRow } from '@/components/ui/table'
import { FileText, Plus, Search, Printer, Edit, Trash2, FileCheck, Loader2, Filter, X } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import client from '@/api/client'
import { useServerPagination } from '@/lib/useServerPagination'
import { PaginatedTable } from '@/components/common/PaginatedTable'
import DeathCertificateForm from './DeathCertificateForm'
import { getFullName } from "@/lib/patient";

const ITEMS_PER_PAGE = 10

export default function DeathCertificateModule() {
  const [view, setView] = useState('list')
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', phone: '', email: '' })
  const [selectedCertId, setSelectedCertId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [placeFilter, setPlaceFilter] = useState('all')

  // Server-side pagination: the DB slices and returns one page, plus a `summary`
  // block with the counts across the WHOLE filtered set for the stat cards.
  const certificatesPagination = useServerPagination('/death-certificates', {
    perPage: ITEMS_PER_PAGE,
    params: { search: searchQuery, place: placeFilter },
  })
  const certificates = certificatesPagination.rows
  const stats = certificatesPagination.summary || { total: 0, issued: 0, pendingIssuance: 0, maternal: 0 }

  useEffect(() => { getOrgSettings().then(setOrgInfo) }, [])

  function handlePrint(id) {
    const cert = certificates.find(c => c.id === id)
    if (!cert) return
    const win = window.open('', '_blank', 'width=900,height=750')
    if (!win) return
    const dod = format(new Date(cert.dateOfDeath), 'dd MMMM yyyy')
    const certDate = format(new Date(cert.certificationDate), 'dd MMMM yyyy')
    const patientName = getFullName(cert.patient) || 'Unknown'
    const age = [
      cert.ageAtDeathYears && `${cert.ageAtDeathYears} years`,
      cert.ageAtDeathMonths && `${cert.ageAtDeathMonths} months`,
      cert.ageAtDeathDays && `${cert.ageAtDeathDays} days`,
    ].filter(Boolean).join(', ') || '—'
    const html = `<!DOCTYPE html><html><head><title>Death Certificate ${cert.certificateNumber}</title>
      <style>body{font-family:'Times New Roman',serif;margin:30px;color:#000;}
      .border-box{border:3px double #000;padding:20px;}.header{text-align:center;margin-bottom:20px;}
      h1{font-size:22px;margin:0;}h2{font-size:16px;margin:4px 0;}.sub{font-size:13px;color:#444;}
      .cert-num{font-size:13px;text-align:right;margin-bottom:10px;}.section{margin:12px 0;}
      .section-title{font-weight:bold;font-size:13px;border-bottom:1px solid #000;margin-bottom:6px;padding-bottom:2px;text-transform:uppercase;}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}.field{margin-bottom:6px;}
      .label{font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;}
      .value{font-size:13px;border-bottom:1px dotted #999;padding-bottom:2px;}
      .cause{font-size:13px;margin:4px 0;}
      .sig-box{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:30px;}
      .sig-line{border-top:1px solid #000;padding-top:4px;font-size:11px;}
      .footer{text-align:center;font-size:10px;color:#888;margin-top:20px;}
      @media print{body{margin:10px;}}</style>
      </head><body>
      <div class="border-box">
      <div class="cert-num">Certificate No: <strong>${cert.certificateNumber}</strong></div>
      <div class="header"><h1>CERTIFICATE OF DEATH</h1><h2>${orgInfo.name}</h2><div class="sub">Official Medical Death Certificate</div></div>
      <div class="section"><div class="section-title">Deceased Information</div>
      <div class="grid">
        <div class="field"><div class="label">Full Name</div><div class="value">${patientName}</div></div>
        <div class="field"><div class="label">Sex</div><div class="value">${cert.sex}</div></div>
        <div class="field"><div class="label">Age at Death</div><div class="value">${age}</div></div>
        <div class="field"><div class="label">Marital Status</div><div class="value">${cert.maritalStatus || '—'}</div></div>
        <div class="field"><div class="label">Occupation</div><div class="value">${cert.occupation || '—'}</div></div>
        <div class="field"><div class="label">Address</div><div class="value">${cert.address || '—'}</div></div>
      </div></div>
      <div class="section"><div class="section-title">Death Information</div>
      <div class="grid">
        <div class="field"><div class="label">Date of Death</div><div class="value">${dod}</div></div>
        <div class="field"><div class="label">Time of Death</div><div class="value">${cert.timeOfDeath || '—'}</div></div>
        <div class="field"><div class="label">Place of Death</div><div class="value">${cert.placeOfDeath}</div></div>
        <div class="field"><div class="label">Manner of Death</div><div class="value">${cert.mannerOfDeath}</div></div>
      </div></div>
      <div class="section"><div class="section-title">Cause of Death</div>
      <div class="cause"><strong>I(a) Immediate Cause:</strong> ${cert.immediateCause}</div>
      ${cert.antecedentCauseB ? `<div class="cause"><strong>I(b):</strong> ${cert.antecedentCauseB}</div>` : ''}
      ${cert.otherConditions ? `<div class="cause"><strong>II. Other conditions:</strong> ${cert.otherConditions}</div>` : ''}
      </div>
      <div class="sig-box">
        <div><div style="height:40px;"></div>
        <div class="sig-line">Certifying Physician<br/>${cert.certifiedBy?.fullName || '—'}<br/>${cert.certifierQualification || ''}</div></div>
        <div><div style="height:40px;"></div><div class="sig-line">Date of Certification<br/>${certDate}</div></div>
      </div>
      </div>
      <div class="footer">This is an official medical death certificate issued by ${orgInfo.name}</div>
      </body></html>`
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 500)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this certificate?')) return
    try {
      const res = await client.delete(`/death-certificates?id=${id}`)
      if (res.success) { toast.success('Certificate deleted'); certificatesPagination.refresh() }
      else toast.error(res.error || 'Failed to delete')
    } catch { toast.error('Failed to delete') }
  }

  function handleCreateSuccess() {
    setView('list')
    certificatesPagination.refresh()
  }

  if (certificatesPagination.loading && certificates.length === 0) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-[#2E4168]" /></div>
  }

  if (view === 'create') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setView('list')}><X className="h-4 w-4 mr-1" /> Back to Directory</Button>
          <h2 className="text-2xl font-bold">New Death Certificate</h2>
        </div>
        <DeathCertificateForm onSuccess={handleCreateSuccess} />
      </div>
    )
  }

  if (view === 'edit' && selectedCertId) {
    const cert = certificates.find(c => c.id === selectedCertId)
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setView('list')}><X className="h-4 w-4 mr-1" /> Back to Directory</Button>
          <h2 className="text-2xl font-bold">Edit Certificate: {cert?.certificateNumber}</h2>
        </div>
        <DeathCertificateForm initialData={cert} onSuccess={handleCreateSuccess} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="h-8 w-8 text-blue-600" />
            Death Certificates
          </h1>
          <p className="text-gray-500">Official death record management and certification</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setView('create')}>
          <Plus className="mr-2 h-4 w-4" /> New Certificate
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Total Registered</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card className="border-l-4 border-l-green-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Issued to Family</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.issued}</div></CardContent></Card>
        <Card className="border-l-4 border-l-orange-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Pending Issuance</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.pendingIssuance}</div></CardContent></Card>
        <Card className="border-l-4 border-l-purple-500"><CardHeader className="py-4"><CardTitle className="text-sm font-medium text-gray-500">Maternal Deaths</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.maternal}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle>Certificate Directory</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full md:w-64">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input placeholder="Search #, Name, UHID..." className="pl-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
              <Select value={placeFilter} onValueChange={setPlaceFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Place of Death" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  <SelectItem value="inpatient">Inpatient</SelectItem>
                  <SelectItem value="emergency">Emergency Room</SelectItem>
                  <SelectItem value="doa">DOA</SelectItem>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PaginatedTable
            pagination={certificatesPagination}
            empty="No death certificates found matching your criteria."
            columns={[
              { header: 'Certificate #' },
              { header: 'Patient Name' },
              { header: 'UHID' },
              { header: 'Date of Death' },
              { header: 'Manner' },
              { header: 'Status' },
              { header: 'Actions', className: 'text-right' },
            ]}
            renderRow={(cert) => (
              <TableRow key={cert.id}>
                <TableCell className="font-mono font-medium">{cert.certificateNumber}</TableCell>
                <TableCell>{cert.patient ? getFullName(cert.patient) : 'N/A'}</TableCell>
                <TableCell>{cert.patient?.mrn || 'N/A'}</TableCell>
                <TableCell>{format(new Date(cert.dateOfDeath), 'dd MMM yyyy')}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{cert.mannerOfDeath}</Badge></TableCell>
                <TableCell>
                  {cert.issuedAt ? (
                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100 flex items-center gap-1 w-fit">
                      <FileCheck className="h-3 w-3" /> Issued
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-orange-100 text-orange-700 hover:bg-orange-100 w-fit">Draft/Pending</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => { setSelectedCertId(cert.id); setView('edit') }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handlePrint(cert.id)}>
                      <Printer className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(cert.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
