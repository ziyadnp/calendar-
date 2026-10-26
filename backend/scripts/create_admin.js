/**
 * Standalone CLI Script to create (or reset) an admin user
 * Usage:
 *   node scripts/create_admin.js <username> <email> <password> "<full name>" [role]
 * Example:
 *   node scripts/create_admin.js admin admin@markaz.in "StrongPass@123" "System Admin" super_admin
 *
 * role: super_admin | admin | operator (default: admin)
 * If the username or email already exists, the password, name and role are updated and the account is re-activated.
 */
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');

const ROLES = ['super_admin', 'admin', 'operator'];

async function createAdmin() {
  const [username, email, password, fullName, role = 'admin'] = process.argv.slice(2);

  if (!username || !email || !password || !fullName) {
    console.error('Usage: node scripts/create_admin.js <username> <email> <password> "<full name>" [role]');
    process.exit(1);
  }
  if (!ROLES.includes(role)) {
    console.error(`Error: role must be one of ${ROLES.join(', ')}`);
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Error: password must be at least 8 characters');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [result] = await db.query(
    `INSERT INTO admins (username, email, password_hash, full_name, role, is_active)
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       full_name = VALUES(full_name),
       role = VALUES(role),
       is_active = 1`,
    [username.trim(), email.trim().toLowerCase(), passwordHash, fullName.trim(), role]
  );

  // affectedRows: 1 = inserted, 2 = updated existing row
  const action = result.affectedRows === 1 ? 'Created' : 'Updated';
  console.log(`\n${action} admin "${username}" (${email}) with role "${role}".\n`);

  process.exit(0);
}

createAdmin().catch((err) => {
  console.error('Fatal error creating admin:', err.message);
  process.exit(1);
});
