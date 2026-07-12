import { db } from '../config/db.js'
import { getOrgId } from "../lib/reqContext.js";
import { isOwned } from "../lib/tenant.js";
import { listResponse } from "../lib/pagination.js";

export async function getAll(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { search, place } = req.query
    const where = { organizationId: ORG_ID }
    if (place && place !== 'all') where.placeOfDeath = place
    if (search) {
      where.OR = [
        { certificateNumber: { contains: search, mode: 'insensitive' } },
        { patient: { firstName: { contains: search, mode: 'insensitive' } } },
        { patient: { lastName: { contains: search, mode: 'insensitive' } } },
        { patient: { mrn: { contains: search, mode: 'insensitive' } } },
      ]
    }
    const include = {
      patient: { select: { id: true, firstName: true, middleName: true, lastName: true, mrn: true } },
      certifiedBy: { select: { id: true, fullName: true } },
    }
    // Stat cards count across the WHOLE filtered set, not just this page.
    const body = await listResponse(db.deathCertificate, {
      where, include, orderBy: { dateOfDeath: 'desc' }, req,
      summary: async () => {
        const [total, issued, maternal] = await Promise.all([
          db.deathCertificate.count({ where }),
          db.deathCertificate.count({ where: { ...where, issuedAt: { not: null } } }),
          db.deathCertificate.count({ where: { ...where, isMaternalDeath: true } }),
        ])
        return { total, issued, pendingIssuance: total - issued, maternal }
      },
    })
    res.json(body)
  } catch (err) {
    next(err)
  }
}

export async function create(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const {
      patientId, dateOfDeath, timeOfDeath, placeOfDeath, locationDetails,
      ageAtDeathYears, ageAtDeathMonths, ageAtDeathDays, sex, maritalStatus, occupation, address,
      immediateCause, antecedentCauseB, antecedentCauseC, antecedentCauseD, otherConditions,
      mannerOfDeath, autopsyPerformed, autopsyFindings,
      isMaternalDeath, pregnancyRelated,
      certifiedById, certifierQualification, licenseNumber,
    } = req.body

    const count = await db.deathCertificate.count({ where: { organizationId: ORG_ID } })
    const certNumber = `DC-${String(count + 1).padStart(5, '0')}`

    // Defensive: only link a certifier if that user actually exists in this org.
    // Prevents FK constraint errors when the selected doctor isn't present
    // (e.g. data migrated without the user records). certifiedById is optional.
    let safeCertifiedById = null
    if (certifiedById) {
      const certifier = await db.user.findFirst({
        where: { id: certifiedById, organizationId: ORG_ID },
        select: { id: true },
      })
      safeCertifiedById = certifier ? certifiedById : null
    }

    const cert = await db.deathCertificate.create({
      data: {
        organizationId: ORG_ID,
        certificateNumber: certNumber,
        patientId,
        dateOfDeath: new Date(dateOfDeath),
        timeOfDeath: timeOfDeath || null,
        placeOfDeath,
        locationDetails: locationDetails || null,
        ageAtDeathYears: ageAtDeathYears ?? null,
        ageAtDeathMonths: ageAtDeathMonths ?? null,
        ageAtDeathDays: ageAtDeathDays ?? null,
        sex,
        maritalStatus: maritalStatus || null,
        occupation: occupation || null,
        address: address || null,
        immediateCause,
        antecedentCauseB: antecedentCauseB || null,
        antecedentCauseC: antecedentCauseC || null,
        antecedentCauseD: antecedentCauseD || null,
        otherConditions: otherConditions || null,
        mannerOfDeath,
        autopsyPerformed: autopsyPerformed || false,
        autopsyFindings: autopsyFindings || null,
        isMaternalDeath: isMaternalDeath || false,
        pregnancyRelated: pregnancyRelated || null,
        certifiedById: safeCertifiedById,
        certifierQualification: certifierQualification || null,
        licenseNumber: licenseNumber || null,
        certificationDate: new Date(),
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        certifiedBy: { select: { id: true, fullName: true } },
      },
    })
    res.json({ success: true, data: cert })
  } catch (err) {
    next(err)
  }
}

export async function update(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id, issuedTo, issuedToRelationship, ...rest } = req.body
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })
    // Tenant guard: only touch a certificate that belongs to this org.
    if (!(await isOwned('deathCertificate', id, ORG_ID))) return res.status(404).json({ success: false, error: 'Death certificate not found' })
    const data = {}
    if (issuedTo !== undefined) {
      data.issuedTo = issuedTo
      data.issuedToRelationship = issuedToRelationship || null
      data.issuedAt = new Date()
    }
    const allowed = ['dateOfDeath','timeOfDeath','placeOfDeath','locationDetails','immediateCause',
      'antecedentCauseB','antecedentCauseC','antecedentCauseD','otherConditions','mannerOfDeath',
      'autopsyPerformed','autopsyFindings','isMaternalDeath','pregnancyRelated','certifierQualification','licenseNumber']
    for (const k of allowed) {
      if (rest[k] !== undefined) data[k] = rest[k]
    }
    if (data.dateOfDeath) data.dateOfDeath = new Date(data.dateOfDeath)

    const cert = await db.deathCertificate.update({
      where: { id },
      data,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        certifiedBy: { select: { id: true, fullName: true } },
      },
    })
    res.json({ success: true, data: cert })
  } catch (err) {
    next(err)
  }
}

export async function remove(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { id } = req.query
    if (!id) return res.status(400).json({ success: false, error: 'id is required' })
    const { count } = await db.deathCertificate.deleteMany({ where: { id, organizationId: ORG_ID } })
    if (count === 0) return res.status(404).json({ success: false, error: 'Death certificate not found' })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}
