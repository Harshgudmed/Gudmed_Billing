import { format } from "date-fns";
import { toast } from "sonner";
import { drName } from "@/lib/utils";

// Patient/doctor names, complaints etc. are user-entered text — escape before
// interpolating into the HTML string below, otherwise a name like
// `<script>...</script>` would run in the print window.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Opens a printable Appointment Card in a new window.
// Pure function — pass in the appointment and the org info it needs.
export function printAppointmentCard(apt, orgInfo) {
  const win = window.open("", "_blank", "width=600,height=500");
  if (!win) {
    toast.error("Please allow pop-ups to print");
    return;
  }
  const patient = apt.patient;
  const patientName = escapeHtml(
    patient ? `${patient.firstName} ${patient.lastName}`.trim() : "Unknown Patient"
  );
  const aptDate = apt.appointmentDate
    ? format(new Date(apt.appointmentDate), "dd MMM yyyy")
    : "—";
  const printDate = format(new Date(), "dd MMM yyyy HH:mm");
  win.document
    .write(`<!DOCTYPE html><html><head><title>Appointment Card</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12pt;padding:20px;color:#000}.header{text-align:center;border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:16px}.hosp{font-size:22pt;font-weight:bold;color:#1e3a5f}.sub{font-size:10pt;color:#666;margin-top:2px}.banner{background:#1e3a5f;color:#fff;text-align:center;padding:6px;font-size:13pt;font-weight:bold;letter-spacing:2px;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;padding:12px;border:1px solid #ccc;border-radius:6px;background:#f9fafb}.label{font-size:9pt;color:#888;font-weight:bold;text-transform:uppercase}.value{font-size:12pt;font-weight:600;margin-top:2px}.apt-box{border:2px solid #1e3a5f;border-radius:8px;padding:12px;text-align:center;margin-bottom:16px;background:#eef4ff}.apt-date{font-size:20pt;font-weight:bold;color:#1e3a5f}.apt-time{font-size:15pt;color:#333;margin-top:4px}.note{font-size:9pt;color:#666;margin-top:16px;padding-top:8px;border-top:1px dashed #ccc;text-align:center}.footer{font-size:8pt;color:#999;text-align:center;margin-top:16px}@media print{body{padding:8px}}</style></head><body>
<div class="header"><div class="hosp">${escapeHtml(orgInfo.name)}</div><div class="sub">Appointment Card</div></div>
<div class="banner">APPOINTMENT CONFIRMATION</div>
<div class="grid">
<div><div class="label">Patient Name</div><div class="value">${patientName}</div></div>
<div><div class="label">UHID</div><div class="value">${escapeHtml(patient?.mrn) || "—"}</div></div>
<div><div class="label">Doctor</div><div class="value">${apt.doctor ? escapeHtml(drName(apt.doctor.fullName)) : "—"}</div></div>
<div><div class="label">Type</div><div class="value" style="text-transform:capitalize">${escapeHtml((apt.appointmentType || "General").replace("_", " "))}</div></div>
<div><div class="label">Status</div><div class="value" style="color:#15803d">${escapeHtml((apt.status || "").replace("_", " ").toUpperCase())}</div></div>

${apt.consultationFee != null ? `<div><div class="label">Consultation Fee</div><div class="value" style="color:#1e3a5f">₹${Number(apt.consultationFee).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>` : ""}
</div>
${apt.consultationFee != null ? `<div style="display:flex;justify-content:space-between;align-items:center;border:2px solid #15803d;border-radius:8px;padding:10px 16px;margin-bottom:16px;background:#f0fdf4"><span style="font-size:11pt;font-weight:bold;color:#15803d">CONSULTATION FEE</span><span style="font-size:18pt;font-weight:bold;color:#15803d">₹${Number(apt.consultationFee).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>` : ""}
<div class="apt-box"><div class="apt-date">${aptDate}</div><div class="apt-time">${apt.appointmentTime}</div></div>
${apt.chiefComplaint ? `<div style="padding:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;margin-bottom:12px"><strong>Chief Complaint:</strong> ${escapeHtml(apt.chiefComplaint)}</div>` : ""}
<div class="note">Please arrive 10 minutes early. Bring this card and any previous medical records.</div>
<div class="footer">Printed: ${printDate}</div>
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
