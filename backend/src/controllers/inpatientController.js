import { db } from "../config/db.js";
import { getOrgId, getActor, svcErr } from "../lib/reqContext.js";
import { z } from "zod";
import {
  resolvePrice,
  computeRunningBill,
  priceForPharmacyItem,
} from "../inpatient/tariffService.js";
import {
  getCurrentBill,
  generateBill,
  finalizeBill,
  cancelBill,
  cancelCharge,
} from "../inpatient/billService.js";
import {
  collectPayment,
  voidPayment,
  refund,
  collections,
} from "../inpatient/billPaymentService.js";
import { computeNews2 } from "../inpatient/nursingService.js";
import { DISCHARGE_TYPES } from "../inpatient/dischargeService.js";
import { ipdAllowed, orderAllowed } from "../inpatient/rbac.js";
import { auditIpd } from "../inpatient/audit.js";
import * as orderableSearch from "../inpatient/orderableSearch.js";
import {
  createOrder,
  transition as orderTransition,
  completeOrder,
  listOrders,
  getOrder,
} from "../inpatient/orderService.js";
import { billAnyOrder, billOrderTask, cancelOrderTaskCharge } from "../inpatient/orderBillingService.js";
import { billConsultation } from "../inpatient/consultationBillingService.js";
import { generateTasksForOrder } from "../inpatient/scheduleService.js";

// ─── Validation Schemas ───────────────────────────────────────────────────────

const wardSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().optional(),
  type: z.string().optional(),
  capacity: z.number().int().optional(),
  building: z.string().optional(),
  floor: z.string().optional(),
  chargeNurse: z.string().optional(),
  phone: z.string().optional(),
  departmentId: z.string().optional(),
});

const bedSchema = z.object({
  wardId: z.string().min(1, "Ward ID is required"),
  bedNumber: z.string().min(1, "Bed number is required"),
  type: z.string().optional(),
  status: z.string().default("available"),
});

const admissionSchema = z.object({
  patientId: z.string().min(1, "Patient ID is required"),
  bedId: z.string().optional(),
  wardId: z.string().optional(),
  admissionType: z.string().optional(),
  admissionReason: z.string().optional(),
  admissionDiagnosis: z.string().optional(),
  chiefComplaint: z.string().optional(),
  expectedLengthOfStay: z.number().int().optional(),
  depositAmount: z.number().optional(),
  admissionNotes: z.string().optional(),
  isCritical: z.boolean().optional(),
  criticalLevel: z.string().optional(),
  admittingDoctorId: z.string().optional(),
  attendingDoctorId: z.string().optional(),
});

// ─── Tenant-safety helpers ────────────────────────────────────────────────────
// Verify a row belongs to the caller's org BEFORE acting on it (closes IDOR /
// cross-tenant writes). Returns the row or null.
async function ownedAdmission(
  orgId,
  id,
  select = { id: true, bedId: true, status: true },
) {
  if (!id) return null;
  return db.admission.findFirst({
    where: { id, organizationId: orgId },
    select,
  });
}
async function ownedBed(
  orgId,
  id,
  select = { id: true, status: true, wardId: true, bedCategoryId: true },
) {
  if (!id) return null;
  return db.bed.findFirst({ where: { id, organizationId: orgId }, select });
}
async function ownedWard(orgId, id, select = { id: true }) {
  if (!id) return null;
  return db.ward.findFirst({ where: { id, organizationId: orgId }, select });
}
// Whitelists for the generic PATCH — prevents mass-assignment of org/billing/status.
const ADMISSION_UPDATABLE = [
  "admissionDiagnosis",
  "chiefComplaint",
  "admissionReason",
  "admissionNotes",
  "expectedLengthOfStay",
  "isCritical",
  "criticalLevel",
  "attendingDoctorId",
  "admittingDoctorId",
];
const BED_UPDATABLE = ["status", "type", "bedCategoryId"];
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function getAll(req, res) {
  try {
    const context = buildListContext(req);
    const { resource } = req.query;

    // Each resource → its own small, readable handler (defined below).
    // NOTE: these `resource` names are the public API contract the frontend
    // calls with — they must NOT change. Only internal handler names are new.
    if (resource === "wards")                     return await getWards(req, res, context);
    if (resource === "beds")                      return await getBeds(req, res, context);
    if (resource === "admissions")                return await getAdmissions(req, res, context);
    if (resource === "notes")                     return await getClinicalNotesLegacy(req, res, context);
    if (resource === "stats")                     return await getStats(req, res, context);
    if (resource === "tariff-preview")            return await getTariffPreview(req, res, context);
    if (resource === "running-bill")              return await getRunningBill(req, res, context);
    if (resource === "pharmacy-price")            return await getPharmacyPrice(req, res, context);
    if (resource === "bill")                      return await getBill(req, res, context);
    if (resource === "payments")                  return await getPayments(req, res, context);
    if (resource === "collections")               return await getCollections(req, res, context);
    if (resource === "bed-categories")            return await getBedCategories(req, res, context);
    if (resource === "tariff-plans")              return await getTariffPlans(req, res, context);
    if (resource === "vitals")                    return await getVitals(req, res, context);
    if (resource === "clinical-notes-v2")         return await getClinicalNotesV2(req, res, context);
    if (resource === "medication-administration") return await getMedicationAdministration(req, res, context);
    if (resource === "order-tasks")               return await getOrderTasks(req, res, context);
    if (resource === "orderables")                return await getOrderables(req, res, context);
    if (resource === "orders")                    return await getOrders(req, res, context);
    if (resource === "order")                     return await getOrderById(req, res, context);
    if (resource === "order-worklist")            return await getOrderWorklist(req, res, context);
    if (resource === "ipd-consultation")          return await getIpdConsultations(req, res, context);
    if (resource === "patient-reports")           return await getPatientReports(req, res, context);

    return res
      .status(400)
      .json({
        error:
          "Invalid resource. Use: wards, beds, admissions, notes, billing, stats, tariff-preview, running-bill, bed-categories, tariff-plans, orderables, orders, order, order-worklist, ipd-consultation",
      });
  } catch (err) {
    console.error("inpatient getAll error:", err);
    if (err?.status)
      return res
        .status(err.status)
        .json({ success: false, code: err.code, error: err.message });
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── getAll helpers ─────────────────────────────────────────────────────────
// These split the (formerly 640-line) getAll into one small dispatcher above
// plus one focused handler per resource. Behaviour and JSON responses are
// identical to before — only the structure changed.

/**
 * Shared read-context for every inpatient list endpoint.
 *  - orgId               : current organization (tenant isolation)
 *  - limit/offset        : general lists (admissions) — capped 1..1000
 *  - clinLimit/clinOffset: clinical time-series (vitals/notes/meds) — bigger cap
 */
function buildListContext(req) {
  const orgId = getOrgId(req);

  let limit = parseInt(req.query.limit) || 10;
  let offset = parseInt(req.query.offset) || 0;
  limit = Math.max(1, Math.min(limit, 1000));
  offset = Math.max(0, offset);

  // Clinical time-series: never silently truncate — paginate with a generous cap.
  const clinLimit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const clinOffset = Math.max(0, parseInt(req.query.offset) || 0);

  return { orgId, limit, offset, clinLimit, clinOffset };
}

/**
 * Latest bill per admission → { [admissionId]: bill }.
 * Prefer the latest FINAL bill; fall back to the latest bill of any status.
 */
async function buildBillSummaryMap(orgId, admissions) {
  const admissionIds = admissions.map((admission) => admission.id);
  if (!admissionIds.length) return {};
  const bills = await db.bill.findMany({
    where: { organizationId: orgId, admissionId: { in: admissionIds } },
    orderBy: { createdAt: "desc" },
    select: {
      admissionId: true,
      billNumber: true,
      status: true,
      billType: true,
      payableTotal: true,
      finalizedAt: true,
    },
  });
  // Har admission ke liye sabse sahi bill chuno:
  // pehla (newest) rakho, par koi FINAL mile to usko upgrade kar do.
  const billByAdmission = {};
  for (const bill of bills) {
    const best = billByAdmission[bill.admissionId];

    const noBillYet = !best;
    const upgradeToFinal =
      best && best.status !== "FINAL" && bill.status === "FINAL";

    if (noBillYet || upgradeToFinal) {
      billByAdmission[bill.admissionId] = bill;
    }
  }
  return billByAdmission;
}

/**
 * Transfer (ward-movement) notes per admission → { [admissionId]: [{ note, date, authorName }] }.
 * Reads the ClinicalNote table (noteType='transfer') in one batched query.
 */
async function buildTransferNotesMap(orgId, admissions) {
  const admissionIds = admissions.map((a) => a.id);
  if (!admissionIds.length) return {};
  const rows = await db.clinicalNote.findMany({
    where: {
      organizationId: orgId,
      admissionId: { in: admissionIds },
      noteType: "transfer",
    },
    orderBy: { authoredAt: "asc" },
    select: { admissionId: true, body: true, authorName: true, authoredAt: true },
  });
  const map = {};
  for (const r of rows) {
    (map[r.admissionId] ||= []).push({
      note: r.body,
      date: r.authoredAt,
      authorName: r.authorName || "—",
    });
  }
  return map;
}

// Ward capacity cards — Capacity/Occupied/Available/Occupancy% per ward (dashboard).
async function getWards(req, res, context) {
  const wards = await db.ward.findMany({
    where: { organizationId: context.orgId, isActive: true },
    include: {
      beds: true,
      department: { select: { id: true, name: true } },
    },
  });

  // Numbers ACTUAL bed records se nikalo (single source of truth) — taaki
  // capacity field aur asli beds kabhi mismatch karein, tab bhi
  // Capacity/Occupied/Available hamesha aapas me consistent rahein.
  const data = wards.map((ward) => {
    const totalBeds = ward.beds.length || ward.capacity || 0;
    const occupiedBeds = ward.beds.filter((b) => b.status === "occupied").length;
    return {
      ...ward,
      totalBeds,
      occupiedBeds,
      availableBeds: totalBeds - occupiedBeds,
      occupancyRate:
        totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
    };
  });

  return res.json({ success: true, data });
}

async function getBeds(req, res, context) {
  const { wardId, status } = req.query;
  const where = { organizationId: context.orgId };
  if (wardId) where.wardId = wardId;
  if (status) where.status = status;

  const beds = await db.bed.findMany({ where, include: { ward: true } });
  return res.json({ success: true, data: beds });
}

async function getAdmissions(req, res, context) {
  const { orgId, limit, offset } = context;
  const { status } = req.query;

  const where = { organizationId: orgId };
  if (status) where.status = status;
  // Doctor portal: `mine=true` limits to the logged-in doctor's own patients
  // (attending or admitting). Scopes "see only my patients" without new endpoints.
  if (req.query.mine === "true" && req.user?.id) {
    where.OR = [
      { attendingDoctorId: req.user.id },
      { admittingDoctorId: req.user.id },
    ];
  }

  const [admissions, total] = await Promise.all([
    db.admission.findMany({
      where,
      include: {
        patient: {
          select: {
            id: true,
            mrn: true,
            firstName: true,
            lastName: true,
            gender: true,
            dateOfBirth: true,
            phonePrimary: true,
          },
        },
        bed: {
          include: {
            ward: {
              include: { department: { select: { id: true, name: true } } },
            },
          },
        },
        // Doctor names come straight from the relation now (no manual lookup).
        attendingDoctor: { select: { id: true, fullName: true } },
        admittingDoctor: { select: { id: true, fullName: true } },
      },
      orderBy: { admissionDate: "desc" },
      take: limit,
      skip: offset,
    }),
    db.admission.count({ where }),
  ]);

  const billByAdm = await buildBillSummaryMap(orgId, admissions);
  const transfersByAdm = await buildTransferNotesMap(orgId, admissions);

  // Pull the relation objects OUT of the spread so the response shape stays
  // EXACTLY as before — only attendingDoctorName/admittingDoctorName are exposed.
  // transferNotes (from the ClinicalNote table) powers the Movement tab.
  const data = admissions.map(({ attendingDoctor, admittingDoctor, ...a }) => ({
    ...a,
    attendingDoctorName: attendingDoctor?.fullName || null,
    admittingDoctorName: admittingDoctor?.fullName || null,
    billSummary: billByAdm[a.id] || null,
    transferNotes: transfersByAdm[a.id] || [],
  }));

  const hasMore = offset + limit < total;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return res.json({
    success: true,
    data,
    meta: { total, limit, offset, page, totalPages, hasMore },
  });
}

async function getClinicalNotesLegacy(req, res, context) {
  const { admissionId } = req.query;
  if (!admissionId)
    return res
      .status(400)
      .json({ success: false, error: "admissionId required" });
  // All notes (incl. backfilled history + transfers) now live in the ClinicalNote table.
  const rows = await db.clinicalNote.findMany({
    where: { admissionId, organizationId: context.orgId },
    orderBy: { authoredAt: "asc" },
  });
  // Reshape each DB note (ClinicalNote) into the simpler shape the View-Admission
  // dialog expects. Keep these field names — InpatientModule renders n.type,
  // n.text and n.createdAt, so renaming any of them would break the frontend.
  //   DB field      →  frontend field
  //   noteType      →  type        (falls back to "Note" if not set)
  //   body          →  text
  //   authoredAt    →  createdAt
  const data = rows.map((note) => ({
    id: note.id,
    type: note.noteType || "Note",
    text: note.body,
    createdAt: note.authoredAt,
    vitals: note.vitals || null,
  }));
  return res.json({ success: true, data });
}

async function getStats(req, res, context) {
  const { orgId } = context;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [totalBeds, occupiedBeds, todayAdmissions, todayDischarges] =
    await Promise.all([
      db.bed.count({ where: { organizationId: orgId } }),
      db.bed.count({
        where: { organizationId: orgId, status: "occupied" },
      }),
      db.admission.count({
        where: {
          organizationId: orgId,
          status: "admitted",
          admissionDate: { gte: todayStart, lte: todayEnd },
        },
      }),
      db.admission.count({
        where: {
          organizationId: orgId,
          status: "discharged",
          dischargeDate: { gte: todayStart, lte: todayEnd },
        },
      }),
    ]);

  const availableBeds = totalBeds - occupiedBeds;
  const occupancyRate =
    totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

  return res.json({
    success: true,
    data: {
      totalBeds,
      occupiedBeds,
      availableBeds,
      todayAdmissions,
      todayDischarges,
      occupancyRate,
    },
  });
}

// ── Enterprise tariff engine ────────────────────────────────────────────
async function getTariffPreview(req, res, context) {
  const { orgId } = context;
  const { admissionId, itemCode, base, serviceGroup, serviceDate } = req.query;
  if (!admissionId)
    return res
      .status(400)
      .json({ success: false, error: "admissionId required" });
  if (!(await ownedAdmission(orgId, admissionId)))
    return res
      .status(404)
      .json({ success: false, error: "Admission not found" });
  try {
    const result = await resolvePrice(orgId, admissionId, {
      itemCode,
      base: base !== undefined ? Number(base) : undefined,
      serviceGroup,
      serviceDate,
    });
    return res.json({ success: true, data: result });
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ success: false, error: e.message });
  }
}

async function getRunningBill(req, res, context) {
  const { orgId } = context;
  const { admissionId } = req.query;
  if (!admissionId)
    return res
      .status(400)
      .json({ success: false, error: "admissionId required" });
  if (!(await ownedAdmission(orgId, admissionId)))
    return res
      .status(404)
      .json({ success: false, error: "Admission not found" });
  try {
    const bill = await computeRunningBill(orgId, admissionId);
    return res.json({ success: true, data: bill });
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ success: false, error: e.message });
  }
}

// Hidden dynamic pharmacy pricing — auto-pop the final price for a drug.
// Normal users get only the final numbers; admins additionally get the breakdown.
async function getPharmacyPrice(req, res, context) {
  const { orgId } = context;
  const { admissionId, drugId, quantity } = req.query;
  if (!admissionId || !drugId)
    return res
      .status(400)
      .json({ success: false, error: "admissionId and drugId required" });
  if (!(await ownedAdmission(orgId, admissionId)))
    return res
      .status(404)
      .json({ success: false, error: "Admission not found" });
  try {
    const r = await priceForPharmacyItem(orgId, admissionId, drugId, {
      quantity,
    });
    const isAdmin =
      req.user?.role === "admin" || req.user?.role === "super_admin";
    const { breakdown, ...visible } = r;
    // Role-based visibility: breakdown (base price, markup rule, plan) admins only.
    return res.json({ success: true, data: isAdmin ? r : visible });
  } catch (e) {
    return res
      .status(e.status || 500)
      .json({ success: false, error: e.message });
  }
}

// Phase 1: the persisted bill (current open DRAFT, else latest) + frozen line items.
async function getBill(req, res, context) {
  const { orgId } = context;
  const { admissionId } = req.query;
  if (!admissionId)
    return res
      .status(400)
      .json({ success: false, error: "admissionId required" });
  if (!(await ownedAdmission(orgId, admissionId)))
    return res
      .status(404)
      .json({ success: false, error: "Admission not found" });
  const bill = await getCurrentBill(orgId, admissionId);
  const allBills = await db.bill.findMany({
    where: { organizationId: orgId, admissionId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      billNumber: true,
      status: true,
      billType: true,
      payableTotal: true,
      finalizedAt: true,
      createdAt: true,
    },
  });
  return res.json({ success: true, data: bill, history: allBills });
}

// Phase 2: payment ledger for a bill (or whole admission via floating payments)
async function getPayments(req, res, context) {
  const { orgId } = context;
  const { billId, admissionId } = req.query;
  if (!billId && !admissionId)
    return res
      .status(400)
      .json({ success: false, error: "billId or admissionId required" });
  const where = { organizationId: orgId };
  if (billId) where.billId = billId;
  if (admissionId) {
    where.admissionId = admissionId;
    if (!(await ownedAdmission(orgId, admissionId)))
      return res
        .status(404)
        .json({ success: false, error: "Admission not found" });
  }
  const rows = await db.billPayment.findMany({
    where,
    orderBy: { paidAt: "desc" },
  });
  return res.json({ success: true, data: rows });
}

// Phase 2: cashier daily/shift collection report
async function getCollections(req, res, context) {
  const { from, to, cashierId } = req.query;
  const report = await collections(context.orgId, { from, to, cashierId });
  return res.json({ success: true, data: report });
}

async function getBedCategories(req, res, context) {
  const cats = await db.bedCategory.findMany({
    where: { organizationId: context.orgId, isActive: true },
    orderBy: { rank: "asc" },
  });
  return res.json({ success: true, data: cats });
}

async function getTariffPlans(req, res, context) {
  const plans = await db.tariffPlan.findMany({
    where: { organizationId: context.orgId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  return res.json({ success: true, data: plans });
}

// ── Phase 2: Nursing station — shared clinical time-series list ──────────────
// vitals, clinical-notes-v2 and medication-administration are the SAME query
// shape (filter by admission, paginate, return data+meta). One helper, three
// thin wrappers — instead of three near-identical 25-line blocks.
async function clinicalTimeSeries(req, res, context, model, orderBy) {
  const { admissionId } = req.query;
  if (!admissionId)
    return res
      .status(400)
      .json({ success: false, error: "admissionId required" });
  const where = { organizationId: context.orgId, admissionId };
  const [data, total] = await Promise.all([
    db[model].findMany({
      where,
      orderBy,
      take: context.clinLimit,
      skip: context.clinOffset,
    }),
    db[model].count({ where }),
  ]);
  return res.json({
    success: true,
    data,
    meta: {
      total,
      limit: context.clinLimit,
      offset: context.clinOffset,
      hasMore: context.clinOffset + context.clinLimit < total,
    },
  });
}

const getVitals = (req, res, context) =>
  clinicalTimeSeries(req, res, context, "vitalsRecord", { recordedAt: "desc" });

const getClinicalNotesV2 = (req, res, context) =>
  clinicalTimeSeries(req, res, context, "clinicalNote", { authoredAt: "desc" });

const getMedicationAdministration = (req, res, context) =>
  clinicalTimeSeries(req, res, context, "medicationAdministration", [
    { scheduledAt: "desc" },
    { createdAt: "desc" },
  ]);

// ── Phase 3C: Scheduled order tasks (Treatment Chart) ──
async function getOrderTasks(req, res, context) {
  const { admissionId } = req.query;
  if (!admissionId)
    return res
      .status(400)
      .json({ success: false, error: "admissionId required" });
  const tasks = await db.orderTask.findMany({
    where: { organizationId: context.orgId, admissionId },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });
  return res.json({ success: true, data: tasks });
}

// ── Phase 3A: Clinical Orders (reads; ungated like other IPD reads) ──
async function getOrderables(req, res, context) {
  const data = await orderableSearch.search(context.orgId, {
    q: req.query.q,
    type: req.query.type,
  });
  return res.json({ success: true, data });
}

async function getOrders(req, res, context) {
  const data = await listOrders(context.orgId, {
    admissionId: req.query.admissionId,
    type: req.query.type,
    status: req.query.status,
  });
  return res.json({ success: true, data });
}

async function getOrderById(req, res, context) {
  if (!req.query.id)
    return res.status(400).json({ success: false, error: "id required" });
  const data = await getOrder(context.orgId, req.query.id);
  return res.json({ success: true, data });
}

async function getOrderWorklist(req, res, context) {
  const data = await listOrders(context.orgId, {
    type: req.query.type,
    status: req.query.status,
    withContext: true,
  });
  return res.json({ success: true, data });
}

// ── ipd-consultation GET ──────────────────────────────────────────────────
async function getIpdConsultations(req, res, context) {
  const where = { organizationId: context.orgId };
  if (req.query.admissionId) where.admissionId = req.query.admissionId;
  if (req.query.status) where.status = req.query.status;
  // Doctor portal: mine=true → consultations assigned to me OR requested by me
  if (req.query.mine === "true" && req.user?.id) {
    where.OR = [
      { consultingDoctorId: req.user.id },
      { requestedById: req.user.id },
    ];
  }
  const consultations = await db.ipdConsultation.findMany({
    where,
    include: {
      consultingDoctor: { select: { id: true, fullName: true } },
      requestedBy: { select: { id: true, fullName: true } },
      department: { select: { id: true, name: true } },
      ipdCharge: { select: { id: true, lineTotal: true, status: true } },
    },
    orderBy: { requestedAt: "desc" },
  });
  return res.json({ success: true, data: consultations });
}

// ── Lab + Radiology reports for a patient (doctor's IPD "Reports" tab) ──
// The Laboratory/Radiology modules store results keyed by patientId (separate
// from the IPD CPOE spine). The admission gives us the patientId, so we read
// both result sets and merge them into one date-sorted list the doctor can read
// without leaving the inpatient screen. Read-only.
async function getPatientReports(req, res, context) {
  const { orgId } = context;
  const { admissionId } = req.query;
  if (!admissionId)
    return res
      .status(400)
      .json({ success: false, error: "admissionId required" });
  const adm = await ownedAdmission(orgId, admissionId, {
    id: true,
    patientId: true,
  });
  if (!adm)
    return res
      .status(404)
      .json({ success: false, error: "Admission not found" });

  const [labOrders, radOrders] = await Promise.all([
    db.labOrder.findMany({
      where: { organizationId: orgId, patientId: adm.patientId },
      orderBy: { orderDate: "desc" },
      include: { results: true },
    }),
    db.radiologyOrder.findMany({
      where: { organizationId: orgId, patientId: adm.patientId },
      orderBy: { orderDate: "desc" },
      include: {
        exam: { select: { examName: true, examCode: true } },
        report: true,
      },
    }),
  ]);

  // Lab: the ordered test names live in a JSON column; map testId → name so each
  // result row can show a readable test name alongside its value/flag.
  const labReports = labOrders.map((o) => {
    let tests = [];
    try {
      tests = JSON.parse(o.tests || "[]");
    } catch {
      tests = [];
    }
    const nameByTestId = Object.fromEntries(
      tests.map((t) => [t.testId, t.testName]),
    );
    return {
      kind: "LAB",
      id: o.id,
      orderNumber: o.orderNumber,
      name:
        tests.map((t) => t.testName).filter(Boolean).join(", ") || "Lab Panel",
      date: o.resultsReportedAt || o.orderDate,
      status: o.status,
      results: (o.results || []).map((r) => ({
        testName: nameByTestId[r.testId] || r.testId,
        value: r.resultValue,
        unit: r.resultUnit || "",
        flag: r.flag || null,
        isAbnormal: r.isAbnormal,
        isCritical: r.isCritical,
        refRange: r.referenceRangeText || null,
      })),
    };
  });

  const radReports = radOrders.map((o) => ({
    kind: "RADIOLOGY",
    id: o.id,
    orderNumber: o.orderNumber,
    name: o.exam?.examName || "Radiology Exam",
    date: o.report?.reportedAt || o.orderDate,
    status: o.status,
    findings: o.report?.findings || null,
    impression: o.report?.impression || null,
    hasCriticalFindings: o.report?.hasCriticalFindings || false,
    reportStatus: o.report?.status || null,
  }));

  const data = [...labReports, ...radReports].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );
  return res.json({ success: true, data });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function create(req, res) {
  try {
    const orgId =
      getOrgId(req);
    const { resource, ...body } = req.body;

    if (!ipdAllowed(req, resource)) {
      return res
        .status(403)
        .json({
          success: false,
          code: "FORBIDDEN",
          error: `Your role may not perform this IPD action (${resource})`,
        });
    }

    if (resource === "ipd-consultation") return await createConsultation(req, res, orgId, body);
    if (resource === "ward")             return await createWard(req, res, orgId, body);
    if (resource === "bed")              return await createBed(req, res, orgId, body);
    if (resource === "admission")        return await createAdmission(req, res, orgId, body);
    if (resource === "transfer")         return await createTransfer(req, res, orgId, body);
    if (resource === "sync-beds")        return await syncBeds(req, res, orgId, body);

    if (resource === "note")                      return await createNoteLegacy(req, res, orgId, body);
    if (resource === "post-charge")               return await createPostCharge(req, res, orgId, body);
    if (resource === "vitals")                    return await createVitals(req, res, orgId, body);
    if (resource === "note-v2")                   return await createNoteV2(req, res, orgId, body);
    if (resource === "medication-administration") return await createMedicationAdministration(req, res, orgId, body);

    if (resource === "bill-generate")     return await createBillGenerate(req, res, orgId, body);
    if (resource === "bill-finalize")      return await createBillFinalize(req, res, orgId, body);
    if (resource === "bill-cancel")        return await createBillCancel(req, res, orgId, body);
    if (resource === "payment")            return await createPayment(req, res, orgId, body);
    if (resource === "void-payment")       return await createVoidPayment(req, res, orgId, body);
    if (resource === "refund")             return await createRefund(req, res, orgId, body);
    if (resource === "cancel-charge")      return await createCancelCharge(req, res, orgId, body);
    if (resource === "discharge-finalize") return await createDischargeFinalize(req, res, orgId, body);
    if (resource === "mark-exit")          return await createMarkExit(req, res, orgId, body);
    if (resource === "order")              return await createOrderResource(req, res, orgId, body);
    if (
      resource === "order-ack" ||
      resource === "order-start" ||
      resource === "order-cancel"
    )
      return await createOrderTransition(req, res, orgId, body, resource);
    if (resource === "order-complete")     return await createOrderComplete(req, res, orgId, body);

    return res
      .status(400)
      .json({
        error:
          "Invalid resource. Use: ward, bed, admission, note, billing, charge, sync-beds, transfer, post-charge, vitals, note-v2, medication-administration, discharge-finalize, mark-exit, order, order-ack, order-start, order-complete, order-cancel",
      });
  } catch (err) {
    console.error("inpatient create error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── create helpers ──────────────────────────────────────────────────────────
// One focused handler per POST resource. Same behaviour & JSON as the old inline
// blocks — only the structure changed (create() is now a thin dispatcher).

async function createConsultation(req, res, orgId, body) {
      const { admissionId, consultingDoctorId, departmentId,
               referralReason, scheduledAt } = body;
      if (!admissionId || !consultingDoctorId) {
        return res.status(400).json({ success: false, error: "admissionId and consultingDoctorId are required" });
      }
      const admission = await ownedAdmission(orgId, admissionId);
      if (!admission)
        return res.status(404).json({ success: false, error: "Admission not found" });
      if (admission.status !== "admitted")
        return res.status(409).json({ success: false, error: "Patient is not currently admitted" });

      let consultation;
      try {
        const actor = {
          id: req.user?.id || req.user?.userId || null,
          name: req.user?.fullName || null,
          role: req.user?.role || null,
        };
        const result = await db.$transaction(async (tx) => {
          const consult = await tx.ipdConsultation.create({
            data: {
              organizationId:    orgId,
              admissionId,
              consultingDoctorId,
              requestedById:     actor.id,
              departmentId:      departmentId  || null,
              referralReason:    referralReason || null,
              scheduledAt:       scheduledAt ? new Date(scheduledAt) : null,
              status:            "REQUESTED",
            },
          });
          // Bills the consultation as a side-effect inside the same transaction.
          // We don't need the returned charge here — only the consultation is sent back.
          await billConsultation(tx, orgId, consult, actor);
          return { consultation: consult };
        });
        consultation = result.consultation;
      } catch (err) {
        console.error("Consultation creation/billing error:", err);
        return res.status(500).json({ success: false, error: "Failed to create and bill consultation" });
      }
      await auditIpd(req, orgId, { action: "create", entityType: "ipd.consultation", entityId: consultation.id, newValues: consultation });
      return res.status(201).json({ success: true, data: consultation });
}

async function createWard(req, res, orgId, body) {
      const parsed = wardSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const capacity = Math.max(1, parseInt(parsed.data.capacity) || 10);
      const ward = await db.ward.create({
        data: {
          ...parsed.data,
          capacity,
          organizationId: orgId,
          isActive: true,
        },
      });

      await db.bed.createMany({
        data: Array.from({ length: capacity }, (_, i) => ({
          organizationId: orgId,
          wardId: ward.id,
          bedNumber: String(i + 1),
          type: "Standard",
          status: "available",
        })),
      });

      const wardWithBeds = await db.ward.findUnique({
        where: { id: ward.id },
        include: { beds: true },
      });

      return res.status(201).json({ success: true, data: wardWithBeds });
}

async function createBed(req, res, orgId, body) {
      const parsed = bedSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const bed = await db.bed.create({
        data: {
          ...parsed.data,
          organizationId: orgId,
        },
        include: { ward: true },
      });

      return res.status(201).json({ success: true, data: bed });
}

async function createAdmission(req, res, orgId, body) {
      const parsed = admissionSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const { bedId, wardId: _wardId, ...admissionData } = parsed.data;

      // H4: one active admission per patient.
      const activeForPatient = await db.admission.findFirst({
        where: {
          organizationId: orgId,
          patientId: admissionData.patientId,
          status: "admitted",
        },
        select: { id: true },
      });
      if (activeForPatient) {
        return res
          .status(409)
          .json({
            success: false,
            code: "IPD_PATIENT_ALREADY_ADMITTED",
            error: "Patient already has an active admission",
          });
      }

      // Resolve the default payer plan up-front (read; safe outside the tx).
      const payerType = body.payerType || "CASH";
      const plan =
        (await db.tariffPlan.findFirst({
          where: {
            organizationId: orgId,
            payerType,
            isDefault: true,
          },
        })) ||
        (await db.tariffPlan.findFirst({
          where: { organizationId: orgId, payerType },
        })) ||
        (await db.tariffPlan.findFirst({
          where: { organizationId: orgId, isDefault: true },
        }));

      let admission;
      try {
        admission = await db.$transaction(async (tx) => {
          // C3: atomically claim the bed — only succeeds if it is currently available.
          let bedCategoryId = null;
          if (bedId) {
            const claimed = await tx.bed.updateMany({
              where: {
                id: bedId,
                organizationId: orgId,
                status: "available",
              },
              data: { status: "occupied" },
            });
            if (claimed.count !== 1) {
              throw Object.assign(new Error("Bed is no longer available"), {
                status: 409,
                code: "IPD_BED_UNAVAILABLE",
              });
            }
            const bed = await tx.bed.findUnique({
              where: { id: bedId },
              select: { bedCategoryId: true },
            });
            bedCategoryId = bed?.bedCategoryId || null;
          }

          const adm = await tx.admission.create({
            data: {
              ...admissionData,
              ...(bedId ? { bedId } : {}),
              organizationId: orgId,
              status: "admitted",
              admissionState: "ADMITTED",
              admissionDate: new Date(),
            },
            include: {
              patient: {
                select: {
                  id: true,
                  mrn: true,
                  firstName: true,
                  lastName: true,
                  gender: true,
                  dateOfBirth: true,
                  phonePrimary: true,
                },
              },
              bed: { include: { ward: true } },
            },
          });

          if (bedId) {
            await tx.bedOccupancy.create({
              data: {
                organizationId: orgId,
                admissionId: adm.id,
                bedId,
                bedCategoryId,
                startAt: adm.admissionDate,
                reason: "ADMIT",
              },
            });
          }
          if (plan) {
            await tx.patientTariff.create({
              data: {
                organizationId: orgId,
                admissionId: adm.id,
                planId: plan.id,
                payerType,
              },
            });
          }
          return adm;
        });
      } catch (e) {
        if (e.status)
          return res
            .status(e.status)
            .json({ success: false, code: e.code, error: e.message });
        // DB-level partial unique indexes (active admission per patient / open occupancy per bed)
        if (e.code === "P2002")
          return res
            .status(409)
            .json({
              success: false,
              code: "IPD_CONFLICT",
              error:
                "Patient already admitted or bed already occupied (DB guard)",
            });
        throw e;
      }

      await auditIpd(req, orgId, {
        action: "create",
        entityType: "ipd.admission",
        entityId: admission.id,
        after: {
          patientId: admission.patientId,
          bedId: admission.bedId,
          admissionType: admission.admissionType,
        },
      });
      return res.status(201).json({ success: true, data: admission });
}

async function createTransfer(req, res, orgId, body) {
      const { admissionId, toBedId, transferReason, authorName } = body;
      if (!admissionId || !toBedId) {
        return res
          .status(400)
          .json({ success: false, error: "admissionId and toBedId required" });
      }
      const admission = await db.admission.findFirst({
        where: { id: admissionId, organizationId: orgId },
      });
      if (!admission)
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      if (admission.status !== "admitted")
        return res
          .status(409)
          .json({
            success: false,
            error: "Only an admitted patient can be transferred",
          });
      if (admission.bedId === toBedId)
        return res
          .status(400)
          .json({ success: false, error: "Patient is already in that bed" });

      // Resolve from/to bed + ward names so the Movement tab can render the journey.
      const [fromBed, toBed] = await Promise.all([
        admission.bedId
          ? db.bed.findFirst({
              where: { id: admission.bedId, organizationId: orgId },
              include: { ward: true },
            })
          : null,
        db.bed.findFirst({
          where: { id: toBedId, organizationId: orgId },
          include: { ward: true },
        }),
      ]);
      if (!toBed)
        return res
          .status(404)
          .json({ success: false, error: "Target bed not found" });
      const fromWardName = fromBed?.ward?.name || "Unknown Ward";
      const fromBedNo = fromBed?.bedNumber || "—";
      const toWardName = toBed?.ward?.name || "Unknown Ward";
      const toBedNo = toBed?.bedNumber || "—";

      const transferText = `WARD TRANSFER NOTE: Patient moved from ${fromWardName} (Bed ${fromBedNo}) to ${toWardName} (Bed ${toBedNo}).${transferReason ? ` Reason: ${transferReason}` : ""}`;
      const now = new Date();

      let updated;
      try {
        updated = await db.$transaction(async (tx) => {
          // C3: atomically claim the destination bed (must be available).
          const claimed = await tx.bed.updateMany({
            where: {
              id: toBedId,
              organizationId: orgId,
              status: "available",
            },
            data: { status: "occupied" },
          });
          if (claimed.count !== 1)
            throw Object.assign(
              new Error("Target bed is no longer available"),
              { status: 409, code: "IPD_BED_UNAVAILABLE" },
            );

          // Free the old bed (housekeeping removed → straight to available).
          if (admission.bedId) {
            await tx.bed.update({
              where: { id: admission.bedId },
              data: { status: "available" },
            });
          }
          // Close + open occupancy segments.
          await tx.bedOccupancy.updateMany({
            where: { admissionId, endAt: null },
            data: { endAt: now },
          });
          await tx.bedOccupancy.create({
            data: {
              organizationId: orgId,
              admissionId,
              bedId: toBedId,
              bedCategoryId: toBed?.bedCategoryId || null,
              startAt: now,
              reason: "TRANSFER",
            },
          });
          // Transfer note now lives in the proper ClinicalNote table (noteType:'transfer'),
          // inside the same transaction — no more JSON read-modify-write on the admission.
          await tx.clinicalNote.create({
            data: {
              organizationId: orgId,
              admissionId,
              noteType: "transfer",
              body: transferText,
              authorName: authorName || "System",
              authoredAt: now,
            },
          });
          return tx.admission.update({
            where: { id: admissionId },
            data: {
              bedId: toBedId,
              status: "admitted",
            },
            include: {
              patient: {
                select: {
                  id: true,
                  mrn: true,
                  firstName: true,
                  lastName: true,
                },
              },
              bed: { include: { ward: true } },
            },
          });
        });
      } catch (e) {
        if (e.status)
          return res
            .status(e.status)
            .json({ success: false, code: e.code, error: e.message });
        if (e.code === "P2002")
          return res
            .status(409)
            .json({
              success: false,
              code: "IPD_BED_UNAVAILABLE",
              error: "Target bed already has an open occupancy (DB guard)",
            });
        throw e;
      }
      await auditIpd(req, orgId, {
        action: "transfer",
        entityType: "ipd.admission",
        entityId: admissionId,
        before: { bedId: admission.bedId },
        after: { bedId: toBedId, reason: transferReason || null },
      });
      return res.json({ success: true, data: updated });
}

async function syncBeds(req, res, orgId, body) {
      const { wardId } = body;
      if (!wardId)
        return res
          .status(400)
          .json({ success: false, error: "wardId required" });

      const ward = await db.ward.findFirst({
        where: { id: wardId, organizationId: orgId },
        include: { beds: true },
      });
      if (!ward)
        return res
          .status(404)
          .json({ success: false, error: "Ward not found" });

      const capacity = Math.max(ward.beds.length, ward.capacity || 10);
      const existingNumbers = new Set(ward.beds.map((b) => b.bedNumber));
      const toCreate = [];
      for (let i = 1; i <= capacity; i++) {
        const num = String(i);
        if (!existingNumbers.has(num)) {
          toCreate.push({
            organizationId: orgId,
            wardId,
            bedNumber: num,
            type: "Standard",
            status: "available",
          });
        }
      }
      if (toCreate.length > 0) await db.bed.createMany({ data: toCreate });

      const wardWithBeds = await db.ward.findUnique({
        where: { id: wardId },
        include: { beds: { orderBy: { bedNumber: "asc" } } },
      });
      return res.json({ success: true, data: wardWithBeds });
}

async function createNoteLegacy(req, res, orgId, body) {
      // Frontend-friendly alias: accepts { admissionId, type, text, vitals: {bp,temp,pulse,spo2,weight} }
      const { admissionId, type, text, vitals } = body;
      if (!admissionId || !text)
        return res
          .status(400)
          .json({ success: false, error: "admissionId and text required" });
      const admission = await db.admission.findFirst({
        where: { id: admissionId, organizationId: orgId },
        select: { id: true },
      });
      if (!admission)
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      // Write to the proper ClinicalNote table — one INSERT, no read-modify-write,
      // so two nurses adding notes at once can't overwrite each other (old JSON bug).
      const note = await db.clinicalNote.create({
        data: {
          organizationId: orgId,
          admissionId,
          noteType: type || "Other notes",
          body: text,
          authorId: req.user?.id || null,
          authorName: body.authorName || req.user?.fullName || null,
          vitals: vitals || undefined,
        },
      });
      return res
        .status(201)
        .json({
          success: true,
          data: {
            id: note.id,
            type: note.noteType,
            text: note.body,
            createdAt: note.authoredAt,
            vitals: note.vitals || null,
          },
        });
}

// Enterprise: post a charge line, auto-priced by the tariff engine (idempotent per source).
// Two modes: pharmacyDrugId (price from pharmacy catalog + ward markup + GST) OR
// itemCode / description+base (generic tariff item).
async function createPostCharge(req, res, orgId, body) {
      const {
        admissionId,
        pharmacyDrugId,
        itemCode,
        description,
        serviceGroup,
        base,
        quantity,
        serviceDate,
        sourceModule,
        sourceRef,
      } = body;
      if (
        !admissionId ||
        (!pharmacyDrugId && !itemCode && (!description || base === undefined))
      ) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "admissionId and (pharmacyDrugId OR itemCode OR description+base) required",
          });
      }
      const admissionBelongsToOrg = await ownedAdmission(
        orgId,
        admissionId,
      );
      if (!admissionBelongsToOrg) {
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      }
      // Idempotency: skip if this source line was already posted (org-scoped).
      if (sourceModule && sourceRef) {
        const dup = await db.ipdCharge
          .findFirst({
            where: { organizationId: orgId, sourceModule, sourceRef },
          })
          .catch(() => null);
        if (dup) return res.json({ success: true, data: dup, deduped: true });
      }

      const r2 = (n) => Math.round((n || 0) * 100) / 100;
      const discountPct = Number(body.discountPct) || 0;
      let chargeData;
      try {
        if (pharmacyDrugId) {
          // Pharmacy item: base from catalog, ward markup applied, GST captured.
          const p = await priceForPharmacyItem(
            orgId,
            admissionId,
            pharmacyDrugId,
            { quantity, serviceDate },
          );
          const gross = r2(p.unitPrice * p.quantity);
          const discountAmount = r2((gross * discountPct) / 100);
          const taxable = r2(gross - discountAmount);
          const taxAmount = r2((taxable * (p.taxPct || 0)) / 100);
          chargeData = {
            chargeItemId: null,
            description:
              description ||
              `${p.drug.name}${p.drug.form ? ` (${p.drug.form})` : ""}`,
            serviceGroup: "PHARMACY",
            unitPrice: p.unitPrice,
            quantity: p.quantity,
            taxPct: p.taxPct || 0,
            taxAmount,
            discountPct,
            discountAmount,
            lineTotal: r2(taxable + taxAmount),
            resolvedFrom: {
              ...p.breakdown,
              pharmacyDrugId: p.drug.id,
              gstPct: p.taxPct,
            },
          };
        } else {
          const priced = await resolvePrice(orgId, admissionId, {
            itemCode,
            base: base !== undefined ? Number(base) : undefined,
            serviceGroup,
            serviceDate,
          });
          const qty = parseFloat(quantity) || 1;
          // Frozen tax from the charge master (if this maps to one), else 0.
          let taxPct = 0;
          if (priced.chargeItem?.id) {
            const cm = await db.chargeMaster
              .findUnique({
                where: { id: priced.chargeItem.id },
                select: { taxRatePct: true },
              })
              .catch(() => null);
            taxPct = cm?.taxRatePct || 0;
          }
          const gross = r2(priced.price * qty);
          const discountAmount = r2((gross * discountPct) / 100);
          const taxable = r2(gross - discountAmount);
          const taxAmount = r2((taxable * taxPct) / 100);
          chargeData = {
            chargeItemId: priced.chargeItem?.id || null,
            description: description || priced.chargeItem?.name || itemCode,
            serviceGroup: priced.serviceGroup || serviceGroup || "OTHER",
            unitPrice: priced.price,
            quantity: qty,
            taxPct,
            taxAmount,
            discountPct,
            discountAmount,
            lineTotal: r2(taxable + taxAmount),
            resolvedFrom: {
              planId: priced.plan?.id,
              bedCategoryId: priced.bedCategoryId,
              ruleId: priced.rule?.id,
              base: priced.base,
            },
          };
        }
      } catch (e) {
        return res
          .status(e.status || 500)
          .json({ success: false, error: e.message });
      }

      const charge = await db.ipdCharge.create({
        data: {
          organizationId: orgId,
          admissionId,
          ...chargeData,
          status: "ACTIVE",
          postedById: req.user?.id || null,
          postedByName: req.user?.fullName || null,
          serviceDate: serviceDate ? new Date(serviceDate) : new Date(),
          sourceModule: sourceModule || (pharmacyDrugId ? "PHARMACY" : "IPD"),
          sourceRef: sourceRef || null,
        },
      });
      await auditIpd(req, orgId, {
        action: "charge",
        entityType: "ipd.charge",
        entityId: charge.id,
        after: {
          admissionId,
          description: charge.description,
          unitPrice: charge.unitPrice,
          quantity: charge.quantity,
          serviceGroup: charge.serviceGroup,
        },
      });
      return res.status(201).json({ success: true, data: charge });
}

// Phase 2: record vitals (auto-computes NEWS2 early-warning score)
async function createVitals(req, res, orgId, body) {
      const { admissionId } = body;
      if (!admissionId)
        return res
          .status(400)
          .json({ success: false, error: "admissionId required" });
      const admissionBelongsToOrg = await ownedAdmission(
        orgId,
        admissionId,
      );
      if (!admissionBelongsToOrg) {
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      }
      const num = (value) => {
        const isEmptyValue =
          value === "" || value === undefined || value === null;

        if (isEmptyValue) {
          return null;
        }

        return Number(value);
      };
      const fields = {
        systolicBp: num(body.systolicBp),
        diastolicBp: num(body.diastolicBp),
        heartRate: num(body.heartRate),
        respiratoryRate: num(body.respiratoryRate),
        spo2: num(body.spo2),
        tempC: num(body.tempC),
        painScore: num(body.painScore),
        gcs: num(body.gcs),
        intakeMl: num(body.intakeMl),
        outputMl: num(body.outputMl),
        bloodSugar: num(body.bloodSugar),
        consciousness: body.consciousness || null,
      };
      const news = computeNews2(fields);
      const rec = await db.vitalsRecord.create({
        data: {
          organizationId: orgId,
          admissionId,
          ...fields,
          newsScore: news.score,
          newsRisk: news.risk,
          recordedById: req.user?.id || null,
          recordedByName: body.recordedByName || req.user?.fullName || null,
          notes: body.notes || null,
          recordedAt: body.recordedAt ? new Date(body.recordedAt) : new Date(),
        },
      });
      await auditIpd(req, orgId, {
        action: "create",
        entityType: "ipd.vitals",
        entityId: rec.id,
        after: {
          admissionId,
          newsScore: rec.newsScore,
          newsRisk: rec.newsRisk,
        },
      });
      return res.status(201).json({ success: true, data: rec });
}

// Phase 2: append a structured clinical note (append-only)
async function createNoteV2(req, res, orgId, body) {
      const { admissionId, body: noteBody, noteType, parentId, vitals } = body;
      const hasRequiredFields = admissionId && noteBody;

      if (!hasRequiredFields) {
        return res
          .status(400)
          .json({ success: false, error: "admissionId and body required" });
      }

      const admissionBelongsToOrg = await ownedAdmission(
        orgId,
        admissionId,
      );
      if (!admissionBelongsToOrg) {
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      }

      const note = await db.clinicalNote.create({
        data: {
          organizationId: orgId,
          admissionId,
          noteType: noteType || "Other notes",
          body: noteBody,
          authorId: req.user?.id || null,
          authorName: body.authorName || req.user?.fullName || null,
          parentId: parentId || null,
          vitals: vitals || undefined,
        },
      });
      await auditIpd(req, orgId, {
        action: "create",
        entityType: "ipd.note",
        entityId: note.id,
        after: { admissionId, noteType: note.noteType },
      });
      return res.status(201).json({ success: true, data: note });
}

// Phase 2: record a medication administration (eMAR)
async function createMedicationAdministration(req, res, orgId, body) {
      const { admissionId, drugName, status } = body;
      if (!admissionId || !drugName)
        return res
          .status(400)
          .json({ success: false, error: "admissionId and drugName required" });
      const admissionBelongsToOrg = await ownedAdmission(
        orgId,
        admissionId,
      );
      if (!admissionBelongsToOrg) {
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      }

      // Default to GIVEN when no status is sent.
      const finalStatus = status || "GIVEN";

      // Optional planned time for the dose.
      const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;

      // Stamp the administration time only when the dose was actually GIVEN;
      // use the time the client sent, else now.
      const administeredAt =
        finalStatus === "GIVEN"
          ? body.administeredAt
            ? new Date(body.administeredAt)
            : new Date()
          : null;

      const DRUG_FORMS = [
        "Tablet", "Capsule", "Syrup", "Injection", "Cream",
        "Ointment", "Drops", "Inhaler", "Suppository", "Solution", "Suspension"
      ];
      if (body.route && !DRUG_FORMS.includes(body.route)) {
        return res.status(400).json({ success: false, error: `Invalid route. Allowed values: ${DRUG_FORMS.join(', ')}` });
      }

      const rec = await db.medicationAdministration.create({
        data: {
          organizationId: orgId,
          admissionId,
          prescriptionId: body.prescriptionId || null,
          drugName,
          dosage: body.dosage || null,
          route: body.route || null,
          scheduledAt,
          administeredAt,
          status: finalStatus,
          reason: body.reason || null,
          nurseId: req.user?.id || null,
          nurseName: body.nurseName || req.user?.fullName || null,
        },
      });
      // Audit trail: what was done, to which record, and a small snapshot of the result.
      const auditEntry = {
        action: "create",
        entityType: "ipd.medication-administration",
        entityId: rec.id,
        after: {
          admissionId,
          drugName: rec.drugName,
          status: rec.status,
        },
      };
      await auditIpd(req, orgId, auditEntry);

      return res.status(201).json({ success: true, data: rec });
}

// ── Phase 1 billing ──────────────────────────────────────────────────────
async function createBillGenerate(req, res, orgId, body) {
      const { admissionId } = body;
      if (!admissionId)
        return res
          .status(400)
          .json({ success: false, error: "admissionId required" });
      const admissionBelongsToOrg = await ownedAdmission(
        orgId,
        admissionId,
      );
      if (!admissionBelongsToOrg) {
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      }
      try {
        const bill = await generateBill(
          orgId,
          admissionId,
          req.user?.id,
        );
        await auditIpd(req, orgId, {
          action: "update",
          entityType: "ipd.bill",
          entityId: bill.id,
          after: {
            admissionId,
            status: bill.status,
            payableTotal: bill.payableTotal,
          },
        });
        return res.status(201).json({ success: true, data: bill });
      } catch (e) {
        return svcErr(res, e);
      }
}

async function createBillFinalize(req, res, orgId, body) {
      const { admissionId, billType } = body;
      if (!admissionId)
        return res
          .status(400)
          .json({ success: false, error: "admissionId required" });
      const admissionBelongsToOrg = await ownedAdmission(
        orgId,
        admissionId,
      );
      if (!admissionBelongsToOrg) {
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      }
      try {
        const bill = await finalizeBill(orgId, admissionId, {
          userId: req.user?.id,
          billType,
        });
        await auditIpd(req, orgId, {
          action: "finalize",
          entityType: "ipd.bill",
          entityId: bill.id,
          after: {
            admissionId,
            billNumber: bill.billNumber,
            payableTotal: bill.payableTotal,
          },
        });
        return res.json({ success: true, data: bill });
      } catch (e) {
        return svcErr(res, e);
      }
}

async function createBillCancel(req, res, orgId, body) {
      const { billId, reason } = body;
      if (!billId)
        return res
          .status(400)
          .json({ success: false, error: "billId required" });
      try {
        const bill = await cancelBill(orgId, billId, { reason });
        await auditIpd(req, orgId, {
          action: "cancel",
          entityType: "ipd.bill",
          entityId: billId,
          after: { status: "CANCELLED", reason: reason || null },
        });
        return res.json({ success: true, data: bill });
      } catch (e) {
        return svcErr(res, e);
      }
}

// Phase 2: collect a payment / advance
async function createPayment(req, res, orgId, body) {
      const { billId, amount, method, reference, type, note, idempotencyKey } =
        body;
      try {
        const r = await collectPayment(orgId, {
          billId,
          amount,
          method,
          reference,
          type,
          note,
          idempotencyKey,
          userId: req.user?.id,
          userName: req.user?.fullName,
        });
        if (!r.deduped)
          await auditIpd(req, orgId, {
            action: "payment",
            entityType: "ipd.payment",
            entityId: r.payment.id,
            after: {
              billId,
              amount: r.payment.amount,
              method,
              receipt: r.payment.receiptNumber,
              balanceDue: r.totals?.balanceDue,
            },
          });
        return res
          .status(201)
          .json({
            success: true,
            data: r.payment,
            totals: r.totals,
            deduped: r.deduped || false,
          });
      } catch (e) {
        return svcErr(res, e);
      }
}

// Phase 2: void a payment (audit-safe)
async function createVoidPayment(req, res, orgId, body) {
      const { paymentId, reason } = body;
      if (!paymentId)
        return res
          .status(400)
          .json({ success: false, error: "paymentId required" });
      try {
        const p = await voidPayment(orgId, paymentId, { reason });
        await auditIpd(req, orgId, {
          action: "void",
          entityType: "ipd.payment",
          entityId: paymentId,
          after: { status: "VOID", reason: reason || null },
        });
        return res.json({ success: true, data: p });
      } catch (e) {
        return svcErr(res, e);
      }
}

// Phase 2: refund (signed-negative ledger entry; credit note in Phase 3)
async function createRefund(req, res, orgId, body) {
      const { billId, amount, reason, method } = body;
      try {
        const r = await refund(orgId, {
          billId,
          amount,
          reason,
          method,
          userId: req.user?.id,
          userName: req.user?.fullName,
        });
        await auditIpd(req, orgId, {
          action: "refund",
          entityType: "ipd.payment",
          entityId: r.payment.id,
          after: {
            billId,
            amount: r.payment.amount,
            receipt: r.payment.receiptNumber,
            balanceDue: r.totals?.balanceDue,
          },
        });
        return res
          .status(201)
          .json({ success: true, data: r.payment, totals: r.totals });
      } catch (e) {
        return svcErr(res, e);
      }
}

async function createCancelCharge(req, res, orgId, body) {
      const { chargeId, status: cStatus, reason } = body;
      if (!chargeId)
        return res
          .status(400)
          .json({ success: false, error: "chargeId required" });
      try {
        const charge = await cancelCharge(orgId, chargeId, {
          status: cStatus,
          reason,
          userId: req.user?.id,
        });
        await auditIpd(req, orgId, {
          action: "cancel",
          entityType: "ipd.charge",
          entityId: chargeId,
          after: { status: charge.status, reason: reason || null },
        });
        return res.json({ success: true, data: charge });
      } catch (e) {
        return svcErr(res, e);
      }
}

// Finalize discharge — gated on a paid bill (NORMAL), with bed turnover.
async function createDischargeFinalize(req, res, orgId, body) {
      const { admissionId, dischargeType = "NORMAL", force } = body;
      if (!admissionId)
        return res
          .status(400)
          .json({ success: false, error: "admissionId required" });
      const typeCfg = DISCHARGE_TYPES[dischargeType] || DISCHARGE_TYPES.NORMAL;

      // Billing gate: a NORMAL discharge for a CASH payer needs the bill paid
      // (balanceDue == 0). LAMA/ABSCONDED/EXPIRED/TRANSFER_OUT bypass; `force` overrides.
      if (typeCfg.requireClearances && !force) {
        const tariff = await db.patientTariff
          .findUnique({ where: { admissionId } })
          .catch(() => null);
        const payerType = tariff?.payerType || "CASH";
        if (payerType === "CASH") {
          const curBill = await getCurrentBill(
            orgId,
            admissionId,
          ).catch(() => null);
          const outstanding =
            Math.round((curBill?.balanceDue || 0) * 100) / 100;
          if (outstanding > 0) {
            return res.status(409).json({
              success: false,
              code: "IPD_BILLING_OUTSTANDING",
              error: `Cannot discharge: ₹${outstanding} outstanding on ${curBill?.billNumber || "the bill"}`,
              outstanding,
            });
          }
        }
      }

      const admission = await ownedAdmission(orgId, admissionId);
      if (!admission)
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      if (admission.status === "discharged")
        return res
          .status(409)
          .json({ success: false, error: "Already discharged" });

      const updated = await db.$transaction(async (tx) => {
        const upd = await tx.admission.update({
          where: { id: admissionId },
          data: {
            status: "discharged",
            admissionState: typeCfg.state,
            dischargeType,
            dischargeDate: new Date(),
            dischargeDiagnosis: body.dischargeDiagnosis ?? undefined,
            dischargeCondition: body.dischargeCondition ?? undefined,
            treatmentSummary: body.treatmentSummary ?? undefined,
            medicationsOnDischarge: body.medicationsOnDischarge ?? undefined,
            followUpInstructions: body.followUpInstructions ?? undefined,
            followUpDate: body.followUpDate
              ? new Date(body.followUpDate)
              : undefined,
            dischargeNotes: body.dischargeNotes ?? undefined,
          },
        });
        await tx.bedOccupancy.updateMany({
          where: { admissionId, endAt: null },
          data: { endAt: new Date() },
        });
        // Free the bed (housekeeping removed → straight to available).
        if (admission.bedId) {
          await tx.bed.update({
            where: { id: admission.bedId },
            data: { status: "available" },
          });
        }
        return upd;
      });

      await auditIpd(req, orgId, {
        action: "discharge",
        entityType: "ipd.admission",
        entityId: admissionId,
        before: { status: "admitted" },
        after: { status: "discharged", dischargeType, state: typeCfg.state },
      });

      // Freeze the bill at discharge (bed charges now use the discharge date).
      // Best-effort: never block a completed discharge if billing hiccups.
      let bill = null;
      try {
        bill = await finalizeBill(orgId, admissionId, {
          userId: req.user?.id,
        });
      } catch (e) {
        console.warn("bill finalize at discharge skipped:", e.message);
      }

      return res.json({ success: true, data: updated, bill });
}

// Phase 3: quick exit (LAMA / ABSCONDED / EXPIRED) — bypasses clearances
async function createMarkExit(req, res, orgId, body) {
      const { admissionId, dischargeType } = body;
      if (!admissionId || !dischargeType)
        return res
          .status(400)
          .json({
            success: false,
            error: "admissionId and dischargeType required",
          });
      const typeCfg = DISCHARGE_TYPES[dischargeType];
      if (!typeCfg)
        return res
          .status(400)
          .json({ success: false, error: "Invalid dischargeType" });
      const admission = await ownedAdmission(orgId, admissionId);
      if (!admission)
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      if (admission.status === "discharged")
        return res
          .status(409)
          .json({ success: false, error: "Already discharged" });
      const updated = await db.$transaction(async (tx) => {
        const upd = await tx.admission.update({
          where: { id: admissionId },
          data: {
            status: "discharged",
            admissionState: typeCfg.state,
            dischargeType,
            dischargeDate: new Date(),
            dischargeNotes: body.reason || `Marked ${dischargeType}`,
          },
        });
        await tx.bedOccupancy.updateMany({
          where: { admissionId, endAt: null },
          data: { endAt: new Date() },
        });
        // Free the bed (housekeeping removed → straight to available).
        if (admission.bedId) {
          await tx.bed.update({
            where: { id: admission.bedId },
            data: { status: "available" },
          });
        }
        return upd;
      });
      await auditIpd(req, orgId, {
        action: "discharge",
        entityType: "ipd.admission",
        entityId: admissionId,
        before: { status: "admitted" },
        after: { status: "discharged", dischargeType, state: typeCfg.state },
      });
      return res.json({ success: true, data: updated });
}

// ── Phase 3A: Clinical Orders (CPOE) — SPINE ONLY (no billing, no executor) ──
async function createOrderResource(req, res, orgId, body) {
      const { admissionId } = body;
      if (!admissionId)
        return res
          .status(400)
          .json({ success: false, error: "admissionId required" });
      const adm = await ownedAdmission(orgId, admissionId, {
        id: true,
        patientId: true,
        status: true,
      });
      if (!adm)
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      const actor = getActor(req);
      try {
        // Spine only at creation — NO charge here. Charges are posted per
        // occurrence when the nurse ticks the task DONE (billOrderTask), so a
        // recurring order (e.g. ABG TDS x2d) bills for each collection actually
        // performed instead of a single line, and missed doses are not billed.
        const order = await createOrder(
          orgId,
          { ...body, patientId: body.patientId || adm.patientId },
          actor,
        );

        // Expand the order's frequency + duration into scheduled tasks for the
        // nurse Treatment Chart / MAR. Non-blocking: a failure here must not undo
        // the committed order — tasks can be regenerated later.
        try {
          await generateTasksForOrder(orgId, order);
        } catch (taskErr) {
          console.error("Order task generation failed (order kept):", taskErr);
        }

        await auditIpd(req, orgId, {
          action: "create",
          entityType: "ipd.order",
          entityId: order.id,
          after: {
            admissionId,
            orderType: order.orderType,
            itemName: order.itemName,
            priority: order.priority,
          },
        });
        return res.status(201).json({ success: true, data: order });
      } catch (e) {
        return svcErr(res, e);
      }
}

// Non-completing transitions (spine only — no billing).
async function createOrderTransition(req, res, orgId, body, resource) {
      const action = {
        "order-ack": "ack",
        "order-start": "start",
        "order-cancel": "cancel",
      }[resource];
      if (!body.id)
        return res.status(400).json({ success: false, error: "id required" });
      const actor = getActor(req);
      try {
        const { order, before } = await orderTransition(
          orgId,
          body.id,
          action,
          actor,
          { reason: body.reason },
        );

        // Auto-cancel associated charge if the order is cancelled
        if (action === "cancel" && order.ipdChargeId) {
          await db.ipdCharge.update({
            where: { id: order.ipdChargeId },
            data: {
              status: "CANCELLED",
              cancelReason: body.reason || "Order cancelled",
              cancelledById: actor.id,
              cancelledAt: new Date()
            }
          });
        }
        const auditAction = {
          ack: "acknowledge",
          start: "start",
          cancel: "cancel",
        }[action];
        await auditIpd(req, orgId, {
          action: auditAction,
          entityType: "ipd.order",
          entityId: order.id,
          before: { status: before },
          after: {
            status: order.status,
            ...(action === "cancel" ? { reason: body.reason || null } : {}),
          },
        });
        return res.json({ success: true, data: order });
      } catch (e) {
        return svcErr(res, e);
      }
}

// Completion (Phase 3B: PROCEDURE auto-bills via the existing tariff→IpdCharge flow).
async function createOrderComplete(req, res, orgId, body) {
      if (!body.id)
        return res.status(400).json({ success: false, error: "id required" });
      const actor = getActor(req);
      // Discipline-scoped completion (gate 2 — in addition to ipdAllowed above).
      const existing = await db.clinicalOrder.findFirst({
        where: { id: body.id, organizationId: orgId },
        select: { orderType: true },
      });
      if (!existing)
        return res
          .status(404)
          .json({
            success: false,
            code: "IPD_ORDER_NOT_FOUND",
            error: "Order not found",
          });
      if (!orderAllowed(req, existing.orderType))
        return res
          .status(403)
          .json({
            success: false,
            code: "FORBIDDEN",
            error: `Your role may not complete a ${existing.orderType} order`,
          });
      try {
        // Only PROCEDURE auto-bills in 3B; other types remain spine-only (biller=null).
        const biller =
          existing.orderType === "PROCEDURE"
            ? (tx, order) =>
                billAnyOrder(tx, orgId, order, actor)
            : null;
        const { order, before, charge, deduped } = await completeOrder(
          orgId,
          body.id,
          actor,
          { biller },
        );
        await auditIpd(req, orgId, {
          action: "complete",
          entityType: "ipd.order",
          entityId: order.id,
          before: { status: before },
          after: {
            status: order.status,
            billed: order.billed,
            ipdChargeId: order.ipdChargeId || null,
          },
        });
        if (charge && !deduped) {
          await auditIpd(req, orgId, {
            action: "charge",
            entityType: "ipd.charge",
            entityId: charge.id,
            after: {
              admissionId: order.admissionId,
              description: charge.description,
              unitPrice: charge.unitPrice,
              quantity: charge.quantity,
              serviceGroup: charge.serviceGroup,
              sourceModule: "PROCEDURE",
              sourceRef: order.id,
            },
          });
        }
        return res.json({
          success: true,
          data: order,
          charge: charge || undefined,
        });
      } catch (e) {
        return svcErr(res, e);
      }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function update(req, res) {
  try {
    const orgId =
      getOrgId(req);
    const resource = req.body.resource || req.query.resource;
    const id = req.body.id || req.query.id;

    // Support both nested updates object and flat body fields
    const {
      resource: _r,
      id: _i,
      updates: nestedUpdates,
      dailyRoomRate,
      ...flatBody
    } = req.body;
    const updates = nestedUpdates || flatBody;

    if (!ipdAllowed(req, resource)) {
      return res
        .status(403)
        .json({
          success: false,
          code: "FORBIDDEN",
          error: `Your role may not perform this IPD action (${resource})`,
        });
    }

    if (resource === "order-task")       return await updateOrderTask(req, res, orgId, id, updates);
    if (resource === "ipd-consultation") return await updateConsultation(req, res, orgId, id, updates);
    if (resource === "admission")        return await updateAdmission(req, res, orgId, id, updates);
    if (resource === "bed")              return await updateBed(req, res, orgId, id, updates);
    if (resource === "ward")             return await updateWard(req, res, orgId, id, updates);
    if (resource === "vitals")           return await updateVitals(req, res, orgId, id, updates);

    return res
      .status(400)
      .json({
        error:
          "Invalid resource. Use: admission, bed, ward, vitals",
      });
  } catch (err) {
    console.error("inpatient update error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── update helpers ──────────────────────────────────────────────────────────
// One focused handler per PATCH resource (create()/getAll()-style dispatcher).
// Same behaviour & JSON as the old inline blocks.

// ── Phase 3C: tick a scheduled order task (Treatment Chart) ──
async function updateOrderTask(req, res, orgId, id, updates) {
      const { status, doneByName, resultValue, notes } = req.body;
      if (!id)
        return res.status(400).json({ success: false, error: "id required" });
      const task = await db.orderTask.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!task)
        return res.status(404).json({ success: false, error: "Task not found" });

      const VALID = ["DUE", "DONE", "MISSED", "HELD", "SKIPPED"];
      const newStatus = status && VALID.includes(status) ? status : "DONE";
      const done = newStatus === "DONE";
      const actor = { id: req.user?.id || req.user?.userId || null, name: req.user?.fullName || null };

      // Bill PER OCCURRENCE: posting the charge when the nurse ticks DONE, and
      // cancelling it if the occurrence is later un-ticked / marked not-done — so
      // the bill reflects exactly the tests/doses actually performed.
      // PROCEDURE bills on order-complete (billAnyOrder); exclude it here to
      // avoid double billing. Lab/imaging/medicine bill per completed occurrence.
      const BILLABLE = ["LAB", "RADIOLOGY", "PHARMACY"];
      const { updated, charge } = await db.$transaction(async (tx) => {
        const upd = await tx.orderTask.update({
          where: { id: task.id },
          data: {
            status: newStatus,
            doneAt: done ? new Date() : null,
            doneById: done ? actor.id : null,
            doneByName: done ? doneByName || actor.name : null,
            resultValue: resultValue ?? task.resultValue,
            notes: notes ?? task.notes,
          },
        });

        let ch = null;
        if (BILLABLE.includes(task.orderType)) {
          const order = await tx.clinicalOrder.findFirst({
            where: { id: task.orderId, organizationId: orgId },
          });
          if (order) {
            if (done) {
              const r = await billOrderTask(tx, orgId, order, task, actor);
              ch = r.charge;
            } else {
              await cancelOrderTaskCharge(tx, orgId, order, task, `Task ${newStatus.toLowerCase()}`);
            }
          }
        }
        return { updated: upd, charge: ch };
      });

      await auditIpd(req, orgId, {
        action: "update",
        entityType: "ipd.order-task",
        entityId: updated.id,
        after: { itemName: updated.itemName, status: updated.status, chargeId: charge?.id || null, lineTotal: charge?.lineTotal },
      });
      return res.json({ success: true, data: updated, charge: charge || undefined });
}

// ── ipd-consultation PATCH ─────────────────────────────────────────────────
async function updateConsultation(req, res, orgId, id, updates) {
      const consult = await db.ipdConsultation.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!consult)
        return res.status(404).json({ success: false, error: "Consultation not found" });
      if (["BILLED", "CANCELLED"].includes(consult.status))
        return res.status(409).json({ success: false, error: `Consultation is already ${consult.status.toLowerCase()}` });

      const newStatus         = req.body.status || updates.status;
      const consultationNotes = req.body.consultationNotes || updates.consultationNotes;
      const diagnosis         = req.body.diagnosis || updates.diagnosis;
      const recommendedPlan   = req.body.recommendedPlan || updates.recommendedPlan;
      const followUpNotes     = req.body.followUpNotes || updates.followUpNotes;
      const followUpRequired  = req.body.followUpRequired ?? updates.followUpRequired;

      const VALID = ["REQUESTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
      if (newStatus && !VALID.includes(newStatus))
        return res.status(400).json({ success: false, error: `Invalid status. Use: ${VALID.join(", ")}` });

      // COMPLETE → auto-bill in a transaction
      if (newStatus === "COMPLETED") {
        if (consult.ipdChargeId)
          return res.status(409).json({ success: false, error: "Already billed" });

        const completedAt = new Date();
        // Inline update then bill inside a transaction
        const result = await db.$transaction(async (tx) => {
          const updated = await tx.ipdConsultation.update({
            where: { id },
            data: {
              status: "COMPLETED",
              completedAt,
              ...(consultationNotes !== undefined && { consultationNotes }),
              ...(diagnosis         !== undefined && { diagnosis }),
              ...(recommendedPlan   !== undefined && { recommendedPlan }),
              ...(followUpNotes     !== undefined && { followUpNotes }),
              ...(followUpRequired  !== undefined && { followUpRequired: Boolean(followUpRequired) }),
            },
          });
          const { charge, commission } = await billConsultation(
            tx, orgId,
            { ...updated, completedAt },
            { id: req.user?.id, name: req.user?.fullName || req.user?.name },
          );
          return { updated, charge, commission };
        });

        await auditIpd(req, orgId, {
          action: "complete", entityType: "ipd.consultation", entityId: id,
          newValues: { status: "BILLED", chargeId: result.charge?.id },
        });

        // Re-fetch with relations for the response
        const fresh = await db.ipdConsultation.findUnique({
          where: { id },
          include: {
            consultingDoctor: { select: { id: true, fullName: true } },
            department:       { select: { id: true, name: true } },
            ipdCharge:        { select: { id: true, lineTotal: true } },
          },
        });
        return res.json({ success: true, data: fresh, charge: result.charge, commission: result.commission });
      }

      // Simple status transitions (REQUESTED → IN_PROGRESS, or CANCELLED)
      const updated = await db.ipdConsultation.update({
        where: { id },
        data: {
          ...(newStatus !== undefined && { status: newStatus }),
          ...(consultationNotes !== undefined && { consultationNotes }),
          ...(diagnosis         !== undefined && { diagnosis }),
          ...(recommendedPlan   !== undefined && { recommendedPlan }),
          ...(followUpNotes     !== undefined && { followUpNotes }),
          ...(followUpRequired  !== undefined && { followUpRequired: Boolean(followUpRequired) }),
        },
      });

      // Auto-cancel associated charge if the consultation is cancelled
      if (newStatus === "CANCELLED" && consult.ipdChargeId) {
        await db.ipdCharge.update({
          where: { id: consult.ipdChargeId },
          data: {
            status: "CANCELLED",
            cancelReason: "Consultation cancelled",
            cancelledById: req.user?.id || req.user?.userId || null,
            cancelledAt: new Date()
          }
        });
      }

      return res.json({ success: true, data: updated });
}

async function updateAdmission(req, res, orgId, id, updates) {
      // Whitelisted, org-scoped update — NO status/billing/org mass-assignment.
      const admission = await ownedAdmission(orgId, id);
      if (!admission)
        return res
          .status(404)
          .json({ success: false, error: "Admission not found" });
      const data = pick(updates, ADMISSION_UPDATABLE);
      if (data.expectedLengthOfStay !== undefined)
        data.expectedLengthOfStay = parseInt(data.expectedLengthOfStay) || null;
      const updated = await db.admission.update({ where: { id }, data });
      return res.json({ success: true, data: updated });
}

async function updateBed(req, res, orgId, id, updates) {
      const bed = await ownedBed(orgId, id);
      if (!bed)
        return res.status(404).json({ success: false, error: "Bed not found" });
      const data = pick(updates, BED_UPDATABLE);
      const updated = await db.bed.update({ where: { id }, data });
      await auditIpd(req, orgId, {
        action: "update",
        entityType: "ipd.bed",
        entityId: id,
        before: { status: bed.status },
        after: data,
      });
      return res.json({ success: true, data: updated });
}

async function updateWard(req, res, orgId, id, updates) {
      if (!(await ownedWard(orgId, id)))
        return res
          .status(404)
          .json({ success: false, error: "Ward not found" });
      const {
        name,
        code,
        type,
        capacity,
        building,
        floor,
        chargeNurse,
        phone,
        departmentId,
      } = updates;
      const wardData = {};
      if (name !== undefined) wardData.name = name;
      if (code !== undefined) wardData.code = code;
      if (type !== undefined) wardData.type = type;
      if (capacity !== undefined) wardData.capacity = parseInt(capacity) || 0;
      if (building !== undefined) wardData.building = building;
      if (floor !== undefined) wardData.floor = floor;
      if (departmentId !== undefined)
        wardData.departmentId = departmentId || null;
      if (chargeNurse !== undefined) wardData.chargeNurse = chargeNurse;
      if (phone !== undefined) wardData.phone = phone;

      const updated = await db.ward.update({
        where: { id },
        data: wardData,
        include: { beds: true },
      });

      if (wardData.capacity !== undefined) {
        const target = parseInt(wardData.capacity) || 0;
        const existing = updated.beds || [];

        if (target > existing.length) {
          // Capacity badhi → utne naye (khaali) beds add karo
          const start = existing.length + 1;
          await db.bed.createMany({
            data: Array.from({ length: target - existing.length }, (_, i) => ({
              organizationId: orgId,
              wardId: id,
              bedNumber: String(start + i),
              type: "Standard",
              status: "available",
            })),
          });
        } else if (target < existing.length) {
          // Capacity ghati → SIRF khaali (available) extra beds hatao.
          // occupied/reserved bed kabhi mat delete karo — patient us pe ho sakta hai.
          const surplus = existing.length - target;
          const removableIds = existing
            .filter((b) => b.status === "available")
            .sort((a, b) =>
              String(b.bedNumber).localeCompare(String(a.bedNumber)),
            ) // sabse aakhri (highest) bed number pehle hatao
            .slice(0, surplus)
            .map((b) => b.id);
          if (removableIds.length) {
            await db.bed.deleteMany({ where: { id: { in: removableIds } } });
          }
        }

        // Capacity ko ACTUAL bed count ke barabar rakho — dono kabhi drift na karein.
        // (Agar bahut saare bed occupied the to surplus poora nahi hata; tab bhi
        //  capacity asli ginti dikhayegi, galat number nahi.)
        const finalBedCount = await db.bed.count({ where: { wardId: id } });
        if (finalBedCount !== target) {
          await db.ward.update({
            where: { id },
            data: { capacity: finalBedCount },
          });
        }
      }

      const wardWithBeds = await db.ward.findUnique({
        where: { id },
        include: { beds: { orderBy: { bedNumber: "asc" } } },
      });

      return res.json({ success: true, data: wardWithBeds });
}

// Vitals correction (nurse-only via RBAC). Audited before/after; NEWS2 recomputed.
async function updateVitals(req, res, orgId, id, updates) {
      const existing = await db.vitalsRecord.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing)
        return res
          .status(404)
          .json({ success: false, error: "Vitals record not found" });
      const num = (value) => {
        const isEmptyValue =
          value === "" || value === undefined || value === null;

        if (isEmptyValue) {
          return null;
        }

        return Number(value);
      };
      const VITAL_FIELDS = [
        "systolicBp",
        "diastolicBp",
        "heartRate",
        "respiratoryRate",
        "spo2",
        "tempC",
        "painScore",
        "gcs",
        "intakeMl",
        "outputMl",
        "bloodSugar",
      ];
      const data = {};
      for (const k of VITAL_FIELDS)
        if (updates[k] !== undefined) data[k] = num(updates[k]);
      if (updates.consciousness !== undefined)
        data.consciousness = updates.consciousness || null;
      if (updates.notes !== undefined) data.notes = updates.notes || null;
      // Recompute NEWS2 from the merged (old + new) values.
      const merged = { ...existing, ...data };
      const news = computeNews2(merged);
      data.newsScore = news.score;
      data.newsRisk = news.risk;
      const updated = await db.vitalsRecord.update({ where: { id }, data });
      await auditIpd(req, orgId, {
        action: "update",
        entityType: "ipd.vitals",
        entityId: id,
        before: {
          systolicBp: existing.systolicBp,
          heartRate: existing.heartRate,
          spo2: existing.spo2,
          tempC: existing.tempC,
          newsScore: existing.newsScore,
        },
        after: { ...data },
      });
      return res.json({ success: true, data: updated });
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function remove(req, res) {
  try {
    const orgId = getOrgId(req);
    const resource = req.body.resource || req.query.resource;
    const id = req.body.id || req.query.id;

    if (!ipdAllowed(req, resource)) {
      return res
        .status(403)
        .json({
          success: false,
          code: "FORBIDDEN",
          error: `Your role may not perform this IPD action (${resource})`,
        });
    }

    if (resource === "ward")             return await removeWard(req, res, orgId, id);
    if (resource === "bed")              return await removeBed(req, res, orgId, id);
    if (resource === "ipd-consultation") return await removeConsultation(req, res, orgId, id);

    return res.status(400).json({ error: "Invalid resource. Use: ward, bed, ipd-consultation" });
  } catch (err) {
    console.error("inpatient remove error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ─── remove helpers ──────────────────────────────────────────────────────────

async function removeWard(req, res, orgId, id) {
      if (!(await ownedWard(orgId, id)))
        return res.status(404).json({ error: "Ward not found" });
      const activeAdmissions = await db.admission.count({
        where: {
          organizationId: orgId,
          status: "admitted",
          bed: { wardId: id },
        },
      });

      if (activeAdmissions > 0) {
        return res.status(400).json({
          error: "Cannot delete ward with active admissions",
        });
      }

      await db.$transaction([
        db.bed.deleteMany({
          where: { wardId: id, organizationId: orgId },
        }),
        db.ward.delete({ where: { id } }),
      ]);
      await auditIpd(req, orgId, {
        action: "delete",
        entityType: "ipd.ward",
        entityId: id,
      });

      return res.json({ success: true });
}

async function removeBed(req, res, orgId, id) {
      const bed = await ownedBed(orgId, id);
      if (!bed) return res.status(404).json({ error: "Bed not found" });
      if (bed.status === "occupied")
        return res.status(400).json({ error: "Cannot delete an occupied bed" });
      await db.bed.delete({ where: { id } });
      await auditIpd(req, orgId, {
        action: "delete",
        entityType: "ipd.bed",
        entityId: id,
      });

      return res.json({ success: true });
}

// ── ipd-consultation DELETE (cancel) ──────────────────────────────────────
async function removeConsultation(req, res, orgId, id) {
      const consult = await db.ipdConsultation.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!consult)
        return res.status(404).json({ success: false, error: "Consultation not found" });
      if (["BILLED", "CANCELLED"].includes(consult.status))
        return res.status(409).json({ success: false, error: `Cannot cancel a ${consult.status.toLowerCase()} consultation` });

      await db.ipdConsultation.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      return res.json({ success: true });
}

// ============================================================================
// TIMELINE
// ============================================================================
export async function getPatientTimeline(req, res) {
  try {
    const orgId = getOrgId(req);
    const { patientId } = req.params;

    if (!patientId) {
      return res.status(400).json({ success: false, error: "Patient ID is required" });
    }

    // 1. Fetch all admissions for this patient
    const admissions = await db.admission.findMany({
      where: { organizationId: orgId, patientId },
      include: {
        bed: { include: { ward: true } },
        // Doctor names straight from the relation (no manual lookup).
        admittingDoctor: { select: { fullName: true } },
        dischargeDoctor: { select: { fullName: true } },
      }
    });

    const admissionIds = admissions.map(a => a.id);

    // 2. Fetch all related events in parallel
    const [notes, orders, vitals, meds] = await Promise.all([
      db.clinicalNote.findMany({ where: { admissionId: { in: admissionIds } } }),
      db.clinicalOrder.findMany({ where: { admissionId: { in: admissionIds } } }),
      db.vitalsRecord.findMany({ where: { admissionId: { in: admissionIds } } }),
      db.medicationAdministration.findMany({ where: { admissionId: { in: admissionIds } } })
    ]);

    // 3. Normalize every source into one chronological timeline (newest first).
    //    Each source has its own small mapper (defined below) — easy to read & extend.
    const timeline = [
      ...admissions.flatMap(a => admissionTimelineEvents(a)),
      ...notes.map(noteTimelineEvent),
      ...orders.map(orderTimelineEvent),
      ...vitals.map(vitalsTimelineEvent),
      ...meds.map(medTimelineEvent),
    ];
    timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.json({ success: true, data: timeline });
  } catch (err) {
    console.error("getPatientTimeline error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch timeline" });
  }
}

// ─── patient-timeline helpers ────────────────────────────────────────────────
// Each builder turns one DB row into a timeline event (pure, easy to extend).

// One admission → an "admitted" event, plus a "discharged" event if it ended.
// Doctor names come from the included relations (admittingDoctor / dischargeDoctor).
function admissionTimelineEvents(a) {
  const events = [{
    id: `adm-${a.id}-start`,
    type: 'ADMISSION_START',
    timestamp: a.admissionDate,
    title: `Admitted to ${a.bed?.ward?.name || 'Ward'}`,
    description: `Admission Type: ${a.admissionType}. Diagnosis: ${a.admissionDiagnosis || 'N/A'}`,
    user: a.admittingDoctor?.fullName || 'System',
    metadata: { admissionId: a.id }
  }];
  if (a.dischargeDate) {
    events.push({
      id: `adm-${a.id}-end`,
      type: 'DISCHARGE',
      timestamp: a.dischargeDate,
      title: `Discharged`,
      description: `Status: ${a.status}`,
      user: a.dischargeDoctor?.fullName || 'System',
      metadata: { admissionId: a.id }
    });
  }
  return events;
}

const noteTimelineEvent = (n) => ({
  id: `note-${n.id}`,
  type: 'CLINICAL_NOTE',
  timestamp: n.authoredAt,
  title: `${n.noteType || 'Clinical Note'}`,
  description: n.body,
  user: n.authorName || 'Doctor',
  metadata: { admissionId: n.admissionId, id: n.id }
});

const orderTimelineEvent = (o) => ({
  id: `order-${o.id}`,
  type: 'ORDER',
  timestamp: o.orderedAt || o.createdAt,
  title: `Order: ${o.itemName}`,
  description: `Type: ${o.orderType} | Status: ${o.status} ${o.route ? '| Route: ' + o.route : ''} ${o.dosage ? '| Dose: ' + o.dosage : ''}`,
  user: o.orderedByName || 'Doctor',
  metadata: { admissionId: o.admissionId, id: o.id, status: o.status }
});

const vitalsTimelineEvent = (v) => ({
  id: `vital-${v.id}`,
  type: 'VITALS',
  timestamp: v.recordedAt,
  title: `Vitals Recorded`,
  description: `Temp: ${v.tempC != null ? Math.round((v.tempC * 9 / 5 + 32) * 10) / 10 : '--'}°F, BP: ${v.systolicBp || '--'}/${v.diastolicBp || '--'}, HR: ${v.heartRate || '--'}, O2: ${v.spo2 || '--'}%`,
  user: v.recordedByName || 'Nurse',
  metadata: { admissionId: v.admissionId, id: v.id }
});

const medTimelineEvent = (m) => ({
  id: `med-${m.id}`,
  type: 'MEDICATION',
  timestamp: m.administeredAt || m.scheduledAt || m.createdAt,
  title: `Medication: ${m.drugName}`,
  description: `Status: ${m.status} | Dose: ${m.dosage || '--'} | Route: ${m.route || '--'} ${m.reason ? '| Reason: ' + m.reason : ''}`,
  user: m.nurseName || 'Nurse',
  metadata: { admissionId: m.admissionId, id: m.id, status: m.status }
});