const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../config/db');
async function migrate() {
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('pharmacy_catalog_migration', 15) AS acquired");
    if (lock.acquired !== 1) throw new Error('Migration lock unavailable');
    const directory = path.join(__dirname, '../migrations');
    const files = (await fs.readdir(directory)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
    // Migrations are additive/idempotent: MySQL DDL commits independently.
    for (const file of files) {
      const sql = await fs.readFile(path.join(directory, file), 'utf8');
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) {
        await connection.query(statement);
      }
      console.log(`Applied ${file}`);
    }
    console.log('Migrations complete. Existing accounts preserved.');
  } finally {
    await connection.query("SELECT RELEASE_LOCK('pharmacy_catalog_migration')");
    connection.release();
  }
}
migrate().catch(error => { console.error('Migration failed:', error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
