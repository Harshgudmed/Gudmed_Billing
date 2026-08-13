import { format } from 'date-fns';
import { drName } from '@/lib/utils';
import { printLabReport } from '../../laboratory/printLabReport';
import { formatMoney as fmtMoney } from '@/lib/format';
import { escapeHtml } from '@/lib/printTemplate';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw, Users, CalendarDays, Microscope, ScanLine, BedDouble, FileText, IndianRupee, Clock, XCircle, FlaskConical, Scan, AlertCircle, Printer, Eye, Edit } from 'lucide-react';
import { getFullName, calculateAge, initials } from '../utils/patientUtils';
import { toast } from 'sonner';

// The strip was a 6-column grid, so every tab got the same 115px whatever its
// label — and "Lab / Pathology" plus its icon and count needs ~160px at any font
// size. Combined with TabsTrigger's own `whitespace-nowrap`, the label could
// neither shrink nor wrap, so it overflowed its cell and printed on top of the
// tab beside it. The strip now wraps and each tab takes the width it needs, which
// fits on one row here and drops to a second row on a narrow screen instead of
// colliding. `shrink-0` keeps the icon and the count whole either way.
// `grow` and NOT `flex-1`: flex-1 sets the basis to 0, which makes all six tabs
// equal again and puts the long label straight back into the collision. grow
// leaves the basis at the label's own width and only shares out the LEFTOVER
// space, so the strip fills the dialog without squeezing anything.
const TAB_TRIGGER = 'flex grow items-center justify-center gap-1 px-2 py-2 data-[state=active]:shadow-sm';
const TAB_ICON = 'h-4 w-4 shrink-0';
const TAB_COUNT = 'ml-0.5 shrink-0 border-0 px-1.5 py-0 text-[10px]';

export default function PatientProfile({
  selectedPatient,
  showViewDialog,
  setShowViewDialog,
  records,
  recordsLoading,
  fetchRecords,
  viewTab,
  setViewTab,
  cancelAppointment,
  cancellingId,
  openEdit,
  orgInfo
}) {
  const handlePrintLabReport = (order) => {
    const results = order.results || [];
    
    // We need to shape `order` to have the necessary patient fields since the new util expects it.
    const p = selectedPatient;
    const enrichedOrder = {
      ...order,
      patientMrn: p.mrn,
      patientName: getFullName(p),
      patientAge: p.dateOfBirth ? calculateAge(p.dateOfBirth) : '',
      patientGender: p.gender || ''
    };
    
    printLabReport(enrichedOrder, results, orgInfo, drName);
  };

  const handlePrintRadReport = (order) => {
    const p = selectedPatient;
    if (!p) return;
    const win = window.open('', '_blank', 'width=900,height=780');
    if (!win) { toast.error('Please allow pop-ups to open the report'); return; }
    // All interpolated values are HTML-escaped — patient, exam and report fields
    // are user-controlled and would otherwise allow stored XSS to fire on print.
    const name = escapeHtml(getFullName(p));
    const mrn = escapeHtml(p.mrn);
    const age = escapeHtml(p.dateOfBirth ? `${calculateAge(p.dateOfBirth)} yrs` : '—');
    const gender = escapeHtml(p.gender ? p.gender.charAt(0).toUpperCase() + p.gender.slice(1) : '—');
    const orgName = escapeHtml(orgInfo.name || 'Hospital');
    const examName = escapeHtml(order.exam?.examName || '—');
    const modality = escapeHtml(order.exam?.modality || '—');
    const bodyPart = escapeHtml(order.exam?.bodyPart || '—');
    const statusText = escapeHtml((order.status || '').replace(/_/g, ' '));
    const clinicalIndication = order.clinicalIndication ? escapeHtml(order.clinicalIndication) : '';
    const printDate = format(new Date(), 'dd MMM yyyy HH:mm');
    const orderDate = format(new Date(order.createdAt), 'dd MMM yyyy HH:mm');
    const rep = order.report;
    const repCritical = rep?.criticalFindings ? escapeHtml(rep.criticalFindings) : '';
    const repTechnique = rep?.technique ? escapeHtml(rep.technique) : '';
    const repFindings = escapeHtml(rep?.findings || 'Report pending.');
    const repImpression = rep?.impression ? escapeHtml(rep.impression) : '';
    const repRecommendations = rep?.recommendations ? escapeHtml(rep.recommendations) : '';
    const orgAddr = escapeHtml([orgInfo.address, orgInfo.city].filter(Boolean).join(', '));

    win.document.write(`<!DOCTYPE html><html><head><title>Radiology Report — ${examName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#000;background:#fff}
.page{max-width:210mm;margin:0 auto;padding:12mm 14mm}
.hosp-header{display:flex;justify-content:space-between;border-bottom:3px solid #4338ca;padding-bottom:10px;margin-bottom:10px}
.hosp-name{font-size:19pt;font-weight:bold;color:#4338ca}
.hosp-sub{font-size:9pt;color:#555;margin-top:2px}
.hosp-contact{font-size:8.5pt;color:#555;text-align:right;line-height:1.6}
.report-banner{background:#4338ca;color:#fff;text-align:center;padding:5px 0;font-size:13pt;font-weight:bold;letter-spacing:3px;margin-bottom:10px}
.info-box{border:1px solid #333;margin-bottom:12px}
.info-box-hdr{background:#4338ca;color:#fff;padding:3px 10px;font-size:9pt;font-weight:bold;text-transform:uppercase}
.info-grid{display:grid;grid-template-columns:repeat(4,1fr)}
.info-cell{padding:5px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
.info-cell:last-child{border-right:none}
.info-label{font-size:7.5pt;color:#555;font-weight:bold;text-transform:uppercase}
.info-value{font-size:10pt;margin-top:1px}
.section-title{font-size:10pt;font-weight:bold;color:#4338ca;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #4338ca;padding-bottom:2px;margin:12px 0 5px}
.section-body{font-size:10.5pt;line-height:1.6;white-space:pre-wrap}
.critical-note{background:#fef2f2;border:1px solid #dc2626;padding:8px 12px;margin:10px 0;font-size:9.5pt;color:#991b1b;border-radius:3px}
.footer{margin-top:16px;border-top:1px solid #ccc;padding-top:5px;font-size:8pt;color:#888;text-align:center}
.print-btn{display:block;margin:16px auto 0;background:#4338ca;color:#fff;border:none;padding:9px 28px;font-size:13px;font-weight:600;border-radius:6px;cursor:pointer}
@media print{.print-btn{display:none}body{padding:0}.page{padding:8mm}}
</style></head><body>
<div class="page">
  <div class="hosp-header">
    <div>
      <div class="hosp-name">${orgName}</div>
      <div class="hosp-sub">Department of Radiology &amp; Imaging</div>
      <div class="hosp-sub">${orgAddr}</div>
    </div>
    <div class="hosp-contact">Printed: ${printDate}</div>
  </div>
  <div class="report-banner">RADIOLOGY REPORT</div>
  <div class="info-box">
    <div class="info-box-hdr">Patient &amp; Exam Information</div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-label">Patient Name</div><div class="info-value"><strong>${name}</strong></div></div>
      <div class="info-cell"><div class="info-label">UHID</div><div class="info-value">${mrn}</div></div>
      <div class="info-cell"><div class="info-label">Age / Sex</div><div class="info-value">${age} / ${gender}</div></div>
      <div class="info-cell"><div class="info-label">Exam Date</div><div class="info-value">${orderDate}</div></div>
      <div class="info-cell"><div class="info-label">Examination</div><div class="info-value"><strong>${examName}</strong></div></div>
      <div class="info-cell"><div class="info-label">Modality</div><div class="info-value">${modality}</div></div>
      <div class="info-cell"><div class="info-label">Body Part</div><div class="info-value">${bodyPart}</div></div>
      <div class="info-cell"><div class="info-label">Status</div><div class="info-value" style="text-transform:capitalize">${statusText}</div></div>
    </div>
  </div>
  ${clinicalIndication ? `<div class="section-title">Clinical Indication</div><div class="section-body">${clinicalIndication}</div>` : ''}
  ${rep?.hasCriticalFindings ? `<div class="critical-note">⚠ CRITICAL FINDINGS: ${repCritical || 'Requires immediate attention'}</div>` : ''}
  ${rep?.technique ? `<div class="section-title">Technique</div><div class="section-body">${repTechnique}</div>` : ''}
  <div class="section-title">Findings</div><div class="section-body">${repFindings}</div>
  ${rep?.impression ? `<div class="section-title">Impression</div><div class="section-body"><strong>${repImpression}</strong></div>` : ''}
  ${rep?.recommendations ? `<div class="section-title">Recommendations</div><div class="section-body">${repRecommendations}</div>` : ''}
  <div class="footer">${orgName} — Department of Radiology &nbsp;|&nbsp; Confidential &nbsp;|&nbsp; Printed: ${printDate}</div>
  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</div>
</body></html>`);
    win.document.close();
  };

  const now = new Date();
  const isUpcoming = (a) => new Date(a.appointmentDate) >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
    && !['cancelled', 'completed', 'no_show'].includes(a.status);
  const upcoming = records.appointments.filter(isUpcoming);
  const history = records.appointments.filter(a => !isUpcoming(a));
  const b = records.billing || { totalBilled: 0, totalPaid: 0, balanceDue: 0 };
  const statusColor = {
    scheduled: 'bg-blue-100 text-blue-700', confirmed: 'bg-indigo-100 text-indigo-700',
    checked_in: 'bg-cyan-100 text-cyan-700', in_progress: 'bg-amber-100 text-amber-700',
    completed: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700',
    no_show: 'bg-gray-200 text-gray-600', rescheduled: 'bg-purple-100 text-purple-700',
  };

  const ApptRow = ({ a, cancellable }) => (
    <div key={a.id} className="rounded-lg border p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{format(new Date(a.appointmentDate), 'dd MMM yyyy')}{a.appointmentTime ? `, ${a.appointmentTime}` : ''}</span>
          <Badge className={`border-0 capitalize ${statusColor[a.status] || 'bg-gray-100 text-gray-700'}`}>{a.status?.replace(/_/g, ' ')}</Badge>
          <Badge className="bg-gray-100 text-gray-600 border-0 capitalize">{a.appointmentType?.replace(/_/g, ' ')}</Badge>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {a.doctor?.fullName ? drName(a.doctor.fullName) : 'Doctor —'}{a.department?.name ? ` · ${a.department.name}` : ''}
          {a.consultationFee != null ? ` · Fee ${fmtMoney(a.consultationFee)}` : ''}
        </p>
      </div>
      {cancellable && (
        <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700 shrink-0"
          onClick={() => cancelAppointment(a)} disabled={cancellingId === a.id}>
          {cancellingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><XCircle className="h-3.5 w-3.5 mr-1" />Cancel</>}
        </Button>
      )}
    </div>
  );

  return (
    <Dialog open={showViewDialog} onOpenChange={setShowViewDialog}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Patient Details</DialogTitle>
        </DialogHeader>
        {selectedPatient && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xl font-bold">
                {initials(getFullName(selectedPatient))}
              </div>
              <div className="flex-1">
                <p className="text-lg font-bold">{getFullName(selectedPatient)}</p>
                <p className="text-sm text-gray-500">UHID: {selectedPatient.mrn}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => fetchRecords(selectedPatient.id)}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
              </Button>
            </div>

            <Tabs value={viewTab} onValueChange={setViewTab}>
              <TabsList className="flex w-full flex-wrap items-center justify-start h-auto gap-1 p-1 bg-gray-100">
                <TabsTrigger value="overview" className={`${TAB_TRIGGER} data-[state=active]:text-blue-700`}>
                  <Users className={TAB_ICON} />
                  <span>Patient Details</span>
                </TabsTrigger>
                <TabsTrigger value="appointments" className={`${TAB_TRIGGER} data-[state=active]:text-green-700`}>
                  <CalendarDays className={TAB_ICON} />
                  <span>Appointments</span>
                  {records.appointments.length > 0 && (
                    <Badge className={`${TAB_COUNT} bg-green-100 text-green-700`}>{records.appointments.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="lab" className={`${TAB_TRIGGER} data-[state=active]:text-teal-700`}>
                  <Microscope className={TAB_ICON} />
                  <span>Lab / Pathology</span>
                  {records.labOrders.length > 0 && (
                    <Badge className={`${TAB_COUNT} bg-cyan-100 text-cyan-700`}>{records.labOrders.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="radiology" className={`${TAB_TRIGGER} data-[state=active]:text-indigo-700`}>
                  <ScanLine className={TAB_ICON} />
                  <span>Radiology</span>
                  {records.radiologyOrders.length > 0 && (
                    <Badge className={`${TAB_COUNT} bg-indigo-100 text-indigo-700`}>{records.radiologyOrders.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="ipd" className={`${TAB_TRIGGER} data-[state=active]:text-rose-700`}>
                  <BedDouble className={TAB_ICON} />
                  <span>IPD</span>
                  {records.admissions.length > 0 && (
                    <Badge className={`${TAB_COUNT} bg-rose-100 text-rose-700`}>{records.admissions.length}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="documents" className={`${TAB_TRIGGER} data-[state=active]:text-sky-700`}>
                  <FileText className={TAB_ICON} />
                  <span>Documents</span>
                  {records.patientDocuments?.length > 0 && (
                    <Badge className={`${TAB_COUNT} bg-sky-100 text-sky-700`}>{records.patientDocuments.length}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Overview */}
              <TabsContent value="overview" className="mt-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: 'Date of Birth', val: selectedPatient.dateOfBirth ? format(new Date(selectedPatient.dateOfBirth), 'dd MMM yyyy') : '—' },
                    { label: 'Age', val: selectedPatient.dateOfBirth ? `${calculateAge(selectedPatient.dateOfBirth)} years` : '—' },
                    { label: 'Gender', val: selectedPatient.gender },
                    { label: 'Blood Group', val: selectedPatient.bloodGroup || '—' },
                    { label: 'Phone', val: selectedPatient.phonePrimary || '—' },
                    { label: 'Email', val: selectedPatient.email || '—' },
                    // One readable line, the way an address is actually read out:
                    // "A-1204, Block G, Andheri West, Mumbai, Mumbai Suburban, Maharashtra - 400053"
                    { label: 'Address', val: [
                        selectedPatient.houseNumber, selectedPatient.street, selectedPatient.locality,
                        selectedPatient.city, selectedPatient.district, selectedPatient.state,
                      ].filter(Boolean).join(', ')
                        + (selectedPatient.pincode ? ` - ${selectedPatient.pincode}` : '')
                      || selectedPatient.addressDescription || '—' },
                    { label: 'Insurance', val: selectedPatient.hasInsurance ? (selectedPatient.insuranceProvider || 'Yes') : 'No' },
                    { label: 'Emergency Contact', val: selectedPatient.emergencyContactName || '—' },
                    { label: 'Contact Phone', val: selectedPatient.emergencyContactPhone || '—' },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <p className="text-gray-500 text-xs font-medium uppercase">{label}</p>
                      <p className="font-medium capitalize">{val}</p>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Appointments & Billing */}
              <TabsContent value="appointments" className="mt-4">
                {recordsLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" /></div>
                ) : (
                  <div className="space-y-4">
                    {/* Billing summary */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border p-3 bg-gray-50">
                        <p className="text-xs text-gray-500 font-medium uppercase flex items-center gap-1"><IndianRupee className="h-3 w-3" />Total Billed</p>
                        <p className="text-lg font-bold text-gray-800">{fmtMoney(b.totalBilled)}</p>
                      </div>
                      <div className="rounded-lg border p-3 bg-green-50">
                        <p className="text-xs text-green-600 font-medium uppercase">Total Paid</p>
                        <p className="text-lg font-bold text-green-700">{fmtMoney(b.totalPaid)}</p>
                      </div>
                      <div className="rounded-lg border p-3 bg-amber-50">
                        <p className="text-xs text-amber-600 font-medium uppercase">Balance Due</p>
                        <p className="text-lg font-bold text-amber-700">{fmtMoney(b.balanceDue)}</p>
                      </div>
                    </div>

                    <ScrollArea className="h-[300px] pr-3">
                      {records.appointments.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                          <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-40" />
                          <p>No appointments yet</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Clock className="h-4 w-4 text-green-600" />Upcoming ({upcoming.length})</h4>
                            {upcoming.length === 0 ? (
                              <p className="text-sm text-gray-400 italic px-1">No upcoming appointments</p>
                            ) : (
                              <div className="space-y-2">{upcoming.map(a => <ApptRow key={a.id} a={a} cancellable />)}</div>
                            )}
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">History ({history.length})</h4>
                            {history.length === 0 ? (
                              <p className="text-sm text-gray-400 italic px-1">No past appointments</p>
                            ) : (
                              <div className="space-y-2">{history.map(a => <ApptRow key={a.id} a={a} cancellable={false} />)}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                )}
              </TabsContent>

              {/* Lab / Pathology */}
              <TabsContent value="lab" className="mt-4">
                <ScrollArea className="h-[360px] pr-3">
                  {recordsLoading ? (
                    <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" /></div>
                  ) : records.labOrders.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <FlaskConical className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p>No lab or pathology reports yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {records.labOrders.map(order => (
                        <div key={order.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <FlaskConical className="h-4 w-4 text-cyan-600" />
                              <span className="font-mono text-sm font-medium">{order.orderNumber}</span>
                              <Badge className="bg-gray-100 text-gray-700 border-0 capitalize">{order.status?.replace(/_/g, ' ')}</Badge>
                              {order.priority && order.priority !== 'routine' && (
                                <Badge className="bg-red-100 text-red-700 border-0 capitalize">{order.priority}</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">{format(new Date(order.createdAt), 'dd MMM yyyy, HH:mm')}</span>
                              {order.results?.length > 0 ? (
                                <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => handlePrintLabReport(order)}>
                                  <Printer className="h-3 w-3 mr-1" />PDF
                                </Button>
                              ) : (
                                <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">Pending</Badge>
                              )}
                            </div>
                          </div>
                          {order.clinicalIndication && (
                            <p className="text-xs text-gray-500 mb-2">Indication: {order.clinicalIndication}</p>
                          )}
                          {order.results?.length > 0 ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="h-8">Test</TableHead>
                                  <TableHead className="h-8">Result</TableHead>
                                  <TableHead className="h-8">Flag</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {order.results.map(r => (
                                  <TableRow key={r.id}>
                                    <TableCell className="py-1.5">{r.test?.testName || '—'}</TableCell>
                                    <TableCell className={`py-1.5 font-medium ${r.isCritical ? 'text-red-600' : r.isAbnormal ? 'text-amber-600' : ''}`}>
                                      {r.resultValue} {r.resultUnit || r.test?.unit || ''}
                                    </TableCell>
                                    <TableCell className="py-1.5">
                                      {r.isCritical
                                        ? <Badge className="bg-red-100 text-red-700 border-0"><AlertCircle className="h-3 w-3 mr-1" />Critical</Badge>
                                        : r.isAbnormal
                                          ? <Badge className="bg-amber-100 text-amber-700 border-0">{r.flag || 'Abnormal'}</Badge>
                                          : <Badge className="bg-green-100 text-green-700 border-0">Normal</Badge>}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          ) : (
                            <p className="text-xs text-gray-400 italic">Results pending</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* Radiology */}
              <TabsContent value="radiology" className="mt-4">
                <ScrollArea className="h-[360px] pr-3">
                  {recordsLoading ? (
                    <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" /></div>
                  ) : records.radiologyOrders.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <Scan className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p>No radiology reports yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {records.radiologyOrders.map(order => (
                        <div key={order.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Scan className="h-4 w-4 text-indigo-600" />
                              <span className="font-medium text-sm">{order.exam?.examName || 'Exam'}</span>
                              <Badge className="bg-gray-100 text-gray-700 border-0 capitalize">{order.status?.replace(/_/g, ' ')}</Badge>
                              {order.report?.hasCriticalFindings && (
                                <Badge className="bg-red-100 text-red-700 border-0"><AlertCircle className="h-3 w-3 mr-1" />Critical</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">{format(new Date(order.createdAt), 'dd MMM yyyy, HH:mm')}</span>
                              {order.report ? (
                                <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => handlePrintRadReport(order)}>
                                  <Printer className="h-3 w-3 mr-1" />PDF
                                </Button>
                              ) : (
                                <Badge variant="outline" className="text-amber-600 border-amber-300 text-[10px]">Pending</Badge>
                              )}
                            </div>
                          </div>
                          {order.report ? (
                            <div className="space-y-1.5 text-sm">
                              {order.report.findings && (
                                <div><span className="text-gray-500 text-xs font-medium uppercase">Findings: </span>{order.report.findings}</div>
                              )}
                              {order.report.impression && (
                                <div><span className="text-gray-500 text-xs font-medium uppercase">Impression: </span><span className="font-medium">{order.report.impression}</span></div>
                              )}
                              {order.report.recommendations && (
                                <div><span className="text-gray-500 text-xs font-medium uppercase">Recommendations: </span>{order.report.recommendations}</div>
                              )}
                              {!order.report.findings && !order.report.impression && (
                                <p className="text-xs text-gray-400 italic flex items-center gap-1"><FileText className="h-3 w-3" />Report drafted, awaiting details</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 italic">Report pending</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* IPD / Admissions */}
              <TabsContent value="ipd" className="mt-4">
                <ScrollArea className="h-[360px] pr-3">
                  {recordsLoading ? (
                    <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" /></div>
                  ) : records.admissions.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <BedDouble className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p>No inpatient (IPD) admissions</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {records.admissions.map(adm => (
                        <div key={adm.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <BedDouble className="h-4 w-4 text-rose-600" />
                              <span className="font-medium text-sm">
                                {adm.bed?.ward?.name || 'Ward'}{adm.bed?.bedNumber ? ` — Bed ${adm.bed.bedNumber}` : ''}
                              </span>
                              <Badge className={`capitalize border-0 ${adm.status === 'admitted' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                {adm.status}
                              </Badge>
                              {adm.isCritical && (
                                <Badge className="bg-red-100 text-red-700 border-0"><AlertCircle className="h-3 w-3 mr-1" />Critical</Badge>
                              )}
                            </div>
                            <span className="text-xs text-gray-500">{format(new Date(adm.admissionDate), 'dd MMM yyyy, HH:mm')}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                            {adm.admissionType && <div><span className="text-gray-500 text-xs font-medium uppercase">Type: </span><span className="capitalize">{adm.admissionType}</span></div>}
                            {adm.admissionDiagnosis && <div><span className="text-gray-500 text-xs font-medium uppercase">Diagnosis: </span>{adm.admissionDiagnosis}</div>}
                            {adm.admissionReason && <div className="col-span-2"><span className="text-gray-500 text-xs font-medium uppercase">Reason: </span>{adm.admissionReason}</div>}
                            {adm.chiefComplaint && <div className="col-span-2"><span className="text-gray-500 text-xs font-medium uppercase">Chief Complaint: </span>{adm.chiefComplaint}</div>}
                            {adm.dischargeDate && <div><span className="text-gray-500 text-xs font-medium uppercase">Discharged: </span>{format(new Date(adm.dischargeDate), 'dd MMM yyyy')}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* Documents / KYC */}
              <TabsContent value="documents" className="mt-4">
                <ScrollArea className="h-[360px] pr-3">
                  {recordsLoading ? (
                    <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#2E4168]" /></div>
                  ) : !records.patientDocuments || records.patientDocuments.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p>No uploaded documents or KYC files</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {records.patientDocuments.map(doc => (
                        <div key={doc.id} className="relative group rounded-lg border bg-white p-3 hover:shadow-md transition-shadow">
                          <div className="aspect-[4/3] rounded bg-gray-100 mb-2 overflow-hidden flex items-center justify-center relative">
                            {doc.fileType.startsWith('image/') ? (
                              <img src={`http://localhost:5000${doc.fileUrl}`} alt={doc.title} className="w-full h-full object-cover" />
                            ) : (
                              <FileText className="h-10 w-10 text-gray-400" />
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <a href={`http://localhost:5000${doc.fileUrl}`} target="_blank" rel="noreferrer" className="bg-white text-blue-600 rounded-full p-2 hover:scale-110 transition-transform shadow-lg">
                                <Eye className="h-4 w-4" />
                              </a>
                            </div>
                          </div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate" title={doc.title}>{doc.title}</p>
                              <p className="text-xs text-gray-500 capitalize">{doc.documentType.replace('_', ' ')}</p>
                            </div>
                          </div>
                          <div className="text-[10px] text-gray-400 mt-2">
                            Uploaded: {format(new Date(doc.uploadedAt), 'dd MMM yyyy')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}
        {viewTab === 'overview' && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowViewDialog(false)}>Close</Button>
            <Button onClick={() => { setShowViewDialog(false); if (selectedPatient) openEdit(selectedPatient); }}>
              <Edit className="h-4 w-4 mr-2" />Edit
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
