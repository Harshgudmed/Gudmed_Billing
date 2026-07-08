-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MachineType" AS ENUM ('lab_analyzer', 'radiology_equipment', 'vital_signs_monitor');

-- CreateEnum
CREATE TYPE "ConnectionType" AS ENUM ('hl7', 'astm', 'rest_api', 'file_upload', 'serial');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('connected', 'disconnected', 'error');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('pending', 'matched', 'imported', 'failed', 'manual_review');

-- CreateEnum
CREATE TYPE "LogType" AS ENUM ('connection', 'result_import', 'error', 'config_change');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2563eb',
    "secondaryColor" TEXT NOT NULL DEFAULT '#7c3aed',
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Ethiopia',
    "settings" TEXT NOT NULL DEFAULT '{"currency":"INR","language":"en","timezone":"Asia/Kolkata","workingHours":{"start":"08:00","end":"17:00"},"appointmentDuration":30}',
    "subscriptionTier" TEXT NOT NULL DEFAULT 'basic',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'trial',
    "subscriptionStartedAt" TIMESTAMP(3),
    "subscriptionEndsAt" TIMESTAMP(3),
    "modulesEnabled" TEXT NOT NULL DEFAULT '{"pharmacy":true,"laboratory":true,"radiology":true,"inpatient":false,"inventory":true,"accounting":false}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "address" TEXT,
    "employeeId" TEXT,
    "role" TEXT NOT NULL,
    "departmentId" TEXT,
    "specialization" TEXT,
    "licenseNumber" TEXT,
    "consultationFee" DOUBLE PRECISION,
    "followUpDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "preferences" TEXT,
    "defaultCalendar" TEXT NOT NULL DEFAULT 'ethiopian',
    "invitationToken" TEXT,
    "invitationExpiresAt" TIMESTAMP(3),
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "headId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "externalId" TEXT,
    "passwordHash" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" TEXT NOT NULL,
    "bloodGroup" TEXT,
    "phonePrimary" TEXT,
    "phoneSecondary" TEXT,
    "email" TEXT,
    "region" TEXT,
    "zone" TEXT,
    "woreda" TEXT,
    "kebele" TEXT,
    "houseNumber" TEXT,
    "postalCode" TEXT,
    "addressDescription" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelationship" TEXT,
    "allergies" TEXT,
    "chronicConditions" TEXT,
    "currentMedications" TEXT,
    "hasInsurance" BOOLEAN NOT NULL DEFAULT false,
    "insuranceProvider" TEXT,
    "insuranceId" TEXT,
    "insuranceExpiryDate" TIMESTAMP(3),
    "insuranceCoverageDetails" TEXT,
    "photoUrl" TEXT,
    "maritalStatus" TEXT,
    "referredBy" TEXT,
    "mlcNumber" TEXT,
    "occupation" TEXT,
    "educationLevel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVip" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "appointmentDate" TIMESTAMP(3) NOT NULL,
    "appointmentTime" TEXT NOT NULL,
    "appointmentType" TEXT,
    "departmentId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "consultationFee" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "chiefComplaint" TEXT,
    "notes" TEXT,
    "consultationNotes" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedInById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "rescheduledFromId" TEXT,
    "rescheduledToId" TEXT,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consultation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "doctorId" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitType" TEXT,
    "temperature" DOUBLE PRECISION,
    "bloodPressureSystolic" INTEGER,
    "bloodPressureDiastolic" INTEGER,
    "pulseRate" INTEGER,
    "respiratoryRate" INTEGER,
    "weight" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "oxygenSaturation" INTEGER,
    "chiefComplaint" TEXT,
    "historyOfPresentIllness" TEXT,
    "physicalExamination" TEXT,
    "diagnosis" TEXT,
    "icd10Codes" TEXT,
    "treatmentPlan" TEXT,
    "followUpInstructions" TEXT,
    "followUpDate" TIMESTAMP(3),
    "referredTo" TEXT,
    "referralReason" TEXT,
    "notes" TEXT,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ward" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "building" TEXT,
    "floor" TEXT,
    "chargeNurse" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bed" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "bedCategoryId" TEXT,
    "bedNumber" TEXT NOT NULL,
    "type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "currentPatientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "bedId" TEXT,
    "admissionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admissionType" TEXT,
    "admissionReason" TEXT,
    "admissionDiagnosis" TEXT,
    "chiefComplaint" TEXT,
    "expectedLengthOfStay" INTEGER,
    "depositAmount" DOUBLE PRECISION,
    "admissionNotes" TEXT,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "criticalLevel" TEXT,
    "admittingDoctorId" TEXT,
    "attendingDoctorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'admitted',
    "admissionState" TEXT,
    "dischargeType" TEXT,
    "dischargeDate" TIMESTAMP(3),
    "dischargeReason" TEXT,
    "dischargeDiagnosis" TEXT,
    "dischargeSummary" TEXT,
    "treatmentSummary" TEXT,
    "dischargeCondition" TEXT,
    "medicationsOnDischarge" TEXT,
    "dischargeNotes" TEXT,
    "followUpInstructions" TEXT,
    "dischargeDoctorId" TEXT,
    "followUpDate" TIMESTAMP(3),
    "followUpNotes" TEXT,
    "clinicalNotes" TEXT,
    "dailyRoomRate" DOUBLE PRECISION,
    "totalBillAmount" DOUBLE PRECISION,
    "billGenerated" BOOLEAN NOT NULL DEFAULT false,
    "additionalCharges" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyDrug" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "drugName" TEXT NOT NULL,
    "genericName" TEXT,
    "brandName" TEXT,
    "drugCode" TEXT,
    "drugCategory" TEXT,
    "dosageForm" TEXT,
    "strength" TEXT,
    "quantityInStock" INTEGER NOT NULL DEFAULT 0,
    "unitOfMeasure" TEXT,
    "reorderLevel" INTEGER NOT NULL DEFAULT 10,
    "maximumStockLevel" INTEGER,
    "costPrice" DOUBLE PRECISION,
    "sellingPrice" DOUBLE PRECISION,
    "markupPercentage" DOUBLE PRECISION,
    "purchasePrice" DOUBLE PRECISION,
    "mrp" DOUBLE PRECISION,
    "gstRate" DOUBLE PRECISION,
    "barcode" TEXT,
    "manufacturer" TEXT,
    "storageLocation" TEXT,
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT false,
    "supplierName" TEXT,
    "supplierContact" TEXT,
    "description" TEXT,
    "sideEffects" TEXT,
    "contraindications" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PharmacyDrug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "manufactureDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "quantityReceived" INTEGER NOT NULL,
    "quantityRemaining" INTEGER NOT NULL,
    "purchaseOrderNumber" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "costPricePerUnit" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "supplierName" TEXT,
    "supplierInvoice" TEXT,
    "vendorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PharmacyBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consultationId" TEXT,
    "doctorId" TEXT NOT NULL,
    "prescriptionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "items" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dispensedById" TEXT,
    "dispensedAt" TIMESTAMP(3),
    "notes" TEXT,
    "isRefill" BOOLEAN NOT NULL DEFAULT false,
    "refillsAllowed" INTEGER NOT NULL DEFAULT 0,
    "refillsRemaining" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacySale" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "prescriptionId" TEXT,
    "servedById" TEXT,
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saleType" TEXT,
    "customerName" TEXT,
    "phone" TEXT,
    "uhid" TEXT,
    "mrn" TEXT,
    "referenceDoctor" TEXT,
    "items" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "paymentMethod" TEXT,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountDue" DOUBLE PRECISION,
    "payments" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "PharmacySale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacyPurchaseOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "supplierName" TEXT NOT NULL,
    "supplierContact" TEXT,
    "supplierEmail" TEXT,
    "vendorId" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDeliveryDate" TIMESTAMP(3),
    "receivedDate" TIMESTAMP(3),
    "items" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "cancellationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PharmacyPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "batchId" TEXT,
    "changeType" TEXT NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstNumber" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineReference" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameLower" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "manufacturer" TEXT,
    "type" TEXT,
    "packSize" TEXT,
    "composition" TEXT,
    "isDiscontinued" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MedicineReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingService" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "serviceCode" TEXT,
    "serviceCategory" TEXT,
    "department" TEXT,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT false,
    "taxPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isCoveredByInsurance" BOOLEAN NOT NULL DEFAULT true,
    "insuranceCopayPercentage" DOUBLE PRECISION,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "BillingService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consultationId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "items" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceDue" DOUBLE PRECISION,
    "insuranceClaimAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "insuranceClaimStatus" TEXT,
    "patientCopayAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "termsAndConditions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "patientId" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "paymentReference" TEXT,
    "cardLastFour" TEXT,
    "mobileMoneyProvider" TEXT,
    "bankName" TEXT,
    "chequeNumber" TEXT,
    "chequeDate" TIMESTAMP(3),
    "processedById" TEXT,
    "isRefund" BOOLEAN NOT NULL DEFAULT false,
    "refundReason" TEXT,
    "originalPaymentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorFeeSlab" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "fromDays" INTEGER NOT NULL,
    "toDays" INTEGER NOT NULL,
    "feeAmount" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorFeeSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorCommissionConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "commissionType" TEXT NOT NULL DEFAULT 'percentage',
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorCommissionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorCommission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "invoiceAmount" DOUBLE PRECISION NOT NULL,
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "commissionType" TEXT NOT NULL DEFAULT 'percentage',
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "period" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "settlementNote" TEXT,
    "settlementRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "machineName" TEXT NOT NULL,
    "machineType" "MachineType" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "department" TEXT,
    "connectionType" "ConnectionType" NOT NULL,
    "connectionDetails" TEXT NOT NULL DEFAULT '{}',
    "testMapping" TEXT NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectionStatus" "ConnectionStatus" NOT NULL DEFAULT 'disconnected',
    "lastConnectedAt" TIMESTAMP(3),
    "lastResultReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "MachineIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineResultsQueue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "machineIntegrationId" TEXT NOT NULL,
    "rawData" TEXT NOT NULL,
    "parsedData" TEXT,
    "patientIdentifier" TEXT,
    "matchedPatientId" TEXT,
    "testResults" TEXT NOT NULL DEFAULT '[]',
    "status" "QueueStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MachineResultsQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "machineIntegrationId" TEXT,
    "logDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logType" "LogType",
    "message" TEXT NOT NULL,
    "details" TEXT,
    "resultsImported" INTEGER NOT NULL DEFAULT 0,
    "resultsFailed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "departmentIds" TEXT,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT NOT NULL,

    CONSTRAINT "UserInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canRead" BOOLEAN NOT NULL DEFAULT false,
    "canUpdate" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "userRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "oldValues" TEXT,
    "newValues" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "metadata" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationType" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "deliveryMethod" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "sendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaptsConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "facilityCode" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastSyncAt" TIMESTAMP(3),
    "syncStatus" TEXT,
    "syncErrors" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaptsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaptsMedicationMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "localDrugId" TEXT NOT NULL,
    "eaptsDrugCode" TEXT NOT NULL,
    "eaptsDrugName" TEXT NOT NULL,
    "eaptsUnitOfMeasure" TEXT,
    "mappingStatus" TEXT NOT NULL DEFAULT 'mapped',
    "lastSyncedAt" TIMESTAMP(3),
    "mappingNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaptsMedicationMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaptsTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestPayload" TEXT,
    "responsePayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaptsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BedCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "defaultBedDayRate" DOUBLE PRECISION,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BedCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payerType" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TariffPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeMaster" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceGroup" TEXT NOT NULL,
    "uom" TEXT,
    "basePrice" DOUBLE PRECISION NOT NULL,
    "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "bedCategoryId" TEXT,
    "serviceGroup" TEXT,
    "serviceItemId" TEXT,
    "adjustmentType" TEXT NOT NULL,
    "adjustmentValue" DOUBLE PRECISION NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TariffRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientTariff" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "payerType" TEXT NOT NULL,
    "corporateId" TEXT,
    "insurancePolicyId" TEXT,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientTariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BedOccupancy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "bedCategoryId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "BedOccupancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpdCharge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "chargeItemId" TEXT,
    "description" TEXT NOT NULL,
    "serviceGroup" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "resolvedFrom" JSONB,
    "serviceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceModule" TEXT,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taxPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "postedById" TEXT,
    "postedByName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "billId" TEXT,

    CONSTRAINT "IpdCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "billNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "billType" TEXT NOT NULL DEFAULT 'FINAL',
    "payerType" TEXT NOT NULL DEFAULT 'CASH',
    "bedTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "serviceTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depositTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payableTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "cancelReason" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT,
    "admissionId" TEXT NOT NULL,
    "receiptNumber" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PAYMENT',
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "voidReason" TEXT,
    "note" TEXT,
    "creditNoteId" TEXT,
    "idempotencyKey" TEXT,
    "receivedById" TEXT,
    "receivedByName" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalsRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "systolicBp" INTEGER,
    "diastolicBp" INTEGER,
    "heartRate" INTEGER,
    "respiratoryRate" INTEGER,
    "spo2" DOUBLE PRECISION,
    "tempC" DOUBLE PRECISION,
    "painScore" INTEGER,
    "consciousness" TEXT,
    "gcs" INTEGER,
    "intakeMl" INTEGER,
    "outputMl" INTEGER,
    "bloodSugar" DOUBLE PRECISION,
    "newsScore" INTEGER,
    "newsRisk" TEXT,
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "notes" TEXT,

    CONSTRAINT "VitalsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "noteType" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT,
    "authoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parentId" TEXT,
    "vitals" JSONB,

    CONSTRAINT "ClinicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationAdministration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "drugName" TEXT NOT NULL,
    "dosage" TEXT,
    "route" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "administeredAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "nurseId" TEXT,
    "nurseName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DischargeClearance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "clearedById" TEXT,
    "clearedByName" TEXT,
    "clearedAt" TIMESTAMP(3),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DischargeClearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "admissionId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'CLEANING',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedToName" TEXT,
    "notes" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "HousekeepingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "catalogModel" TEXT,
    "catalogItemId" TEXT,
    "itemName" TEXT NOT NULL,
    "itemCode" TEXT,
    "serviceGroup" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'ROUTINE',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "frequency" TEXT,
    "dosage" TEXT,
    "route" TEXT,
    "duration" TEXT,
    "clinicalIndication" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "domainStatus" TEXT,
    "orderedById" TEXT,
    "orderedByName" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedById" TEXT,
    "acknowledgedByName" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "startedByName" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completedByName" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledByName" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "executorModel" TEXT,
    "executorId" TEXT,
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "ipdChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "doneByName" TEXT,
    "resultValue" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalOrderEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "remark" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpdConsultation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "consultingDoctorId" TEXT NOT NULL,
    "requestedById" TEXT,
    "departmentId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "referralReason" TEXT,
    "consultationNotes" TEXT,
    "diagnosis" TEXT,
    "recommendedPlan" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpNotes" TEXT,
    "ipdChargeId" TEXT,
    "feeApplied" DOUBLE PRECISION,
    "commissionAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpdConsultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "testCode" TEXT,
    "testCategory" TEXT,
    "testType" TEXT,
    "specimenType" TEXT,
    "specimenVolume" TEXT,
    "specimenContainer" TEXT,
    "resultType" TEXT,
    "unit" TEXT,
    "referenceRanges" TEXT,
    "price" DOUBLE PRECISION,
    "turnaroundTime" INTEGER,
    "department" TEXT,
    "preparationInstructions" TEXT,
    "clinicalSignificance" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "LabTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consultationId" TEXT,
    "requestedById" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderNumber" TEXT NOT NULL,
    "tests" TEXT NOT NULL,
    "clinicalIndication" TEXT,
    "provisionalDiagnosis" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'routine',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sampleCollectedAt" TIMESTAMP(3),
    "sampleCollectedById" TEXT,
    "accessionNumber" TEXT,
    "resultsEnteredAt" TIMESTAMP(3),
    "resultsEnteredById" TEXT,
    "resultsVerifiedAt" TIMESTAMP(3),
    "resultsVerifiedById" TEXT,
    "resultsReportedAt" TIMESTAMP(3),
    "notes" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "orderId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "resultValue" TEXT NOT NULL,
    "resultUnit" TEXT,
    "isAbnormal" BOOLEAN NOT NULL DEFAULT false,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "flag" TEXT,
    "referenceRangeMin" DOUBLE PRECISION,
    "referenceRangeMax" DOUBLE PRECISION,
    "referenceRangeText" TEXT,
    "qcLevel" TEXT,
    "qcPassed" BOOLEAN,
    "methodUsed" TEXT,
    "instrumentUsed" TEXT,
    "enteredById" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "comment" TEXT,
    "technicianNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadiologyExam" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "examName" TEXT NOT NULL,
    "examCode" TEXT,
    "examCategory" TEXT,
    "bodyPart" TEXT,
    "modality" TEXT,
    "price" DOUBLE PRECISION,
    "estimatedDuration" INTEGER,
    "preparationInstructions" TEXT,
    "contrastRequired" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "RadiologyExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadiologyOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consultationId" TEXT,
    "requestedById" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderNumber" TEXT NOT NULL,
    "clinicalIndication" TEXT,
    "provisionalDiagnosis" TEXT,
    "relevantHistory" TEXT,
    "urgency" TEXT NOT NULL DEFAULT 'routine',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledDate" TIMESTAMP(3),
    "examPerformedAt" TIMESTAMP(3),
    "performedById" TEXT,
    "reportCreatedAt" TIMESTAMP(3),
    "reportedById" TEXT,
    "reportVerifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "notes" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "RadiologyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadiologyReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "orderId" TEXT NOT NULL,
    "technique" TEXT,
    "findings" TEXT,
    "impression" TEXT,
    "recommendations" TEXT,
    "hasCriticalFindings" BOOLEAN NOT NULL DEFAULT false,
    "criticalFindings" TEXT,
    "criticalNotifiedTo" TEXT,
    "criticalNotifiedAt" TIMESTAMP(3),
    "comparedWithPrevious" BOOLEAN NOT NULL DEFAULT false,
    "comparisonNotes" TEXT,
    "images" TEXT,
    "dicomStudyUid" TEXT,
    "templateUsed" TEXT,
    "reportedById" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "amendmentReason" TEXT,
    "amendedAt" TIMESTAMP(3),
    "amendedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RadiologyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreTriage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "screeningNumber" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "age" INTEGER,
    "gender" TEXT,
    "phone" TEXT,
    "chiefComplaint" TEXT,
    "briefHistory" TEXT,
    "temperature" DOUBLE PRECISION,
    "bloodPressureSystolic" INTEGER,
    "bloodPressureDiastolic" INTEGER,
    "pulseRate" INTEGER,
    "respiratoryRate" INTEGER,
    "spo2" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "bmi" DOUBLE PRECISION,
    "fbs" DOUBLE PRECISION,
    "ppbs" DOUBLE PRECISION,
    "routedTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'screening',
    "patientId" TEXT,
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screenedById" TEXT,
    "routedAt" TIMESTAMP(3),
    "routedById" TEXT,

    CONSTRAINT "PreTriage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueManagement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "appointmentId" TEXT,
    "serviceArea" TEXT NOT NULL,
    "serviceType" TEXT,
    "queueNumber" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assignedToId" TEXT,
    "assignedRoom" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "joinedQueueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3),
    "serviceStartedAt" TIMESTAMP(3),
    "serviceCompletedAt" TIMESTAMP(3),
    "estimatedWaitMinutes" INTEGER,
    "displayMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueManagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayCareCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "doctorId" TEXT,
    "doctorName" TEXT,
    "procedure" TEXT,
    "admissionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dischargeTime" TEXT,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'admitted',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "DayCareCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbulanceTrip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "tripNumber" TEXT NOT NULL,
    "ambulanceType" TEXT NOT NULL DEFAULT 'BLS',
    "fromLocation" TEXT,
    "toLocation" TEXT DEFAULT 'Hospital',
    "distanceKm" DOUBLE PRECISION,
    "charge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "tripDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "driverName" TEXT,
    "vehicleNumber" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "AmbulanceTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "payerType" TEXT NOT NULL DEFAULT 'INSURANCE',
    "insurerName" TEXT NOT NULL,
    "tpaName" TEXT,
    "policyNumber" TEXT,
    "coverageLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "InsuranceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaim" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "claimAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approvedAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "diagnosis" TEXT,
    "remarks" TEXT,
    "submittedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeathCertificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "dateOfDeath" TIMESTAMP(3) NOT NULL,
    "timeOfDeath" TEXT,
    "placeOfDeath" TEXT NOT NULL,
    "locationDetails" TEXT,
    "ageAtDeathYears" INTEGER,
    "ageAtDeathMonths" INTEGER,
    "ageAtDeathDays" INTEGER,
    "sex" TEXT NOT NULL,
    "maritalStatus" TEXT,
    "occupation" TEXT,
    "address" TEXT,
    "immediateCause" TEXT NOT NULL,
    "antecedentCauseB" TEXT,
    "antecedentCauseC" TEXT,
    "antecedentCauseD" TEXT,
    "otherConditions" TEXT,
    "mannerOfDeath" TEXT NOT NULL,
    "autopsyPerformed" BOOLEAN NOT NULL DEFAULT false,
    "autopsyFindings" TEXT,
    "isMaternalDeath" BOOLEAN NOT NULL DEFAULT false,
    "pregnancyRelated" TEXT,
    "certifiedById" TEXT,
    "certificationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "certifierQualification" TEXT,
    "licenseNumber" TEXT,
    "signatureUrl" TEXT,
    "issuedTo" TEXT,
    "issuedToRelationship" TEXT,
    "issuedToNationalId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeathCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_invitationToken_key" ON "User"("invitationToken");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_invitationToken_idx" ON "User"("invitationToken");

-- CreateIndex
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_organizationId_name_key" ON "Department"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_mrn_key" ON "Patient"("mrn");

-- CreateIndex
CREATE INDEX "Patient_organizationId_idx" ON "Patient"("organizationId");

-- CreateIndex
CREATE INDEX "Patient_mrn_idx" ON "Patient"("mrn");

-- CreateIndex
CREATE INDEX "Patient_lastName_firstName_idx" ON "Patient"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Patient_phonePrimary_idx" ON "Patient"("phonePrimary");

-- CreateIndex
CREATE INDEX "PatientDocument_organizationId_idx" ON "PatientDocument"("organizationId");

-- CreateIndex
CREATE INDEX "PatientDocument_patientId_idx" ON "PatientDocument"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_idx" ON "Appointment"("organizationId");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_doctorId_idx" ON "Appointment"("doctorId");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_appointmentDate_idx" ON "Appointment"("organizationId", "appointmentDate");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_appointmentDate_doctorId_idx" ON "Appointment"("organizationId", "appointmentDate", "doctorId");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_appointmentDate_status_idx" ON "Appointment"("organizationId", "appointmentDate", "status");

-- CreateIndex
CREATE INDEX "Appointment_appointmentDate_appointmentTime_idx" ON "Appointment"("appointmentDate", "appointmentTime");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "Consultation_organizationId_idx" ON "Consultation"("organizationId");

-- CreateIndex
CREATE INDEX "Consultation_patientId_idx" ON "Consultation"("patientId");

-- CreateIndex
CREATE INDEX "Consultation_doctorId_idx" ON "Consultation"("doctorId");

-- CreateIndex
CREATE INDEX "Consultation_visitDate_idx" ON "Consultation"("visitDate");

-- CreateIndex
CREATE INDEX "Ward_organizationId_idx" ON "Ward"("organizationId");

-- CreateIndex
CREATE INDEX "Bed_organizationId_idx" ON "Bed"("organizationId");

-- CreateIndex
CREATE INDEX "Bed_wardId_idx" ON "Bed"("wardId");

-- CreateIndex
CREATE INDEX "Bed_status_idx" ON "Bed"("status");

-- CreateIndex
CREATE INDEX "Admission_organizationId_idx" ON "Admission"("organizationId");

-- CreateIndex
CREATE INDEX "Admission_patientId_idx" ON "Admission"("patientId");

-- CreateIndex
CREATE INDEX "Admission_status_idx" ON "Admission"("status");

-- CreateIndex
CREATE INDEX "PharmacyDrug_organizationId_idx" ON "PharmacyDrug"("organizationId");

-- CreateIndex
CREATE INDEX "PharmacyDrug_drugName_idx" ON "PharmacyDrug"("drugName");

-- CreateIndex
CREATE INDEX "PharmacyDrug_drugCategory_idx" ON "PharmacyDrug"("drugCategory");

-- CreateIndex
CREATE INDEX "PharmacyDrug_quantityInStock_idx" ON "PharmacyDrug"("quantityInStock");

-- CreateIndex
CREATE INDEX "PharmacyDrug_barcode_idx" ON "PharmacyDrug"("barcode");

-- CreateIndex
CREATE INDEX "PharmacyBatch_drugId_idx" ON "PharmacyBatch"("drugId");

-- CreateIndex
CREATE INDEX "PharmacyBatch_expiryDate_idx" ON "PharmacyBatch"("expiryDate");

-- CreateIndex
CREATE INDEX "PharmacyBatch_status_idx" ON "PharmacyBatch"("status");

-- CreateIndex
CREATE INDEX "PharmacyBatch_vendorId_idx" ON "PharmacyBatch"("vendorId");

-- CreateIndex
CREATE INDEX "Prescription_organizationId_idx" ON "Prescription"("organizationId");

-- CreateIndex
CREATE INDEX "Prescription_patientId_idx" ON "Prescription"("patientId");

-- CreateIndex
CREATE INDEX "Prescription_status_idx" ON "Prescription"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacySale_receiptNumber_key" ON "PharmacySale"("receiptNumber");

-- CreateIndex
CREATE INDEX "PharmacySale_organizationId_idx" ON "PharmacySale"("organizationId");

-- CreateIndex
CREATE INDEX "PharmacySale_patientId_idx" ON "PharmacySale"("patientId");

-- CreateIndex
CREATE INDEX "PharmacySale_saleDate_idx" ON "PharmacySale"("saleDate");

-- CreateIndex
CREATE INDEX "PharmacyPurchaseOrder_organizationId_idx" ON "PharmacyPurchaseOrder"("organizationId");

-- CreateIndex
CREATE INDEX "PharmacyPurchaseOrder_status_idx" ON "PharmacyPurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PharmacyPurchaseOrder_orderDate_idx" ON "PharmacyPurchaseOrder"("orderDate");

-- CreateIndex
CREATE INDEX "PharmacyPurchaseOrder_vendorId_idx" ON "PharmacyPurchaseOrder"("vendorId");

-- CreateIndex
CREATE INDEX "StockLedger_organizationId_idx" ON "StockLedger"("organizationId");

-- CreateIndex
CREATE INDEX "StockLedger_drugId_idx" ON "StockLedger"("drugId");

-- CreateIndex
CREATE INDEX "StockLedger_createdAt_idx" ON "StockLedger"("createdAt");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_idx" ON "Vendor"("organizationId");

-- CreateIndex
CREATE INDEX "MedicineReference_nameLower_idx" ON "MedicineReference"("nameLower");

-- CreateIndex
CREATE INDEX "MedicineReference_name_idx" ON "MedicineReference"("name");

-- CreateIndex
CREATE INDEX "BillingService_organizationId_idx" ON "BillingService"("organizationId");

-- CreateIndex
CREATE INDEX "BillingService_serviceCategory_idx" ON "BillingService"("serviceCategory");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_patientId_idx" ON "Invoice"("patientId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_paymentStatus_idx" ON "Invoice"("paymentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_patientId_idx" ON "Payment"("patientId");

-- CreateIndex
CREATE INDEX "Payment_receiptNumber_idx" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "DoctorFeeSlab_doctorId_idx" ON "DoctorFeeSlab"("doctorId");

-- CreateIndex
CREATE INDEX "DoctorFeeSlab_organizationId_idx" ON "DoctorFeeSlab"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorFeeSlab_doctorId_fromDays_toDays_key" ON "DoctorFeeSlab"("doctorId", "fromDays", "toDays");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorCommissionConfig_doctorId_key" ON "DoctorCommissionConfig"("doctorId");

-- CreateIndex
CREATE INDEX "DoctorCommissionConfig_organizationId_idx" ON "DoctorCommissionConfig"("organizationId");

-- CreateIndex
CREATE INDEX "DoctorCommission_organizationId_idx" ON "DoctorCommission"("organizationId");

-- CreateIndex
CREATE INDEX "DoctorCommission_doctorId_idx" ON "DoctorCommission"("doctorId");

-- CreateIndex
CREATE INDEX "DoctorCommission_status_idx" ON "DoctorCommission"("status");

-- CreateIndex
CREATE INDEX "DoctorCommission_period_idx" ON "DoctorCommission"("period");

-- CreateIndex
CREATE INDEX "MachineIntegration_organizationId_idx" ON "MachineIntegration"("organizationId");

-- CreateIndex
CREATE INDEX "MachineIntegration_machineType_idx" ON "MachineIntegration"("machineType");

-- CreateIndex
CREATE INDEX "MachineIntegration_connectionStatus_idx" ON "MachineIntegration"("connectionStatus");

-- CreateIndex
CREATE INDEX "MachineResultsQueue_organizationId_idx" ON "MachineResultsQueue"("organizationId");

-- CreateIndex
CREATE INDEX "MachineResultsQueue_machineIntegrationId_idx" ON "MachineResultsQueue"("machineIntegrationId");

-- CreateIndex
CREATE INDEX "MachineResultsQueue_status_idx" ON "MachineResultsQueue"("status");

-- CreateIndex
CREATE INDEX "MachineResultsQueue_receivedAt_idx" ON "MachineResultsQueue"("receivedAt");

-- CreateIndex
CREATE INDEX "IntegrationLog_machineIntegrationId_idx" ON "IntegrationLog"("machineIntegrationId");

-- CreateIndex
CREATE INDEX "IntegrationLog_logDate_idx" ON "IntegrationLog"("logDate");

-- CreateIndex
CREATE INDEX "IntegrationLog_logType_idx" ON "IntegrationLog"("logType");

-- CreateIndex
CREATE UNIQUE INDEX "UserInvitation_token_key" ON "UserInvitation"("token");

-- CreateIndex
CREATE INDEX "UserInvitation_organizationId_idx" ON "UserInvitation"("organizationId");

-- CreateIndex
CREATE INDEX "UserInvitation_email_idx" ON "UserInvitation"("email");

-- CreateIndex
CREATE INDEX "UserInvitation_token_idx" ON "UserInvitation"("token");

-- CreateIndex
CREATE INDEX "UserInvitation_status_idx" ON "UserInvitation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "Permission_category_idx" ON "Permission"("category");

-- CreateIndex
CREATE INDEX "Permission_code_idx" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_permissionId_key" ON "RolePermission"("role", "permissionId");

-- CreateIndex
CREATE INDEX "UserActivity_userId_idx" ON "UserActivity"("userId");

-- CreateIndex
CREATE INDEX "UserActivity_action_idx" ON "UserActivity"("action");

-- CreateIndex
CREATE INDEX "UserActivity_timestamp_idx" ON "UserActivity"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_performedAt_idx" ON "AuditLog"("performedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_notificationType_idx" ON "Notification"("notificationType");

-- CreateIndex
CREATE UNIQUE INDEX "EaptsConfig_organizationId_key" ON "EaptsConfig"("organizationId");

-- CreateIndex
CREATE INDEX "EaptsConfig_organizationId_idx" ON "EaptsConfig"("organizationId");

-- CreateIndex
CREATE INDEX "EaptsMedicationMapping_organizationId_idx" ON "EaptsMedicationMapping"("organizationId");

-- CreateIndex
CREATE INDEX "EaptsMedicationMapping_mappingStatus_idx" ON "EaptsMedicationMapping"("mappingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "EaptsMedicationMapping_organizationId_localDrugId_key" ON "EaptsMedicationMapping"("organizationId", "localDrugId");

-- CreateIndex
CREATE UNIQUE INDEX "EaptsMedicationMapping_organizationId_eaptsDrugCode_key" ON "EaptsMedicationMapping"("organizationId", "eaptsDrugCode");

-- CreateIndex
CREATE INDEX "EaptsTransaction_organizationId_idx" ON "EaptsTransaction"("organizationId");

-- CreateIndex
CREATE INDEX "EaptsTransaction_transactionType_idx" ON "EaptsTransaction"("transactionType");

-- CreateIndex
CREATE INDEX "EaptsTransaction_status_idx" ON "EaptsTransaction"("status");

-- CreateIndex
CREATE INDEX "EaptsTransaction_transactionDate_idx" ON "EaptsTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "BedCategory_organizationId_idx" ON "BedCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BedCategory_organizationId_code_key" ON "BedCategory"("organizationId", "code");

-- CreateIndex
CREATE INDEX "TariffPlan_organizationId_idx" ON "TariffPlan"("organizationId");

-- CreateIndex
CREATE INDEX "ChargeMaster_organizationId_serviceGroup_idx" ON "ChargeMaster"("organizationId", "serviceGroup");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeMaster_organizationId_code_key" ON "ChargeMaster"("organizationId", "code");

-- CreateIndex
CREATE INDEX "TariffRule_organizationId_planId_bedCategoryId_serviceGroup_idx" ON "TariffRule"("organizationId", "planId", "bedCategoryId", "serviceGroup");

-- CreateIndex
CREATE UNIQUE INDEX "PatientTariff_admissionId_key" ON "PatientTariff"("admissionId");

-- CreateIndex
CREATE INDEX "PatientTariff_organizationId_idx" ON "PatientTariff"("organizationId");

-- CreateIndex
CREATE INDEX "BedOccupancy_organizationId_admissionId_idx" ON "BedOccupancy"("organizationId", "admissionId");

-- CreateIndex
CREATE INDEX "BedOccupancy_bedId_startAt_idx" ON "BedOccupancy"("bedId", "startAt");

-- CreateIndex
CREATE INDEX "IpdCharge_organizationId_admissionId_idx" ON "IpdCharge"("organizationId", "admissionId");

-- CreateIndex
CREATE INDEX "IpdCharge_billId_idx" ON "IpdCharge"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "IpdCharge_organizationId_sourceModule_sourceRef_key" ON "IpdCharge"("organizationId", "sourceModule", "sourceRef");

-- CreateIndex
CREATE INDEX "Bill_organizationId_status_idx" ON "Bill"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Bill_admissionId_idx" ON "Bill"("admissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_organizationId_billNumber_key" ON "Bill"("organizationId", "billNumber");

-- CreateIndex
CREATE INDEX "BillPayment_organizationId_billId_idx" ON "BillPayment"("organizationId", "billId");

-- CreateIndex
CREATE INDEX "BillPayment_organizationId_paidAt_idx" ON "BillPayment"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "BillPayment_admissionId_idx" ON "BillPayment"("admissionId");

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_organizationId_receiptNumber_key" ON "BillPayment"("organizationId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BillPayment_organizationId_idempotencyKey_key" ON "BillPayment"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillCounter_organizationId_series_year_key" ON "BillCounter"("organizationId", "series", "year");

-- CreateIndex
CREATE INDEX "VitalsRecord_organizationId_admissionId_recordedAt_idx" ON "VitalsRecord"("organizationId", "admissionId", "recordedAt");

-- CreateIndex
CREATE INDEX "ClinicalNote_organizationId_admissionId_authoredAt_idx" ON "ClinicalNote"("organizationId", "admissionId", "authoredAt");

-- CreateIndex
CREATE INDEX "MedicationAdministration_organizationId_admissionId_schedul_idx" ON "MedicationAdministration"("organizationId", "admissionId", "scheduledAt");

-- CreateIndex
CREATE INDEX "DischargeClearance_organizationId_admissionId_idx" ON "DischargeClearance"("organizationId", "admissionId");

-- CreateIndex
CREATE UNIQUE INDEX "DischargeClearance_admissionId_type_key" ON "DischargeClearance"("admissionId", "type");

-- CreateIndex
CREATE INDEX "HousekeepingTask_organizationId_status_idx" ON "HousekeepingTask"("organizationId", "status");

-- CreateIndex
CREATE INDEX "HousekeepingTask_bedId_idx" ON "HousekeepingTask"("bedId");

-- CreateIndex
CREATE INDEX "ClinicalOrder_organizationId_admissionId_status_idx" ON "ClinicalOrder"("organizationId", "admissionId", "status");

-- CreateIndex
CREATE INDEX "ClinicalOrder_organizationId_orderType_status_idx" ON "ClinicalOrder"("organizationId", "orderType", "status");

-- CreateIndex
CREATE INDEX "ClinicalOrder_admissionId_idx" ON "ClinicalOrder"("admissionId");

-- CreateIndex
CREATE INDEX "OrderTask_organizationId_admissionId_scheduledAt_idx" ON "OrderTask"("organizationId", "admissionId", "scheduledAt");

-- CreateIndex
CREATE INDEX "OrderTask_orderId_idx" ON "OrderTask"("orderId");

-- CreateIndex
CREATE INDEX "ClinicalOrderEvent_orderId_at_idx" ON "ClinicalOrderEvent"("orderId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "IpdConsultation_ipdChargeId_key" ON "IpdConsultation"("ipdChargeId");

-- CreateIndex
CREATE INDEX "IpdConsultation_organizationId_admissionId_idx" ON "IpdConsultation"("organizationId", "admissionId");

-- CreateIndex
CREATE INDEX "IpdConsultation_consultingDoctorId_idx" ON "IpdConsultation"("consultingDoctorId");

-- CreateIndex
CREATE INDEX "IpdConsultation_status_idx" ON "IpdConsultation"("status");

-- CreateIndex
CREATE INDEX "LabTest_organizationId_idx" ON "LabTest"("organizationId");

-- CreateIndex
CREATE INDEX "LabTest_testCategory_idx" ON "LabTest"("testCategory");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrder_orderNumber_key" ON "LabOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrder_accessionNumber_key" ON "LabOrder"("accessionNumber");

-- CreateIndex
CREATE INDEX "LabOrder_accessionNumber_idx" ON "LabOrder"("accessionNumber");

-- CreateIndex
CREATE INDEX "LabOrder_organizationId_idx" ON "LabOrder"("organizationId");

-- CreateIndex
CREATE INDEX "LabOrder_patientId_idx" ON "LabOrder"("patientId");

-- CreateIndex
CREATE INDEX "LabOrder_status_idx" ON "LabOrder"("status");

-- CreateIndex
CREATE INDEX "LabResult_isCritical_idx" ON "LabResult"("isCritical");

-- CreateIndex
CREATE INDEX "LabResult_orderId_idx" ON "LabResult"("orderId");

-- CreateIndex
CREATE INDEX "RadiologyExam_organizationId_idx" ON "RadiologyExam"("organizationId");

-- CreateIndex
CREATE INDEX "RadiologyExam_examCategory_idx" ON "RadiologyExam"("examCategory");

-- CreateIndex
CREATE UNIQUE INDEX "RadiologyOrder_orderNumber_key" ON "RadiologyOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "RadiologyOrder_organizationId_idx" ON "RadiologyOrder"("organizationId");

-- CreateIndex
CREATE INDEX "RadiologyOrder_patientId_idx" ON "RadiologyOrder"("patientId");

-- CreateIndex
CREATE INDEX "RadiologyOrder_status_idx" ON "RadiologyOrder"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RadiologyReport_orderId_key" ON "RadiologyReport"("orderId");

-- CreateIndex
CREATE INDEX "RadiologyReport_hasCriticalFindings_idx" ON "RadiologyReport"("hasCriticalFindings");

-- CreateIndex
CREATE UNIQUE INDEX "PreTriage_screeningNumber_key" ON "PreTriage"("screeningNumber");

-- CreateIndex
CREATE INDEX "PreTriage_organizationId_idx" ON "PreTriage"("organizationId");

-- CreateIndex
CREATE INDEX "PreTriage_screeningNumber_idx" ON "PreTriage"("screeningNumber");

-- CreateIndex
CREATE INDEX "PreTriage_status_idx" ON "PreTriage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "QueueManagement_appointmentId_key" ON "QueueManagement"("appointmentId");

-- CreateIndex
CREATE INDEX "QueueManagement_organizationId_idx" ON "QueueManagement"("organizationId");

-- CreateIndex
CREATE INDEX "QueueManagement_serviceArea_status_idx" ON "QueueManagement"("serviceArea", "status");

-- CreateIndex
CREATE INDEX "QueueManagement_assignedToId_idx" ON "QueueManagement"("assignedToId");

-- CreateIndex
CREATE INDEX "DayCareCase_organizationId_idx" ON "DayCareCase"("organizationId");

-- CreateIndex
CREATE INDEX "DayCareCase_patientId_idx" ON "DayCareCase"("patientId");

-- CreateIndex
CREATE INDEX "DayCareCase_admissionDate_idx" ON "DayCareCase"("admissionDate");

-- CreateIndex
CREATE INDEX "DayCareCase_status_idx" ON "DayCareCase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DayCareCase_organizationId_caseNumber_key" ON "DayCareCase"("organizationId", "caseNumber");

-- CreateIndex
CREATE INDEX "AmbulanceTrip_organizationId_idx" ON "AmbulanceTrip"("organizationId");

-- CreateIndex
CREATE INDEX "AmbulanceTrip_patientId_idx" ON "AmbulanceTrip"("patientId");

-- CreateIndex
CREATE INDEX "AmbulanceTrip_tripDate_idx" ON "AmbulanceTrip"("tripDate");

-- CreateIndex
CREATE INDEX "AmbulanceTrip_status_idx" ON "AmbulanceTrip"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AmbulanceTrip_organizationId_tripNumber_key" ON "AmbulanceTrip"("organizationId", "tripNumber");

-- CreateIndex
CREATE INDEX "InsuranceCase_organizationId_idx" ON "InsuranceCase"("organizationId");

-- CreateIndex
CREATE INDEX "InsuranceCase_patientId_idx" ON "InsuranceCase"("patientId");

-- CreateIndex
CREATE INDEX "InsuranceCase_payerType_idx" ON "InsuranceCase"("payerType");

-- CreateIndex
CREATE INDEX "InsuranceClaim_organizationId_idx" ON "InsuranceClaim"("organizationId");

-- CreateIndex
CREATE INDEX "InsuranceClaim_caseId_idx" ON "InsuranceClaim"("caseId");

-- CreateIndex
CREATE INDEX "InsuranceClaim_status_idx" ON "InsuranceClaim"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaim_organizationId_claimNumber_key" ON "InsuranceClaim"("organizationId", "claimNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DeathCertificate_certificateNumber_key" ON "DeathCertificate"("certificateNumber");

-- CreateIndex
CREATE INDEX "DeathCertificate_organizationId_idx" ON "DeathCertificate"("organizationId");

-- CreateIndex
CREATE INDEX "DeathCertificate_patientId_idx" ON "DeathCertificate"("patientId");

-- CreateIndex
CREATE INDEX "DeathCertificate_certificateNumber_idx" ON "DeathCertificate"("certificateNumber");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_bedCategoryId_fkey" FOREIGN KEY ("bedCategoryId") REFERENCES "BedCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_attendingDoctorId_fkey" FOREIGN KEY ("attendingDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_admittingDoctorId_fkey" FOREIGN KEY ("admittingDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_dischargeDoctorId_fkey" FOREIGN KEY ("dischargeDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyDrug" ADD CONSTRAINT "PharmacyDrug_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyBatch" ADD CONSTRAINT "PharmacyBatch_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "PharmacyDrug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyBatch" ADD CONSTRAINT "PharmacyBatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_dispensedById_fkey" FOREIGN KEY ("dispensedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacySale" ADD CONSTRAINT "PharmacySale_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacySale" ADD CONSTRAINT "PharmacySale_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacySale" ADD CONSTRAINT "PharmacySale_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacySale" ADD CONSTRAINT "PharmacySale_servedById_fkey" FOREIGN KEY ("servedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyPurchaseOrder" ADD CONSTRAINT "PharmacyPurchaseOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyPurchaseOrder" ADD CONSTRAINT "PharmacyPurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "PharmacyDrug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingService" ADD CONSTRAINT "BillingService_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorFeeSlab" ADD CONSTRAINT "DoctorFeeSlab_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorFeeSlab" ADD CONSTRAINT "DoctorFeeSlab_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCommissionConfig" ADD CONSTRAINT "DoctorCommissionConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCommissionConfig" ADD CONSTRAINT "DoctorCommissionConfig_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCommission" ADD CONSTRAINT "DoctorCommission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCommission" ADD CONSTRAINT "DoctorCommission_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCommission" ADD CONSTRAINT "DoctorCommission_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineIntegration" ADD CONSTRAINT "MachineIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineResultsQueue" ADD CONSTRAINT "MachineResultsQueue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineResultsQueue" ADD CONSTRAINT "MachineResultsQueue_machineIntegrationId_fkey" FOREIGN KEY ("machineIntegrationId") REFERENCES "MachineIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineResultsQueue" ADD CONSTRAINT "MachineResultsQueue_matchedPatientId_fkey" FOREIGN KEY ("matchedPatientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationLog" ADD CONSTRAINT "IntegrationLog_machineIntegrationId_fkey" FOREIGN KEY ("machineIntegrationId") REFERENCES "MachineIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserActivity" ADD CONSTRAINT "UserActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaptsConfig" ADD CONSTRAINT "EaptsConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaptsMedicationMapping" ADD CONSTRAINT "EaptsMedicationMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaptsMedicationMapping" ADD CONSTRAINT "EaptsMedicationMapping_localDrugId_fkey" FOREIGN KEY ("localDrugId") REFERENCES "PharmacyDrug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaptsTransaction" ADD CONSTRAINT "EaptsTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedCategory" ADD CONSTRAINT "BedCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffPlan" ADD CONSTRAINT "TariffPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeMaster" ADD CONSTRAINT "ChargeMaster_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffRule" ADD CONSTRAINT "TariffRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffRule" ADD CONSTRAINT "TariffRule_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TariffPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientTariff" ADD CONSTRAINT "PatientTariff_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientTariff" ADD CONSTRAINT "PatientTariff_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedOccupancy" ADD CONSTRAINT "BedOccupancy_bedCategoryId_fkey" FOREIGN KEY ("bedCategoryId") REFERENCES "BedCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdCharge" ADD CONSTRAINT "IpdCharge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdCharge" ADD CONSTRAINT "IpdCharge_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdCharge" ADD CONSTRAINT "IpdCharge_chargeItemId_fkey" FOREIGN KEY ("chargeItemId") REFERENCES "ChargeMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdCharge" ADD CONSTRAINT "IpdCharge_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillCounter" ADD CONSTRAINT "BillCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalsRecord" ADD CONSTRAINT "VitalsRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalsRecord" ADD CONSTRAINT "VitalsRecord_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAdministration" ADD CONSTRAINT "MedicationAdministration_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeClearance" ADD CONSTRAINT "DischargeClearance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeClearance" ADD CONSTRAINT "DischargeClearance_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "Bed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTask" ADD CONSTRAINT "OrderTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTask" ADD CONSTRAINT "OrderTask_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTask" ADD CONSTRAINT "OrderTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrderEvent" ADD CONSTRAINT "ClinicalOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ClinicalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdConsultation" ADD CONSTRAINT "IpdConsultation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdConsultation" ADD CONSTRAINT "IpdConsultation_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdConsultation" ADD CONSTRAINT "IpdConsultation_consultingDoctorId_fkey" FOREIGN KEY ("consultingDoctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdConsultation" ADD CONSTRAINT "IpdConsultation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdConsultation" ADD CONSTRAINT "IpdConsultation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpdConsultation" ADD CONSTRAINT "IpdConsultation_ipdChargeId_fkey" FOREIGN KEY ("ipdChargeId") REFERENCES "IpdCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabTest" ADD CONSTRAINT "LabTest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_sampleCollectedById_fkey" FOREIGN KEY ("sampleCollectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_testId_fkey" FOREIGN KEY ("testId") REFERENCES "LabTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyExam" ADD CONSTRAINT "RadiologyExam_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyOrder" ADD CONSTRAINT "RadiologyOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyOrder" ADD CONSTRAINT "RadiologyOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyOrder" ADD CONSTRAINT "RadiologyOrder_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyOrder" ADD CONSTRAINT "RadiologyOrder_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyOrder" ADD CONSTRAINT "RadiologyOrder_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyOrder" ADD CONSTRAINT "RadiologyOrder_examId_fkey" FOREIGN KEY ("examId") REFERENCES "RadiologyExam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyReport" ADD CONSTRAINT "RadiologyReport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "RadiologyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiologyReport" ADD CONSTRAINT "RadiologyReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreTriage" ADD CONSTRAINT "PreTriage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreTriage" ADD CONSTRAINT "PreTriage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreTriage" ADD CONSTRAINT "PreTriage_screenedById_fkey" FOREIGN KEY ("screenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreTriage" ADD CONSTRAINT "PreTriage_routedById_fkey" FOREIGN KEY ("routedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueManagement" ADD CONSTRAINT "QueueManagement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueManagement" ADD CONSTRAINT "QueueManagement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueManagement" ADD CONSTRAINT "QueueManagement_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueManagement" ADD CONSTRAINT "QueueManagement_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCareCase" ADD CONSTRAINT "DayCareCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCareCase" ADD CONSTRAINT "DayCareCase_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCareCase" ADD CONSTRAINT "DayCareCase_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbulanceTrip" ADD CONSTRAINT "AmbulanceTrip_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbulanceTrip" ADD CONSTRAINT "AmbulanceTrip_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceCase" ADD CONSTRAINT "InsuranceCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceCase" ADD CONSTRAINT "InsuranceCase_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "InsuranceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeathCertificate" ADD CONSTRAINT "DeathCertificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeathCertificate" ADD CONSTRAINT "DeathCertificate_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeathCertificate" ADD CONSTRAINT "DeathCertificate_certifiedById_fkey" FOREIGN KEY ("certifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeathCertificate" ADD CONSTRAINT "DeathCertificate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

