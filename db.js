const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

async function getDb() {
  const db = await open({
    filename: path.join(__dirname, 'bid-to-build.sqlite'),
    driver: sqlite3.Database
  });

  return db;
}

async function initDb() {
  const db = await getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  // Split schema by semicolon to run statements sequentially
  const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (let statement of statements) {
    await db.exec(statement);
  }

  // Attempt to alter table if live_company_id doesn't exist
  try {
    await db.run("ALTER TABLE system_control ADD COLUMN live_company_id INTEGER REFERENCES companies(id)");
  } catch (err) {
    // Column already exists or table doesn't exist
  }

  console.log('Database initialized successfully.');
  
  // Create default admin if not exists
  const bcrypt = require('bcrypt');
  const adminExists = await db.get("SELECT * FROM users WHERE role = 'admin'");
  if (!adminExists) {
    const defaultPassword = 'admin';
    const hash = await bcrypt.hash(defaultPassword, 10);
    await db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", ['admin', hash, 'admin']);
    console.log('Default admin created. Username: admin, Password: admin');
  }

  // Ensure phases table has a row if it doesn't exist
  const controlExists = await db.get("SELECT * FROM system_control LIMIT 1");
  if (!controlExists) {
      await db.run("INSERT INTO system_control (current_phase) VALUES ('closed')");
      console.log('System control defaults set (Phase: closed).');
  }
}

module.exports = {
  getDb,
  initDb
};
