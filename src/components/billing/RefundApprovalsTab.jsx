import React, { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui/table'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Check, X, Clock } from 'lucide-react'
import client from '@/api/client'
import { toast } from 'sonner'

export default function RefundApprovalsTab({ userRole, onProcess }) {
  const [approvals, setApprovals] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchApprovals = async () => {
    try {
      setLoading(true)
      // Fetch ALL refunds to show history, not just pending ones
      const res = await client.get('/billing?resource=payments&isRefund=true')
      if (res.success) {
        setApprovals(res.data)
      }
    } catch (err) {
      toast.error('Failed to load pending approvals')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchApprovals()
  }, [])

  const handleAction = async (paymentId, action) => {
    try {
      const res = await client.post('/billing', {
        resource: 'approve_refund',
        paymentId,
        action
      })
      if (res.success) {
        toast.success(`Refund ${action === 'APPROVE' ? 'Approved' : 'Rejected'} Successfully`)
        fetchApprovals()
        if (onProcess) onProcess() // Refresh parent module data
      }
    } catch (err) {
      toast.error(err.message || 'Error processing refund')
    }
  }

  const canApprove = ['finance_controller', 'admin', 'super_admin'].includes(userRole)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            Pending Refund Approvals
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Approver</TableHead>
                {canApprove && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">Loading...</TableCell></TableRow>
              ) : approvals.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500">No pending approvals.</TableCell></TableRow>
              ) : (
                approvals.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="py-3 text-sm">{new Date(a.paymentDate).toLocaleDateString()}</TableCell>
                    <TableCell className="py-3">
                      {a.status === 'PENDING_APPROVAL' && <Badge variant="outline" className="text-amber-600 bg-amber-50">Pending</Badge>}
                      {a.status === 'APPROVED' && <Badge variant="outline" className="text-green-600 bg-green-50">Approved</Badge>}
                      {a.status === 'REJECTED' && <Badge variant="outline" className="text-red-600 bg-red-50">Rejected</Badge>}
                    </TableCell>
                    <TableCell className="py-3 font-medium text-sm">
                      {a.patient?.firstName} {a.patient?.lastName}
                    </TableCell>
                    <TableCell className="py-3 text-sm font-mono text-gray-600">{a.invoice?.invoiceNumber}</TableCell>
                    <TableCell className="py-3 text-right font-bold text-red-600">₹{a.amount.toFixed(2)}</TableCell>
                    <TableCell className="py-3 text-xs text-gray-500 max-w-[200px] truncate" title={a.refundReason}>
                      {a.refundReason}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-gray-500">
                      {a.approvedByUserId ? a.approvedByUserId : '-'}
                      {a.approvalDate && <div className="text-[10px] text-gray-400">{new Date(a.approvalDate).toLocaleDateString()}</div>}
                    </TableCell>
                    {canApprove && (
                      <TableCell className="py-3 text-right space-x-2">
                        {a.status === 'PENDING_APPROVAL' ? (
                          <>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-8 px-2 border-red-200 text-red-600 hover:bg-red-50"
                              onClick={() => handleAction(a.id, 'REJECT')}
                            >
                              <X className="w-4 h-4 mr-1" /> Reject
                            </Button>
                            <Button 
                              size="sm" 
                              className="h-8 px-2 bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => handleAction(a.id, 'APPROVE')}
                            >
                              <Check className="w-4 h-4 mr-1" /> Approve
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">Processed</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {!canApprove && approvals.length > 0 && (
            <div className="mt-4 p-3 bg-amber-50 text-amber-800 text-sm rounded-md flex items-start gap-2 border border-amber-200">
              <Clock className="w-4 h-4 mt-0.5 shrink-0" />
              <p>You do not have permission to approve refunds. A Finance Controller or Administrator must approve these requests.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
