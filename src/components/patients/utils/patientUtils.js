import { z } from 'zod';
// The name/age/initials helpers live in one dependency-free module now; re-exported
// here so existing `patientUtils` imports keep working against a single implementation.
export { calcAge, getFullName, patientDisplayName, initials } from '@/lib/patient';
// calculateAge kept as an alias for the many call sites that use the old name.
export { calcAge as calculateAge } from '@/lib/patient';

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry'
];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const INSURANCE_PROVIDERS = [
  'CGHS', 'ESIC', 'PM-JAY (Ayushman Bharat)', 'Star Health', 'HDFC ERGO',
  'Niva Bupa', 'Care Health', 'ICICI Lombard', 'Bajaj Allianz', 'LIC Health',
  'United India', 'New India Assurance', 'Oriental Insurance', 'National Insurance',
  'Max Bupa', 'Reliance Health', 'SBI Health', 'Tata AIG',
];

export const patientSchema = z.object({
  firstName: z.string().min(2, 'First name is required'),
  middleName: z.string().optional(),
  lastName: z.string().min(2, 'Last name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female', 'other']),
  phonePrimary: z.string().min(10, 'Valid phone number required'),
  phoneSecondary: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  houseNumber: z.string().optional(),
  street: z.string().optional(),
  locality: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().regex(/^\d{6}$/, 'PIN code must be 6 digits').optional().or(z.literal('')),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  bloodGroup: z.string().optional(),
  hasInsurance: z.boolean().optional().default(false),
  insuranceProvider: z.string().optional(),
  insuranceId: z.string().optional(),
});

