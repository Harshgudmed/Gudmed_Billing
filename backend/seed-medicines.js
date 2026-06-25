import { db } from './src/config/db.js'

const medicinesData = [
  { name: 'Tacrolimus', strength: '10', unit: 'mg', category: 'Immunosuppressant', type: 'Capsule', mrp: 405.7 },
  { name: 'Valganciclovir', strength: '2', unit: 'mg', category: 'Anti-Viral', type: 'Tablet', mrp: 844 },
  { name: 'Methylcobalamin + Folic Acid', strength: '10', unit: 'mg', category: 'Dietary Supplement', type: 'Tablet', mrp: 89 },
  { name: 'Etoricoxib', strength: '10', unit: 'mg', category: 'Pain Killer', type: 'Tablet', mrp: 98 },
  { name: 'Domperidone + Rabeprazole', strength: '10', unit: 'mg', category: 'Antacids', type: 'Capsule', mrp: 97 },
  { name: 'Etoricoxib', strength: '10', unit: 'mg', category: 'Pain Relief', type: 'Tablet', mrp: 99 },
  { name: 'Mometasone', strength: '1', unit: 'w/w', category: 'Eczema', type: 'Ointment', mrp: 0 },
  { name: 'Trigaine', strength: '200', unit: 'ml', category: 'Hair Loss', type: 'Shampoo', mrp: 540 },
  { name: 'Tofacitinib', strength: '60', unit: 'mg', category: 'Immunosuppressant', type: 'Tablet', mrp: 2100 },
  { name: 'Cyclosporine', strength: '10', unit: 'mg', category: 'Immunosuppressive', type: 'Tablet', mrp: 0 },
  { name: 'Esomeprazole', strength: '10', unit: 'mg', category: 'Antacids', type: 'Tablet', mrp: 79.55 },
  { name: 'Torasemide', strength: '10', unit: 'mg', category: 'Cardiovascular Disease', type: 'Tablet', mrp: 59 },
  { name: 'Spironolactone + Torasemide', strength: '10', unit: 'mg', category: 'Cardiovascular Disease', type: 'Tablet', mrp: 59 },
  { name: 'Tacrolimus', strength: '10', unit: 'mg', category: 'Prevention Of Organ Rejection In Transplant Patients', type: 'Capsule', mrp: 842.46 },
  { name: 'Tacrolimus', strength: '10', unit: 'mg', category: 'Prevention Of Organ Rejection In Transplant Patients', type: 'Capsule', mrp: 0 },
  { name: 'Tacrolimus', strength: '10', unit: 'mg', category: 'Prevention of organ rejection in transplant patients', type: 'Capsule', mrp: 775 },
  { name: 'Acyclovir', strength: '10', unit: 'mg', category: 'Anti-Viral', type: 'Tablet', mrp: 0 },
  { name: 'Mycophenolate Sodium', strength: '10', unit: 'mg', category: 'Immunosuppressant', type: 'Tablet', mrp: 0 },
  { name: 'Darbepoetin Alfa', strength: '1', unit: 'mcg', category: 'Treatment Of Anemia Due To Chronic Kidney Disease', type: 'Injection', mrp: 2506 },
  { name: 'Mycophenolate Sodium', strength: '10', unit: 'mg', category: 'Immunosuppressant', type: 'Tablet', mrp: 0 },
  { name: 'Sodium Bicarbonate', strength: '10', unit: 'mg', category: 'Antacids', type: 'Tablet', mrp: 39.2 },
  { name: 'Calcium Acetate', strength: '10', unit: 'mg', category: 'Dietary Supplement', type: 'Tablet', mrp: 35 },
  { name: 'Sodium Bicarbonate', strength: '10', unit: 'mg', category: 'Antacids', type: 'Tablet', mrp: 45 },
  { name: 'Aloe Vera + Vitamin E + Squalene', strength: '1', unit: 'Gram', category: 'Moisturizer', type: 'Cream', mrp: 438.5 },
  { name: 'Protein Powder', strength: '1', unit: 'gm', category: 'Dietary Supplement', type: 'Powder', mrp: 3575 },
  { name: 'Darbepoetin Alfa', strength: '1', unit: 'mcg', category: 'Anemia', type: 'Injection', mrp: 2240 },
  { name: 'Sodium Valproate + Valproic Acid', strength: '10', unit: 'mg', category: 'Anti Epileptic', type: 'Tablet', mrp: 0 },
  { name: 'Recombinant Human Erythropoietin', strength: '1', unit: 'iu', category: 'Treatment Of Anemia Due To Chronic Kidney Disease', type: 'Injection', mrp: 2500 },
  { name: 'Sofosbuvir + Velpatasvir', strength: '1', unit: 'mg', category: 'Chronic Hepatitis C Virus (Hcv) Infection', type: 'Tablet', mrp: 17500 },
  { name: 'Dexlansoprazole + Domperidone', strength: '10', unit: 'mg', category: 'Antacids', type: 'Capsule', mrp: 199 },
  { name: 'Levofloxacin', strength: '10', unit: 'MG', category: 'Antibiotics', type: 'Tablet', mrp: 500 },
  { name: 'Ertapenem', strength: '1', unit: 'mg', category: 'Antibiotics', type: 'Injection', mrp: 2400 },
  { name: 'Human Albumin', strength: '1', unit: 'ml', category: 'fluid replacement therapy', type: 'Injection', mrp: 5240 },
  { name: 'Tulsi + Kali Mirch + Kantkari', strength: '1', unit: 'ml', category: 'Cough', type: 'Syrup', mrp: 160 },
  { name: 'Methylprednisolone', strength: '10', unit: 'mg', category: 'Corticosteroid', type: 'Tablet', mrp: 70 },
  { name: 'Acebrophylline', strength: '10', unit: 'mg', category: 'Asthma', type: 'Capsule', mrp: 80 },
  { name: 'Pilocarpine', strength: '10', unit: 'mg', category: 'miotics', type: 'Tablet', mrp: 349.99 },
  { name: 'Fusidic Acid', strength: '5', unit: 'gm', category: 'Skin Infections', type: 'Cream', mrp: 56.65 },
  { name: 'Dutasteride + Silodosin', strength: '10', unit: 'mg', category: 'Treatment Of Benign Prostatic Hyperplasia', type: 'Capsule', mrp: 0 },
  { name: 'Lidocaine + Clotrimazole + Beclomethasone', strength: '10', unit: 'w.v', category: 'Anti Bacterial', type: 'Ear Drop', mrp: 44 },
  { name: 'Eperisone + Aceclofenac', strength: '10', unit: 'mg', category: 'Pain Killer', type: 'Capsule', mrp: 249 },
  { name: 'Cyproheptadine', strength: '10', unit: 'mg', category: 'Appetite Stimulant', type: 'Tablet', mrp: 0 },
  { name: 'Methotrexate', strength: '10', unit: 'mg', category: 'Rheumatoid Arthritis', type: 'Tablet', mrp: 0 },
  { name: 'Vitamin D3 + Folic Acid + Alpha Lipoic Acid', strength: '10', unit: 'Mg/Mcg', category: 'Dietary Supplement', type: 'Tablet', mrp: 189 },
  { name: 'Kojic Acid + Niacinamide + Pine Extract', strength: '1', unit: 'Mg/Gm', category: 'Skin Care', type: 'Cream', mrp: 370 },
  { name: 'Clindamycin + Nicotinamide', strength: '1', unit: 'W/W', category: 'Skin Care', type: 'Gel', mrp: 177 },
  { name: 'Pilocarpine', strength: '10', unit: 'mg', category: 'Dry Mouth', type: 'Tablet', mrp: 78 },
  { name: 'Dextromethorphan', strength: '10', unit: 'mg', category: 'Cough', type: 'Lozenges', mrp: 108 },
  { name: 'Metformin + Vildagliptin', strength: '10', unit: 'mg', category: 'Anti-Diabetics', type: 'Tablet', mrp: 163.25 },
  { name: 'Lactulose', strength: '1', unit: 'gm', category: 'Constipation', type: 'Powder', mrp: 0 },
  { name: 'Sildenafil', strength: '4', unit: 'mg', category: 'Erectile Dysfunction', type: 'Tablet', mrp: 116 },
  { name: 'Lidocaine + Nifedipine', strength: '1', unit: 'W/W', category: 'anal fissures', type: 'Ointment', mrp: 166 },
  { name: 'Psyllium Husk', strength: '1', unit: 'gm', category: 'Laxative', type: 'Powder', mrp: 0 },
  { name: 'Diltiazem + Lidocaine', strength: '1', unit: 'W/W', category: 'Anal Fissures', type: 'Cream', mrp: 250 },
  { name: 'Ketorolac', strength: '10', unit: 'mg', category: 'Pain Killer', type: 'Tablet', mrp: 82 },
  { name: 'Atorvastatin Calcium', strength: '10', unit: 'mg', category: 'Cardiovascular Disease', type: 'Tablet', mrp: 48 },
  { name: 'Metformin', strength: '10', unit: 'mg', category: 'Anti-Diabetics', type: 'Tablet', mrp: 179 },
  { name: 'Nebivolol', strength: '10', unit: 'mg', category: 'Cardiovascular Disease', type: 'Tablet', mrp: 87 },
  { name: 'Dexamethasone', strength: '10', unit: 'mg', category: 'Steroids', type: 'Tablet', mrp: 4.2 },
  { name: 'Glimepiride + Metformin', strength: '10', unit: 'mg', category: 'Anti-Diabetics', type: 'Tablet', mrp: 133 },
  { name: 'Medroxyprogesterone Acetate', strength: '10', unit: 'mg', category: 'Irregular Period', type: 'Tablet', mrp: 60.3 },
  { name: 'Dapagliflozin + Metformin + Sitagliptin', strength: '10', unit: 'mg', category: 'Anti-Diabetics', type: 'Tablet', mrp: 315 },
  { name: 'Cholecalciferol', strength: '4', unit: 'iu', category: 'Vitamin D Deficiency', type: 'Tablet', mrp: 94 },
  { name: 'Dapagliflozin + Sitagliptin', strength: '10', unit: 'mg', category: 'Anti Diabetic', type: 'Tablet', mrp: 180 },
  { name: 'Insulin Lispro', strength: '1', unit: 'iu', category: 'Antidiabetic', type: 'Injection', mrp: 1688 },
  { name: 'Aspirin + Rosuvastatin + Clopidogrel', strength: '10', unit: 'mg', category: 'Cardiovascular Disease', type: 'Capsule', mrp: 319 },
  { name: 'Methylcobalamin + Calcitriol + Thiamine', strength: '10', unit: 'mg', category: 'Dietary Supplement', type: 'Capsule', mrp: 15 },
  { name: 'Aceclofenac + Paracetamol + Serratiopeptidase', strength: '10', unit: 'mg', category: 'Pain Killer', type: 'Tablet', mrp: 100 },
  { name: 'Pantoprazole', strength: '10', unit: 'mg', category: 'Antacids', type: 'Tablet', mrp: 59 },
  { name: 'Sacubitril + Valsartan', strength: '14', unit: 'mg', category: 'Cardiovascular Disease', type: 'Tablet', mrp: 250 },
  { name: 'Mycophenolate Sodium', strength: '10', unit: 'mg', category: 'Immunosuppressant', type: 'Tablet', mrp: 1020.8 },
  { name: 'Calcium', strength: '10', unit: 'mg', category: 'Calcium Deficiency', type: 'Tablet', mrp: 34 },
  { name: 'Mycophenolate Sodium', strength: '10', unit: 'mg', category: 'Immunosuppressants', type: 'Tablet', mrp: 583.96 },
  { name: 'Sodium Bicarbonate', strength: '15', unit: 'mg', category: 'Treatment Of Indigestion', type: 'Tablet', mrp: 82 },
  { name: 'Calcitriol', strength: '10', unit: 'mg', category: 'Vitamin D3', type: 'Tablet', mrp: 102.85 },
  { name: 'Fluconazole', strength: '3', unit: 'mg', category: 'Anti Fungal', type: 'Tablet', mrp: 0 },
  { name: 'Tacrolimus', strength: '10', unit: 'mg', category: 'Prevention Of Organ Rejection In Transplant Patients', type: 'Capsule', mrp: 206.41 },
  { name: 'Domperidone + Rabeprazole', strength: '10', unit: 'mg', category: 'Nausia Acidity', type: 'Capsule', mrp: 71 },
  { name: 'Telmisartan + Chlorthalidone', strength: '10', unit: 'mg', category: 'Cardiovascular Disease', type: 'Tablet', mrp: 201 },
  { name: 'Methylcobalamin + L-Methyl Folate', strength: '10', unit: 'mg', category: 'Dietary Supplement', type: 'Tablet', mrp: 0 },
  { name: 'Benidipine + Nebivolol', strength: '10', unit: 'mg', category: 'Cardiovascular Disease', type: 'Tablet', mrp: 168 },
  { name: 'Sevelamer', strength: '10', unit: 'mg', category: 'Phosphate Binders', type: 'Tablet', mrp: 165 },
  { name: 'Insulin Glargine', strength: '1', unit: 'Iu/Ml', category: 'Anti Diabetic', type: 'Injection', mrp: 782.13 },
  { name: 'Human Insulin', strength: '1', unit: 'iu', category: 'Anti Diabetic', type: 'Injection', mrp: 157 },
  { name: 'Recombinant Human Erythropoietin', strength: '1', unit: 'Iu', category: 'Treatment Of Anemia Due To Cancer Chemotherapy', type: 'Injection', mrp: 1991 },
  { name: 'Pitavastatin', strength: '10', unit: 'mg', category: 'Cardiovascular Disease', type: 'Tablet', mrp: 199 },
  { name: 'Ertapenem', strength: '1', unit: 'mg', category: 'Antibiotic', type: 'Injection', mrp: 2400 },
  { name: 'Terlipressin', strength: '10', unit: 'mg', category: 'Bleeding', type: 'Injection', mrp: 0 },
  { name: 'Etanercept', strength: '1', unit: 'Mg', category: 'Rheumatoid Arthritis', type: 'Injection', mrp: 3500 },
  { name: 'Pregabalin + Nortriptyline', strength: '10', unit: 'mg', category: 'Neuropathic Pain', type: 'Tablet', mrp: 140 },
  { name: 'Ivabradine', strength: '10', unit: 'mg', category: 'Cardiovascular Disease', type: 'Tablet', mrp: 135 },
  { name: 'Antioxidant + Multiminerals + Multivitamins', strength: '10', unit: 'mg', category: 'Dietary Supplement', type: 'Tablet', mrp: 0 },
  { name: 'Peppermint Oil', strength: '15', unit: 'mg', category: 'Treat Irritable Bowel Syndrome', type: 'Capsule', mrp: 135 },
  { name: 'Levocetrazine + Montelukast', strength: '10', unit: 'mg', category: 'Anti Allergics', type: 'Tablet', mrp: 0 },
  { name: 'Tolperisone + Diclofenac', strength: '10', unit: 'mg', category: 'Muscle Relaxant', type: 'Tablet', mrp: 0 },
  { name: 'Sitagliptin', strength: '10', unit: 'mg', category: 'Anti Diabetic', type: 'Tablet', mrp: 150 },
  { name: 'Levofloxacin', strength: '10', unit: 'mg', category: 'Antibiotic', type: 'Tablet', mrp: 87 }
]

async function seedMedicines() {
  try {
    console.log('💊 MEDICINES SEEDING STARTED')
    console.log(`📊 Total medicines to seed: ${medicinesData.length}\n`)

    const orgId = 'org-demo'
    let successCount = 0
    let errorCount = 0
    const errors = []

    for (let i = 0; i < medicinesData.length; i++) {
      const medicine = medicinesData[i]
      const medicineName = `${medicine.name} ${medicine.strength}${medicine.unit}`

      try {
        const medicineId = `pharm-${medicine.name.toLowerCase().replace(/\s+/g, '-').replace(/[+/()]/g, '').substring(0, 40)}-${medicine.strength}`.toLowerCase()

        await db.pharmacyDrug.upsert({
          where: { id: medicineId },
          update: {
            drugName: medicineName,
            genericName: medicine.name,
            strength: medicine.strength,
            unitOfMeasure: medicine.unit,
            drugCategory: medicine.category,
            dosageForm: medicine.type,
            sellingPrice: medicine.mrp || 0,
          },
          create: {
            id: medicineId,
            organizationId: orgId,
            drugName: medicineName,
            genericName: medicine.name,
            strength: medicine.strength,
            unitOfMeasure: medicine.unit,
            drugCategory: medicine.category,
            dosageForm: medicine.type,
            sellingPrice: medicine.mrp || 0,
            quantityInStock: 0,
            requiresPrescription: false,
          },
        })

        successCount++
        if ((i + 1) % 20 === 0) {
          console.log(`⏳ Progress: ${i + 1}/${medicinesData.length} medicines processed...`)
        }
      } catch (err) {
        errorCount++
        errors.push({ medicine: medicineName, error: err.message.substring(0, 100) })
        if (errors.length <= 5) {
          console.log(`⚠️  Error: ${medicineName} - ${err.message.substring(0, 80)}`)
        }
      }
    }

    console.log('\n' + '='.repeat(70))
    console.log('📊 MEDICINES SEEDING COMPLETE')
    console.log('='.repeat(70))
    console.log(`✅ Successfully seeded: ${successCount} medicines`)
    console.log(`❌ Failed: ${errorCount} medicines`)
    console.log(`\n🎉 Pharmacy catalog updated with medicine data!`)

    if (errors.length > 5) {
      console.log(`\n(Showing first 5 errors of ${errors.length} total errors)`)
    }

    process.exit(successCount > 0 ? 0 : 1)
  } catch (err) {
    console.error('❌ Critical error:', err.message)
    process.exit(1)
  }
}

seedMedicines()
