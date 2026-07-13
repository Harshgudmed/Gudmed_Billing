import { useState, useEffect } from "react";

function useDebounce(value, delay = 400) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

import { Search, User, X, Loader2, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { toast } from "sonner";
import client from "@/api/client";
import { useCreatePatient } from "@/lib/useCreatePatient";

const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed", "Other"];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Delhi",
  "Jammu & Kashmir",
  "Ladakh",
  "Chandigarh",
  "Puducherry",
];
const INSURANCE_PROVIDERS = [
  "CGHS",
  "ESIC",
  "PM-JAY (Ayushman Bharat)",
  "Star Health",
  "HDFC ERGO",
  "Niva Bupa",
  "Care Health",
  "ICICI Lombard",
  "Bajaj Allianz",
  "LIC Health",
  "United India",
  "New India Assurance",
  "Oriental Insurance",
  "National Insurance",
  "Max Bupa",
  "Reliance Health",
  "SBI Health",
  "Tata AIG",
];

export function getPatientFullName(patient) {
  if (!patient) return "";
  return `${patient.firstName || ""} ${patient.middleName || ""} ${patient.lastName || ""}`
    .replace(/\s+/g, " ")
    .trim();
}

export function calculatePatientAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const today = new Date();
  const birth = new Date(dateOfBirth);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

const emptyNew = {
  firstName: "",
  middleName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "male",
  bloodGroup: "",
  maritalStatus: "",
  referredBy: "",
  mlcNumber: "",
  phonePrimary: "",
  phoneSecondary: "",
  email: "",
  region: "",
  zone: "",
  houseNumber: "",
  postalCode: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  hasInsurance: false,
  insuranceProvider: "",
  insuranceId: "",
};

export default function PatientLookup({
  selectedPatient,
  onSelect,
  onClear,
  placeholder = "Search by UHID, name, or phone...",
  className = "",
  showHint = true,
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [newForm, setNewForm] = useState(emptyNew);
  const { createPatient, creating } = useCreatePatient();

  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => {
    if (search.length >= 2) setLoading(true);
    else {
      setLoading(false);
      setResults([]);
    }
  }, [search]);

  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const searchTerm = debouncedSearch;
    (async () => {
      try {
        const res = await client.get("/patients", {
          params: { search: debouncedSearch, limit: 8, status: "active" },
        });
        if (!cancelled && searchTerm === debouncedSearch) {
          setResults(res.data ?? []);
          setOpen(true);
        }
      } catch {
        if (!cancelled && searchTerm === debouncedSearch) setResults([]);
      } finally {
        if (!cancelled && searchTerm === debouncedSearch) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  async function handleCreate() {
    if (
      newForm.firstName.trim().length < 2 ||
      newForm.lastName.trim().length < 2
    ) {
      toast.error("Enter first and last name (min 2 characters)");
      return;
    }

    const phoneDigits = newForm.phonePrimary.replace(/\D/g, "");
    if (!phoneDigits || phoneDigits.length < 10) {
      toast.error("Enter a valid 10-digit phone number");
      return;
    }

    if (!newForm.dateOfBirth) {
      toast.error("Date of birth is required");
      return;
    }

    try {
      const payload = {
        firstName: newForm.firstName.trim(),
        middleName: newForm.middleName.trim(),
        lastName: newForm.lastName.trim(),
        dateOfBirth: new Date(newForm.dateOfBirth).toISOString(),
        gender: newForm.gender,
        bloodGroup: newForm.bloodGroup || undefined,
        maritalStatus: newForm.maritalStatus || undefined,
        referredBy: newForm.referredBy.trim() || undefined,
        mlcNumber: newForm.mlcNumber.trim() || undefined,
        phonePrimary: newForm.phonePrimary.trim(),
        phoneSecondary: newForm.phoneSecondary.trim() || undefined,
        email: newForm.email.trim() || undefined,
        region: newForm.region || undefined,
        zone: newForm.zone.trim() || undefined,
        houseNumber: newForm.houseNumber.trim() || undefined,
        postalCode: newForm.postalCode.trim() || undefined,
        emergencyContactName: newForm.emergencyContactName.trim() || undefined,
        emergencyContactPhone:
          newForm.emergencyContactPhone.trim() || undefined,
        emergencyContactRelationship:
          newForm.emergencyContactRelationship.trim() || undefined,
        hasInsurance:
          newForm.hasInsurance === true || newForm.hasInsurance === "true",
        insuranceProvider: newForm.insuranceProvider || undefined,
        insuranceId: newForm.insuranceId.trim() || undefined,
      };

      console.log("Form:", newForm);
      console.log("Payload:", payload);

      Object.keys(payload).forEach(
        (key) => payload[key] === undefined && delete payload[key],
      );

      const created = await createPatient(payload);
      toast.success(
        `Patient registered: ${getPatientFullName(created)} (${created.mrn || "new"})`,
      );
      onSelect(created);
      setAddingNew(false);
      setNewForm(emptyNew);
      setSearch("");
      setOpen(false);
    } catch (err) {
      toast.error(
        "Could not register patient: " + (err.message || "try again"),
      );
    }
  }

  if (selectedPatient) {
    const age = calculatePatientAge(selectedPatient.dateOfBirth);
    return (
      <div
        className={`flex items-center justify-between gap-3 p-3 bg-green-50 border border-green-200 rounded-lg ${className}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <User className="h-5 w-5 text-green-700 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-green-900 truncate">
              {getPatientFullName(selectedPatient)}
            </p>
            <p className="text-sm text-green-700">
              UHID: {selectedPatient.mrn}
              {age != null && ` • ${age}y`}
              {selectedPatient.gender && ` • ${selectedPatient.gender}`}
              {selectedPatient.phonePrimary &&
                ` • ${selectedPatient.phonePrimary}`}
            </p>
          </div>
        </div>
        {onClear && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClear}
            aria-label="Clear patient"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  if (addingNew) {
    return (
      <div
        className={`rounded-lg border border-blue-200 bg-gray-50 p-4 space-y-4 max-h-[80vh] overflow-y-auto ${className}`}
      >
        <div className="flex items-center justify-between top-0 bg-blue-50/40 pb-2">
          <span className="text-sm font-semibold flex items-center gap-2 text-blue-800">
            <UserPlus className="h-4 w-4" /> New Patient (not in records)
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setAddingNew(false);
              setNewForm(emptyNew);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          {/* Personal Information */}
          <div>
            <div className="text-xs font-semibold text-blue-800 mb-3">
              Personal Information
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">First Name *</Label>
                <Input
                  className="mt-1"
                  placeholder="First name"
                  value={newForm.firstName}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, firstName: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Middle Name</Label>
                <Input
                  className="mt-1"
                  placeholder="Middle name"
                  value={newForm.middleName}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, middleName: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Last Name *</Label>
                <Input
                  className="mt-1"
                  placeholder="Last name"
                  value={newForm.lastName}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, lastName: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Date of Birth *</Label>
                <Input
                  className="mt-1"
                  type="date"
                  value={newForm.dateOfBirth}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, dateOfBirth: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Gender</Label>
                <Select
                  value={newForm.gender}
                  onValueChange={(v) =>
                    setNewForm((p) => ({ ...p, gender: v }))
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Blood Group</Label>
                <Select
                  value={newForm.bloodGroup}
                  onValueChange={(v) =>
                    setNewForm((p) => ({ ...p, bloodGroup: v }))
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOOD_GROUPS.map((bg) => (
                      <SelectItem key={bg} value={bg}>
                        {bg}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Marital Status</Label>
                <Select
                  value={newForm.maritalStatus}
                  onValueChange={(v) =>
                    setNewForm((p) => ({ ...p, maritalStatus: v }))
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {MARITAL_STATUSES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Referred By</Label>
                <Input
                  className="mt-1"
                  placeholder="Doctor / clinic / person"
                  value={newForm.referredBy}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, referredBy: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">MLC Number</Label>
                <Input
                  className="mt-1"
                  placeholder="Medico-legal case no. (if any)"
                  value={newForm.mlcNumber}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, mlcNumber: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div>
            <div className="text-xs font-semibold text-blue-800 mb-3">
              Contact Information
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Primary Phone *</Label>
                <Input
                  className="mt-1"
                  placeholder="10-digit mobile"
                  value={newForm.phonePrimary}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, phonePrimary: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Secondary Phone</Label>
                <Input
                  className="mt-1"
                  placeholder="Secondary phone"
                  value={newForm.phoneSecondary}
                  onChange={(e) =>
                    setNewForm((p) => ({
                      ...p,
                      phoneSecondary: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Email</Label>
                <Input
                  className="mt-1"
                  type="email"
                  placeholder="patient@email.com"
                  value={newForm.email}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, email: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Address Information */}
          <div>
            <div className="text-xs font-semibold text-blue-800 mb-3">
              Address Information
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">House / Flat / Building No.</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. 12-B"
                  value={newForm.houseNumber}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, houseNumber: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Village / Town</Label>
                <Input
                  className="mt-1"
                  placeholder="Village or town"
                  value={newForm.kebele}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, kebele: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">City / District</Label>
                <Input
                  className="mt-1"
                  placeholder="City or district"
                  value={newForm.zone}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, zone: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">State</Label>
                <Select
                  value={newForm.region}
                  onValueChange={(v) =>
                    setNewForm((p) => ({ ...p, region: v }))
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDIAN_STATES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">PIN Code</Label>
                <Input
                  className="mt-1"
                  placeholder="6-digit PIN"
                  inputMode="numeric"
                  maxLength={6}
                  value={newForm.postalCode}
                  onChange={(e) =>
                    setNewForm((p) => ({ ...p, postalCode: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Emergency Contact Information */}
          <div>
            <div className="text-xs font-semibold text-blue-800 mb-3">
              Emergency Contact
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Contact Name</Label>
                <Input
                  className="mt-1"
                  placeholder="Contact name"
                  value={newForm.emergencyContactName}
                  onChange={(e) =>
                    setNewForm((p) => ({
                      ...p,
                      emergencyContactName: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Contact Phone</Label>
                <Input
                  className="mt-1"
                  placeholder="+91 XXXXX XXXXX"
                  value={newForm.emergencyContactPhone}
                  onChange={(e) =>
                    setNewForm((p) => ({
                      ...p,
                      emergencyContactPhone: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Relationship</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Spouse"
                  value={newForm.emergencyContactRelationship}
                  onChange={(e) =>
                    setNewForm((p) => ({
                      ...p,
                      emergencyContactRelationship: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Insurance Information */}
          <div>
            <div className="text-xs font-semibold text-blue-800 mb-3">
              Insurance
            </div>
            <div className="mb-3">
              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={newForm.hasInsurance}
                  onChange={(e) =>
                    setNewForm((p) => ({
                      ...p,
                      hasInsurance: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-blue-600"
                />
                <span className="text-xs font-medium text-gray-700">
                  Patient has health insurance
                </span>
              </label>
            </div>
            {newForm.hasInsurance && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Insurance Provider</Label>
                  <Select
                    value={newForm.insuranceProvider}
                    onValueChange={(v) =>
                      setNewForm((p) => ({ ...p, insuranceProvider: v }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {INSURANCE_PROVIDERS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Insurance ID</Label>
                  <Input
                    className="mt-1"
                    placeholder="Policy / Member ID"
                    value={newForm.insuranceId}
                    onChange={(e) =>
                      setNewForm((p) => ({ ...p, insuranceId: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 sticky bottom-0 bg-gray-100 pt-3 border-t">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setAddingNew(false);
              setNewForm(emptyNew);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                Saving…
              </>
            ) : (
              "Register & Select"
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="relative">
        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <Input
          className="pl-9"
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => search.length >= 2 && setOpen(true)}
        />
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>
      {open && search.length >= 2 && (
        <div className="border rounded-md divide-y max-h-48 overflow-y-auto bg-white shadow-sm">
          {results.length === 0 && !loading ? (
            <div className="p-3 text-center">
              <p className="text-sm text-gray-500 mb-2">
                No patients found for &ldquo;{search}&rdquo;
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  const parts = search.trim().split(/\s+/);
                  setNewForm({
                    ...emptyNew,
                    firstName: parts[0] || "",
                    lastName: parts.slice(1).join(" ") || "",
                  });
                  setAddingNew(true);
                  setOpen(false);
                }}
              >
                <UserPlus className="h-3.5 w-3.5" /> Add as new patient
              </Button>
            </div>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                className="w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between gap-2"
                onClick={() => {
                  onSelect(p);
                  setSearch("");
                  setOpen(false);
                }}
              >
                <div>
                  <p className="font-medium">{getPatientFullName(p)}</p>
                  <p className="text-xs text-gray-500">
                    UHID: {p.mrn}
                    {p.dateOfBirth &&
                      ` • DOB: ${format(new Date(p.dateOfBirth), "dd MMM yyyy")}`}
                    {p.phonePrimary && ` • ${p.phonePrimary}`}
                  </p>
                </div>
                <span className="text-xs text-blue-600 font-medium shrink-0">
                  Select
                </span>
              </button>
            ))
          )}
        </div>
      )}
      <div className="flex items-center justify-between">
        {showHint ? (
          <p className="text-xs text-gray-500">
            Search registered patients by UHID, name, or phone.
          </p>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs gap-1 text-blue-600"
          onClick={() => setAddingNew(true)}
        >
          <UserPlus className="h-3.5 w-3.5" /> Patient not in records? Add new
        </Button>
      </div>
    </div>
  );
}
