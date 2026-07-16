-- Doctor Sitting Type: Floor -> Room -> DoctorRoomAssignment -> ConsultationSchedule,
-- plus New/Follow-up + prescription-upload fields on QueueManagement.
--
-- Written by hand and applied via `prisma db execute` (not `migrate dev`)
-- because this dev database already has pre-existing drift (indexes on
-- Patient added outside migration history) that makes `migrate dev` want to
-- reset the whole database. This migration does not touch that drift; it
-- only adds the new tables/columns below.

-- CreateTable
CREATE TABLE "Floor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "departmentId" TEXT,
    "roomNumber" TEXT NOT NULL,
    "sittingType" TEXT NOT NULL DEFAULT 'single',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorRoomAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorRoomAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Floor_organizationId_name_key" ON "Floor"("organizationId", "name");
CREATE INDEX "Floor_organizationId_idx" ON "Floor"("organizationId");

CREATE UNIQUE INDEX "Room_organizationId_floorId_roomNumber_key" ON "Room"("organizationId", "floorId", "roomNumber");
CREATE INDEX "Room_organizationId_idx" ON "Room"("organizationId");
CREATE INDEX "Room_floorId_idx" ON "Room"("floorId");
CREATE INDEX "Room_departmentId_idx" ON "Room"("departmentId");

CREATE UNIQUE INDEX "DoctorRoomAssignment_doctorId_roomId_key" ON "DoctorRoomAssignment"("doctorId", "roomId");
CREATE INDEX "DoctorRoomAssignment_organizationId_idx" ON "DoctorRoomAssignment"("organizationId");
CREATE INDEX "DoctorRoomAssignment_roomId_idx" ON "DoctorRoomAssignment"("roomId");

CREATE INDEX "ConsultationSchedule_organizationId_idx" ON "ConsultationSchedule"("organizationId");
CREATE INDEX "ConsultationSchedule_roomId_dayOfWeek_idx" ON "ConsultationSchedule"("roomId", "dayOfWeek");
CREATE INDEX "ConsultationSchedule_doctorId_idx" ON "ConsultationSchedule"("doctorId");

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Room" ADD CONSTRAINT "Room_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Room" ADD CONSTRAINT "Room_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Room" ADD CONSTRAINT "Room_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DoctorRoomAssignment" ADD CONSTRAINT "DoctorRoomAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoctorRoomAssignment" ADD CONSTRAINT "DoctorRoomAssignment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DoctorRoomAssignment" ADD CONSTRAINT "DoctorRoomAssignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultationSchedule" ADD CONSTRAINT "ConsultationSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationSchedule" ADD CONSTRAINT "ConsultationSchedule_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationSchedule" ADD CONSTRAINT "ConsultationSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: QueueManagement gains New/Follow-up + prescription-upload event fields
ALTER TABLE "QueueManagement" ADD COLUMN "visitType" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "QueueManagement" ADD COLUMN "followUpDoctorId" TEXT;
ALTER TABLE "QueueManagement" ADD COLUMN "prescriptionUploadedAt" TIMESTAMP(3);

CREATE INDEX "QueueManagement_followUpDoctorId_idx" ON "QueueManagement"("followUpDoctorId");

ALTER TABLE "QueueManagement" ADD CONSTRAINT "QueueManagement_followUpDoctorId_fkey" FOREIGN KEY ("followUpDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
