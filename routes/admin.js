const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { getDb, logActivity } = require('../db');

// Error wrapper
const catchAsync = fn => (req, res, next) => fn(req, res, next).catch(next);

// Admin check middleware
const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    req.session.errorMsg = 'Access Denied. Admin only.';
    return res.redirect('/login');
  }
  next();
};

router.use(requireAdmin);

const fs = require('fs');
const uploadDir = path.join(__dirname, '../public/uploads/');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Setup multer for PDF uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
});
const upload = multer({ storage: storage });

// GET /admin/dashboard
router.get('/dashboard', catchAsync(async (req, res) => {
  const db = await getDb();
  
  const systemControl = await db.get('SELECT * FROM system_control LIMIT 1');
  const companies = await db.all('SELECT * FROM companies ORDER BY name ASC');
  const teams = await db.all('SELECT * FROM teams ORDER BY team_name ASC');
  const bids = await db.all(`
    SELECT bids.*, teams.team_name, companies.name as company_name 
    FROM bids 
    JOIN teams ON bids.team_id = teams.id 
    JOIN companies ON bids.company_id = companies.id
    ORDER BY bids.assigned_at DESC
  `);
  
  res.render('admin_dashboard', {
    systemControl: systemControl || { current_phase: 'closed'},
    companies,
    teams,
    bids
  });
}));

// POST /admin/create-user
router.post('/create-user', catchAsync(async (req, res) => {
  const { username, password } = req.body;
  const db = await getDb();
  const bcrypt = require('bcrypt');
  
  try {
    const hash = await bcrypt.hash(password, 10);
    await db.run('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', [username, hash, 'team']);
    
    // Immediately create the team entry too
    const newUser = await db.get('SELECT id FROM users WHERE username = $1', [username]);
    const sys = await db.get('SELECT default_bidding_purse, default_allocation_purse FROM system_control LIMIT 1');
    const bPurse = sys ? sys.default_bidding_purse : 1000000;
    const aPurse = sys ? sys.default_allocation_purse : 2000000;
    const teamName = `${username}_team`;
    await db.run('INSERT INTO teams (team_name, user_id, purse_remaining, allocation_purse) VALUES ($1, $2, $3, $4)', [teamName, newUser.id, bPurse, aPurse]);
    
    await logActivity('ADMIN', 'CREATE_USER', `Created team user "${username}" and team "${teamName}" with Bid=₹${bPurse} Cr., Trade=₹${aPurse} Cr.`);
    req.session.successMsg = `Team User '${username}' and team '${teamName}' created successfully.`;
  } catch(err) {
    console.error("CREATE USER ERROR:", err.message);
    req.session.errorMsg = 'Error creating user. Username might already exist.';
  }
  res.redirect('/admin/dashboard');
}));

// POST /admin/add-company
router.post('/add-company', upload.single('pdf_doc'), catchAsync(async (req, res) => {
  const { name, description } = req.body;
  const pdf_url = req.file ? `/uploads/${req.file.filename}` : null;
  const db = await getDb();

  try {
    // Check if a company with this name already exists
    const existing = await db.get('SELECT id FROM companies WHERE LOWER(name) = LOWER($1)', [name]);
    if (existing) {
      req.session.errorMsg = `A company named "${name}" already exists (ID: ${existing.id}).`;
      return res.redirect('/admin/dashboard');
    }
    
    await db.run('INSERT INTO companies (name, description, pdf_url) VALUES ($1, $2, $3)', [name, description || null, pdf_url]);
    await logActivity('ADMIN', 'ADD_COMPANY', `Added company "${name}"`);
    req.session.successMsg = `Company "${name}" added successfully!`;
  } catch (err) {
    console.error("ADD COMPANY FULL ERROR:", err);
    req.session.errorMsg = `DB Error adding company: ${err.message}`;
  }
  res.redirect('/admin/dashboard');
}));

// POST /admin/assign-bid
router.post('/assign-bid', catchAsync(async (req, res) => {
  const { team_id, company_id, bid_amount } = req.body;
  const amount = parseFloat(bid_amount);
  const db = await getDb();

  const team = await db.get('SELECT * FROM teams WHERE id = $1', [team_id]);
  const existingBid = await db.get('SELECT * FROM bids WHERE company_id = $1', [company_id]);

  if (existingBid) {
    req.session.errorMsg = 'Company already assigned to a team.';
    return res.redirect('/admin/dashboard');
  }

  if (team.purse_remaining < amount) {
    req.session.errorMsg = 'Team does not have enough purse remaining.';
    return res.redirect('/admin/dashboard');
  }

  // Deduct purse and insert bid
  await db.exec('BEGIN');
  try {
    await db.run('INSERT INTO bids (team_id, company_id, bid_amount) VALUES ($1, $2, $3)', [team_id, company_id, amount]);
    await db.run('UPDATE teams SET purse_remaining = purse_remaining - $1 WHERE id = $2', [amount, team_id]);
    await db.exec('COMMIT');
    const updatedTeam = await db.get('SELECT team_name, purse_remaining, allocation_purse FROM teams WHERE id = $1', [team_id]);
    const companyName = (await db.get('SELECT name FROM companies WHERE id = $1', [company_id])).name;
    await logActivity('ADMIN', 'ASSIGN_BID', `Assigned "${companyName}" to "${updatedTeam.team_name}" for ₹${amount} Cr.`, `Team "${updatedTeam.team_name}": Bidding=₹${updatedTeam.purse_remaining} Cr., Trading=₹${updatedTeam.allocation_purse} Cr.`);
    req.session.successMsg = 'Bid assigned successfully.';
  } catch (err) {
    await db.exec('ROLLBACK');
    req.session.errorMsg = 'Error assigning bid.';
  }

  res.redirect('/admin/dashboard');
}));

// POST /admin/set-phase
router.post('/set-phase', catchAsync(async (req, res) => {
  const { phase } = req.body;
  const db = await getDb();
  
  const sys = await db.get('SELECT current_phase, default_allocation_purse FROM system_control LIMIT 1');
  if (sys && sys.current_phase === 'auction' && phase === 'trading') {
    // allocation_purse = leftover bidding money + the global default allocation purse
    const defaultAlloc = sys.default_allocation_purse || 0;
    await db.run('UPDATE teams SET allocation_purse = purse_remaining + $1, purse_remaining = 0', [defaultAlloc]);
    const allTeams = await db.all('SELECT team_name, purse_remaining, allocation_purse FROM teams');
    const snapshot = allTeams.map(t => `${t.team_name}: Bid=₹${t.purse_remaining} Cr., Trade=₹${t.allocation_purse} Cr.`).join(' | ');
    await logActivity('ADMIN', 'PHASE_CHANGE', `Phase: auction → trading. Rollover applied. Default alloc=₹${defaultAlloc} Cr.`, snapshot);
    req.session.successMsg = `Phase changed to ${phase}. Each team's trading purse = leftover bid funds + ₹${defaultAlloc.toLocaleString()} Cr. default.`;
  } else {
    await logActivity('ADMIN', 'PHASE_CHANGE', `Phase changed to "${phase}"`);
    req.session.successMsg = `Phase changed to ${phase}.`;
  }

  await db.run('UPDATE system_control SET current_phase = $1', [phase]);
  res.redirect('/admin/dashboard');
}));

// POST /admin/update-default-purses
router.post('/update-default-purses', catchAsync(async (req, res) => {
  const { bidding_purse, allocation_purse } = req.body;
  const db = await getDb();
  const bp = parseFloat(bidding_purse);
  const ap = parseFloat(allocation_purse);
  
  await db.run('UPDATE system_control SET default_bidding_purse = $1, default_allocation_purse = $2', [bp, ap]);
  await db.run('UPDATE teams SET purse_remaining = $1, allocation_purse = $2', [bp, ap]);
  const allTeams = await db.all('SELECT team_name, purse_remaining, allocation_purse FROM teams');
  const snapshot = allTeams.map(t => `${t.team_name}: Bid=₹${t.purse_remaining} Cr., Trade=₹${t.allocation_purse} Cr.`).join(' | ');
  await logActivity('ADMIN', 'UPDATE_DEFAULT_PURSES', `Global defaults set: Bidding=₹${bp} Cr., Trading=₹${ap} Cr. All teams reset.`, snapshot);
  req.session.successMsg = 'Global default purses updated successfully and all existing teams were securely reset to these values.';
  res.redirect('/admin/dashboard');
}));

// POST /admin/update-team-purse
router.post('/update-team-purse', catchAsync(async (req, res) => {
  const { team_id, bidding_purse, allocation_purse } = req.body;
  const db = await getDb();
  await db.run('UPDATE teams SET purse_remaining = $1, allocation_purse = $2 WHERE id = $3', [parseFloat(bidding_purse), parseFloat(allocation_purse), parseInt(team_id)]);
  const t = await db.get('SELECT team_name, purse_remaining, allocation_purse FROM teams WHERE id = $1', [parseInt(team_id)]);
  await logActivity('ADMIN', 'UPDATE_TEAM_PURSE', `Overrode purses for "${t.team_name}": Bid=₹${t.purse_remaining} Cr., Trade=₹${t.allocation_purse} Cr.`, `${t.team_name}: Bid=₹${t.purse_remaining} Cr., Trade=₹${t.allocation_purse} Cr.`);
  req.session.successMsg = 'Team purses updated successfully.';
  res.redirect('/admin/dashboard');
}));

// POST /admin/set-live-company
router.post('/set-live-company', catchAsync(async (req, res) => {
  const company_id = req.body.company_id;
  const db = await getDb();
  if (company_id === 'none') {
    await db.run('UPDATE system_control SET live_company_id = NULL');
    req.session.successMsg = 'Cleared live company broadcast.';
    await logActivity('ADMIN', 'SET_LIVE_COMPANY', 'Cleared live company broadcast');
  } else {
    await db.run('UPDATE system_control SET live_company_id = $1', [company_id]);
    const c = await db.get('SELECT name FROM companies WHERE id = $1', [company_id]);
    await logActivity('ADMIN', 'SET_LIVE_COMPANY', `Live company set to "${c ? c.name : company_id}"`);
    req.session.successMsg = 'Live company broadcast updated!';
  }
  res.redirect('/admin/dashboard');
}));



// POST /admin/delete-team
router.post('/delete-team', catchAsync(async (req, res) => {
  const { team_id } = req.body;
  const db = await getDb();
  await db.exec('BEGIN TRANSACTION');
  try {
    const team = await db.get('SELECT * FROM teams WHERE id = $1', [team_id]);
    if (team) {
      await db.run('DELETE FROM trades WHERE initiator_team_id = $1 OR target_team_id = $1', [team_id]);
      await db.run('DELETE FROM allocations WHERE team_id = $1', [team_id]);
      await db.run('DELETE FROM bids WHERE team_id = $1', [team_id]);
      await db.run('DELETE FROM teams WHERE id = $1', [team_id]);
      await db.run('DELETE FROM users WHERE id = $1', [team.user_id]);
    }
    await db.exec('COMMIT');
    await logActivity('ADMIN', 'DELETE_TEAM', `Deleted team ID=${team_id} and their user/bids/allocations`);
    req.session.successMsg = 'Team deleted completely.';
  } catch (err) {
    await db.exec('ROLLBACK');
    req.session.errorMsg = 'Error deleting team.';
  }
  res.redirect('/admin/dashboard');
}));

// POST /admin/delete-company
router.post('/delete-company', catchAsync(async (req, res) => {
  const { company_id } = req.body;
  const db = await getDb();
  await db.exec('BEGIN TRANSACTION');
  try {
    const bids = await db.all('SELECT * FROM bids WHERE company_id = $1', [company_id]);
    for (let bid of bids) {
      await db.run('UPDATE teams SET purse_remaining = purse_remaining + $1 WHERE id = $2', [bid.bid_amount, bid.team_id]);
    }
    await db.run('DELETE FROM trades WHERE target_company_id = $1 OR offered_company_id = $1', [company_id]);
    await db.run('DELETE FROM bids WHERE company_id = $1', [company_id]);
    await db.run('DELETE FROM allocations WHERE company_id = $1', [company_id]);
    await db.run('UPDATE system_control SET live_company_id = NULL WHERE live_company_id = $1', [company_id]);
    await db.run('DELETE FROM companies WHERE id = $1', [company_id]);
    await db.exec('COMMIT');
    await logActivity('ADMIN', 'DELETE_COMPANY', `Deleted company ID=${company_id}. Refunded bids to teams.`);
    req.session.successMsg = 'Company deleted successfully.';
  } catch (err) {
    await db.exec('ROLLBACK');
    req.session.errorMsg = 'Error deleting company.';
  }
  res.redirect('/admin/dashboard');
}));

// POST /admin/revoke-bid
router.post('/revoke-bid', catchAsync(async (req, res) => {
  const { bid_id } = req.body;
  const db = await getDb();
  await db.exec('BEGIN TRANSACTION');
  try {
    const bid = await db.get('SELECT * FROM bids WHERE id = $1', [bid_id]);
    if (bid) {
      await db.run('UPDATE teams SET purse_remaining = purse_remaining + $1 WHERE id = $2', [bid.bid_amount, bid.team_id]);
      await db.run('DELETE FROM allocations WHERE team_id = $1 AND company_id = $2', [bid.team_id, bid.company_id]);
      await db.run('DELETE FROM bids WHERE id = $1', [bid_id]);
    }
    await db.exec('COMMIT');
    await logActivity('ADMIN', 'REVOKE_BID', `Revoked bid ID=${bid_id}. ₹${bid.bid_amount} Cr. refunded to team ID=${bid.team_id}`);
    req.session.successMsg = 'Bid revoked successfully. Funds returned to team.';
  } catch (err) {
    await db.exec('ROLLBACK');
    req.session.errorMsg = 'Error revoking bid.';
  }
  res.redirect('/admin/dashboard');
}));

// POST /admin/reset-all-data
router.post('/reset-all-data', catchAsync(async (req, res) => {
  const db = await getDb();
  try {
    await db.run('DELETE FROM trades');
    await db.run('DELETE FROM allocations');
    await db.run('DELETE FROM bids');
    await db.run('DELETE FROM teams');
    await db.run('DELETE FROM companies');
    await db.run("DELETE FROM users WHERE role != 'admin'");
    await db.run("UPDATE system_control SET current_phase = 'closed', live_company_id = NULL");
    await logActivity('ADMIN', 'RESET_ALL_DATA', 'NUCLEAR RESET: All teams, companies, bids, allocations, trades wiped.');
    req.session.successMsg = 'All data wiped successfully! Only admin account preserved.';
  } catch (err) {
    console.error("RESET ERROR:", err);
    req.session.errorMsg = 'Error resetting data: ' + err.message;
  }
  res.redirect('/admin/dashboard');
}));

// GET /admin/logs
router.get('/logs', catchAsync(async (req, res) => {
  const db = await getDb();
  const { action, actor } = req.query;
  
  let sql = 'SELECT * FROM activity_logs WHERE 1=1';
  const params = [];
  let paramIdx = 1;
  
  if (action) {
    sql += ` AND action = $${paramIdx++}`;
    params.push(action);
  }
  if (actor) {
    sql += ` AND actor ILIKE $${paramIdx++}`;
    params.push(`%${actor}%`);
  }
  
  sql += ' ORDER BY timestamp DESC LIMIT 500';
  
  const logs = await db.all(sql, params);
  
  res.render('admin_logs', {
    logs,
    filter_action: action || '',
    filter_actor: actor || ''
  });
}));

module.exports = router;

