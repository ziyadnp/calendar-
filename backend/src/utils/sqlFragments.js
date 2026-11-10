/**
 * All active unit names of registration `r`, comma-separated in selection order.
 * A registration can hold several units (see max_units_per_student); `r.unit_id` is only the first.
 * Falls back to the primary unit's name (`u` joined on r.unit_id) once assignments are released,
 * so cancelled registrations still show where they were.
 */
const REGISTRATION_UNIT_NAMES = `COALESCE(
  (SELECT GROUP_CONCAT(un.name ORDER BY ua_n.id SEPARATOR ', ')
   FROM unit_assignments ua_n
   JOIN units un ON un.id = ua_n.unit_id
   WHERE ua_n.registration_id = r.id AND ua_n.status = 'active'),
  u.name)`;

module.exports = { REGISTRATION_UNIT_NAMES };
