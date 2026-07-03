import { useState, useCallback } from 'react'
import client from '@/api/client'

// Single place that knows how to create a patient. Used by every "create a
// patient" surface (RegisterPatientForm's full form, PatientLookup's inline
// walk-in quick-add, and anywhere else that needs one) so the POST /patients
// call + loading flag aren't duplicated — and a future backend change only
// needs updating here, not in every form.
//
// Callers keep their own success/error toast wording (it differs by context:
// full registration vs a 5-field walk-in), so this hook only owns the request.
export function useCreatePatient() {
  const [creating, setCreating] = useState(false)

  const createPatient = useCallback(async (patientData) => {
    setCreating(true)
    try {
      const res = await client.post('/patients', patientData)
      if (res?.success === false) {
        throw new Error(res.error || 'Failed to create patient')
      }
      return res.data ?? res
    } finally {
      setCreating(false)
    }
  }, [])

  return { createPatient, creating }
}
