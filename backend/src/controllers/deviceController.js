import crypto from 'node:crypto'
import { db } from '../config/db.js'
import { getOrgId } from '../lib/reqContext.js'
import { getDeviceStatus } from '../lib/deviceStatus.js'

// 6-char pairing code from an unambiguous alphabet (no O/0/I/1) — easy to read
// off a TV, ~1e9 combinations so collisions are effectively nil.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function makeCode() {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('')
}
// A code unique among THIS org's currently-unpaired devices.
async function uniquePairingCode(orgId) {
  for (let i = 0; i < 5; i++) {
    const code = makeCode()
    const clash = await db.displayDevice.findFirst({
      where: { organizationId: orgId, pairingCode: code, status: 'unpaired' },
      select: { id: true },
    })
    if (!clash) return code
  }
  return makeCode()
}

const clientIp = (req) => (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.socket?.remoteAddress || null

function publicDevice(d) {
  return {
    deviceId: d.deviceId,
    status: getDeviceStatus(d),          // unpaired | online | reconnecting | offline
    paired: d.status === 'paired',
    screenId: d.screenId,
    pairingCode: d.status === 'unpaired' ? d.pairingCode : null,
    friendlyName: d.friendlyName,
    appVersion: d.appVersion,
    lastSeenAt: d.lastSeenAt,
    lastBootAt: d.lastBootAt,
    lastIpAddress: d.lastIpAddress,
    screen: d.screen ? { id: d.screen.id, name: d.screen.name } : null,
  }
}

// POST /api/display/devices/register  — a display announces itself on boot.
// No deviceId (or an unknown one) → mint a new device + pairing code. A known
// deviceId → refresh its diagnostics and hand back its current pairing/screen.
export async function registerDevice(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { deviceId, appVersion, friendlyName } = req.body || {}
    const diag = {
      lastSeenAt: new Date(),
      lastBootAt: new Date(),
      appVersion: appVersion || null,
      lastIpAddress: clientIp(req),
      ...(friendlyName ? { friendlyName } : {}),
    }

    let device = deviceId
      ? await db.displayDevice.findFirst({ where: { deviceId, organizationId: ORG_ID }, include: { screen: { select: { id: true, name: true } } } })
      : null

    if (device) {
      device = await db.displayDevice.update({ where: { id: device.id }, data: diag, include: { screen: { select: { id: true, name: true } } } })
    } else {
      device = await db.displayDevice.create({
        data: {
          organizationId: ORG_ID,
          // Honor a device-supplied id (the Electron Display Manager owns a
          // stable id per monitor, stored in its own config file); otherwise mint one.
          deviceId: deviceId || crypto.randomUUID(),
          pairingCode: await uniquePairingCode(ORG_ID),
          status: 'unpaired',
          ...diag,
        },
        include: { screen: { select: { id: true, name: true } } },
      })
    }
    res.json({ success: true, data: publicDevice(device) })
  } catch (err) { next(err) }
}

// GET /api/display/devices/:deviceId/status  — a display polls "am I paired yet,
// and to which screen?". The poll doubles as a liveness ping (updates lastSeenAt).
export async function getDeviceStatusEndpoint(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const existing = await db.displayDevice.findFirst({ where: { deviceId: req.params.deviceId, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Device not found' })
    const device = await db.displayDevice.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
      include: { screen: { select: { id: true, name: true } } },
    })
    res.json({ success: true, data: publicDevice(device) })
  } catch (err) { next(err) }
}

// POST /api/display/devices/:deviceId/heartbeat  — periodic "I'm alive" + diagnostics.
export async function heartbeatDevice(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { appVersion } = req.body || {}
    const existing = await db.displayDevice.findFirst({ where: { deviceId: req.params.deviceId, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Device not found' })
    const device = await db.displayDevice.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date(), lastIpAddress: clientIp(req), ...(appVersion ? { appVersion } : {}) },
      select: { screenId: true, status: true },
    })
    // Echo back the device's CURRENT assignment. A board already showing a
    // screen has its screenId fixed in its URL, so without this it can never
    // learn that an admin re-assigned it (or unpaired it) — it just keeps
    // showing the old screen forever. The board compares this on every beat.
    res.json({ success: true, screenId: device.screenId, status: device.status })
  } catch (err) { next(err) }
}

// GET /api/display/devices  — admin: every display in this org with live health.
export async function listDevices(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const devices = await db.displayDevice.findMany({
      where: { organizationId: ORG_ID },
      include: { screen: { select: { id: true, name: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    })
    res.json({ success: true, data: devices.map(publicDevice) })
  } catch (err) { next(err) }
}

// POST /api/display/devices/:deviceId/assign  — admin links a device to a screen
// (or unlinks when screenId is null). Screen must belong to the same org.
export async function assignDevice(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { screenId, friendlyName } = req.body || {}
    const existing = await db.displayDevice.findFirst({ where: { deviceId: req.params.deviceId, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Device not found' })

    let data
    if (screenId) {
      const screen = await db.displayScreen.findFirst({ where: { id: screenId, organizationId: ORG_ID }, select: { id: true } })
      if (!screen) return res.status(404).json({ success: false, error: 'Screen not found' })
      data = { screenId, status: 'paired', pairingCode: null, ...(friendlyName !== undefined ? { friendlyName } : {}) }
    } else {
      // Unpair: send it back to the pairing screen with a fresh code.
      data = { screenId: null, status: 'unpaired', pairingCode: await uniquePairingCode(ORG_ID), ...(friendlyName !== undefined ? { friendlyName } : {}) }
    }
    const device = await db.displayDevice.update({ where: { id: existing.id }, data, include: { screen: { select: { id: true, name: true } } } })
    res.json({ success: true, data: publicDevice(device) })
  } catch (err) { next(err) }
}

// POST /api/display/devices/:deviceId/offline  — the Display Manager calls this
// the instant a monitor is unplugged, so the admin sees 🔴 immediately instead
// of waiting out the ~90s heartbeat timeout. Push lastSeenAt into the past so
// getDeviceStatus computes 'offline' now; a reconnect's next heartbeat revives it.
export async function markDeviceOffline(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const existing = await db.displayDevice.findFirst({ where: { deviceId: req.params.deviceId, organizationId: ORG_ID }, select: { id: true } })
    if (!existing) return res.status(404).json({ success: false, error: 'Device not found' })
    await db.displayDevice.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(Date.now() - 120_000) } })
    res.json({ success: true })
  } catch (err) { next(err) }
}

// DELETE /api/display/devices/:deviceId  — admin removes a stale/duplicate device
// from the list (org-scoped). If that display ever reconnects it just re-registers.
export async function removeDevice(req, res, next) {
  try {
    const ORG_ID = getOrgId(req)
    const { count } = await db.displayDevice.deleteMany({ where: { deviceId: req.params.deviceId, organizationId: ORG_ID } })
    if (count === 0) return res.status(404).json({ success: false, error: 'Device not found' })
    res.json({ success: true })
  } catch (err) { next(err) }
}
