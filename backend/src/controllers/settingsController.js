const settingsStore = require('../utils/settings');

/**
 * Public: settings the registration form needs (open/closed state and unit limit)
 */
async function getPublicSettings(req, res, next) {
  try {
    const settings = await settingsStore.getSettings();
    return res.json({
      success: true,
      settings: {
        registrationOpen: settings.registration_open,
        closedTitle: settings.registration_closed_title,
        closedMessage: settings.registration_closed_message,
        maxUnitsPerStudent: settings.max_units_per_student
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: all settings
 */
async function getSettings(req, res, next) {
  try {
    const settings = await settingsStore.getSettings();
    return res.json({ success: true, settings });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: update one or more settings
 */
async function updateSettings(req, res, next) {
  try {
    const result = await settingsStore.updateSettings(req.body || {}, req.user.id);
    if (result.errors) {
      return res.status(400).json({ success: false, message: result.errors.join(' ') });
    }
    return res.json({
      success: true,
      message: 'Settings saved successfully.',
      settings: result.settings
    });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({
        success: false,
        message: 'Settings table is missing. Re-run database/database.sql to create it.'
      });
    }
    next(err);
  }
}

module.exports = { getPublicSettings, getSettings, updateSettings };
