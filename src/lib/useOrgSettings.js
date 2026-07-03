import { useState, useEffect } from 'react'
import { getOrgSettings, clearOrgCache } from '@/lib/orgSettings'

/**
 * Hook that listens for org settings changes and refetches automatically
 * Components should use this instead of manually calling getOrgSettings
 */
export function useOrgSettings() {
  const [orgInfo, setOrgInfo] = useState({ name: 'Hospital', address: '', city: '', region: '', phone: '', email: '', logoUrl: '', website: '', gstNo: '', cin: '', sacCode: '', labCode: '', homeCollectionCharge: 0, showEmptyReceiptFields: true, receiptFooter: '' })
  const [loading, setLoading] = useState(true)

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const settings = await getOrgSettings()
      setOrgInfo(settings)
    } catch (error) {
      console.error('Failed to fetch org settings:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetch on mount
    fetchSettings()

    // Listen for settings changes - clear cache and refetch
    const handleSettingsChange = () => {
      clearOrgCache() // Force clear the cache
      fetchSettings() // Refetch fresh data
    }

    window.addEventListener('brandingChange', handleSettingsChange)
    window.addEventListener('hospitalNameChange', handleSettingsChange)
    window.addEventListener('organizationSettingsChange', handleSettingsChange)

    return () => {
      window.removeEventListener('brandingChange', handleSettingsChange)
      window.removeEventListener('hospitalNameChange', handleSettingsChange)
      window.removeEventListener('organizationSettingsChange', handleSettingsChange)
    }
  }, [])

  return { orgInfo, loading }
}
