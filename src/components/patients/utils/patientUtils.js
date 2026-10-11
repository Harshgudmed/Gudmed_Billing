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

export const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Other'];

// The Edit Patient form's rules are registration's own: patientEditSchema in
// src/lib/schemas/patientFormSchema.js. (A looser copy lived here and let an edit
// save a name with digits, a date of birth in 1800 and an emptied city.)

