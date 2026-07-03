import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import client from '@/api/client';
import { useDebounce } from '@/lib/useDebounce';

export function usePatients({ dfStart, dfEnd, limit = 10 }) {
  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [offset, setOffset] = useState(0);

  // The input box still updates instantly (uses `search`), but the API call
  // waits 300ms after typing stops — so we fire ONE request, not one per key.
  const debouncedSearch = useDebounce(search, 300);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
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
  }, [debouncedSearch, status, offset, dfStart, dfEnd, limit]);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  // The external date filter is a prop, so reset the page from an effect.
  useEffect(() => {
    setOffset(0);
  }, [dfStart, dfEnd]);

  // Search/status setters reset the page in the SAME update, so changing a
  // filter from a later page fetches once (not twice: old page + reset).
  const changeSearch = useCallback((value) => {
    setSearch(value);
    setOffset(0);
  }, []);
  const changeStatus = useCallback((value) => {
    setStatus(value);
    setOffset(0);
  }, []);

  return {
    patients,
    total,
    loading,
    error,
    search,
    setSearch: changeSearch,
    status,
    setStatus: changeStatus,
    offset,
    setOffset,
    limit,
    refresh: fetchPatients
  };
}
