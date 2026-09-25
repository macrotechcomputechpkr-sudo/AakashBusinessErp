// =============================================
// scripts/generateHash.js
// Run this locally (after `npm install` in /server) to generate a real
// bcrypt hash for a password, so you can paste it into the SQL INSERT for
// public.global_users.password_hash instead of the placeholder text.
//
// Usage:
//   node scripts/generateHash.js "Super@2024"
// =============================================

const bcrypt = require('bcrypt');

const password = process.argv[2];
if (!password) {
    console.error('Usage: node scripts/generateHash.js <password>');
    process.exit(1);
}

bcrypt.hash(password, 10).then(hash => {
    console.log(hash);
}).catch(err => {
    console.error('Error generating hash:', err);
    process.exit(1);
});
