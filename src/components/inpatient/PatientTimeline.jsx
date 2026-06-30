import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';
import { Pill, HeartPulse, FileText, Activity, AlertCircle, LogIn, LogOut, TestTube } from 'lucide-react';
import client from '@/api/client';
import { toast } from 'sonner';

export function PatientTimeline({ patientId }) {
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (patientId) {
      loadTimeline();
    }
  }, [patientId]);

  const loadTimeline = async () => {
    try {
      setLoading(true);
      const res = await client.get(`/inpatient/timeline/${patientId}`);
      if (res.success) {
        setTimeline(res.data || []);
      } else {
        toast.error('Failed to load timeline');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error loading timeline');
    } finally {
      setLoading(false);
    }
  };

  const getIconForType = (type) => {
    switch (type) {
      case 'ADMISSION_START': return <LogIn className="h-4 w-4 text-white" />;
      case 'DISCHARGE': return <LogOut className="h-4 w-4 text-white" />;
      case 'CLINICAL_NOTE': return <FileText className="h-4 w-4 text-white" />;
      case 'ORDER': return <TestTube className="h-4 w-4 text-white" />;
      case 'VITALS': return <HeartPulse className="h-4 w-4 text-white" />;
      case 'MEDICATION': return <Pill className="h-4 w-4 text-white" />;
      default: return <Activity className="h-4 w-4 text-white" />;
    }
  };

  const getColorForType = (type) => {
    switch (type) {
      case 'ADMISSION_START': return 'bg-emerald-500';
      case 'DISCHARGE': return 'bg-slate-500';
      case 'CLINICAL_NOTE': return 'bg-blue-500';
      case 'ORDER': return 'bg-purple-500';
      case 'VITALS': return 'bg-rose-500';
      case 'MEDICATION': return 'bg-amber-500';
      default: return 'bg-gray-500';
    }
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-500 animate-pulse">Loading patient timeline...</div>;
  }

  if (timeline.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-400">
          <Activity className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p>No medical history or logs found for this patient.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6">
      <div className="relative border-l-2 border-gray-100 ml-4 space-y-8">
        {timeline.map((event, index) => (
          <div key={`${event.id}-${index}`} className="relative pl-8">
            <div className={`absolute -left-3 top-1.5 h-6 w-6 rounded-full flex items-center justify-center shadow ring-4 ring-white ${getColorForType(event.type)}`}>
              {getIconForType(event.type)}
            </div>
            <div className="bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                    {event.title}
                  </h4>
                  <div className="text-xs text-gray-500 flex items-center gap-2 mt-1">
                    <span className="font-medium text-gray-700">{event.user}</span>
                    <span>•</span>
                    <span>{event.timestamp ? format(new Date(event.timestamp), 'dd MMM yyyy, HH:mm') : 'Unknown Time'}</span>
                  </div>
                </div>
                <div className="px-2 py-1 bg-gray-50 text-[10px] uppercase font-bold text-gray-500 rounded border">
                  {event.type.replace('_', ' ')}
                </div>
              </div>
              <div className="text-sm text-gray-600 mt-2 bg-gray-50 p-3 rounded border border-gray-100">
                {event.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
