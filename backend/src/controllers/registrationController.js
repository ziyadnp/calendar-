const db = require('../config/db');
const env = require('../config/env');
const { logAction } = require('../utils/auditLogger');
const { getSettings } = require('../utils/settings');
const { REGISTRATION_UNIT_NAMES } = require('../utils/sqlFragments');
const { getRegistrationUnits, attachRegistrationUnits } = require('../utils/registrationUnits');

/**
 * Generate a unique registration code (e.g. MKZ-2026-0042)
 */
async function generateRegistrationCode(connection) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total FROM registrations`
  );
  const nextNum = (rows[0].total + 1).toString().padStart(4, '0');
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  return `MKZ-2026-${nextNum}-${randomSuffix}`;
}

/**
 * Public: Submit Registration (Inside Kerala OR Outside Kerala)
 */
async function submitRegistration(req, res, next) {
  let connection;
  try {
    const {
      student_id,
      registration_type, // 'inside_kerala' or 'outside_kerala'
      // Inside Kerala (district/zone/circle are derived from the selected units)
      unit_id,
      unit_ids,
      // Outside Kerala
      state_name,
      outside_district,
      outside_zone,
      outside_circle,
      outside_unit,
      // Confirmation
      confirmed
    } = req.body;

    if (!student_id || !registration_type) {
      return res.status(400).json({
        success: false,
        message: 'Student ID and Registration Type are required.'
      });
    }

    if (!confirmed) {
      return res.status(400).json({
        success: false,
        message: 'Please confirm that all details are accurate before submitting.'
      });
    }

    const settings = await getSettings();
    if (!settings.registration_open) {
      return res.status(403).json({
        success: false,
        registrationClosed: true,
        message: settings.registration_closed_message
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. Validate student and lock row to prevent concurrent submissions for same student
    const [students] = await connection.query(
      `SELECT id, reg_no, admission_no, candidate_name, is_active FROM students WHERE id = ? FOR UPDATE`,
      [student_id]
    );

    if (students.length === 0 || !students[0].is_active) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Student record not found or inactive.'
      });
    }

    const student = students[0];

    // 2. Existing active registrations. Rules:
    //    - at most one Inside Kerala registration (holding several units); any number of
    //      Outside Kerala registrations (one unit each)
    //    - Kerala units + Outside Kerala registrations <= max_units_per_student
    //    - submitting Inside Kerala again adds units to the existing Kerala registration
    const [existingRegs] = await connection.query(
      `SELECT id, registration_code, registration_type, calendars_requested, additional_calendars, calendars_allotted
       FROM registrations
       WHERE student_id = ? AND status IN ('approved', 'pending')
       FOR UPDATE`,
      [student_id]
    );
    const insideReg = existingRegs.find((r) => r.registration_type === 'inside_kerala') || null;
    const outsideRegCount = existingRegs.filter((r) => r.registration_type === 'outside_kerala').length;
    const maxUnits = settings.max_units_per_student;

    let insideUnitCount = 0;
    if (insideReg) {
      const [[held]] = await connection.query(
        `SELECT COUNT(*) AS total FROM unit_assignments WHERE registration_id = ? AND status = 'active'`,
        [insideReg.id]
      );
      insideUnitCount = held.total;
    }
    // Total unit slots used by this student: Kerala units + one per Outside Kerala registration
    const heldUnitCount = insideUnitCount + outsideRegCount;

    if (heldUnitCount >= maxUnits) {
      await connection.rollback();
      connection.release();
      const codes = existingRegs.map((r) => r.registration_code).join(', ');
      return res.status(409).json({
        success: false,
        message: `Student ${student.candidate_name} has already used all ${maxUnits} unit slot${maxUnits === 1 ? '' : 's'} (registration ${codes}). No further registrations are allowed.`
      });
    }

    // Inside Kerala resubmission adds units to the existing Kerala registration
    const existingReg = registration_type === 'inside_kerala' ? insideReg : null;

    let registrationId = existingReg ? existingReg.id : null;
    let regCode = existingReg ? existingReg.registration_code : await generateRegistrationCode(connection);
    let placeDetails = {};

    // Validate student-selectable calendar quantity.
    // A student's first registration needs at least 100; later registrations (they already
    // hold calendars) may request any amount from 0. Adding units keeps the existing quantities.
    const minQuota = existingRegs.length > 0 ? 0 : 100;
    let requestedQuota = existingReg ? existingReg.calendars_requested : null;
    if (!existingReg) {
      const rawRequested = req.body.calendars_requested !== undefined
        ? req.body.calendars_requested
        : (req.body.calendar_quantity !== undefined ? req.body.calendar_quantity : (req.body.calendars_required !== undefined ? req.body.calendars_required : minQuota));
      requestedQuota = parseInt(rawRequested, 10);
      if (isNaN(requestedQuota) || requestedQuota < minQuota) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: minQuota > 0
            ? 'Minimum 100 calendars required (must be at least 100 Nos).'
            : 'Calendar quantity must be 0 or more.'
        });
      }
    }

    if (registration_type === 'inside_kerala') {
      // Units in selection order; the first one is the primary unit stored on the registration.
      // `unit_id` (single) is still accepted from older clients.
      const rawUnitIds = Array.isArray(unit_ids) ? unit_ids : (unit_id ? [unit_id] : []);
      const selectedUnitIds = [...new Set(rawUnitIds.map((id) => parseInt(id, 10)))];

      if (selectedUnitIds.length === 0 || selectedUnitIds.some((id) => !Number.isInteger(id) || id <= 0)) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: 'Please select at least one Unit for Inside Kerala registration.'
        });
      }

      const remainingSlots = maxUnits - heldUnitCount;
      if (selectedUnitIds.length > remainingSlots) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: heldUnitCount > 0
            ? `You already hold ${heldUnitCount} unit${heldUnitCount === 1 ? '' : 's'}; you can add only ${remainingSlots} more (maximum ${maxUnits}).`
            : `You can select a maximum of ${maxUnits} unit${maxUnits === 1 ? '' : 's'}.`
        });
      }

      // CRITICAL BUSINESS RULE: Unit availability & assignment with row-level locking.
      // Each unit belongs to at most one student; a student may hold up to maxUnits units.
      // Lock in id order so concurrent submissions can't deadlock each other.
      const [unitRows] = await connection.query(
        `SELECT u.id, u.name, c.id AS circle_id, c.name AS circle_name,
                z.id AS zone_id, z.name AS zone_name, d.id AS district_id, d.name AS district_name,
                (SELECT COUNT(*) FROM unit_assignments ua WHERE ua.unit_id = u.id AND ua.status = 'active') AS active_assignment_count,
                (SELECT COUNT(*) FROM registrations r WHERE r.unit_id = u.id AND r.registration_type = 'inside_kerala' AND r.status IN ('approved', 'pending')) AS active_reg_count
         FROM units u
         JOIN circles c ON u.circle_id = c.id
         JOIN zones z ON c.zone_id = z.id
         JOIN districts d ON z.district_id = d.id
         WHERE u.id IN (?) AND u.is_active = 1
         ORDER BY u.id
         FOR UPDATE`,
        [selectedUnitIds]
      );

      if (unitRows.length !== selectedUnitIds.length) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: 'One or more selected units are invalid or inactive.'
        });
      }

      const takenUnits = unitRows.filter((u) => u.active_assignment_count > 0 || u.active_reg_count > 0);
      if (takenUnits.length > 0) {
        await connection.rollback();
        connection.release();
        const names = takenUnits.map((u) => `"${u.name}"`).join(', ');
        return res.status(409).json({
          success: false,
          message: `${names} ${takenUnits.length === 1 ? 'has' : 'have'} already been selected by another student. Please select another available unit.`
        });
      }

      // Place hierarchy comes from the primary unit, not the client
      const unitsById = new Map(unitRows.map((u) => [u.id, u]));
      const orderedUnits = selectedUnitIds.map((id) => unitsById.get(id));
      const primary = orderedUnits[0];

      if (!existingReg) {
        // Insert Registration with requested quantity and initial 0 additional granted
        const [regResult] = await connection.query(
          `INSERT INTO registrations
             (registration_code, student_id, registration_type, calendars_requested, additional_calendars, calendars_allotted, district_id, zone_id, circle_id, unit_id, status)
           VALUES (?, ?, 'inside_kerala', ?, 0, ?, ?, ?, ?, ?, 'approved')`,
          [regCode, student_id, requestedQuota, requestedQuota, primary.district_id, primary.zone_id, primary.circle_id, primary.id]
        );
        registrationId = regResult.insertId;
      }

      // One active Unit Assignment per selected unit
      await connection.query(
        `INSERT INTO unit_assignments (unit_id, student_id, registration_id, status, assigned_at)
         VALUES ${orderedUnits.map(() => `(?, ?, ?, 'active', NOW())`).join(', ')}`,
        orderedUnits.flatMap((u) => [u.id, student_id, registrationId])
      );

      if (existingReg) {
        // Confirmation shows the whole registration: its original place plus all units now held
        const [[full]] = await connection.query(
          `SELECT d.name AS district_name, z.name AS zone_name, c.name AS circle_name,
                  ${REGISTRATION_UNIT_NAMES} AS unit_name
           FROM registrations r
           LEFT JOIN districts d ON r.district_id = d.id
           LEFT JOIN zones z ON r.zone_id = z.id
           LEFT JOIN circles c ON r.circle_id = c.id
           LEFT JOIN units u ON r.unit_id = u.id
           WHERE r.id = ?`,
          [registrationId]
        );
        placeDetails = { ...full };
      } else {
        placeDetails = {
          district_name: primary.district_name,
          zone_name: primary.zone_name,
          circle_name: primary.circle_name,
          unit_name: orderedUnits.map((u) => u.name).join(', ')
        };
      }
      placeDetails.addedUnits = orderedUnits.map((u) => ({
        id: u.id,
        name: u.name,
        circle_name: u.circle_name,
        zone_name: u.zone_name,
        district_name: u.district_name
      }));
      // Every unit the registration now holds, each with its own location (for the slip)
      placeDetails.units = await getRegistrationUnits(registrationId, connection);

    } else if (registration_type === 'outside_kerala') {
      // Validate Outside Kerala fields
      if (!state_name || !outside_district || !outside_zone || !outside_circle || !outside_unit) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: 'State, District, Zone, Circle, and Unit are all required for Outside Kerala registration.'
        });
      }

      const [regResult] = await connection.query(
        `INSERT INTO registrations 
           (registration_code, student_id, registration_type, calendars_requested, additional_calendars, calendars_allotted, state_name, outside_district, outside_zone, outside_circle, outside_unit, status)
         VALUES (?, ?, 'outside_kerala', ?, 0, ?, ?, ?, ?, ?, ?, 'approved')`,
        [
          regCode,
          student_id,
          requestedQuota,
          requestedQuota,
          state_name.trim(),
          outside_district.trim(),
          outside_zone.trim(),
          outside_circle.trim(),
          outside_unit.trim()
        ]
      );
      registrationId = regResult.insertId;

      placeDetails = {
        state_name: state_name.trim(),
        outside_district: outside_district.trim(),
        outside_zone: outside_zone.trim(),
        outside_circle: outside_circle.trim(),
        outside_unit: outside_unit.trim()
      };
    } else {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Invalid registration type. Must be "inside_kerala" or "outside_kerala".'
      });
    }

    await connection.commit();
    connection.release();

    const addedCount = placeDetails.addedUnits ? placeDetails.addedUnits.length : 0;
    return res.status(existingReg ? 200 : 201).json({
      success: true,
      addedToExisting: Boolean(existingReg),
      message: existingReg
        ? `${addedCount} unit${addedCount === 1 ? '' : 's'} added to registration ${regCode}.`
        : 'Registration submitted successfully!',
      registration: {
        id: registrationId,
        registrationCode: regCode,
        studentName: student.candidate_name,
        regNo: student.reg_no,
        registrationType: registration_type,
        calendarsRequested: requestedQuota,
        additionalCalendars: existingReg ? existingReg.additional_calendars : 0,
        calendarsAllotted: existingReg ? existingReg.calendars_allotted : requestedQuota,
        ...placeDetails
      }
    });
  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'This unit has already been selected by another student. Please select another available unit.'
      });
    }
    next(err);
  }
}

/**
 * Admin: Get paginated list of registrations with rich filters
 */
async function getRegistrations(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit || '15', 10)));
    const offset = (page - 1) * limit;

    const {
      search,
      registration_type,
      status,
      district_id,
      zone_id,
      circle_id,
      unit_id,
      class_name,
      from_date,
      to_date
    } = req.query;

    let whereClauses = [];
    let params = [];

    if (search) {
      whereClauses.push('(r.registration_code LIKE ? OR s.reg_no LIKE ? OR s.admission_no LIKE ? OR s.candidate_name LIKE ? OR s.mobile LIKE ?)');
      const p = `%${search.trim()}%`;
      params.push(p, p, p, p, p);
    }

    if (registration_type) {
      whereClauses.push('r.registration_type = ?');
      params.push(registration_type);
    }

    if (status && status !== 'all') {
      whereClauses.push('r.status = ?');
      params.push(status);
    } else if (status !== 'all') {
      whereClauses.push("r.status != 'cancelled'");
    }

    if (class_name) {
      whereClauses.push('s.class_name = ?');
      params.push(class_name);
    }

    if (district_id) {
      whereClauses.push('r.district_id = ?');
      params.push(district_id);
    }

    if (zone_id) {
      whereClauses.push('r.zone_id = ?');
      params.push(zone_id);
    }

    if (circle_id) {
      whereClauses.push('r.circle_id = ?');
      params.push(circle_id);
    }

    if (unit_id) {
      // Match the primary unit or any additional unit held by the registration
      whereClauses.push('(r.unit_id = ? OR EXISTS (SELECT 1 FROM unit_assignments ua_f WHERE ua_f.registration_id = r.id AND ua_f.unit_id = ?))');
      params.push(unit_id, unit_id);
    }

    if (from_date) {
      whereClauses.push('DATE(r.submitted_at) >= ?');
      params.push(from_date);
    }

    if (to_date) {
      whereClauses.push('DATE(r.submitted_at) <= ?');
      params.push(to_date);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total 
       FROM registrations r
       JOIN students s ON r.student_id = s.id
       ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    const [registrations] = await db.query(
      `SELECT r.*,
              s.candidate_name, s.reg_no, s.admission_no, s.class_name, s.hajer_no, s.hajer_no AS hall_no, s.place, s.mobile,
              d.name AS district_name, z.name AS zone_name, c.name AS circle_name, ${REGISTRATION_UNIT_NAMES} AS unit_name
       FROM registrations r
       JOIN students s ON r.student_id = s.id
       LEFT JOIN districts d ON r.district_id = d.id
       LEFT JOIN zones z ON r.zone_id = z.id
       LEFT JOIN circles c ON r.circle_id = c.id
       LEFT JOIN units u ON r.unit_id = u.id
       ${whereSql}
       ORDER BY r.submitted_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Each registration's units with their own location (units may span circles/districts)
    await attachRegistrationUnits(registrations);

    return res.json({
      success: true,
      registrations,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Get single registration by ID
 */
async function getRegistrationById(req, res, next) {
  try {
    const id = req.params.id;
    const [rows] = await db.query(
      `SELECT r.*,
              s.candidate_name, s.reg_no, s.admission_no, s.class_name, s.hajer_no, s.hajer_no AS hall_no, s.place, s.mobile,
              d.name AS district_name, z.name AS zone_name, c.name AS circle_name, ${REGISTRATION_UNIT_NAMES} AS unit_name,
              ua.id AS unit_assignment_id, ua.status AS assignment_status, ua.assigned_at, ua.released_at, ua.release_reason
       FROM registrations r
       JOIN students s ON r.student_id = s.id
       LEFT JOIN districts d ON r.district_id = d.id
       LEFT JOIN zones z ON r.zone_id = z.id
       LEFT JOIN circles c ON r.circle_id = c.id
       LEFT JOIN units u ON r.unit_id = u.id
       LEFT JOIN unit_assignments ua ON ua.registration_id = r.id
       WHERE r.id = ?
       LIMIT 1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Registration record not found' });
    }

    rows[0].units = await getRegistrationUnits(rows[0].id);
    return res.json({ success: true, registration: rows[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Update registration status (approve, reject, cancel)
 * When cancelling or rejecting an inside_kerala registration, automatically release its unit assignment!
 */
async function updateRegistrationStatus(req, res, next) {
  let connection;
  try {
    const id = req.params.id;
    const { status, reason } = req.body;

    if (!['approved', 'pending', 'rejected', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid registration status.' });
    }

    const effectiveReason = reason && reason.trim() ? reason.trim() : `Registration ${status} by administrator`;

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT r.*, s.candidate_name 
       FROM registrations r 
       JOIN students s ON r.student_id = s.id 
       WHERE r.id = ? FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Registration not found' });
    }

    const reg = rows[0];

    // Update status
    await connection.query(
      `UPDATE registrations SET status = ?, rejection_reason = ? WHERE id = ?`,
      [status, effectiveReason, id]
    );

    // If cancelled or rejected and was inside_kerala, release unit assignment so the unit is freed up!
    if (['rejected', 'cancelled'].includes(status) && reg.registration_type === 'inside_kerala' && reg.unit_id) {
      await connection.query(
        `UPDATE unit_assignments 
         SET status = 'released', released_at = NOW(), release_reason = ?, released_by = ?
         WHERE registration_id = ? AND status = 'active'`,
        [effectiveReason, req.user.id, id]
      );
    }

    await connection.commit();
    connection.release();

    await logAction({
      adminId: req.user.id,
      action: `REGISTRATION_${status.toUpperCase()}`,
      entityType: 'registration',
      entityId: parseInt(id, 10),
      details: { status, reason, registrationCode: reg.registration_code, student: reg.candidate_name }
    });

    return res.json({
      success: true,
      message: `Registration marked as ${status} successfully.`
    });
  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    next(err);
  }
}

/**
 * Admin: Update calendar quota for a registration (increment/decrement or direct edit)
 */
async function updateCalendarQuota(req, res, next) {
  try {
    const registrationId = req.params.id;
    const { delta, quota, calendars_allotted, additional_calendars, calendars_requested } = req.body;

    // Check registration existence
    const [existing] = await db.query(
      `SELECT r.id, r.calendars_requested, r.additional_calendars, r.calendars_allotted, s.candidate_name, s.reg_no 
       FROM registrations r
       JOIN students s ON r.student_id = s.id
       WHERE r.id = ?`,
      [registrationId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Registration record not found.'
      });
    }

    const currentRequested = existing[0].calendars_requested != null ? existing[0].calendars_requested : 100;
    const currentAdditional = existing[0].additional_calendars != null ? existing[0].additional_calendars : 0;
    const currentAllotted = existing[0].calendars_allotted != null ? existing[0].calendars_allotted : (currentRequested + currentAdditional);

    let newRequested = currentRequested;
    let newAdditional = currentAdditional;
    let newAllotted = currentAllotted;

    if (additional_calendars !== undefined) {
      // Explicit additional calendars granted (maintains student request separately)
      const parsedAdd = parseInt(additional_calendars, 10);
      if (isNaN(parsedAdd) || parsedAdd < 0) {
        return res.status(400).json({ success: false, message: 'Additional calendars must be a non-negative integer.' });
      }
      newAdditional = parsedAdd;
      newAllotted = currentRequested + newAdditional;
    } else if (delta !== undefined) {
      // Step increment [+] / [-]
      const parsedDelta = parseInt(delta, 10);
      if (isNaN(parsedDelta)) {
        return res.status(400).json({ success: false, message: 'Invalid quota delta value.' });
      }
      newAllotted = Math.max(0, currentAllotted + parsedDelta);
      newRequested = newAllotted;
      newAdditional = 0;
    } else {
      // Direct quota / Calendars Required change
      const targetQuota = calendars_allotted !== undefined 
        ? calendars_allotted 
        : (calendars_requested !== undefined ? calendars_requested : quota);
      const parsedQuota = parseInt(targetQuota, 10);
      if (isNaN(parsedQuota) || parsedQuota < 0) {
        return res.status(400).json({ success: false, message: 'Quota must be a non-negative integer.' });
      }
      newAllotted = parsedQuota;
      newRequested = parsedQuota;
      newAdditional = 0;
    }

    // Persist changes directly into MySQL database
    await db.query(
      `UPDATE registrations 
       SET calendars_requested = ?, additional_calendars = ?, calendars_allotted = ? 
       WHERE id = ?`,
      [newRequested, newAdditional, newAllotted, registrationId]
    );

    await logAction({
      adminId: req.user.id,
      action: 'UPDATE_CALENDAR_QUOTA',
      entityType: 'registration',
      entityId: parseInt(registrationId, 10),
      details: {
        calendarsRequested: newRequested,
        previousRequested: currentRequested,
        previousAdditional: currentAdditional,
        newAdditional,
        previousTotal: currentAllotted,
        newTotal: newAllotted,
        studentName: existing[0].candidate_name,
        regNo: existing[0].reg_no
      }
    });

    return res.json({
      success: true,
      message: `Calendar quota updated for ${existing[0].candidate_name}. Total: ${newAllotted} Nos (Requested / Quota: ${newRequested}).`,
      registrationId: parseInt(registrationId, 10),
      calendars_requested: newRequested,
      additional_calendars: newAdditional,
      calendars_allotted: newAllotted
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Cancel & Permanently Delete registration
 * Removes registration and associated unit assignment in a transaction,
 * immediately freeing up the unit and allowing the student to register again.
 */
async function deleteRegistration(req, res, next) {
  let connection;
  try {
    const id = req.params.id;
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT r.*, s.candidate_name, s.reg_no 
       FROM registrations r 
       LEFT JOIN students s ON r.student_id = s.id 
       WHERE r.id = ? FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Registration not found' });
    }

    const reg = rows[0];

    // 1. Delete associated unit assignments
    await connection.query(
      `DELETE FROM unit_assignments WHERE registration_id = ?`,
      [id]
    );

    // 2. Delete the registration record
    await connection.query(
      `DELETE FROM registrations WHERE id = ?`,
      [id]
    );

    await connection.commit();
    connection.release();

    return res.json({
      success: true,
      message: `Registration ${reg.registration_code} for "${reg.candidate_name}" has been cancelled and deleted. The unit is now available.`
    });
  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    next(err);
  }
}

/**
 * Remove some units from a multi-unit Kerala registration.
 * Body: { unit_ids: [..] }. The removed units become available again; the registration,
 * its code and calendar quota stay. Removing every unit deletes the registration
 * (same as deleteRegistration).
 */
async function removeRegistrationUnits(req, res, next) {
  let connection;
  try {
    const id = req.params.id;
    const unitIds = [...new Set((Array.isArray(req.body.unit_ids) ? req.body.unit_ids : [])
      .map((v) => parseInt(v, 10))
      .filter((v) => Number.isInteger(v) && v > 0))];

    if (unitIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one unit to remove.' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT r.*, s.candidate_name, s.reg_no
       FROM registrations r
       LEFT JOIN students s ON r.student_id = s.id
       WHERE r.id = ? FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ success: false, message: 'Registration not found' });
    }
    const reg = rows[0];

    const [active] = await connection.query(
      `SELECT ua.id, ua.unit_id, u.name AS unit_name
       FROM unit_assignments ua
       JOIN units u ON u.id = ua.unit_id
       WHERE ua.registration_id = ? AND ua.status = 'active'
       ORDER BY ua.id
       FOR UPDATE`,
      [id]
    );

    const toRemove = active.filter((a) => unitIds.includes(a.unit_id));
    if (toRemove.length !== unitIds.length) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ success: false, message: 'One or more selected units are not assigned to this registration.' });
    }

    const remaining = active.filter((a) => !unitIds.includes(a.unit_id));

    if (remaining.length === 0) {
      // Every unit selected: remove the whole registration
      await connection.query(`DELETE FROM unit_assignments WHERE registration_id = ?`, [id]);
      await connection.query(`DELETE FROM registrations WHERE id = ?`, [id]);
      await connection.commit();
      connection.release();
      return res.json({
        success: true,
        registrationDeleted: true,
        message: `Registration ${reg.registration_code} for "${reg.candidate_name}" has been deleted. All its units are now available.`
      });
    }

    await connection.query(`DELETE FROM unit_assignments WHERE id IN (?)`, [toRemove.map((a) => a.id)]);

    // If the primary unit was removed, promote the first remaining unit with its place hierarchy
    if (unitIds.includes(reg.unit_id)) {
      await connection.query(
        `UPDATE registrations r
         JOIN units u ON u.id = ?
         JOIN circles c ON u.circle_id = c.id
         JOIN zones z ON c.zone_id = z.id
         SET r.unit_id = u.id, r.circle_id = c.id, r.zone_id = z.id, r.district_id = z.district_id
         WHERE r.id = ?`,
        [remaining[0].unit_id, id]
      );
    }

    await connection.commit();
    connection.release();

    const removedNames = toRemove.map((a) => a.unit_name).join(', ');
    return res.json({
      success: true,
      registrationDeleted: false,
      message: `Removed ${removedNames} from registration ${reg.registration_code} ("${reg.candidate_name}"). ${remaining.length} unit${remaining.length === 1 ? '' : 's'} remain${remaining.length === 1 ? 's' : ''}.`
    });
  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    next(err);
  }
}

module.exports = {
  removeRegistrationUnits,
  submitRegistration,
  getRegistrations,
  getRegistrationById,
  updateRegistrationStatus,
  updateCalendarQuota,
  deleteRegistration
};
