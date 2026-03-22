const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    phase TEXT NOT NULL,
    num TEXT DEFAULT '',
    name TEXT NOT NULL,
    detail TEXT DEFAULT '',
    est_cost TEXT DEFAULT '—',
    status TEXT DEFAULT 'Not Started',
    due_date TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    qty REAL DEFAULT 1,
    unit TEXT DEFAULT 'unit',
    unit_price REAL DEFAULT 0,
    supplier TEXT DEFAULT '',
    status TEXT DEFAULT 'To Procure',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reno_works (
    id TEXT PRIMARY KEY,
    area TEXT NOT NULL,
    description TEXT NOT NULL,
    tradesman TEXT DEFAULT '',
    status TEXT DEFAULT 'Not Started',
    est_cost REAL DEFAULT 0,
    actual_cost REAL DEFAULT 0,
    start_date TEXT DEFAULT '',
    end_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scratchpad (
    id TEXT PRIMARY KEY,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS shortlist (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    brand TEXT DEFAULT '',
    link TEXT DEFAULT '',
    price REAL DEFAULT 0,
    qty INTEGER DEFAULT 1,
    area TEXT DEFAULT '',
    priority TEXT DEFAULT 'Medium',
    status TEXT DEFAULT 'Considering',
    notes TEXT DEFAULT '',
    added_by TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient TEXT NOT NULL,
    sender TEXT NOT NULL,
    type TEXT DEFAULT 'mention',
    ref_id TEXT DEFAULT '',
    excerpt TEXT DEFAULT '',
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    uploaded_by TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scratchpad_refs (
    id TEXT PRIMARY KEY,
    scratch_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    label TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_activity ON activity_log(entity_type, entity_id);

  CREATE TABLE IF NOT EXISTS design_assets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    label TEXT DEFAULT '',
    section TEXT DEFAULT 'general',
    uploaded_by TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    name TEXT PRIMARY KEY,
    protected INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add url column to attachments (safe to run on existing DBs — fails silently if already exists)
try { db.exec('ALTER TABLE attachments ADD COLUMN url TEXT DEFAULT NULL'); } catch(e) {}
// Link shortlist items to confirmed inventory entries
try { db.exec('ALTER TABLE shortlist ADD COLUMN inventory_id TEXT DEFAULT NULL'); } catch(e) {}

// Seed default users (Marcus is protected — cannot be deleted)
const insertUser = db.prepare('INSERT OR IGNORE INTO users (name, protected) VALUES (?, ?)');
insertUser.run('Marcus', 1);
insertUser.run('Lucas', 0);

// Seed default settings
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('contractor_name', 'Contractor');
insertSetting.run('inv_budget', '100000');
insertSetting.run('reno_budget', '150000');

// Seed tasks on first run
const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
if (taskCount === 0) {
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, phase, num, name, detail, est_cost, status, due_date, owner, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, 'Not Started', '', ?, '', ?)`
  );

  const seeds = [
    // Phase 1 — Pre-Offer
    ['t01','p1','1.1','Check Letter of Offer expiry date',
     'Call HL Bank banker immediately. If expiry within 7 days, request extension or reissue. Do NOT let it lapse.',
     '—','Marcus / HL Bank',1],
    ['t02','p1','1.2','Contact agent to request inspection access',
     'Frame as a serious buyer with financing already arranged doing due diligence. Coordinate one access visit for all trades.',
     '—','Marcus / Agent',2],
    ['t03','p1','1.3','Book building inspector / civil engineer',
     'Written report with photos covering structural, waterproofing, and general condition.',
     'RM 800–2,000','Building Inspector',3],
    ['t04','p1','1.4','Book licensed pest control company',
     'Written termite inspection report required. Must be a licensed company for the report to be credible.',
     'RM 300–500','Pest Control',4],
    ['t05','p1','1.5','Book electrical contractor',
     'Attend inspection in person. Get written remediation quote on the day — not just verbal observations.',
     'RM 200–400','Electrician',5],
    ['t06','p1','1.6','Book licensed plumber',
     'Turn on mains water during visit to identify leaks in real time. Get remediation quote.',
     'RM 150–300','Plumber',6],
    ['t07','p1','1.7','Engage property solicitor in advance',
     'Brief solicitor so they are ready to act immediately once price is agreed. Get fee quote for SPA + loan.',
     '—','Solicitor',7],
    ['t08','p1','1.8','Compile cost-of-ownership summary',
     'After inspection, aggregate all written remediation quotes into one total. This document is your price reduction tool.',
     '—','Marcus',8],

    // Phase 2 — Inspection Day
    ['t09','p2','2.1','Coordinate all trades on same day',
     'One access visit — building inspector, pest control, electrician, and plumber all attend simultaneously.',
     'RM 1,500–3,200','Marcus',1],
    ['t10','p2','2.2','Waterproofing & water ingress — HIGH',
     'Roof, all wet areas, balconies, LG floors. Look for staining, mould, efflorescence. Get written quote.',
     'RM 20,000–80,000+','Building Inspector',2],
    ['t11','p2','2.3','Termite & pest inspection — HIGH',
     'All timber door/window frames, built-in cabinetry, roof trusses, subfloor areas. Written report required.',
     'RM 5,000–30,000','Pest Control',3],
    ['t12','p2','2.4','Electrical system — HIGH',
     'DB board, wiring, switchgear. Confirm TNB supply status. Full rewire of 6,026 sq ft is significant cost.',
     'RM 30,000–60,000','Electrician',4],
    ['t13','p2','2.5','Plumbing & drainage — MEDIUM',
     'Turn on mains. Check all sanitary fittings, visible pipe joints, drainage outlets.',
     'RM 10,000–25,000','Plumber',5],
    ['t14','p2','2.6','Structural inspection — MEDIUM',
     'Beams, columns, floor slabs. HILLSIDE SITE — check retaining walls and slope stability carefully.',
     'RM 15,000–50,000+','Building Inspector / Engineer',6],
    ['t15','p2','2.7','Finishes & fittings — LOWER',
     'Tiles (tap test), doors, windows, paint/plaster, air-con trunking. Cosmetic but aggregate cost adds up.',
     'RM 50,000–150,000','Marcus',7],
    ['t16','p2','2.8','Photograph all defects',
     'Systematic photos of every defect found. These support remediation quotes and the negotiation presentation.',
     '—','Marcus',8],

    // Phase 3 — Post-Inspection & Offer
    ['t17','p3','3.1','Compile full inspection & remediation report',
     'Aggregate all written reports and quotes into one summary. Calculate total remediation cost estimate.',
     '—','Marcus',1],
    ['t18','p3','3.2','Make verbal offer at RM 1.9M via agent',
     'Present inspection findings. Anchor at RM 1.9M. Fall back to RM 2.0M as a concession. Walk away if above RM 2.1M.',
     '—','Marcus / Agent',2],
    ['t19','p3','3.3','Pay 2% booking deposit',
     'Pay upon price agreement to secure the property. This is the earnest deposit.',
     '2% of agreed price','Marcus',3],
    ['t20','p3','3.4','Instruct solicitor to act on SPA',
     'Brief solicitor on agreed price. Provide copy of Letter of Offer. Solicitor to prepare SPA.',
     '—','Solicitor',4],
    ['t21','p3','3.5','Inform HL Bank of agreed price',
     'Banker will order panel valuation. If price below RM 2.1M, confirm: (1) valuation, (2) loan quantum, (3) MRTA.',
     '—','Marcus / HL Bank',5],

    // Phase 4 — SPA & Loan
    ['t22','p4','4.1','Bank panel valuation conducted',
     'Bank sends panel valuer to property. Confirm valuation figure. Loan capped at 90% of lower of price or valuation.',
     '~RM 3,500','HL Bank / Valuer',1],
    ['t23','p4','4.2','Review bank valuation report',
     'Confirm loan quantum. If reduced below RM 1.89M, arrange top-up cash. Confirm MRTA is correctly structured.',
     '—','Marcus / HL Bank',2],
    ['t24','p4','4.3','Sign SPA — pay balance 8% down payment',
     'Pay balance 8% (less the 2% booking deposit already paid). Legal fees and stamp duty on SPA payable.',
     '8% of price','Marcus / Solicitor',3],
    ['t25','p4','4.4','Pay SPA stamp duty (MOT)',
     'Stamp duty on Memorandum of Transfer based on purchase price.',
     '~RM 44,000','Marcus / Solicitor',4],
    ['t26','p4','4.5','Pay SPA legal fees',
     "Solicitor's scale fee based on purchase price.",
     '~RM 12,700','Marcus / Solicitor',5],
    ['t27','p4','4.6','Sign loan agreement',
     'Execute formal loan agreement with HL Bank.',
     '—','Marcus / HL Bank',6],
    ['t28','p4','4.7','Pay loan stamp duty (0.5%)',
     '0.5% of loan amount on the loan agreement.',
     '~RM 9,450','Marcus / Solicitor',7],
    ['t29','p4','4.8','Pay loan legal fees',
     "Solicitor's scale fee for acting on the loan agreement.",
     '~RM 11,820','Marcus / Solicitor',8],
    ['t30','p4','4.9','Bank disbursement — title transfer',
     'Bank releases funds to vendor. Title transfers to buyer. First loan instalment (RM 8,030/month) begins.',
     '—','Bank / Solicitor',9],

    // Phase 5 — Move-In Preparation
    ['t31','p5','5.1','Commission renovation — get 3 quotes',
     'Plan all remediation and renovation works. Obtain at least 3 quotes from different contractors.',
     'RM 50,000–150,000+','Marcus / Contractor',1],
    ['t32','p5','5.2','Apply for TNB power reconnection',
     'New TNB account and power reconnection. Required before renovation can proceed safely.',
     '—','Marcus / TNB',2],
    ['t33','p5','5.3','Apply for Indah Water account',
     'Set up sewerage utility account.',
     '—','Marcus / Indah Water',3],
    ['t34','p5','5.4','Apply for Air Selangor water account',
     'Set up water supply utility account.',
     '—','Marcus / Air Selangor',4],
    ['t35','p5','5.5','Set up cukai tanah (quit rent)',
     'Register with Pejabat Tanah. ~RM 50–100/month equivalent.',
     'RM 600–1,200 p.a.','Marcus / Pejabat Tanah',5],
    ['t36','p5','5.6','Set up cukai taksiran (assessment tax)',
     'Register with local council (MBPJ or MPSJ). ~RM 150–300/month equivalent.',
     'RM 1,800–3,600 p.a.','Marcus / MBPJ or MPSJ',6],
    ['t37','p5','5.7','Obtain houseowner / fire insurance',
     'Separate from MRTA. Required by bank. Annual premium.',
     'RM 1,800–3,000 p.a.','Marcus / Insurer',7],
    ['t38','p5','5.8','Change all locks and access credentials',
     'Replace all locks, gate remotes, and any access control upon handover.',
     'RM 500–2,000','Marcus / Locksmith',8],
    ['t39','p5','5.9','Move-in defect inspection',
     'Post-renovation inspection to sign off on contractor work before moving in.',
     'RM 500–1,000','Inspector',9],
  ];

  const insertMany = db.transaction((tasks) => {
    for (const t of tasks) insertTask.run(...t);
  });
  insertMany(seeds);
}

module.exports = db;
