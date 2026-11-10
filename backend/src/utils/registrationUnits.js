const db = require('../config/db');

/**
 * Active units of a registration with each unit's own place hierarchy, in selection order.
 * Units can come from different circles, zones or districts, so the registration's own
 * district/zone/circle columns (taken from the first unit) don't describe every unit.
 */
async function getRegistrationUnits(registrationId, connection = db) {
  const [rows] = await connection.query(
    `SELECT un.id, un.name AS unit_name, c.name AS circle_name, z.name AS zone_name, d.name AS district_name
     FROM unit_assignments ua
     JOIN units un ON un.id = ua.unit_id
     JOIN circles c ON un.circle_id = c.id
     JOIN zones z ON c.zone_id = z.id
     JOIN districts d ON z.district_id = d.id
     WHERE ua.registration_id = ? AND ua.status = 'active'
     ORDER BY ua.id`,
    [registrationId]
  );
  return rows;
}

/**
 * Batch version for lists: attaches `units` (same shape as above) to each registration row
 * using one query. Rows without active assignments get an empty array.
 */
async function attachRegistrationUnits(registrations, connection = db) {
  const ids = registrations.map((r) => r.id);
  const byRegistration = new Map(ids.map((id) => [id, []]));

  if (ids.length > 0) {
    const [rows] = await connection.query(
      `SELECT ua.registration_id, un.id, un.name AS unit_name, c.name AS circle_name, z.name AS zone_name, d.name AS district_name
       FROM unit_assignments ua
       JOIN units un ON un.id = ua.unit_id
       JOIN circles c ON un.circle_id = c.id
       JOIN zones z ON c.zone_id = z.id
       JOIN districts d ON z.district_id = d.id
       WHERE ua.registration_id IN (?) AND ua.status = 'active'
       ORDER BY ua.id`,
      [ids]
    );
    for (const { registration_id, ...unit } of rows) {
      byRegistration.get(registration_id).push(unit);
    }
  }

  for (const reg of registrations) {
    reg.units = byRegistration.get(reg.id) || [];
  }
  return registrations;
}

module.exports = { getRegistrationUnits, attachRegistrationUnits };
