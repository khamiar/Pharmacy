const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../config/db');
const { bootstrapAdmin } = require('../services/userService');
const { integer } = require('../validators/catalog');
(async () => {
  const id = integer(process.argv[2], 'Account ID (npm run bootstrap-admin -- <id>)', 1);
  const user = await bootstrapAdmin(id);
  console.log(`Administrator enabled for ${user.email}. Existing password preserved.`);
})().catch(error => { console.error('Administrator setup failed:', error.status ? error.message : error.code || error.name); process.exitCode = 1; }).finally(() => pool.end());
