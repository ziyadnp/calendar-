const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { authenticateToken } = require('../middleware/auth');

// Public settings for the registration form
router.get('/public', settingsController.getPublicSettings);

// Protected Admin settings management
router.get('/', authenticateToken, settingsController.getSettings);
router.put('/', authenticateToken, settingsController.updateSettings);

module.exports = router;
