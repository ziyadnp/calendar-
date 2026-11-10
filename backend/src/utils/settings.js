const db = require('../config/db');

/**
 * System settings stored as key/value rows in the `settings` table.
 * Each definition parses the stored string and validates admin input.
 * Defaults apply when a row (or the whole table) is missing, so the app keeps working
 * on databases created before the settings table existed.
 */
const SETTING_DEFINITIONS = {
  registration_open: {
    default: true,
    parse: (raw) => raw === '1' || raw === 'true',
    serialize: (value) => (value ? '1' : '0'),
    validate: (value) => (typeof value === 'boolean' ? null : 'Registration open must be true or false.')
  },
  registration_closed_title: {
    default: 'Registration Closed',
    parse: (raw) => raw,
    serialize: (value) => value.trim(),
    validate: (value) =>
      typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 150
        ? null
        : 'Closed page title is required (max 150 characters).'
  },
  registration_closed_message: {
    default: 'Calendar distribution registration is currently closed. Please contact the Markaz administration for more information.',
    parse: (raw) => raw,
    serialize: (value) => value.trim(),
    validate: (value) =>
      typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 2000
        ? null
        : 'Closed page message is required (max 2000 characters).'
  },
  max_units_per_student: {
    default: 1,
    parse: (raw) => {
      const n = parseInt(raw, 10);
      return Number.isInteger(n) && n >= 1 ? n : 1;
    },
    serialize: (value) => String(value),
    validate: (value) =>
      Number.isInteger(value) && value >= 1 && value <= 50
        ? null
        : 'Maximum units per student must be a whole number between 1 and 50.'
  }
};

async function getSettings(connection = db) {
  const settings = {};
  for (const [key, def] of Object.entries(SETTING_DEFINITIONS)) {
    settings[key] = def.default;
  }

  try {
    const [rows] = await connection.query(`SELECT setting_key, setting_value FROM settings`);
    for (const row of rows) {
      const def = SETTING_DEFINITIONS[row.setting_key];
      if (def && row.setting_value !== null) {
        settings[row.setting_key] = def.parse(row.setting_value);
      }
    }
  } catch (err) {
    // Settings table not created yet: fall back to defaults
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }

  return settings;
}

/**
 * Validate and save a partial settings object. Returns { errors } or { settings }.
 */
async function updateSettings(changes, adminId) {
  const errors = [];
  const entries = [];

  for (const [key, value] of Object.entries(changes)) {
    const def = SETTING_DEFINITIONS[key];
    if (!def) continue; // Ignore unknown keys
    const error = def.validate(value);
    if (error) {
      errors.push(error);
    } else {
      entries.push([key, def.serialize(value), adminId || null]);
    }
  }

  if (errors.length > 0) return { errors };

  if (entries.length > 0) {
    await db.query(
      `INSERT INTO settings (setting_key, setting_value, updated_by) VALUES ?
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [entries]
    );
  }

  return { settings: await getSettings() };
}

module.exports = { SETTING_DEFINITIONS, getSettings, updateSettings };
