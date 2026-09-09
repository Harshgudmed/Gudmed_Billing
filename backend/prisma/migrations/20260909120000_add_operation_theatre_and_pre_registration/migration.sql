-- Operation Theatre, and self-service pre-registration.
--
-- Nine new tables. Nothing here alters an existing one, so this cannot break a
-- feature that already works: every table below is created, not changed.
--
-- THE ONE EXCEPTION, and it is not new drift:
--   Prescription_doctorId_fkey is dropped and immediately re-created. The FK is
--   the same (doctorId -> User.id); only its ON DELETE action changes, from the
--   RESTRICT that a required relation got to the SET NULL that an optional one
--   gets. 20260818120000_prescription_doctor_optional made the column nullable
--   but left the constraint alone, so schema.prisma and the database have
--   disagreed ever since. This closes that gap.
--
--   Behaviour change, stated plainly: deleting a User who has prescriptions is
--   currently refused; after this it succeeds and those rows keep the
--   prescription with doctorId set to NULL. That is what schema.prisma has
--   declared since August. Existing rows are untouched either way — 104 of the
--   105 in development carry a doctor, and none is rewritten by this migration.
--
-- Verified before committing: `npm run check:drift` reports no drift after this,
-- and `prisma migrate deploy` builds a database from empty through every
-- migration in order without error.

-- DropForeignKey
ALTER TABLE "Prescription" DROP CONSTRAINT IF EXISTS "Prescription_doctorId_fkey";

-- CreateTable
CREATE TABLE IF NOT EXISTS "PreRegistration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phonePrimary" TEXT NOT NULL,
    "formData" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OperatingTheatre" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "floorId" TEXT,
    "departmentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "theatreType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "cleaningMinutes" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingTheatre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SurgeryCatalog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "chargeItemId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "specialty" TEXT,
    "defaultMinutes" INTEGER NOT NULL DEFAULT 60,
    "defaultAnaesthesia" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurgeryCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OtBooking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "admissionId" TEXT,
    "theatreId" TEXT NOT NULL,
    "surgeryId" TEXT,
    "caseNumber" TEXT NOT NULL,
    "procedureName" TEXT NOT NULL,
    "laterality" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'ELECTIVE',
    "siteOfSurgery" TEXT,
    "patientLocation" TEXT,
    "equipmentNeeded" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "estimatedMinutes" INTEGER,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "primarySurgeonId" TEXT NOT NULL,
    "anaesthetistId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "cancelReason" TEXT,
    "postponeReason" TEXT,
    "statusChangeNote" TEXT,
    "notes" TEXT,
    "bookedById" TEXT,
    "bookedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OtTeamMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OtPreOpAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "diagnosis" TEXT,
    "plannedProcedure" TEXT,
    "indication" TEXT,
    "allergies" TEXT,
    "currentMedication" TEXT,
    "comorbidities" TEXT,
    "previousSurgery" TEXT,
    "asaGrade" TEXT,
    "mallampati" INTEGER,
    "airwayNote" TEXT,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "systolicBp" INTEGER,
    "diastolicBp" INTEGER,
    "heartRate" INTEGER,
    "spo2" DOUBLE PRECISION,
    "bloodGroup" TEXT,
    "haemoglobin" DOUBLE PRECISION,
    "investigationNote" TEXT,
    "fastingFrom" TIMESTAMP(3),
    "fastingNote" TEXT,
    "consentTaken" BOOLEAN NOT NULL DEFAULT false,
    "consentBy" TEXT,
    "fitness" TEXT,
    "fitnessNote" TEXT,
    "assessedById" TEXT,
    "assessedByName" TEXT,
    "assessedAt" TIMESTAMP(3),
    "reassessedAt" TIMESTAMP(3),
    "reassessedById" TEXT,
    "reassessedByName" TEXT,
    "reassessFitness" TEXT,
    "reassessNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtPreOpAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OtSafetyChecklist" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "signInAt" TIMESTAMP(3),
    "signInById" TEXT,
    "signInByName" TEXT,
    "identityConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "siteMarked" BOOLEAN NOT NULL DEFAULT false,
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "anaesthesiaCheck" BOOLEAN NOT NULL DEFAULT false,
    "pulseOximeterOn" BOOLEAN NOT NULL DEFAULT false,
    "knownAllergy" BOOLEAN NOT NULL DEFAULT false,
    "difficultAirwayRisk" BOOLEAN NOT NULL DEFAULT false,
    "bloodLossRisk" BOOLEAN NOT NULL DEFAULT false,
    "signInNote" TEXT,
    "timeOutAt" TIMESTAMP(3),
    "timeOutById" TEXT,
    "timeOutByName" TEXT,
    "teamIntroduced" BOOLEAN NOT NULL DEFAULT false,
    "patientSiteAgreed" BOOLEAN NOT NULL DEFAULT false,
    "antibioticGiven" BOOLEAN NOT NULL DEFAULT false,
    "imagingDisplayed" BOOLEAN NOT NULL DEFAULT false,
    "criticalStepsSaid" BOOLEAN NOT NULL DEFAULT false,
    "timeOutNote" TEXT,
    "signOutAt" TIMESTAMP(3),
    "signOutById" TEXT,
    "signOutByName" TEXT,
    "procedureRecorded" BOOLEAN NOT NULL DEFAULT false,
    "specimenLabelled" BOOLEAN NOT NULL DEFAULT false,
    "equipmentIssue" TEXT,
    "recoveryConcern" TEXT,
    "signOutNote" TEXT,
    "swabInitial" INTEGER,
    "swabFinal" INTEGER,
    "instrumentInitial" INTEGER,
    "instrumentFinal" INTEGER,
    "needleInitial" INTEGER,
    "needleFinal" INTEGER,
    "countsCorrect" BOOLEAN NOT NULL DEFAULT false,
    "countedById" TEXT,
    "countedByName" TEXT,
    "countNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtSafetyChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OtAnaesthesiaRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "anaesthesiaType" TEXT,
    "asaGrade" TEXT,
    "airwayDevice" TEXT,
    "tubeSize" TEXT,
    "ventilationMode" TEXT,
    "ventilatorNote" TEXT,
    "drugsGiven" TEXT,
    "fluidsMl" INTEGER,
    "fluidNote" TEXT,
    "bloodGiven" BOOLEAN NOT NULL DEFAULT false,
    "bloodUnits" INTEGER,
    "bloodNote" TEXT,
    "monitoringNote" TEXT,
    "complication" TEXT,
    "inductionAt" TIMESTAMP(3),
    "reversalAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtAnaesthesiaRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OtOperativeNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "incisionAt" TIMESTAMP(3),
    "closureAt" TIMESTAMP(3),
    "findings" TEXT,
    "procedurePerformed" TEXT,
    "procedureNote" TEXT,
    "complication" TEXT,
    "specimenSent" BOOLEAN NOT NULL DEFAULT false,
    "specimenDetail" TEXT,
    "bloodLossMl" INTEGER,
    "drainDetail" TEXT,
    "postOpInstruction" TEXT,
    "complicationTypes" TEXT,
    "procedureStatus" TEXT,
    "patientDestination" TEXT,
    "dictatedById" TEXT,
    "dictatedByName" TEXT,
    "dictatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtOperativeNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PreRegistration_organizationId_status_createdAt_idx" ON "PreRegistration"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PreRegistration_organizationId_phonePrimary_idx" ON "PreRegistration"("organizationId", "phonePrimary");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OperatingTheatre_organizationId_idx" ON "OperatingTheatre"("organizationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OperatingTheatre_status_idx" ON "OperatingTheatre"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OperatingTheatre_organizationId_name_key" ON "OperatingTheatre"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SurgeryCatalog_organizationId_idx" ON "SurgeryCatalog"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SurgeryCatalog_organizationId_name_key" ON "SurgeryCatalog"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtBooking_organizationId_scheduledStart_idx" ON "OtBooking"("organizationId", "scheduledStart");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtBooking_organizationId_status_idx" ON "OtBooking"("organizationId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtBooking_theatreId_scheduledStart_idx" ON "OtBooking"("theatreId", "scheduledStart");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtBooking_patientId_idx" ON "OtBooking"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OtBooking_organizationId_caseNumber_key" ON "OtBooking"("organizationId", "caseNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtTeamMember_organizationId_bookingId_idx" ON "OtTeamMember"("organizationId", "bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtTeamMember_userId_role_idx" ON "OtTeamMember"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OtTeamMember_bookingId_role_memberName_key" ON "OtTeamMember"("bookingId", "role", "memberName");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OtPreOpAssessment_bookingId_key" ON "OtPreOpAssessment"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtPreOpAssessment_organizationId_idx" ON "OtPreOpAssessment"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OtSafetyChecklist_bookingId_key" ON "OtSafetyChecklist"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtSafetyChecklist_organizationId_idx" ON "OtSafetyChecklist"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OtAnaesthesiaRecord_bookingId_key" ON "OtAnaesthesiaRecord"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtAnaesthesiaRecord_organizationId_idx" ON "OtAnaesthesiaRecord"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OtOperativeNote_bookingId_key" ON "OtOperativeNote"("bookingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OtOperativeNote_organizationId_idx" ON "OtOperativeNote"("organizationId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PreRegistration_organizationId_fkey') THEN
    ALTER TABLE "PreRegistration" ADD CONSTRAINT "PreRegistration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Prescription_doctorId_fkey') THEN
    ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperatingTheatre_organizationId_fkey') THEN
    ALTER TABLE "OperatingTheatre" ADD CONSTRAINT "OperatingTheatre_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperatingTheatre_floorId_fkey') THEN
    ALTER TABLE "OperatingTheatre" ADD CONSTRAINT "OperatingTheatre_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperatingTheatre_departmentId_fkey') THEN
    ALTER TABLE "OperatingTheatre" ADD CONSTRAINT "OperatingTheatre_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurgeryCatalog_organizationId_fkey') THEN
    ALTER TABLE "SurgeryCatalog" ADD CONSTRAINT "SurgeryCatalog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SurgeryCatalog_chargeItemId_fkey') THEN
    ALTER TABLE "SurgeryCatalog" ADD CONSTRAINT "SurgeryCatalog_chargeItemId_fkey" FOREIGN KEY ("chargeItemId") REFERENCES "ChargeMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtBooking_organizationId_fkey') THEN
    ALTER TABLE "OtBooking" ADD CONSTRAINT "OtBooking_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtBooking_patientId_fkey') THEN
    ALTER TABLE "OtBooking" ADD CONSTRAINT "OtBooking_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtBooking_admissionId_fkey') THEN
    ALTER TABLE "OtBooking" ADD CONSTRAINT "OtBooking_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtBooking_theatreId_fkey') THEN
    ALTER TABLE "OtBooking" ADD CONSTRAINT "OtBooking_theatreId_fkey" FOREIGN KEY ("theatreId") REFERENCES "OperatingTheatre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtBooking_surgeryId_fkey') THEN
    ALTER TABLE "OtBooking" ADD CONSTRAINT "OtBooking_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "SurgeryCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtBooking_primarySurgeonId_fkey') THEN
    ALTER TABLE "OtBooking" ADD CONSTRAINT "OtBooking_primarySurgeonId_fkey" FOREIGN KEY ("primarySurgeonId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtBooking_anaesthetistId_fkey') THEN
    ALTER TABLE "OtBooking" ADD CONSTRAINT "OtBooking_anaesthetistId_fkey" FOREIGN KEY ("anaesthetistId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtTeamMember_organizationId_fkey') THEN
    ALTER TABLE "OtTeamMember" ADD CONSTRAINT "OtTeamMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtTeamMember_bookingId_fkey') THEN
    ALTER TABLE "OtTeamMember" ADD CONSTRAINT "OtTeamMember_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "OtBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtTeamMember_userId_fkey') THEN
    ALTER TABLE "OtTeamMember" ADD CONSTRAINT "OtTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtPreOpAssessment_organizationId_fkey') THEN
    ALTER TABLE "OtPreOpAssessment" ADD CONSTRAINT "OtPreOpAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtPreOpAssessment_bookingId_fkey') THEN
    ALTER TABLE "OtPreOpAssessment" ADD CONSTRAINT "OtPreOpAssessment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "OtBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtSafetyChecklist_organizationId_fkey') THEN
    ALTER TABLE "OtSafetyChecklist" ADD CONSTRAINT "OtSafetyChecklist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtSafetyChecklist_bookingId_fkey') THEN
    ALTER TABLE "OtSafetyChecklist" ADD CONSTRAINT "OtSafetyChecklist_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "OtBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtAnaesthesiaRecord_organizationId_fkey') THEN
    ALTER TABLE "OtAnaesthesiaRecord" ADD CONSTRAINT "OtAnaesthesiaRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtAnaesthesiaRecord_bookingId_fkey') THEN
    ALTER TABLE "OtAnaesthesiaRecord" ADD CONSTRAINT "OtAnaesthesiaRecord_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "OtBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtOperativeNote_organizationId_fkey') THEN
    ALTER TABLE "OtOperativeNote" ADD CONSTRAINT "OtOperativeNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OtOperativeNote_bookingId_fkey') THEN
    ALTER TABLE "OtOperativeNote" ADD CONSTRAINT "OtOperativeNote_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "OtBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Columns added to OtOperativeNote after the table itself. Harmless when the
-- table was just created above; the point is a production copy that predates
-- them. All nullable, so safe on a table that already holds rows.
ALTER TABLE "OtOperativeNote" ADD COLUMN IF NOT EXISTS "complicationTypes" TEXT;
ALTER TABLE "OtOperativeNote" ADD COLUMN IF NOT EXISTS "procedureStatus" TEXT;
ALTER TABLE "OtOperativeNote" ADD COLUMN IF NOT EXISTS "patientDestination" TEXT;
