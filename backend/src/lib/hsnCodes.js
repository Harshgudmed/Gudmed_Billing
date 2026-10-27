// Common HSN / SAC suggestions for a hospital's purchasing.
//
// HSN = tax code for GOODS (4, 6 or 8 digits); SAC = for SERVICES (6 digits,
// starting 99). These are the everyday items a hospital buys, offered as
// type-ahead suggestions on the item's HSN field so staff need not remember a
// number. They are SUGGESTIONS only — the hospital can still type any HSN its
// goods actually carry, and every code here should be confirmed against the
// official HSN/SAC list before it is used for GST filing (rates and the exact
// 8-digit tariff line can differ by product and change between budgets).
//
// Shape: { code, description, keywords } — keywords is a lowercase string the
// search matches against (synonyms, Hindi words staff use, broader terms).

export const HSN_CODES = [
  // ── Surgical & consumables ──────────────────────────────────────────────
  { code: '90183100', description: 'Syringes, with or without needles', keywords: 'syringe syringes disposable injection ml' },
  { code: '90183200', description: 'Tubular metal needles and needles for sutures', keywords: 'needle needles hypodermic suture tubular' },
  { code: '90183900', description: 'Catheters, cannulae and the like', keywords: 'cannula catheter iv line urinary foley tube drain' },
  { code: '40151900', description: 'Surgical / examination gloves of rubber', keywords: 'gloves glove surgical examination latex nitrile hand disposable' },
  { code: '40159000', description: 'Other protective articles of vulcanised rubber', keywords: 'rubber apron sheet protective' },
  { code: '30051090', description: 'Adhesive dressings and plasters', keywords: 'dressing plaster adhesive bandaid band-aid wound tape micropore' },
  { code: '30059010', description: 'Absorbent cotton wool, gauze and bandages', keywords: 'gauze bandage cotton wool absorbent roll surgical dressing crepe' },
  { code: '30061010', description: 'Sterile surgical catgut and sutures', keywords: 'suture sutures catgut stitch surgical thread' },
  { code: '63079011', description: 'Face masks and surgical masks (textile)', keywords: 'mask masks face surgical n95 respirator triple layer' },

  // ── Pharmaceuticals ─────────────────────────────────────────────────────
  { code: '30049099', description: 'Medicaments (tablets, capsules, injections, IV fluids)', keywords: 'medicine medicament drug tablet capsule injection syrup iv fluid saline dextrose ringer infusion drip pharma' },
  { code: '30041000', description: 'Medicaments containing penicillins / antibiotics', keywords: 'antibiotic penicillin amoxicillin medicine antibiotics' },
  { code: '30022000', description: 'Vaccines for human medicine', keywords: 'vaccine vaccines immunisation immunization' },
  { code: '30021200', description: 'Antisera and other immunological products', keywords: 'antisera serum immunoglobulin immunological' },
  { code: '30067000', description: 'Lubricant / ultrasound gel preparations (medical)', keywords: 'gel ultrasound lubricant jelly ecg conductive' },

  // ── Medical devices & equipment ─────────────────────────────────────────
  { code: '90181100', description: 'Electro-cardiographs (ECG machines)', keywords: 'ecg electrocardiograph cardiac machine' },
  { code: '90181200', description: 'Ultrasonic scanning apparatus (ultrasound)', keywords: 'ultrasound sonography usg scanner doppler' },
  { code: '90181900', description: 'Electro-diagnostic apparatus (patient monitor, pulse oximeter)', keywords: 'monitor patient oximeter pulse spo2 eeg electro diagnostic defibrillator' },
  { code: '90189019', description: 'Sphygmomanometers / blood pressure monitors', keywords: 'bp blood pressure sphygmomanometer monitor' },
  { code: '90189099', description: 'Other medical/surgical instruments and appliances', keywords: 'instrument instruments surgical forceps scissors scalpel speculum nebulizer suction equipment' },
  { code: '90221400', description: 'X-ray apparatus for medical use', keywords: 'x-ray xray radiography imaging' },
  { code: '90221200', description: 'Computed tomography (CT scan) apparatus', keywords: 'ct scan computed tomography' },
  { code: '90251910', description: 'Digital clinical thermometer', keywords: 'thermometer temperature fever digital clinical' },
  { code: '87131090', description: 'Wheelchairs (not mechanically propelled)', keywords: 'wheelchair wheel chair patient mobility' },

  // ── Lab & diagnostic ────────────────────────────────────────────────────
  { code: '38220090', description: 'Diagnostic or laboratory reagents', keywords: 'reagent reagents diagnostic lab laboratory assay buffer' },
  { code: '30021500', description: 'Immunological products / diagnostic test kits', keywords: 'test kit rapid antigen elisa diagnostic immunological' },
  { code: '70172000', description: 'Laboratory glassware (graduated / measured)', keywords: 'glassware beaker flask pipette volumetric measuring lab' },
  { code: '70179090', description: 'Other laboratory / hygienic glassware', keywords: 'test tube slide petri lab glass' },
  { code: '90118000', description: 'Optical microscopes', keywords: 'microscope lab optical binocular' },
  { code: '84211910', description: 'Laboratory centrifuges', keywords: 'centrifuge lab spin' },

  // ── Furniture ───────────────────────────────────────────────────────────
  { code: '94029090', description: 'Hospital / medical furniture (OT table, hospital bed)', keywords: 'hospital bed ot operating examination couch stretcher trolley medical furniture' },
  { code: '94013000', description: 'Swivel / office chairs (adjustable height)', keywords: 'chair office swivel revolving visitor seat kursi' },
  { code: '94031090', description: 'Metal office furniture (tables, desks)', keywords: 'table desk steel metal office workstation furniture' },
  { code: '94036000', description: 'Wooden furniture (tables, cabinets)', keywords: 'table cabinet wooden cupboard desk furniture' },
  { code: '94032090', description: 'Metal cupboards / almirah / storage racks', keywords: 'almirah cupboard locker rack storage steel' },
  { code: '94042090', description: 'Mattresses', keywords: 'mattress gadda bed foam' },

  // ── IT & electronics ────────────────────────────────────────────────────
  { code: '84713010', description: 'Laptop / notebook computer', keywords: 'laptop notebook computer pc' },
  { code: '84714190', description: 'Desktop / personal computer', keywords: 'desktop computer pc cpu' },
  { code: '84716060', description: 'Computer input units (keyboard, mouse)', keywords: 'keyboard mouse input peripheral' },
  { code: '84717020', description: 'Computer storage units (hard disk, SSD, pen drive)', keywords: 'hard disk ssd storage pendrive pen drive usb' },
  { code: '84433290', description: 'Printers (connectable to a computer)', keywords: 'printer inkjet laser print' },
  { code: '84433100', description: 'Multifunction printers / photocopiers', keywords: 'printer copier scanner multifunction mfp photocopier xerox' },
  { code: '84439959', description: 'Toner / ink cartridges for printers', keywords: 'toner cartridge ink printer refill' },
  { code: '85285200', description: 'Monitors for use with a computer', keywords: 'monitor display screen led computer' },
  { code: '85286200', description: 'Projectors', keywords: 'projector beamer presentation' },
  { code: '85171300', description: 'Smartphones / mobile phones', keywords: 'phone mobile smartphone cell handset' },
  { code: '85171800', description: 'Other telephone sets (landline, intercom)', keywords: 'telephone landline intercom phone epabx' },
  { code: '85176290', description: 'Routers, switches and network equipment', keywords: 'router switch network wifi modem networking' },
  { code: '85044090', description: 'UPS and static converters', keywords: 'ups inverter power backup converter' },
  { code: '85258100', description: 'CCTV / television cameras', keywords: 'cctv camera surveillance security ip' },
  { code: '94054090', description: 'LED lights, lamps and fittings', keywords: 'light led lamp tube bulb fitting fixture' },

  // ── Stationery & printing ───────────────────────────────────────────────
  { code: '48025590', description: 'Uncoated printing / writing paper (A4)', keywords: 'paper a4 printing writing sheet ream copier' },
  { code: '48201090', description: 'Registers, account books and notebooks', keywords: 'register notebook book diary account exercise file stationery' },
  { code: '49019900', description: 'Printed books and manuals', keywords: 'book books printed manual' },
  { code: '96081019', description: 'Ball point pens', keywords: 'pen pens ballpoint ball point writing' },
  { code: '96091000', description: 'Pencils', keywords: 'pencil pencils lead writing' },
  { code: '96082000', description: 'Marker / felt-tip pens', keywords: 'marker whiteboard sketch pen highlighter' },
  { code: '48171000', description: 'Envelopes', keywords: 'envelope envelopes cover postal' },
  { code: '48239019', description: 'Other paper articles (files, folders)', keywords: 'file folder board paper' },

  // ── Cleaning & housekeeping ─────────────────────────────────────────────
  { code: '34022090', description: 'Washing / cleaning / detergent preparations', keywords: 'detergent washing powder cleaning surf cleaner floor liquid' },
  { code: '38089400', description: 'Disinfectants and hand sanitizers', keywords: 'disinfectant sanitizer hand rub hygiene phenyl floor cleaner' },
  { code: '34011190', description: 'Toilet soaps and hand wash', keywords: 'soap handwash bathing toilet bar' },
  { code: '39232990', description: 'Plastic bags / garbage bags / bin liners', keywords: 'garbage bag bin liner plastic biohazard waste polythene' },
  { code: '96031000', description: 'Brooms and mops', keywords: 'broom mop jhadu sweeping cleaning' },
  { code: '96032900', description: 'Brushes (toilet, scrub)', keywords: 'brush scrub toilet cleaning' },
  { code: '39241090', description: 'Plastic buckets, mugs and household articles', keywords: 'bucket mug plastic tub household balti' },
  { code: '48181000', description: 'Toilet tissue and paper rolls', keywords: 'tissue toilet paper roll napkin' },

  // ── Linen ───────────────────────────────────────────────────────────────
  { code: '63022190', description: 'Cotton bed linen (bedsheets, pillow covers)', keywords: 'bedsheet bed sheet chadar linen pillow cover cotton' },
  { code: '63026000', description: 'Towels (terry towelling)', keywords: 'towel towels napkin terry cotton' },
  { code: '63014000', description: 'Blankets (synthetic fibre)', keywords: 'blanket kambal fleece synthetic' },
  { code: '63039000', description: 'Curtains and drapes', keywords: 'curtain curtains drape blind window' },
  { code: '63079090', description: 'Other made-up textiles (surgical drapes, patient gowns)', keywords: 'drape gown patient surgical cloth made up' },

  // ── Services (SAC — 6-digit, starting 99) ───────────────────────────────
  { code: '998711', description: 'Maintenance and repair of machinery / equipment (AMC)', keywords: 'maintenance repair amc service equipment machinery servicing annual' },
  { code: '998714', description: 'Maintenance and repair of transport vehicles (ambulance)', keywords: 'ambulance vehicle repair maintenance servicing transport' },
  { code: '998313', description: 'Information technology (IT) consulting and support', keywords: 'it software consulting support development technology application' },
  { code: '998599', description: 'Other support services', keywords: 'support services other administrative' },
  { code: '998533', description: 'Cleaning and housekeeping services', keywords: 'housekeeping cleaning sanitation janitorial service' },
  { code: '998521', description: 'Security and investigation services', keywords: 'security guard investigation surveillance service' },
  { code: '998515', description: 'Manpower / staffing / labour supply services', keywords: 'manpower labour staffing contract worker supply recruitment' },
  { code: '999711', description: 'Laundry and dry-cleaning services', keywords: 'laundry dry cleaning washing linen service' },
  { code: '999439', description: 'Biomedical / hazardous waste disposal services', keywords: 'biomedical waste disposal treatment hazardous sewage' },
  { code: '998912', description: 'Printing and reproduction services', keywords: 'printing reproduction print press stationery service' },
  { code: '996511', description: 'Road transport of goods (logistics)', keywords: 'transport logistics freight goods courier delivery road' },
  { code: '998346', description: 'Technical testing and calibration services', keywords: 'testing calibration technical inspection lab service' },
  { code: '998422', description: 'Internet and telecom services', keywords: 'internet telecom broadband data connectivity service' },
]
