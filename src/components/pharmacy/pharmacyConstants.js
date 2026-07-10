// Shared, pure constants + reference data for the Pharmacy module.
// Extracted from PharmacyModule.jsx so each tab can import only what it needs.

export const DRUG_CATEGORIES = [
  "Antibiotics",
  "Analgesics",
  "Antimalarials",
  "Antiretrovirals (ARV)",
  "Cardiovascular",
  "Respiratory",
  "Gastrointestinal",
  "Vitamins",
  "Antidiabetics",
  "Antihelminthics",
  "Antifungals",
  "Topical",
  "Antihistamines",
  "Vaccines",
  "IV Fluids",
  "Other",
];

export const DRUG_FORMS = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Cream",
  "Ointment",
  "Drops",
  "Inhaler",
  "Suppository",
  "Solution",
  "Suspension",
];

export const SCHEDULE_TYPES = ["none", "G", "H", "H1", "X"];

// Page sizes for each paginated table.
export const DRUGS_PER_PAGE = 15;
export const PHARMACY_BATCHES_PER_PAGE = 10;
export const PHARMACY_PO_PER_PAGE = 10;
export const PHARMACY_SALES_PER_PAGE = 10;

// Blank form templates (spread into useState to reset a form).
export const emptyDrug = {
  name: "",
  saltName: "",
  companyName: "",
  category: "",
  form: "",
  strength: "",
  mrp: 0,
  rate: 0,
  discountPercentage: 0,
  scheme: "",
  scheduleType: "none",
  initialQty: 0,
  minStock: 10,
  batchNumber: "",
  expiryDate: "",
  manufacturingDate: "",
  barcode: "",
};

export const emptyBatch = {
  drugId: "",
  // Display-only: the picker is a server-side search, so the chosen drug's name is
  // carried here rather than looked up in a full in-memory drug list. Stripped by
  // the batch Zod schema on the way to the API.
  drugName: "",
  batchNumber: "",
  expiryDate: "",
  manufactureDate: "",
  quantityReceived: 1,
  costPricePerUnit: 0,
  supplierName: "",
  supplierInvoice: "",
  purchaseOrderNumber: "",
};

// Local drug–drug interaction rules used by the dispense screen.
export const DRUG_INTERACTIONS = [
  {
    drugs: ["warfarin", "aspirin"],
    severity: "high",
    message:
      "Warfarin + Aspirin: increased bleeding risk — monitor INR closely.",
  },
  {
    drugs: ["warfarin", "ibuprofen"],
    severity: "high",
    message: "Warfarin + Ibuprofen: increased bleeding risk — avoid NSAIDs.",
  },
  {
    drugs: ["metformin", "alcohol"],
    severity: "moderate",
    message: "Metformin + Alcohol: risk of lactic acidosis — counsel patient.",
  },
  {
    drugs: ["amoxicillin", "methotrexate"],
    severity: "high",
    message: "Amoxicillin + Methotrexate: elevated methotrexate toxicity.",
  },
  {
    drugs: ["ciprofloxacin", "antacid"],
    severity: "moderate",
    message: "Ciprofloxacin + Antacid: reduced absorption — space by 2 h.",
  },
  {
    drugs: ["ssri", "tramadol"],
    severity: "high",
    message: "SSRI + Tramadol: serotonin syndrome risk — use with caution.",
  },
  {
    drugs: ["fluoxetine", "tramadol"],
    severity: "high",
    message: "Fluoxetine + Tramadol: serotonin syndrome risk.",
  },
  {
    drugs: ["simvastatin", "clarithromycin"],
    severity: "high",
    message:
      "Simvastatin + Clarithromycin: severe myopathy / rhabdomyolysis risk.",
  },
  {
    drugs: ["clopidogrel", "omeprazole"],
    severity: "moderate",
    message: "Clopidogrel + Omeprazole: reduced antiplatelet effect.",
  },
  {
    drugs: ["digoxin", "amiodarone"],
    severity: "high",
    message: "Digoxin + Amiodarone: digoxin toxicity — reduce digoxin dose.",
  },
  {
    drugs: ["lithium", "ibuprofen"],
    severity: "high",
    message: "Lithium + Ibuprofen: elevated lithium levels — monitor closely.",
  },
  {
    drugs: ["metronidazole", "alcohol"],
    severity: "high",
    message:
      "Metronidazole + Alcohol: disulfiram-like reaction — alcohol contraindicated.",
  },
];

// Returns interaction warnings for a list of drug names (case-insensitive match).
export function checkDrugInteractions(drugNames) {
  const lower = drugNames.map((n) => n.toLowerCase());
  const warnings = [];
  for (const rule of DRUG_INTERACTIONS) {
    const [a, b] = rule.drugs;
    if (lower.some((n) => n.includes(a)) && lower.some((n) => n.includes(b)))
      warnings.push({ severity: rule.severity, message: rule.message });
  }
  return warnings;
}

// Print arbitrary HTML via a hidden iframe (used for receipts/labels).
export function printViaIframe(html) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none";
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }, 1000);
}
