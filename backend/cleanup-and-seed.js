import { db } from './src/config/db.js'

async function cleanupAndSeed() {
  try {
    console.log('\n' + '='.repeat(70))
    console.log('🧹 CLEANING DATABASE - DELETING ALL EXAM DATA')
    console.log('='.repeat(70))

    // Delete all radiology exams
    const deletedRadiology = await db.radiologyExam.deleteMany({})
    console.log(`✅ Deleted ${deletedRadiology.count} radiology exams`)

    // Delete all lab tests
    const deletedLabTests = await db.labTest.deleteMany({})
    console.log(`✅ Deleted ${deletedLabTests.count} lab tests`)

    console.log('='.repeat(70))
    console.log('✨ DATABASE CLEANED - READY FOR FRESH SEEDING\n')

    // Now run the seeding
    console.log('='.repeat(70))
    console.log('🌍 SEEDING EXACTLY 552 CATALOG ITEMS')
    console.log('='.repeat(70))

    const catalogData = {
      radiology: [
        'X RAY CHEST (Male)',
        'X- Ray Abdomen - Supine',
        'X- Ray Forearm - AP Left',
        'X-Ray Abdomen - Cross Table',
        'X-Ray Abdomen - KUB',
        'X-Ray Abdomen - Standing',
        'X-Ray Ankle - AP',
        'X-Ray Ankle - AP left',
        'X-Ray Ankle - AP Right',
        'X-Ray Ankle - AP/Lateral left',
        'X-Ray Ankle - AP/Lateral Right',
        'X-Ray Ankle - AP/Oblique Left',
        'X-Ray Ankle - AP/Oblique Right',
        'X-Ray Ankle - Lateral',
        'X-Ray Ankle - Lateral Left',
        'X-Ray Ankle - Lateral Right',
        'X-Ray Ankle - Lateral/Oblique Left',
        'X-Ray Ankle - Lateral/Oblique Right',
        'X-Ray Ankle - Oblique',
        'X-Ray Ankle - Oblique Left',
        'X-Ray Ankle - Oblique Right',
        'X-Ray Arm - AP',
        'X-Ray Arm - AP Left',
        'X-Ray Arm - AP Right',
        'X-Ray Arm - AP/Lateral Left',
        'X-Ray Arm - AP/Lateral Right',
        'X-Ray Arm - AP/Oblique Left',
        'X-Ray Arm - AP/Oblique Right',
        'X-Ray Arm - Lateral',
        'X-Ray Arm - Lateral Left',
        'X-Ray Arm - Lateral Right',
        'X-Ray Arm - Lateral/Oblique Left',
        'X-Ray Arm - Lateral/Oblique Right',
        'X-Ray Arm - Oblique',
        'X-Ray Arm - Oblique Left',
        'X-Ray Arm - Oblique Right',
        'X-Ray Base of the Skull',
        'X-Ray both SI joint',
        'X-Ray Both SI Joint - Left',
        'X-Ray Both SI Joint - Right',
        'X-Ray Carpell Tunnel View',
        'X-Ray Carpell Tunnel View Left',
        'X-Ray Carpell Tunnel View Right',
        'X-Ray Cervical Spine',
        'X-Ray Chest',
        'X-ray Chest PA View',
        'X-Ray DL Spine',
        'X-Ray Dorsal Spine',
        'X-Ray Elbow - AP',
        'X-Ray Elbow - AP left',
        'X-Ray Elbow - AP Right',
        'X-Ray Elbow - AP/Lateral left',
        'X-Ray Elbow - AP/Lateral Right',
        'X-Ray Elbow - AP/Oblique Left',
        'X-Ray Elbow - AP/Oblique Right',
        'X-Ray Elbow - Lateral',
        'X-Ray Elbow - Lateral Left',
        'X-Ray Elbow - Lateral Right',
        'X-Ray Elbow - Lateral/Oblique Left',
        'X-Ray Elbow - Lateral/Oblique Right',
        'X-Ray Elbow - Oblique Left',
        'X-Ray Elbow - Oblique Right',
        'X-Ray Femur - Lateral Left',
        'X-Ray Femur - Lateral Right',
        'X-Ray Foot - AP',
        'X-Ray Foot - AP Left',
        'X-Ray Foot - AP Right',
        'X-Ray Foot - AP/Lateral Left',
        'X-Ray Foot - AP/Lateral Right',
        'X-Ray Foot - AP/Oblique Left',
        'X-Ray Foot - AP/Oblique Right',
        'X-Ray Foot - Lateral',
        'X-Ray Foot - Lateral Left',
        'X-Ray Foot - Lateral Right',
        'X-Ray Foot - Lateral/Oblique Left',
        'X-Ray Foot - Lateral/Oblique Right',
        'X-Ray Foot - Oblique',
        'X-Ray Foot - Oblique Left',
        'X-Ray Foot - Oblique Right',
        'X-Ray Forearm - AP',
        'X-Ray Forearm - AP Right',
        'X-Ray Forearm - AP/ Oblique Left',
        'X-Ray Forearm - AP/ Oblique Right',
        'X-Ray Forearm - AP/Lateral Left',
        'X-Ray Forearm - AP/Lateral Right',
        'X-Ray Forearm - Lateral Left',
        'X-Ray Forearm - Lateral Right',
        'X-Ray Forearm - Lateral/Oblique Left',
        'X-Ray Forearm - Lateral/Oblique Right',
        'X-Ray Forearm - Oblique',
        'X-Ray Forearm - Oblique Left',
        'X-Ray Forearm - Oblique Right',
        'X-Ray Hand - AP',
        'X-Ray Hand - AP left',
        'X-Ray Hand - AP Right',
        'X-Ray Hand - AP/Lateral left',
        'X-Ray Hand - AP/Lateral Right',
        'X-Ray Hand - AP/Oblique Left',
        'X-Ray Hand - AP/Oblique Right',
        'X-Ray Hand - Lateral',
        'X-Ray Hand - Lateral Left',
        'X-Ray Hand - Lateral Right',
        'X-Ray Hand - Lateral/Oblique Left',
        'X-Ray Hand - Lateral/Oblique Right',
        'X-Ray Hand - Oblique',
        'X-Ray Knee - AP',
        'X-Ray Knee - AP left',
        'X-Ray Knee - AP Right',
        'X-Ray Knee - AP/Lateral left',
        'X-Ray Knee - AP/Lateral Right',
        'X-Ray Knee - AP/Oblique Left',
        'X-Ray Knee - AP/Oblique Right',
        'X-Ray Knee - Lateral',
        'X-Ray Knee - Lateral Left',
        'X-Ray Knee - Lateral Right',
        'X-Ray Knee - Lateral/Oblique Left',
        'X-Ray Knee - Lateral/Oblique Right',
        'X-Ray Knee - Oblique Left',
        'X-Ray Knee - Oblique Right',
        'Bilateral Mammography',
        'Mammography',
        'Hysterosalpingography (HSG)',
        '3D Mammography',
        '3-D conformal radiation',
        '3D mammogram',
        'MRI - Abdomen',
        'MRI - Angiography',
        'MRI - Ankle Left',
        'MRI - Ankle Right',
        'MRI - Base of Skull to Inlet of Thorax',
        'MRI - Brain',
        'MRI - Brain + Angio',
        'MRI - Brain + Orbit',
        'MRI - Brain + Veno',
        'MRI - Breast Left',
        'MRI - Breast Right',
        'MRI - Cardiac',
        'MRI - Cervical Spine',
        'MRI - Cisternography',
        'MRI - CSF flow Study',
        'MRI - CV Junction',
        'MRI - DL Spine',
        'MRI - Dorsal Spine',
        'MRI - Fistulogram',
        'MRI - Functional',
        'MRI - Hip Joint',
        'MRI - Knee Left',
        'MRI - Knee Right',
        'MRI - Limb Left',
        'MRI - Limb Right',
        'MRI - Lumbar Spine',
        'MRI - Lumbosacral Spine',
        'MRI - Neck Left',
        'MRI - Neck Right',
        'MRI - Orbit',
        'MRI - PBH',
        'MRI - Pelvis',
        'MRI - PNS',
        'MRI - Prostate',
        'MRI - Shoulder Joint',
        'MRI - Shoulder Left',
        'MRI - Shoulder Right',
        'MRI - SI Joint Left',
        'MRI - SI joint Right',
        'MRI - Spectroscopy',
        'MRI - Spine',
        'MRI - Thorax Left',
        'MRI - Thorax Right',
        'MRI - TM joint Left',
        'MRI - TM joint Right',
        'MRI - Tractography',
        'MRI - Urography/Myelography',
        'MRI - Wrist Left',
        'MRI - Wrist Right',
        'MRI Scan of Brain and Pituitary',
        'MRI- Lumbosacral Spine',
        'MRI- Perfusion study',
        'CT - Abdomen',
        'CT - Abdomen and Pelvis',
        'CT - Bone Densitometry',
        'CT - Cardiac',
        'CT - Chest',
        'CT - Cisternography',
        'CT - Coronary Angiography',
        'CT - Coronary Calcium Study',
        'CT - CV junction',
        'CT - DL Spine Plain',
        'CT - DL Spine Plain + Contrast',
        'CT - Elbow Left',
        'CT - Head/Brain Plain',
        'CT - Head/Brain Plain + Contrast',
        'CT - HRCT Chest',
        'CT - HRCT Lung',
        'CT - HRCT PNS',
        'CT - HRCT Temporal bone',
        'CT - HRCT Thorax',
        'CT - KUB plain',
        'CT - KUB plain + Contrast',
        'CT - Left Limb',
        'CT - Lung',
        'CT - Neck',
        'CT - Orbit',
        'CT - Parotid Swelling',
        'CT - Pelvis',
        'CT - Perfusion Study',
        'CT - PNS',
        'CT - Right Limb',
        'CT - Shoulder Left',
        'CT - Shoulder Right',
        'CT - Skull',
        'CT - Spine Contrast + Plain',
        'CT - Spine Left',
        'CT - Spine Plain',
        'CT - Spine Right',
        'CT - Thorax',
        'CT - TMJ',
        'CT - Virtual Bronchoscopy',
        'CT - Virtual Colonoscopy',
        'CT - Whole Body',
        'CT coronary Angiogram',
        'USG Abdomen',
        'USG Abdomen and Pelvis',
        'USG Ankle Joint Left',
        'USG Ankle Joint Right',
        'USG Congenital Anomaly Scan',
        'USG Fistulography',
        'USG Knee Joint Left',
        'USG Knee Joint Right',
        'USG KUB with Post Void Residual Urine',
        'USG Left Hip',
        'USG Left Shoulder',
        'USG Local',
        'USG Neck',
        'USG Obstetric',
        'USG Orbit Left',
        'USG Orbit Right',
        'USG Parotid',
        'USG Pelvis',
        'USG Prostate',
        'USG Right Shoulder',
        'USG Scrotum',
        'USG Skull',
        'USG Testes (Male)',
        'USG Thyroid',
        'USG Trans Rectal Sonography',
        'USG Trans Vaginal Sonography',
        'Carotid ultrasound',
        'Fetal ultrasound',
        'Color Doppler Scrotum (Male)',
        'Lower Limb Arterial Doppler Left',
        'Lower Limb Arterial Doppler Right',
        'Lower Limb Venous Doppler Right',
        'Lower Limb Venous Doppler Left',
        'Carotid Doppler',
      ],
      pathology: [
        'CA - 125',
        'HbeAg',
        'T4',
        'T3',
        'Rubella - IgG',
        'Protein total',
        'Hb',
        'Iron',
        'Vitamin B12',
        'AMH',
        'Cytomegalo virus IgM',
        'Phosphorous',
        'Lipoprotein (A)',
        'Estradiol / Oestrogen',
        'Rubella - IgM',
        'NEOT',
        'SGPT',
        'PPBS',
        'S. Creat',
        'Rheumatoid Factor (RF)',
        'Herpes Simplex Virus - IgM',
        'CEA',
        'Apolipoprotein B',
        'Folic Acid',
        'TOXO GOND II - IgG',
        'Apolipoprotein A1',
        'Blood Urea Nitrogen',
        'Chloride',
        'Testosterone',
        'Anti dsDNA',
        'TSH',
        'ACL - IgM',
        'Total Cholesterol',
        'Anti HAV - IgM',
        'Prolactin',
        'ANA',
        'FSH',
        'Uric acid',
        'PSA',
        'Blood Element Analysis Profile',
        'Beta - Thalassemia Screening',
        'Calcium',
        'Insulin',
        'Free Thyroxine (FT4)',
        'Progesterone',
        'Ferritin',
        'Homocysteine',
        'Sodium',
        'IgE',
        'Toxo Gond II / IgM',
        'Free Triiodothyronine (T3)',
        'ACL - IgG',
        'AFP',
        'Beta HCG',
        'PTH',
        'Vitamin D (Total)',
        'LH',
        'TIBC',
        'Amylase',
        'CD3/CD4/CD8',
        'Lipase',
        'HS - CRP',
        'Anti phospholipid antibody (APL) - IgM',
        'Anti HSV',
        'Bilirubin Total',
        'FBS',
        'HLA - B27',
        'SGOT',
        'HbA1c',
        'Alkaline Phosphatase',
        'ASO',
        'Hemogram - 6 Part (Diff)',
        'Respiratory Rate',
        '% Transferrin Saturation',
        '17 OH Progesterone',
        'Activated Protein-C',
        'Adenosine Deaminase',
        'Androstenedione (A4)',
        'Anti Beta 2 Glycoprotein',
        'Anti Cardiolipin Antibodies',
        'Anti glomerular basement membrane protein - IgG',
        'Anti HCV',
        'Anti Hepatitis A virus (HAV) - Total',
        'Anti Hepatitis B Core Antigen (AHBc) - IgM',
        'Anti Hepatitis B Core Antigen (AHBc) - total',
        'Anti Hepatitis B Envelope Antigen (AHBe)- Total',
        'Anti Hepatitis B Surface Antigen (AHBS) - Total',
        'Anti HEV - IgM',
        'Anti SCL - 70 Antibody',
        'Anti sperm Antibody (ASAB)',
        'Anti Thrombin III',
        'Antichlamydia antibody (IGG)',
        'Antichlamydia antibody (IGM)',
        'Antithyroglobulin Antibody (ATG)',
        'APO B / APO A1 ratio',
        'Arsenic',
        'B2 Microglonulin',
        'Barium',
        'Basophils',
        'Basophils Absolute count',
        'Beta 2 Glycoprotein 1 - IgG',
        'Beta 2 Glycoprotein 1 - IgM',
        'Bilateral Mammography',
        'Bilirubin Direct',
        'Bilirubin Indirect',
        'Blood Group',
        'Blood Group (FEMALE)',
        'Blood Group(Husband)',
        'Blood Urea Nitrogen / Serum Creatinine Ratio',
        'BOH Profile',
        'BUN',
        'BUN (Male)',
        'C3',
        'CA 15.3',
        'CA 19.9',
        'Cadmium',
        'Caesium',
        'Carbamazepine/Tegretol',
        'Cardiolipin Antibody (ACL) IgA',
        'Cobalt',
        'CBC',
        'Chromium',
        'CMV - IgG',
        'Cortisol',
        'cystatin C',
        'D-Dimer',
        'Dengue - IgG',
        'Dengue - IgM',
        'Dengue NS1 Antigen',
        'DHEA SULPHATE',
        'DLC',
        'DNA FRAGMENTATION (Male)',
        'Dual Markers',
        'Eosinophils',
        'Eosinophils Absolute count',
        'ESR',
        'Estradiol (Male)',
      ],
      surgeryProcedure: [
        'Upper GI Endoscopy',
        'Anoscopy',
        'Colonoscopy',
        'Sigmoidoscopy',
        'Thoracoscopy',
        'Capsule endoscopy',
        'Endoscopy small bowel',
        'Endoscopy upper',
        'Small bowel endoscopy',
        'Upper endoscopy',
        'Cystoscopy',
        'Esophagogastroduodenoscopy',
        'Flexible sigmoidoscopy',
        'Capsule enteroscopy',
        'Colposcopy',
        'Virtual colonoscopy',
        'Bronchoscopy',
        'Cystopanendoscopy',
        'Esophagoscopy',
        'Endocervical Test',
        'Ecc Endocervical Curettage Test',
        'Otoendoscopy',
        'Throat Endoscopy',
        'Fiberoptic Endoscopic Evaluation Of Swallowing',
        'Pre-Operated Surgical Package',
        'FCG with reporting',
        'Free Androgen Index',
        'Free PSA',
        'Free Testosterone',
        'FRUCTOSE (Male)',
        'FSH (Male)',
        'FT/ LCS',
        'FTND',
        'G5 PD',
        'Gamma Glutamyl Transferase (GGT)',
        'GBP',
        'GIT',
        'Glucose-6-Phosphate Dehydrogenase',
        'Hb Electrophorasis',
        'Hb(Male)',
        'Hbasg (Male)',
        'HbsAg',
        'HCV',
        'HCV (Male)',
        'HDL Cholesterol Direct',
        'Helicobacter Pylori - IgA',
        'Helicobacter Pylori - IgG',
        'Hematocrit (PCV)',
        'Hemoglobin A2',
        'Hemoglobin C',
        'Hemoglobin D',
        'Hemoglobin F',
        'Hemoglobin S',
        'Herpes Simplex Virus I (HSV) - IgG',
        'Herpes Simplex Virus I (HSV) - IgM',
        'Herpes Simplex Virus II (HSV) IgG',
        'Herpes Simplex Virus II (HSV) IgM',
        'HIV I & II',
        'Hiv I & II (Male)',
        'HSG (Hysterosalpingography)',
        'HSV - IgG',
        'Human Growth Hormone (HGH)',
        'Immature Granulocytes (IG)',
        'Immunoglobulin A (IgA)',
        'Immunoglobulin G (IgG)',
        'Immunoglobulin M (IgM)',
        'Inhibin A',
        'INR',
        'Intravenous Urography',
        'Lactate Dehydrogenase',
        'LDH',
        'LD / HDL Ratio',
        'LDL cholesterol Direct',
        'Lead',
        'Leptospira - IgM',
        'LFT',
        'LH (Male)',
        'Lipid Profile',
        'Liver Kidney Microsomes',
        'Liver Profile Vit',
        'Lp-PLA2',
        'Lymphocytes Percentage',
        'Magnesium',
        'Malarial Antigen',
        'Mammography',
        'Mantoux Test',
        'Mean Corpuscular Hemoglobin (MCH)',
        'Mean Corpuscular Hemoglobin concentration (MCHC)',
        'Mean Corpuscular Volume (MCV)',
        'Mean Platelet Volume (MPV)',
        'Mercury',
        'Monocytes',
        'Monocytes Absolute count',
        'MP',
        'MP antigen',
        'MPO - ANCA (p - ANCA)',
        'Neutrophils',
        'Neutrophils Absolute count',
        'Non HDL Cholesterol',
        'Nucleated RBC',
        'Phenytoin/Dilantin/Eptoin',
        'Platelet (Male)',
        'Platelet Count',
        'Platelet Distribution Width (PDW)',
        'Platelet to Large Cell Ratio (PLCR)',
        'Plateletcrit (PCT)',
        'Potassium',
        'PR 3 - ANCA (c-ANCA)',
        'Pregnancy associated Plasma protein A',
        'PROGRESSIVE MOTILITY (Male)',
        'Prolactin (Male)',
        'Protein-C',
        'Protein-S',
        'Prosthesis',
        'PTT',
        'Pulmonary Function Test',
        'Random Blood Sugar (RBS)',
        'Red Cell Distribution Width - SD (RD W - SD)',
        'S. Calcium',
        'S. Copper',
        'S. Vit B12',
        'S. Vit D',
        'S. Zinc',
        'Selenium',
        'Serum Albumin',
        'Serum Albumin / Globulin Ratio',
        'Serum Globulin',
        'Sex Hormone Binding Globulin (SHBG)',
        'SGOT (Male)',
        'SGPT (Male)',
        'Sickling Test',
        'SLR',
        'SPERM CONC (Male)',
        'SPO2',
        'Sputum AFP',
        'Sputum test',
        'SRL Lt',
        'SRL Rt',
        'TB Gold',
        'TC / HDL Cholesterol Ratio',
        'Testosterone (Male)',
        'Testosterone/Estradiol Ratio (Male)',
        'Thyroglobulin (TG)',
        'TIBC',
        'Total Erythrocytes (RBC)',
        'Total Leucocytes Count (WBC)',
        'Total Lymphocytes',
        'TOTAL MOTILITY (Male)',
        'TPO',
        'Treponema Pallidum Antibody (TPAB)',
        'Treponema Pallidum Haemagglutination',
        'Triglycerides',
        'Tromeophila Profile',
        'TRUS (Male)',
        'TSH (Male)',
        'TSP',
        'Typhoid Culture Test',
        'unconjugated Estriol (E3)',
        'Valgus-Patellar Tracking',
        'Valproic acid',
        'Varus/Valgus',
      ]
    }

    const radiologyCount = catalogData.radiology.length
    const pathologyCount = catalogData.pathology.length
    const surgeryCount = catalogData.surgeryProcedure.length
    const totalCount = radiologyCount + pathologyCount + surgeryCount

    console.log(`📊 Total items to seed: ${totalCount}`)
    console.log(`   - Radiology: ${radiologyCount}`)
    console.log(`   - Pathology: ${pathologyCount}`)
    console.log(`   - Surgery/Procedure: ${surgeryCount}`)
    console.log('='.repeat(70))

    const orgId = 'org-demo'
    let successCount = 0
    let errorCount = 0

    function categorizeRadiology(examName) {
      const name = examName.toLowerCase()
      if (name.includes('x-ray') || name.includes('x ray')) {
        return { examCategory: 'x-ray', modality: 'CR' }
      } else if (name.includes('mri')) {
        return { examCategory: 'mri', modality: 'MRI' }
      } else if (name.includes('ct')) {
        return { examCategory: 'ct', modality: 'CT' }
      } else if (name.includes('usg') || name.includes('ultrasound') || name.includes('doppler')) {
        return { examCategory: 'ultrasound', modality: 'US' }
      } else if (name.includes('mammography')) {
        return { examCategory: 'mammography', modality: 'MG' }
      }
      return { examCategory: 'radiography', modality: 'CR' }
    }

    // Seed Radiology exams
    for (let i = 0; i < catalogData.radiology.length; i++) {
      const examName = catalogData.radiology[i].trim()
      if (!examName) continue

      try {
        const { examCategory, modality } = categorizeRadiology(examName)
        const examId = `radio-${examName.toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '')}`

        await db.radiologyExam.create({
          data: {
            id: examId,
            organizationId: orgId,
            examName,
            examCategory,
            modality,
            bodyPart: 'general',
            price: 1000,
            isActive: true,
          },
        })

        successCount++
        if ((i + 1) % 50 === 0) {
          console.log(`⏳ Radiology: ${i + 1}/${radiologyCount} processed...`)
        }
      } catch (err) {
        errorCount++
      }
    }

    // Seed Pathology tests
    for (let i = 0; i < catalogData.pathology.length; i++) {
      const testName = catalogData.pathology[i].trim()
      if (!testName) continue

      try {
        const testId = `lab-${testName.toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '')}`

        await db.labTest.create({
          data: {
            id: testId,
            organizationId: orgId,
            testName,
            testCategory: 'pathology',
            specimenType: 'blood',
            price: 500,
            isActive: true,
          },
        })

        successCount++
        if ((i + 1) % 50 === 0) {
          console.log(`⏳ Pathology: ${i + 1}/${pathologyCount} processed...`)
        }
      } catch (err) {
        errorCount++
      }
    }

    // Seed Surgery/Procedure items
    for (let i = 0; i < catalogData.surgeryProcedure.length; i++) {
      const procedureName = catalogData.surgeryProcedure[i].trim()
      if (!procedureName) continue

      try {
        const procId = `proc-${procedureName.toLowerCase().replace(/\s+/g, '-').replace(/[()]/g, '')}`

        await db.radiologyExam.create({
          data: {
            id: procId,
            organizationId: orgId,
            examName: procedureName,
            examCategory: 'procedure',
            modality: 'PROC',
            bodyPart: 'general',
            price: 2000,
            isActive: true,
          },
        })

        successCount++
        if ((i + 1) % 50 === 0) {
          console.log(`⏳ Surgery/Procedure: ${i + 1}/${surgeryCount} processed...`)
        }
      } catch (err) {
        errorCount++
      }
    }

    console.log('\n' + '='.repeat(70))
    console.log('✅ SEEDING COMPLETE')
    console.log('='.repeat(70))
    console.log(`✅ Successfully seeded: ${successCount} items`)
    console.log(`❌ Failed: ${errorCount} items`)
    console.log(`📊 TOTAL ITEMS SEEDED: ${successCount} / ${totalCount}`)
    console.log('='.repeat(70) + '\n')

    if (successCount === totalCount) {
      console.log(`🎉 SUCCESS! Exactly ${totalCount} items have been seeded!\n`)
    }

    process.exit(successCount === totalCount ? 0 : 1)
  } catch (err) {
    console.error('❌ Critical error:', err.message)
    process.exit(1)
  }
}

cleanupAndSeed()
