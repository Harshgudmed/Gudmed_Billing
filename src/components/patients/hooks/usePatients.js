import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import client from '@/api/client';

export function usePatients({ dfStart, dfEnd, limit = 10 }) {
  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [offset, setOffset] = useState(0);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status !== 'all') params.set('status', status);
      if (dfStart) params.set('startDate', dfStart);
      if (dfEnd) params.set('endDate', dfEnd);
      params.set('limit', String(limit));
      params.set('offset', String(offset));

      const res = await client.get(`/patients?${params}`);
      if (!res.success && res.error) {
        throw new Error(res.error);
      }
      setPatients(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (err) {
      const errorMsg = err.message || 'Failed to load patients';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [search, status, offset, dfStart, dfEnd, limit]);

  useEffect(() => { 
    fetchPatients(); 
  }, [fetchPatients]);

  // Reset offset when filters change
  useEffect(() => { 
    setOffset(0); 
  }, [search, status, dfStart, dfEnd]);

  return {
    patients,
    total,
    loading,
    error,
    search,
    setSearch,
    status,
    setStatus,
    offset,
    setOffset,
    limit,
    refresh: fetchPatients
  };
}
