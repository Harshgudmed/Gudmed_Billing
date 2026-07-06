```mermaid
erDiagram

        MachineType {
            lab_analyzer lab_analyzer
radiology_equipment radiology_equipment
vital_signs_monitor vital_signs_monitor
        }
    


        ConnectionType {
            hl7 hl7
astm astm
rest_api rest_api
file_upload file_upload
serial serial
        }
    


        ConnectionStatus {
            connected connected
disconnected disconnected
error error
        }
    


        QueueStatus {
            pending pending
matched matched
imported imported
failed failed
manual_review manual_review
        }
    


        LogType {
            connection connection
result_import result_import
error error
config_change config_change
        }
    


        InvitationStatus {
            pending pending
accepted accepted
expired expired
cancelled cancelled
        }
    
  "Organization" {
    String id "🗝️"
    String name 
    String slug 
    String logoUrl "❓"
    String primaryColor 
    String secondaryColor 
    String email "❓"
    String phone "❓"
    String address "❓"
    String city "❓"
    String region "❓"
    String country 
    String settings 
    String subscriptionTier 
    String subscriptionStatus 
    DateTime subscriptionStartedAt "❓"
    DateTime subscriptionEndsAt "❓"
    String modulesEnabled 
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "User" {
    String id "🗝️"
    String organizationId 
    String email 
    String passwordHash "❓"
    String fullName 
    String phone "❓"
    DateTime dateOfBirth "❓"
    String gender "❓"
    String address "❓"
    String employeeId "❓"
    String role 
    String departmentId "❓"
    String specialization "❓"
    String licenseNumber "❓"
    Float consultationFee "❓"
    Int followUpDays "❓"
    Boolean isActive 
    DateTime lastLoginAt "❓"
    String preferences "❓"
    String defaultCalendar 
    String invitationToken "❓"
    DateTime invitationExpiresAt "❓"
    String invitedById "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "Department" {
    String id "🗝️"
    String organizationId 
    String name 
    String code "❓"
    String description "❓"
    String headId "❓"
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Patient" {
    String id "🗝️"
    String organizationId 
    String mrn 
    String externalId "❓"
    String passwordHash "❓"
    String assignedCrmUserId "❓"
    String firstName 
    String middleName "❓"
    String lastName 
    DateTime dateOfBirth 
    String gender 
    String bloodGroup "❓"
    String phonePrimary "❓"
    String phoneSecondary "❓"
    String email "❓"
    String region "❓"
    String zone "❓"
    String woreda "❓"
    String kebele "❓"
    String houseNumber "❓"
    String postalCode "❓"
    String addressDescription "❓"
    String emergencyContactName "❓"
    String emergencyContactPhone "❓"
    String emergencyContactRelationship "❓"
    String allergies "❓"
    String chronicConditions "❓"
    String currentMedications "❓"
    Boolean hasInsurance 
    String insuranceProvider "❓"
    String insuranceId "❓"
    DateTime insuranceExpiryDate "❓"
    String insuranceCoverageDetails "❓"
    String photoUrl "❓"
    String maritalStatus "❓"
    String referredBy "❓"
    String mlcNumber "❓"
    String occupation "❓"
    String educationLevel "❓"
    Boolean isActive 
    Boolean isVip 
    String notes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    String updatedById "❓"
    }
  

  "PatientDocument" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String documentType 
    String title "❓"
    String fileUrl 
    String fileType "❓"
    DateTime uploadedAt 
    }
  

  "PreTriage" {
    String id "🗝️"
    String organizationId 
    String screeningNumber 
    String firstName "❓"
    String lastName "❓"
    Int age "❓"
    String gender "❓"
    String phone "❓"
    String chiefComplaint "❓"
    String briefHistory "❓"
    Float temperature "❓"
    Int bloodPressureSystolic "❓"
    Int bloodPressureDiastolic "❓"
    Int pulseRate "❓"
    Int respiratoryRate "❓"
    Float spo2 "❓"
    Float weight "❓"
    Float height "❓"
    Float bmi "❓"
    Float fbs "❓"
    Float ppbs "❓"
    String routedTo "❓"
    String status 
    String patientId "❓"
    DateTime screenedAt 
    String screenedById "❓"
    DateTime routedAt "❓"
    String routedById "❓"
    }
  

  "QueueManagement" {
    String id "🗝️"
    String organizationId 
    String patientId "❓"
    String serviceArea 
    String serviceType "❓"
    String queueNumber 
    String priority 
    String assignedToId "❓"
    String assignedRoom "❓"
    String status 
    DateTime joinedQueueAt 
    DateTime calledAt "❓"
    DateTime serviceStartedAt "❓"
    DateTime serviceCompletedAt "❓"
    Int estimatedWaitMinutes "❓"
    String displayMessage "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "TriageAssessment" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String appointmentId "❓"
    String triageType 
    String etatPriority "❓"
    String etatCategory "❓"
    String urgencyLevel "❓"
    String chiefComplaint "❓"
    Float temperature "❓"
    Int bloodPressureSystolic "❓"
    Int bloodPressureDiastolic "❓"
    Int pulseRate "❓"
    Int respiratoryRate "❓"
    Int oxygenSaturation "❓"
    Float weight "❓"
    Float height "❓"
    Int ageMonths "❓"
    Float muac "❓"
    Boolean edema 
    Boolean unableToDrink 
    Boolean vomitingEverything 
    Boolean convulsions 
    Boolean lethargicUnconscious 
    Int pregnancyWeeks "❓"
    Int gravida "❓"
    Int para "❓"
    DateTime lastMenstrualPeriod "❓"
    String mentalStatus "❓"
    Boolean suicidalIdeation 
    Boolean violentBehavior 
    Boolean substanceUse 
    String triageNotes "❓"
    String triageCategory "❓"
    String recommendedService "❓"
    String triagedById "❓"
    DateTime triagedAt 
    DateTime createdAt 
    }
  

  "Appointment" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String doctorId "❓"
    DateTime appointmentDate 
    String appointmentTime 
    String appointmentType "❓"
    String departmentId "❓"
    String priority 
    Float consultationFee "❓"
    String status 
    String chiefComplaint "❓"
    String notes "❓"
    String consultationNotes "❓"
    DateTime checkedInAt "❓"
    String checkedInById "❓"
    DateTime startedAt "❓"
    DateTime completedAt "❓"
    DateTime cancelledAt "❓"
    String cancelledById "❓"
    String cancellationReason "❓"
    String rescheduledFromId "❓"
    String rescheduledToId "❓"
    Boolean reminderSent 
    DateTime reminderSentAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "Consultation" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String appointmentId "❓"
    String doctorId 
    DateTime visitDate 
    String visitType "❓"
    Float temperature "❓"
    Int bloodPressureSystolic "❓"
    Int bloodPressureDiastolic "❓"
    Int pulseRate "❓"
    Int respiratoryRate "❓"
    Float weight "❓"
    Float height "❓"
    Int oxygenSaturation "❓"
    String chiefComplaint "❓"
    String historyOfPresentIllness "❓"
    String physicalExamination "❓"
    String diagnosis "❓"
    String icd10Codes "❓"
    String treatmentPlan "❓"
    String followUpInstructions "❓"
    DateTime followUpDate "❓"
    String referredTo "❓"
    String referralReason "❓"
    String notes "❓"
    String attachments "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "Ward" {
    String id "🗝️"
    String organizationId 
    String departmentId "❓"
    String name 
    String code "❓"
    String type "❓"
    Int capacity 
    String building "❓"
    String floor "❓"
    String chargeNurse "❓"
    String phone "❓"
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Bed" {
    String id "🗝️"
    String organizationId 
    String wardId 
    String bedCategoryId "❓"
    String bedNumber 
    String type "❓"
    String status 
    String currentPatientId "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "Admission" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String bedId "❓"
    DateTime admissionDate 
    String admissionType "❓"
    String admissionReason "❓"
    String admissionDiagnosis "❓"
    String chiefComplaint "❓"
    Int expectedLengthOfStay "❓"
    Float depositAmount "❓"
    String admissionNotes "❓"
    Boolean isCritical 
    String criticalLevel "❓"
    String admittingDoctorId "❓"
    String attendingDoctorId "❓"
    String status 
    String admissionState "❓"
    String dischargeType "❓"
    DateTime dischargeDate "❓"
    String dischargeReason "❓"
    String dischargeDiagnosis "❓"
    String dischargeSummary "❓"
    String treatmentSummary "❓"
    String dischargeCondition "❓"
    String medicationsOnDischarge "❓"
    String dischargeNotes "❓"
    String followUpInstructions "❓"
    String dischargeDoctorId "❓"
    DateTime followUpDate "❓"
    String followUpNotes "❓"
    String clinicalNotes "❓"
    Float dailyRoomRate "❓"
    Float totalBillAmount "❓"
    Boolean billGenerated 
    String additionalCharges "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "DeathCertificate" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String certificateNumber 
    DateTime dateOfDeath 
    String timeOfDeath "❓"
    String placeOfDeath 
    String locationDetails "❓"
    Int ageAtDeathYears "❓"
    Int ageAtDeathMonths "❓"
    Int ageAtDeathDays "❓"
    String sex 
    String maritalStatus "❓"
    String occupation "❓"
    String address "❓"
    String immediateCause 
    String antecedentCauseB "❓"
    String antecedentCauseC "❓"
    String antecedentCauseD "❓"
    String otherConditions "❓"
    String mannerOfDeath 
    Boolean autopsyPerformed 
    String autopsyFindings "❓"
    Boolean isMaternalDeath 
    String pregnancyRelated "❓"
    String certifiedById "❓"
    DateTime certificationDate 
    String certifierQualification "❓"
    String licenseNumber "❓"
    String signatureUrl "❓"
    String issuedTo "❓"
    String issuedToRelationship "❓"
    String issuedToNationalId "❓"
    DateTime issuedAt "❓"
    String issuedById "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "PharmacyDrug" {
    String id "🗝️"
    String organizationId 
    String drugName 
    String genericName "❓"
    String brandName "❓"
    String drugCode "❓"
    String drugCategory "❓"
    String dosageForm "❓"
    String strength "❓"
    Int quantityInStock 
    String unitOfMeasure "❓"
    Int reorderLevel 
    Int maximumStockLevel "❓"
    Float costPrice "❓"
    Float sellingPrice "❓"
    Float markupPercentage "❓"
    Float purchasePrice "❓"
    Float mrp "❓"
    Float gstRate "❓"
    String barcode "❓"
    String manufacturer "❓"
    String storageLocation "❓"
    Boolean requiresPrescription 
    String supplierName "❓"
    String supplierContact "❓"
    String description "❓"
    String sideEffects "❓"
    String contraindications "❓"
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "PharmacyBatch" {
    String id "🗝️"
    String organizationId 
    String drugId 
    String batchNumber 
    DateTime manufactureDate "❓"
    DateTime expiryDate 
    Int quantityReceived 
    Int quantityRemaining 
    String purchaseOrderNumber "❓"
    DateTime purchaseDate "❓"
    Float costPricePerUnit "❓"
    Float totalCost "❓"
    String supplierName "❓"
    String supplierInvoice "❓"
    String vendorId "❓"
    String status 
    DateTime createdAt 
    String createdById "❓"
    }
  

  "Prescription" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String consultationId "❓"
    String doctorId 
    DateTime prescriptionDate 
    String items 
    String status 
    String dispensedById "❓"
    DateTime dispensedAt "❓"
    String notes "❓"
    Boolean isRefill 
    Int refillsAllowed 
    Int refillsRemaining "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "PharmacySale" {
    String id "🗝️"
    String organizationId 
    String patientId "❓"
    String prescriptionId "❓"
    String servedById "❓"
    DateTime saleDate 
    String saleType "❓"
    String items 
    Float subtotal 
    Float discountAmount 
    Float taxAmount 
    Float totalAmount 
    String paymentStatus 
    String paymentMethod "❓"
    Float amountPaid 
    Float amountDue "❓"
    String receiptNumber 
    DateTime createdAt 
    String createdById "❓"
    }
  

  "PharmacyPurchaseOrder" {
    String id "🗝️"
    String organizationId 
    String poNumber 
    String status 
    String supplierName 
    String supplierContact "❓"
    String supplierEmail "❓"
    String vendorId "❓"
    DateTime orderDate 
    DateTime expectedDeliveryDate "❓"
    DateTime receivedDate "❓"
    String items 
    Float totalAmount 
    String notes "❓"
    String cancellationNote "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "StockLedger" {
    String id "🗝️"
    String organizationId 
    String drugId 
    String batchId "❓"
    String changeType 
    Int quantityDelta 
    Int balanceAfter 
    String reference "❓"
    String note "❓"
    String createdById "❓"
    DateTime createdAt 
    }
  

  "Vendor" {
    String id "🗝️"
    String organizationId 
    String name 
    String contactPerson "❓"
    String phone "❓"
    String email "❓"
    String gstNumber "❓"
    String address "❓"
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "MedicineReference" {
    String id "🗝️"
    String name 
    String nameLower 
    Float price "❓"
    String manufacturer "❓"
    String type "❓"
    String packSize "❓"
    String composition "❓"
    Boolean isDiscontinued 
    }
  

  "LabTest" {
    String id "🗝️"
    String organizationId 
    String testName 
    String testCode "❓"
    String testCategory "❓"
    String testType "❓"
    String specimenType "❓"
    String specimenVolume "❓"
    String specimenContainer "❓"
    String resultType "❓"
    String unit "❓"
    String referenceRanges "❓"
    Float price "❓"
    Int turnaroundTime "❓"
    String department "❓"
    String preparationInstructions "❓"
    String clinicalSignificance "❓"
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "LabOrder" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String consultationId "❓"
    String requestedById 
    DateTime orderDate 
    String orderNumber 
    String tests 
    String clinicalIndication "❓"
    String provisionalDiagnosis "❓"
    String priority 
    String status 
    DateTime sampleCollectedAt "❓"
    String sampleCollectedById "❓"
    String accessionNumber "❓"
    DateTime resultsEnteredAt "❓"
    String resultsEnteredById "❓"
    DateTime resultsVerifiedAt "❓"
    String resultsVerifiedById "❓"
    DateTime resultsReportedAt "❓"
    String notes "❓"
    String rejectionReason "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "LabResult" {
    String id "🗝️"
    String organizationId "❓"
    String orderId 
    String testId 
    String resultValue 
    String resultUnit "❓"
    Boolean isAbnormal 
    Boolean isCritical 
    String flag "❓"
    Float referenceRangeMin "❓"
    Float referenceRangeMax "❓"
    String referenceRangeText "❓"
    String qcLevel "❓"
    Boolean qcPassed "❓"
    String methodUsed "❓"
    String instrumentUsed "❓"
    String enteredById "❓"
    DateTime enteredAt 
    String verifiedById "❓"
    DateTime verifiedAt "❓"
    String comment "❓"
    String technicianNotes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "RadiologyExam" {
    String id "🗝️"
    String organizationId 
    String examName 
    String examCode "❓"
    String examCategory "❓"
    String bodyPart "❓"
    String modality "❓"
    Float price "❓"
    Int estimatedDuration "❓"
    String preparationInstructions "❓"
    Boolean contrastRequired 
    String description "❓"
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "RadiologyOrder" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String consultationId "❓"
    String requestedById 
    String examId 
    DateTime orderDate 
    String orderNumber 
    String clinicalIndication "❓"
    String provisionalDiagnosis "❓"
    String relevantHistory "❓"
    String urgency 
    String status 
    DateTime scheduledDate "❓"
    DateTime examPerformedAt "❓"
    String performedById "❓"
    DateTime reportCreatedAt "❓"
    String reportedById "❓"
    DateTime reportVerifiedAt "❓"
    String verifiedById "❓"
    String notes "❓"
    String cancellationReason "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "RadiologyReport" {
    String id "🗝️"
    String organizationId "❓"
    String orderId 
    String technique "❓"
    String findings "❓"
    String impression "❓"
    String recommendations "❓"
    Boolean hasCriticalFindings 
    String criticalFindings "❓"
    String criticalNotifiedTo "❓"
    DateTime criticalNotifiedAt "❓"
    Boolean comparedWithPrevious 
    String comparisonNotes "❓"
    String images "❓"
    String dicomStudyUid "❓"
    String templateUsed "❓"
    String reportedById "❓"
    DateTime reportedAt 
    String verifiedById "❓"
    DateTime verifiedAt "❓"
    String status 
    String amendmentReason "❓"
    DateTime amendedAt "❓"
    String amendedById "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "BillingService" {
    String id "🗝️"
    String organizationId 
    String serviceName 
    String serviceCode "❓"
    String serviceCategory "❓"
    String department "❓"
    Float unitPrice 
    Boolean isTaxable 
    Float taxPercentage 
    Boolean isCoveredByInsurance 
    Float insuranceCopayPercentage "❓"
    String description "❓"
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "Invoice" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String consultationId "❓"
    String invoiceNumber 
    DateTime invoiceDate 
    DateTime dueDate "❓"
    String items 
    Float subtotal 
    Float discountAmount 
    Float discountPercentage 
    Float taxAmount 
    Float totalAmount 
    String paymentStatus 
    Float amountPaid 
    Float balanceDue "❓"
    Float insuranceClaimAmount 
    String insuranceClaimStatus "❓"
    Float patientCopayAmount 
    String status 
    String notes "❓"
    String termsAndConditions "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    DateTime cancelledAt "❓"
    String cancelledById "❓"
    String cancellationReason "❓"
    }
  

  "Payment" {
    String id "🗝️"
    String organizationId 
    String invoiceId 
    String patientId "❓"
    DateTime paymentDate 
    String receiptNumber 
    Float amount 
    String paymentMethod 
    String paymentReference "❓"
    String cardLastFour "❓"
    String mobileMoneyProvider "❓"
    String bankName "❓"
    String chequeNumber "❓"
    DateTime chequeDate "❓"
    String processedById "❓"
    Boolean isRefund 
    String refundReason "❓"
    String originalPaymentId "❓"
    String notes "❓"
    DateTime createdAt 
    String createdById "❓"
    }
  

  "DoctorFeeSlab" {
    String id "🗝️"
    String organizationId 
    String doctorId 
    Int fromDays 
    Int toDays 
    Float feeAmount 
    Boolean isActive 
    String notes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "DoctorCommissionConfig" {
    String id "🗝️"
    String organizationId 
    String doctorId 
    String commissionType 
    Float commissionRate 
    Boolean isActive 
    String notes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "DoctorCommission" {
    String id "🗝️"
    String organizationId 
    String doctorId 
    String invoiceId "❓"
    Float invoiceAmount 
    Float commissionRate 
    String commissionType 
    Float commissionAmount 
    String status 
    String period "❓"
    DateTime settledAt "❓"
    String settledById "❓"
    String settlementNote "❓"
    String settlementRef "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "MachineIntegration" {
    String id "🗝️"
    String organizationId 
    String machineName 
    MachineType machineType 
    String manufacturer "❓"
    String model "❓"
    String serialNumber "❓"
    String department "❓"
    ConnectionType connectionType 
    String connectionDetails 
    String testMapping 
    Boolean isActive 
    ConnectionStatus connectionStatus 
    DateTime lastConnectedAt "❓"
    DateTime lastResultReceivedAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "MachineResultsQueue" {
    String id "🗝️"
    String organizationId 
    String machineIntegrationId 
    String rawData 
    String parsedData "❓"
    String patientIdentifier "❓"
    String matchedPatientId "❓"
    String testResults 
    QueueStatus status 
    String errorMessage "❓"
    DateTime receivedAt 
    DateTime processedAt "❓"
    }
  

  "IntegrationLog" {
    String id "🗝️"
    String organizationId "❓"
    String machineIntegrationId "❓"
    DateTime logDate 
    LogType logType "❓"
    String message 
    String details "❓"
    Int resultsImported 
    Int resultsFailed 
    DateTime createdAt 
    }
  

  "UserInvitation" {
    String id "🗝️"
    String organizationId 
    String email 
    String role 
    String departmentIds "❓"
    String token 
    DateTime expiresAt 
    InvitationStatus status 
    DateTime acceptedAt "❓"
    DateTime createdAt 
    String sentById 
    }
  

  "Permission" {
    String id "🗝️"
    String code 
    String name 
    String description "❓"
    String category 
    DateTime createdAt 
    }
  

  "RolePermission" {
    String id "🗝️"
    String role 
    String permissionId 
    Boolean canCreate 
    Boolean canRead 
    Boolean canUpdate 
    Boolean canDelete 
    }
  

  "UserActivity" {
    String id "🗝️"
    String organizationId "❓"
    String userId 
    String action 
    String entityType "❓"
    String entityId "❓"
    String details "❓"
    String ipAddress "❓"
    String userAgent "❓"
    DateTime timestamp 
    }
  

  "AuditLog" {
    String id "🗝️"
    String organizationId 
    String userId "❓"
    String userEmail "❓"
    String userRole "❓"
    String action 
    String entityType "❓"
    String entityId "❓"
    String oldValues "❓"
    String newValues "❓"
    String ipAddress "❓"
    String userAgent "❓"
    DateTime performedAt 
    String description "❓"
    String metadata "❓"
    }
  

  "Notification" {
    String id "🗝️"
    String organizationId 
    String userId 
    String notificationType "❓"
    String title 
    String message 
    String entityType "❓"
    String entityId "❓"
    String deliveryMethod "❓"
    Boolean isRead 
    DateTime readAt "❓"
    String priority 
    DateTime sendAt 
    DateTime sentAt "❓"
    DateTime createdAt 
    }
  

  "EaptsConfig" {
    String id "🗝️"
    String organizationId 
    String apiUrl 
    String apiKey 
    String facilityCode 
    Boolean isEnabled 
    Boolean autoSyncEnabled 
    Int syncIntervalMinutes 
    DateTime lastSyncAt "❓"
    String syncStatus "❓"
    String syncErrors "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "EaptsMedicationMapping" {
    String id "🗝️"
    String organizationId 
    String localDrugId 
    String eaptsDrugCode 
    String eaptsDrugName 
    String eaptsUnitOfMeasure "❓"
    String mappingStatus 
    DateTime lastSyncedAt "❓"
    String mappingNotes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "EaptsTransaction" {
    String id "🗝️"
    String organizationId 
    String transactionType 
    DateTime transactionDate 
    String requestPayload "❓"
    String responsePayload "❓"
    String status 
    String errorMessage "❓"
    Int retryCount 
    String entityType "❓"
    String entityId "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "BedCategory" {
    String id "🗝️"
    String organizationId 
    String name 
    String code 
    Int rank 
    Float defaultBedDayRate "❓"
    Boolean isCritical 
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "TariffPlan" {
    String id "🗝️"
    String organizationId 
    String name 
    String payerType 
    DateTime validFrom 
    DateTime validTo "❓"
    Boolean isDefault 
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "ChargeMaster" {
    String id "🗝️"
    String organizationId 
    String code 
    String name 
    String serviceGroup 
    String uom "❓"
    Float basePrice 
    Float taxRatePct 
    Boolean isActive 
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "TariffRule" {
    String id "🗝️"
    String organizationId 
    String planId 
    String bedCategoryId "❓"
    String serviceGroup "❓"
    String serviceItemId "❓"
    String adjustmentType 
    Float adjustmentValue 
    DateTime validFrom 
    DateTime validTo "❓"
    DateTime createdAt 
    }
  

  "PatientTariff" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String planId 
    String payerType 
    String corporateId "❓"
    String insurancePolicyId "❓"
    DateTime lockedAt 
    }
  

  "BedOccupancy" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String bedId 
    String bedCategoryId "❓"
    DateTime startAt 
    DateTime endAt "❓"
    String reason "❓"
    }
  

  "IpdCharge" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String chargeItemId "❓"
    String description 
    String serviceGroup 
    Float unitPrice 
    Float quantity 
    Json resolvedFrom "❓"
    DateTime serviceDate 
    String sourceModule "❓"
    String sourceRef "❓"
    DateTime createdAt 
    Float taxPct 
    Float taxAmount 
    Float discountPct 
    Float discountAmount 
    Float lineTotal 
    String postedById "❓"
    String postedByName "❓"
    String status 
    String cancelReason "❓"
    String cancelledById "❓"
    DateTime cancelledAt "❓"
    String billId "❓"
    }
  

  "Bill" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String billNumber "❓"
    String status 
    String billType 
    String payerType 
    Float bedTotal 
    Float serviceTotal 
    Float subtotal 
    Float taxTotal 
    Float discountTotal 
    Float depositTotal 
    Float payableTotal 
    Float paidTotal 
    Float balanceDue 
    String paymentStatus 
    String cancelReason "❓"
    DateTime finalizedAt "❓"
    String createdById "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "BillPayment" {
    String id "🗝️"
    String organizationId 
    String billId "❓"
    String admissionId 
    String receiptNumber "❓"
    String type 
    Float amount 
    String method 
    String reference "❓"
    String status 
    String voidReason "❓"
    String note "❓"
    String creditNoteId "❓"
    String idempotencyKey "❓"
    String receivedById "❓"
    String receivedByName "❓"
    DateTime paidAt 
    DateTime createdAt 
    }
  

  "BillCounter" {
    String id "🗝️"
    String organizationId 
    String series 
    String year 
    Int value 
    }
  

  "VitalsRecord" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    DateTime recordedAt 
    Int systolicBp "❓"
    Int diastolicBp "❓"
    Int heartRate "❓"
    Int respiratoryRate "❓"
    Float spo2 "❓"
    Float tempC "❓"
    Int painScore "❓"
    String consciousness "❓"
    Int gcs "❓"
    Int intakeMl "❓"
    Int outputMl "❓"
    Float bloodSugar "❓"
    Int newsScore "❓"
    String newsRisk "❓"
    String recordedById "❓"
    String recordedByName "❓"
    String notes "❓"
    }
  

  "ClinicalNote" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String noteType 
    String body 
    String authorId "❓"
    String authorName "❓"
    DateTime authoredAt 
    String parentId "❓"
    Json vitals "❓"
    }
  

  "MedicationAdministration" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String prescriptionId "❓"
    String drugName 
    String dosage "❓"
    String route "❓"
    DateTime scheduledAt "❓"
    DateTime administeredAt "❓"
    String status 
    String reason "❓"
    String nurseId "❓"
    String nurseName "❓"
    DateTime createdAt 
    }
  

  "DischargeClearance" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String type 
    String status 
    String clearedById "❓"
    String clearedByName "❓"
    DateTime clearedAt "❓"
    String remark "❓"
    DateTime createdAt 
    }
  

  "HousekeepingTask" {
    String id "🗝️"
    String organizationId 
    String bedId 
    String admissionId "❓"
    String type 
    String status 
    String assignedToName "❓"
    String notes "❓"
    DateTime openedAt 
    DateTime closedAt "❓"
    }
  

  "ClinicalOrder" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String patientId 
    String orderType 
    String catalogModel "❓"
    String catalogItemId "❓"
    String itemName 
    String itemCode "❓"
    String serviceGroup 
    String priority 
    Float quantity 
    String frequency "❓"
    String dosage "❓"
    String route "❓"
    String duration "❓"
    String clinicalIndication "❓"
    String notes "❓"
    String status 
    String domainStatus "❓"
    String orderedById "❓"
    String orderedByName "❓"
    DateTime orderedAt 
    String acknowledgedById "❓"
    String acknowledgedByName "❓"
    DateTime acknowledgedAt "❓"
    String startedById "❓"
    String startedByName "❓"
    DateTime startedAt "❓"
    String completedById "❓"
    String completedByName "❓"
    DateTime completedAt "❓"
    String cancelledById "❓"
    String cancelledByName "❓"
    DateTime cancelledAt "❓"
    String cancelReason "❓"
    String executorModel "❓"
    String executorId "❓"
    Boolean billed 
    String ipdChargeId "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "OrderTask" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String orderId 
    String orderType 
    String itemName 
    DateTime scheduledAt 
    String status 
    DateTime doneAt "❓"
    String doneById "❓"
    String doneByName "❓"
    String resultValue "❓"
    String notes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  

  "ClinicalOrderEvent" {
    String id "🗝️"
    String organizationId 
    String orderId 
    String fromStatus "❓"
    String toStatus 
    String actorId "❓"
    String actorName "❓"
    String actorRole "❓"
    String remark "❓"
    DateTime at 
    }
  

  "AmbulanceTrip" {
    String id "🗝️"
    String organizationId 
    String patientId "❓"
    String tripNumber 
    String ambulanceType 
    String fromLocation "❓"
    String toLocation "❓"
    Float distanceKm "❓"
    Float charge 
    String status 
    DateTime tripDate 
    String driverName "❓"
    String vehicleNumber "❓"
    String contactPhone "❓"
    String notes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "DayCareCase" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String caseNumber 
    String doctorId "❓"
    String doctorName "❓"
    String procedure "❓"
    DateTime admissionDate 
    String dischargeTime "❓"
    Float fee 
    String paymentStatus 
    Float amountPaid 
    String status 
    String notes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "InsuranceCase" {
    String id "🗝️"
    String organizationId 
    String patientId 
    String payerType 
    String insurerName 
    String tpaName "❓"
    String policyNumber "❓"
    Float coverageLimit 
    String status 
    DateTime validFrom "❓"
    DateTime validTo "❓"
    String notes "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "InsuranceClaim" {
    String id "🗝️"
    String organizationId 
    String caseId 
    String claimNumber 
    Float claimAmount 
    Float approvedAmount "❓"
    String status 
    String diagnosis "❓"
    String remarks "❓"
    DateTime submittedAt "❓"
    DateTime settledAt "❓"
    DateTime createdAt 
    DateTime updatedAt 
    String createdById "❓"
    }
  

  "IpdConsultation" {
    String id "🗝️"
    String organizationId 
    String admissionId 
    String consultingDoctorId 
    String requestedById "❓"
    String departmentId "❓"
    DateTime requestedAt 
    DateTime scheduledAt "❓"
    DateTime completedAt "❓"
    String status 
    String referralReason "❓"
    String consultationNotes "❓"
    String diagnosis "❓"
    String recommendedPlan "❓"
    Boolean followUpRequired 
    String followUpNotes "❓"
    String ipdChargeId "❓"
    Float feeApplied "❓"
    Float commissionAmount "❓"
    DateTime createdAt 
    DateTime updatedAt 
    }
  
    "User" }o--|| "Organization" : "organization"
    "User" }o--|o "Department" : "department"
    "User" |o--|o "User" : "invitedBy"
    "Department" }o--|| "Organization" : "organization"
    "Patient" }o--|| "Organization" : "organization"
    "Patient" }o--|o "User" : "assignedCrmUser"
    "PatientDocument" }o--|| "Organization" : "organization"
    "PatientDocument" }o--|| "Patient" : "patient"
    "PreTriage" }o--|| "Organization" : "organization"
    "PreTriage" }o--|o "Patient" : "patient"
    "PreTriage" }o--|o "User" : "screenedBy"
    "PreTriage" }o--|o "User" : "routedBy"
    "QueueManagement" }o--|| "Organization" : "organization"
    "QueueManagement" }o--|o "Patient" : "patient"
    "QueueManagement" }o--|o "User" : "assignedTo"
    "TriageAssessment" }o--|| "Organization" : "organization"
    "TriageAssessment" }o--|| "Patient" : "patient"
    "TriageAssessment" }o--|o "User" : "triagedBy"
    "Appointment" }o--|| "Organization" : "organization"
    "Appointment" }o--|| "Patient" : "patient"
    "Appointment" }o--|o "User" : "doctor"
    "Appointment" }o--|o "User" : "checkedInBy"
    "Consultation" }o--|| "Organization" : "organization"
    "Consultation" }o--|| "Patient" : "patient"
    "Consultation" }o--|o "Appointment" : "appointment"
    "Consultation" }o--|| "User" : "doctor"
    "Ward" }o--|| "Organization" : "organization"
    "Ward" }o--|o "Department" : "department"
    "Bed" }o--|| "Organization" : "organization"
    "Bed" }o--|| "Ward" : "ward"
    "Bed" }o--|o "BedCategory" : "bedCategory"
    "Admission" }o--|| "Organization" : "organization"
    "Admission" }o--|| "Patient" : "patient"
    "Admission" }o--|o "Bed" : "bed"
    "Admission" }o--|o "User" : "attendingDoctor"
    "Admission" }o--|o "User" : "admittingDoctor"
    "Admission" }o--|o "User" : "dischargeDoctor"
    "DeathCertificate" }o--|| "Organization" : "organization"
    "DeathCertificate" }o--|| "Patient" : "patient"
    "DeathCertificate" }o--|o "User" : "certifiedBy"
    "DeathCertificate" }o--|o "User" : "issuedBy"
    "PharmacyDrug" }o--|| "Organization" : "organization"
    "PharmacyBatch" }o--|| "PharmacyDrug" : "drug"
    "PharmacyBatch" }o--|o "Vendor" : "vendor"
    "Prescription" }o--|| "Organization" : "organization"
    "Prescription" }o--|| "Patient" : "patient"
    "Prescription" }o--|o "Consultation" : "consultation"
    "Prescription" }o--|| "User" : "doctor"
    "Prescription" }o--|o "User" : "dispensedBy"
    "PharmacySale" }o--|| "Organization" : "organization"
    "PharmacySale" }o--|o "Patient" : "patient"
    "PharmacySale" }o--|o "Prescription" : "prescription"
    "PharmacySale" }o--|o "User" : "servedBy"
    "PharmacyPurchaseOrder" }o--|| "Organization" : "organization"
    "PharmacyPurchaseOrder" }o--|o "Vendor" : "vendor"
    "StockLedger" }o--|| "PharmacyDrug" : "drug"
    "Vendor" }o--|| "Organization" : "organization"
    "LabTest" }o--|| "Organization" : "organization"
    "LabOrder" }o--|| "Organization" : "organization"
    "LabOrder" }o--|| "Patient" : "patient"
    "LabOrder" }o--|o "Consultation" : "consultation"
    "LabOrder" }o--|| "User" : "requestedBy"
    "LabOrder" }o--|o "User" : "sampleCollectedBy"
    "LabResult" }o--|| "LabOrder" : "order"
    "LabResult" }o--|| "LabTest" : "test"
    "LabResult" }o--|o "User" : "enteredBy"
    "LabResult" }o--|o "User" : "verifiedBy"
    "RadiologyExam" }o--|| "Organization" : "organization"
    "RadiologyOrder" }o--|| "Organization" : "organization"
    "RadiologyOrder" }o--|| "Patient" : "patient"
    "RadiologyOrder" }o--|o "Consultation" : "consultation"
    "RadiologyOrder" }o--|| "User" : "requestedBy"
    "RadiologyOrder" }o--|o "User" : "performedBy"
    "RadiologyOrder" }o--|| "RadiologyExam" : "exam"
    "RadiologyReport" |o--|| "RadiologyOrder" : "order"
    "RadiologyReport" }o--|o "User" : "reportedBy"
    "BillingService" }o--|| "Organization" : "organization"
    "Invoice" }o--|| "Organization" : "organization"
    "Invoice" }o--|| "Patient" : "patient"
    "Invoice" }o--|o "Consultation" : "consultation"
    "Invoice" }o--|o "User" : "createdBy"
    "Invoice" }o--|o "User" : "cancelledBy"
    "Payment" }o--|| "Organization" : "organization"
    "Payment" }o--|| "Invoice" : "invoice"
    "Payment" }o--|o "Patient" : "patient"
    "Payment" }o--|o "User" : "processedBy"
    "DoctorFeeSlab" }o--|| "Organization" : "organization"
    "DoctorFeeSlab" }o--|| "User" : "doctor"
    "DoctorCommissionConfig" }o--|| "Organization" : "organization"
    "DoctorCommissionConfig" |o--|| "User" : "doctor"
    "DoctorCommission" }o--|| "Organization" : "organization"
    "DoctorCommission" }o--|| "User" : "doctor"
    "DoctorCommission" }o--|o "User" : "settledBy"
    "MachineIntegration" |o--|| "MachineType" : "enum:machineType"
    "MachineIntegration" |o--|| "ConnectionType" : "enum:connectionType"
    "MachineIntegration" |o--|| "ConnectionStatus" : "enum:connectionStatus"
    "MachineIntegration" }o--|| "Organization" : "organization"
    "MachineResultsQueue" |o--|| "QueueStatus" : "enum:status"
    "MachineResultsQueue" }o--|| "Organization" : "organization"
    "MachineResultsQueue" }o--|| "MachineIntegration" : "machineIntegration"
    "MachineResultsQueue" }o--|o "Patient" : "patient"
    "IntegrationLog" |o--|o "LogType" : "enum:logType"
    "IntegrationLog" }o--|o "MachineIntegration" : "machineIntegration"
    "UserInvitation" |o--|| "InvitationStatus" : "enum:status"
    "UserInvitation" }o--|| "Organization" : "organization"
    "UserInvitation" }o--|| "User" : "sentBy"
    "RolePermission" }o--|| "Permission" : "permission"
    "UserActivity" }o--|| "User" : "user"
    "AuditLog" }o--|| "Organization" : "organization"
    "AuditLog" }o--|o "User" : "user"
    "Notification" }o--|| "Organization" : "organization"
    "Notification" }o--|| "User" : "user"
    "EaptsConfig" |o--|| "Organization" : "organization"
    "EaptsMedicationMapping" }o--|| "Organization" : "organization"
    "EaptsMedicationMapping" }o--|| "PharmacyDrug" : "drug"
    "EaptsTransaction" }o--|| "Organization" : "organization"
    "BedCategory" }o--|| "Organization" : "organization"
    "TariffPlan" }o--|| "Organization" : "organization"
    "ChargeMaster" }o--|| "Organization" : "organization"
    "TariffRule" }o--|| "Organization" : "organization"
    "TariffRule" }o--|| "TariffPlan" : "plan"
    "PatientTariff" }o--|| "Organization" : "organization"
    "PatientTariff" |o--|| "Admission" : "admission"
    "BedOccupancy" }o--|| "Organization" : "organization"
    "BedOccupancy" }o--|| "Admission" : "admission"
    "BedOccupancy" }o--|| "Bed" : "bed"
    "BedOccupancy" }o--|o "BedCategory" : "bedCategory"
    "IpdCharge" }o--|| "Organization" : "organization"
    "IpdCharge" }o--|| "Admission" : "admission"
    "IpdCharge" }o--|o "ChargeMaster" : "chargeItem"
    "IpdCharge" }o--|o "Bill" : "bill"
    "Bill" }o--|| "Organization" : "organization"
    "Bill" }o--|| "Admission" : "admission"
    "BillPayment" }o--|| "Organization" : "organization"
    "BillPayment" }o--|o "Bill" : "bill"
    "BillPayment" }o--|| "Admission" : "admission"
    "BillCounter" }o--|| "Organization" : "organization"
    "VitalsRecord" }o--|| "Organization" : "organization"
    "VitalsRecord" }o--|| "Admission" : "admission"
    "ClinicalNote" }o--|| "Organization" : "organization"
    "ClinicalNote" }o--|| "Admission" : "admission"
    "MedicationAdministration" }o--|| "Organization" : "organization"
    "MedicationAdministration" }o--|| "Admission" : "admission"
    "DischargeClearance" }o--|| "Organization" : "organization"
    "DischargeClearance" }o--|| "Admission" : "admission"
    "HousekeepingTask" }o--|| "Organization" : "organization"
    "HousekeepingTask" }o--|| "Bed" : "bed"
    "ClinicalOrder" }o--|| "Organization" : "organization"
    "ClinicalOrder" }o--|| "Admission" : "admission"
    "OrderTask" }o--|| "Organization" : "organization"
    "OrderTask" }o--|| "Admission" : "admission"
    "OrderTask" }o--|| "ClinicalOrder" : "order"
    "ClinicalOrderEvent" }o--|| "ClinicalOrder" : "order"
    "AmbulanceTrip" }o--|| "Organization" : "organization"
    "AmbulanceTrip" }o--|o "Patient" : "patient"
    "DayCareCase" }o--|| "Organization" : "organization"
    "DayCareCase" }o--|| "Patient" : "patient"
    "DayCareCase" }o--|o "User" : "doctor"
    "InsuranceCase" }o--|| "Organization" : "organization"
    "InsuranceCase" }o--|| "Patient" : "patient"
    "InsuranceClaim" }o--|| "Organization" : "organization"
    "InsuranceClaim" }o--|| "InsuranceCase" : "case"
    "IpdConsultation" }o--|| "Organization" : "organization"
    "IpdConsultation" }o--|| "Admission" : "admission"
    "IpdConsultation" }o--|| "User" : "consultingDoctor"
    "IpdConsultation" }o--|o "User" : "requestedBy"
    "IpdConsultation" }o--|o "Department" : "department"
    "IpdConsultation" |o--|o "IpdCharge" : "ipdCharge"
```
