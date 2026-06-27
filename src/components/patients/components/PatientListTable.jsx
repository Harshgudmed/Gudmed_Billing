import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Phone, Shield, Microscope, ScanLine, BedDouble, FileText, Eye, Printer, Trash2 } from 'lucide-react';
import { getFullName, calculateAge, initials } from '../utils/patientUtils';

export default function PatientListTable({ patients, openPatient, handlePrintCard, handleDeletePatient }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Patient</TableHead>
          <TableHead>UHID</TableHead>
          <TableHead>Age / Gender</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Insurance</TableHead>
          <TableHead>Reports</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {patients.map(patient => {
          const name = getFullName(patient);
          const age = patient.dateOfBirth ? calculateAge(patient.dateOfBirth) : '—';
          return (
            <TableRow key={patient.id} className="cursor-pointer hover:bg-gray-50" onClick={() => openPatient(patient)}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-blue-100 text-blue-700 text-sm font-bold">
                      {initials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{name}</div>
                    {patient.isVip && <Badge className="text-[10px] bg-amber-100 text-amber-700 border-0 px-1 py-0">VIP</Badge>}
                  </div>
                </div>
              </TableCell>
              <TableCell className="font-mono text-sm">{patient.mrn}</TableCell>
              <TableCell>
                <div>{age} yrs</div>
                <div className="text-xs text-gray-500 capitalize">{patient.gender}</div>
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                {patient.phonePrimary ? (
                  <a
                    href={`tel:${patient.phonePrimary.replace(/[^0-9+]/g, '')}`}
                    title={`Call ${patient.phonePrimary}`}
                    className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-blue-600 hover:underline"
                  >
                    <Phone className="h-3 w-3 text-gray-400" />
                    {patient.phonePrimary}
                  </a>
                ) : (
                  <span className="flex items-center gap-1 text-sm text-gray-400"><Phone className="h-3 w-3" />—</span>
                )}
              </TableCell>
              <TableCell>
                {patient.hasInsurance
                  ? <Badge className="bg-green-100 text-green-700 border-0"><Shield className="h-3 w-3 mr-1" />{patient.insuranceProvider || 'Insured'}</Badge>
                  : <Badge variant="outline" className="text-gray-400">None</Badge>
                }
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                {patient.labReportCount > 0 || patient.radiologyReportCount > 0 || patient.admittedCount > 0 || patient.documentCount > 0 ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {patient.labReportCount > 0 && (
                      <button
                        type="button"
                        title={`View ${patient.labReportCount} pathology / lab report${patient.labReportCount > 1 ? 's' : ''}`}
                        onClick={() => openPatient(patient, 'lab')}
                        className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-teal-50 to-cyan-50 text-teal-700 ring-1 ring-inset ring-teal-200 pl-1.5 pr-2 py-0.5 text-xs font-semibold shadow-sm transition-all hover:from-teal-100 hover:to-cyan-100 hover:shadow hover:scale-105"
                      >
                        <Microscope className="h-3.5 w-3.5" />
                        <span>Pathology</span>
                        <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-teal-600 text-white text-[10px] leading-none px-1">
                          {patient.labReportCount}
                        </span>
                      </button>
                    )}
                    {patient.radiologyReportCount > 0 && (
                      <button
                        type="button"
                        title={`View ${patient.radiologyReportCount} radiology report${patient.radiologyReportCount > 1 ? 's' : ''}`}
                        onClick={() => openPatient(patient, 'radiology')}
                        className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 pl-1.5 pr-2 py-0.5 text-xs font-semibold shadow-sm transition-all hover:from-indigo-100 hover:to-violet-100 hover:shadow hover:scale-105"
                      >
                        <ScanLine className="h-3.5 w-3.5" />
                        <span>Radiology</span>
                        <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-indigo-600 text-white text-[10px] leading-none px-1">
                          {patient.radiologyReportCount}
                        </span>
                      </button>
                    )}
                    {patient.admittedCount > 0 && (
                      <button
                        type="button"
                        title="Admitted — view IPD / admission details"
                        onClick={() => openPatient(patient, 'ipd')}
                        className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-rose-50 to-orange-50 text-rose-700 ring-1 ring-inset ring-rose-200 pl-1.5 pr-2 py-0.5 text-xs font-semibold shadow-sm transition-all hover:from-rose-100 hover:to-orange-100 hover:shadow hover:scale-105"
                      >
                        <BedDouble className="h-3.5 w-3.5" />
                        <span>IPD</span>
                      </button>
                    )}
                    {patient.documentCount > 0 && (
                      <button
                        type="button"
                        title={`View ${patient.documentCount} uploaded document${patient.documentCount > 1 ? 's' : ''}`}
                        onClick={() => openPatient(patient, 'documents')}
                        className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-blue-50 to-sky-50 text-blue-700 ring-1 ring-inset ring-blue-200 pl-1.5 pr-2 py-0.5 text-xs font-semibold shadow-sm transition-all hover:from-blue-100 hover:to-sky-100 hover:shadow hover:scale-105"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>Documents</span>
                        <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-blue-600 text-white text-[10px] leading-none px-1">
                          {patient.documentCount}
                        </span>
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge className={patient.isActive ? 'bg-green-100 text-green-700 border-0' : 'bg-gray-100 text-gray-500 border-0'}>
                  {patient.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex gap-1 justify-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="View"
                    onClick={() => openPatient(patient)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600" title="Print OPD Prescription"
                    onClick={() => handlePrintCard(patient)}>
                    <Printer className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" title="Delete Patient"
                    onClick={() => handleDeletePatient(patient)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
