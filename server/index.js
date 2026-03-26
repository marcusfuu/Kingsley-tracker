const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded design assets
const uploadsDir = path.join(__dirname, '../data/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const PORT = process.env.PORT || 3000;
const PIN  = process.env.APP_PIN || 'changeme';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token !== PIN) return res.status(401).json({ error: 'Invalid PIN' });
  next();
}

// ─── PIN check ────────────────────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  const { pin } = req.body || {};
  if (pin === PIN) return res.json({ ok: true });
  res.status(401).json({ error: 'Invalid PIN' });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get('/api/settings', auth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  res.json({ settings: s });
});

app.put('/api/settings', auth, (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const save = db.transaction(pairs => {
    for (const [k, v] of pairs) stmt.run(k, String(v));
  });
  save(Object.entries(req.body));
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  res.json({ settings: s });
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
app.get('/api/tasks', auth, (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY phase, sort_order, id').all();
  res.json({ tasks });
});

app.post('/api/tasks', auth, (req, res) => {
  const { phase, num, name, detail, est_cost, owner } = req.body;
  if (!phase || !name) return res.status(400).json({ error: 'phase and name required' });
  const id = uid();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM tasks WHERE phase=?').get(phase).m;
  db.prepare(
    `INSERT INTO tasks (id,phase,num,name,detail,est_cost,status,due_date,owner,notes,sort_order)
     VALUES (?,?,?,?,?,?,'Not Started','',?,?,?)`
  ).run(id, phase, num||'', name, detail||'', est_cost||'—', owner||'', '', maxOrder+1);
  res.json({ task: db.prepare('SELECT * FROM tasks WHERE id=?').get(id) });
});

app.put('/api/tasks/:id', auth, (req, res) => {
  const allowed = ['phase','num','name','detail','est_cost','owner','status','due_date','notes'];
  const fields = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No fields' });
  const sets = Object.keys(fields).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE tasks SET ${sets} WHERE id=?`).run(...Object.values(fields), req.params.id);
  res.json({ task: db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) });
});

app.delete('/api/tasks/:id', auth, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Inventory ────────────────────────────────────────────────────────────────
app.get('/api/inventory', auth, (req, res) => {
  const items = db.prepare('SELECT * FROM inventory ORDER BY category, created_at').all();
  res.json({ items });
});

app.post('/api/inventory', auth, (req, res) => {
  const { category, name, qty, unit, unit_price, supplier, status, notes } = req.body;
  if (!category || !name) return res.status(400).json({ error: 'category and name required' });
  const id = uid();
  db.prepare(
    `INSERT INTO inventory (id,category,name,qty,unit,unit_price,supplier,status,notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, category, name, qty||1, unit||'unit', unit_price||0, supplier||'', status||'To Procure', notes||'');
  // Auto-mirror to shortlist as Confirmed
  const slId = uid();
  db.prepare(
    `INSERT INTO shortlist (id,category,name,brand,link,price,qty,area,priority,status,notes,added_by,inventory_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`
  ).run(slId, category, name, supplier||'', '', unit_price||0, qty||1, '', 'Medium', 'Confirmed', notes||'', '', id);
  const item = db.prepare('SELECT * FROM inventory WHERE id=?').get(id);
  const slItem = db.prepare('SELECT * FROM shortlist WHERE id=?').get(slId);
  res.json({ item, slItem });
});

app.put('/api/inventory/:id', auth, (req, res) => {
  const allowed = ['category','name','qty','unit','unit_price','supplier','status','notes'];
  const fields = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No fields' });
  const sets = Object.keys(fields).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE inventory SET ${sets} WHERE id=?`).run(...Object.values(fields), req.params.id);
  res.json({ item: db.prepare('SELECT * FROM inventory WHERE id=?').get(req.params.id) });
});

app.delete('/api/inventory/:id', auth, (req, res) => {
  // Unlink any shortlist items that were confirmed from this inventory item
  db.prepare("UPDATE shortlist SET inventory_id=NULL, status='Shortlisted' WHERE inventory_id=?").run(req.params.id);
  db.prepare('DELETE FROM inventory WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Renovation Works ─────────────────────────────────────────────────────────
app.get('/api/reno', auth, (req, res) => {
  const works = db.prepare('SELECT * FROM reno_works ORDER BY area, created_at').all();
  // Attach assigned contact names to each work item (for table display)
  const contactQ = db.prepare(
    `SELECT c.id, c.name, c.role, c.avatar_color FROM contacts c
     JOIN reno_contacts rc ON rc.contact_id = c.id WHERE rc.reno_id = ?`
  );
  works.forEach(w => { w._contacts = contactQ.all(w.id); });
  res.json({ works });
});

app.post('/api/reno', auth, (req, res) => {
  const { area, description, tradesman, status, est_cost, actual_cost, start_date, end_date, notes } = req.body;
  if (!area || !description) return res.status(400).json({ error: 'area and description required' });
  const id = uid();
  db.prepare(
    `INSERT INTO reno_works (id,area,description,tradesman,status,est_cost,actual_cost,start_date,end_date,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, area, description, tradesman||'', status||'Not Started', est_cost||0, actual_cost||0,
        start_date||'', end_date||'', notes||'');
  res.json({ work: db.prepare('SELECT * FROM reno_works WHERE id=?').get(id) });
});

app.put('/api/reno/:id', auth, (req, res) => {
  const allowed = ['area','description','tradesman','status','est_cost','actual_cost','start_date','end_date','notes'];
  const fields = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No fields' });
  const sets = Object.keys(fields).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE reno_works SET ${sets} WHERE id=?`).run(...Object.values(fields), req.params.id);
  res.json({ work: db.prepare('SELECT * FROM reno_works WHERE id=?').get(req.params.id) });
});

app.delete('/api/reno/:id', auth, (req, res) => {
  db.prepare('DELETE FROM reno_works WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Shortlist ────────────────────────────────────────────────────────────────
app.get('/api/shortlist', auth, (req, res) => {
  const items = db.prepare('SELECT * FROM shortlist ORDER BY category, created_at').all();
  res.json({ items });
});

app.post('/api/shortlist', auth, (req, res) => {
  const { category, name, brand, link, price, qty, area, priority, status, notes, added_by } = req.body;
  if (!category || !name) return res.status(400).json({ error: 'category and name required' });
  const id = uid();
  db.prepare(
    `INSERT INTO shortlist (id,category,name,brand,link,price,qty,area,priority,status,notes,added_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, category, name, brand||'', link||'', price||0, qty||1, area||'', priority||'Medium', status||'Considering', notes||'', added_by||'');
  res.json({ item: db.prepare('SELECT * FROM shortlist WHERE id=?').get(id) });
});

app.put('/api/shortlist/:id', auth, (req, res) => {
  const allowed = ['category','name','brand','link','price','qty','area','priority','status','notes','added_by','inventory_id'];
  const fields = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No fields' });
  const sets = Object.keys(fields).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE shortlist SET ${sets} WHERE id=?`).run(...Object.values(fields), req.params.id);
  res.json({ item: db.prepare('SELECT * FROM shortlist WHERE id=?').get(req.params.id) });
});

app.delete('/api/shortlist/:id', auth, (req, res) => {
  db.prepare('DELETE FROM shortlist WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Promote a shortlist item → create an inventory entry and link back
app.post('/api/shortlist/:id/promote', auth, (req, res) => {
  const sl = db.prepare('SELECT * FROM shortlist WHERE id=?').get(req.params.id);
  if (!sl) return res.status(404).json({ error: 'Not found' });
  if (sl.inventory_id) return res.status(409).json({ error: 'Already confirmed to Inventory' });
  const invId = uid();
  db.prepare(
    `INSERT INTO inventory (id,category,name,qty,unit,unit_price,supplier,status,notes,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`
  ).run(invId, sl.category, sl.name, sl.qty||1, 'unit', sl.price||0, sl.brand||'', 'To Procure', sl.notes||'');
  db.prepare("UPDATE shortlist SET inventory_id=?, status='Confirmed' WHERE id=?").run(invId, sl.id);
  const invItem = db.prepare('SELECT * FROM inventory WHERE id=?').get(invId);
  const slItem  = db.prepare('SELECT * FROM shortlist WHERE id=?').get(sl.id);
  res.json({ invItem, slItem });
});

// ─── Scratchpad ───────────────────────────────────────────────────────────────
app.get('/api/scratchpad', auth, (req, res) => {
  const entries = db.prepare('SELECT * FROM scratchpad ORDER BY timestamp DESC LIMIT 200').all();
  const allRefs = db.prepare('SELECT * FROM scratchpad_refs').all();
  const allAtts = db.prepare("SELECT * FROM attachments WHERE entity_type='scratchpad'").all();
  const refMap  = {}, attMap = {};
  allRefs.forEach(r => { (refMap[r.scratch_id]  = refMap[r.scratch_id]  || []).push(r); });
  allAtts.forEach(a => { (attMap[a.entity_id]   = attMap[a.entity_id]   || []).push(a); });
  entries.forEach(e => { e.refs = refMap[e.id] || []; e.attachments = attMap[e.id] || []; });
  res.json({ entries });
});

app.post('/api/scratchpad', auth, (req, res) => {
  const { author, text, refs } = req.body;
  if (!author || !text) return res.status(400).json({ error: 'author and text required' });
  const id = uid();
  db.prepare("INSERT INTO scratchpad (id,author,text,timestamp) VALUES (?,?,?,datetime('now','localtime'))").run(id, author, text);
  // Detect @mentions and notify every mentioned user (dynamic)
  const allUsers = db.prepare('SELECT name FROM users').all().map(u => u.name);
  allUsers.filter(u => u.toLowerCase() !== author.toLowerCase()).forEach(other => {
    if (new RegExp('@' + other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
      db.prepare(`INSERT INTO notifications (id,recipient,sender,type,ref_id,excerpt,created_at)
        VALUES (?,?,?,'mention',?,?,datetime('now','localtime'))`)
        .run(uid(), other, author, id, text.slice(0, 120));
    }
  });
  // Store item references
  if (Array.isArray(refs)) {
    const ins = db.prepare('INSERT INTO scratchpad_refs (id,scratch_id,entity_type,entity_id,label) VALUES (?,?,?,?,?)');
    refs.forEach(r => ins.run(uid(), id, r.entity_type, r.entity_id, r.label || ''));
  }
  const entry = db.prepare('SELECT * FROM scratchpad WHERE id=?').get(id);
  entry.refs = db.prepare('SELECT * FROM scratchpad_refs WHERE scratch_id=?').all(id);
  entry.attachments = [];
  res.json({ entry });
});

app.delete('/api/scratchpad/:id', auth, (req, res) => {
  // Cascade: delete refs, delete attachment files
  const atts = db.prepare("SELECT * FROM attachments WHERE entity_type='scratchpad' AND entity_id=?").all(req.params.id);
  atts.forEach(a => { try { fs.unlinkSync(path.join(uploadsDir, a.filename)); } catch(e){} });
  db.prepare("DELETE FROM attachments WHERE entity_type='scratchpad' AND entity_id=?").run(req.params.id);
  db.prepare('DELETE FROM scratchpad_refs WHERE scratch_id=?').run(req.params.id);
  db.prepare('DELETE FROM scratchpad WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications', auth, (req, res) => {
  const { user } = req.query;
  if (!user) return res.status(400).json({ error: 'user required' });
  const notifications = db.prepare('SELECT * FROM notifications WHERE recipient=? ORDER BY created_at DESC LIMIT 50').all(user);
  res.json({ notifications });
});

app.put('/api/notifications/read-all', auth, (req, res) => {
  const { user } = req.body;
  db.prepare('UPDATE notifications SET is_read=1 WHERE recipient=?').run(user || '');
  res.json({ ok: true });
});

app.put('/api/notifications/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Attachments ──────────────────────────────────────────────────────────────
app.get('/api/attachments/:type/:id', auth, (req, res) => {
  const attachments = db.prepare('SELECT * FROM attachments WHERE entity_type=? AND entity_id=? ORDER BY created_at ASC').all(req.params.type, req.params.id);
  res.json({ attachments });
});

app.post('/api/attachments', auth, (req, res) => {
  const { entity_type, entity_id, filename, data, url, uploaded_by } = req.body;
  if (!entity_type || !entity_id) return res.status(400).json({ error: 'Missing fields' });
  let safe = null;
  let origName = filename || url || '';
  if (url) {
    // Remote URL — store reference only, no file write
    safe = '';
  } else if (data && filename) {
    safe = Date.now() + '-' + filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    fs.writeFileSync(path.join(uploadsDir, safe), Buffer.from(data, 'base64'));
  } else {
    return res.status(400).json({ error: 'Provide either data+filename or url' });
  }
  const id = uid();
  db.prepare('INSERT INTO attachments (id,entity_type,entity_id,filename,original_name,uploaded_by,url) VALUES (?,?,?,?,?,?,?)')
    .run(id, entity_type, entity_id, safe, origName, uploaded_by || '', url || null);
  res.json({ attachment: db.prepare('SELECT * FROM attachments WHERE id=?').get(id) });
});

app.delete('/api/attachments/:id', auth, (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
  if (att) {
    // Only try to delete local file (not URL-only attachments)
    if (att.filename && !att.url) {
      try { fs.unlinkSync(path.join(uploadsDir, att.filename)); } catch(e) {}
    }
    db.prepare('DELETE FROM attachments WHERE id=?').run(att.id);
  }
  res.json({ ok: true });
});

// ─── Users ────────────────────────────────────────────────────────────────────
app.get('/api/users', auth, (req, res) => {
  res.json({ users: db.prepare('SELECT name, protected FROM users ORDER BY name ASC').all() });
});

app.post('/api/users', auth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  try {
    db.prepare("INSERT INTO users (name, protected, created_at) VALUES (?, 0, datetime('now','localtime'))").run(name);
    res.json({ ok: true, user: { name, protected: 0 } });
  } catch(e) {
    res.status(409).json({ error: 'User already exists' });
  }
});

app.delete('/api/users/:name', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE name=?').get(req.params.name);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.protected) return res.status(403).json({ error: 'Cannot delete a protected user' });
  db.prepare('DELETE FROM users WHERE name=?').run(req.params.name);
  res.json({ ok: true });
});

// ─── Scratchpad refs ──────────────────────────────────────────────────────────
app.get('/api/scratchpad-refs/:scratchId', auth, (req, res) => {
  res.json({ refs: db.prepare('SELECT * FROM scratchpad_refs WHERE scratch_id=?').all(req.params.scratchId) });
});

// ─── What's New / Last Seen ───────────────────────────────────────────────────
app.get('/api/whats-new', auth, (req, res) => {
  const { user } = req.query;
  if (!user) return res.status(400).json({ error: 'user required' });
  const key = 'last_seen_' + user.toLowerCase();
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  const since = row ? row.value : null;
  if (!since) return res.json({ firstVisit: true, since: null, posts: [], activity: [], newItems: [] });

  const posts    = db.prepare("SELECT * FROM scratchpad WHERE timestamp>? ORDER BY timestamp DESC LIMIT 5").all(since);
  const activity = db.prepare("SELECT * FROM activity_log WHERE timestamp>? ORDER BY timestamp DESC LIMIT 15").all(since);
  const invNew   = db.prepare("SELECT 'inventory' as src, name FROM inventory WHERE created_at>? LIMIT 5").all(since);
  const renoNew  = db.prepare("SELECT 'reno' as src, description as name FROM reno_works WHERE created_at>? LIMIT 5").all(since);
  const slNew    = db.prepare("SELECT 'shortlist' as src, name FROM shortlist WHERE created_at>? LIMIT 5").all(since);

  res.json({ firstVisit: false, since, posts, activity, newItems: [...invNew, ...renoNew, ...slNew] });
});

app.put('/api/last-seen', auth, (req, res) => {
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: 'user required' });
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, datetime('now','localtime'))").run('last_seen_' + user.toLowerCase());
  res.json({ ok: true });
});

// ─── Activity Log ─────────────────────────────────────────────────────────────

app.get('/api/activity-counts', auth, (req, res) => {
  const rows = db.prepare(
    'SELECT entity_type, entity_id, COUNT(*) as count FROM activity_log GROUP BY entity_type, entity_id'
  ).all();
  const counts = {};
  rows.forEach(r => { counts[r.entity_type + ':' + r.entity_id] = r.count; });
  res.json({ counts });
});

app.get('/api/activity/:type', auth, (req, res) => {
  const entries = db.prepare(
    'SELECT * FROM activity_log WHERE entity_type=? ORDER BY timestamp DESC LIMIT 200'
  ).all(req.params.type);
  res.json({ entries });
});

app.get('/api/activity/:type/:id', auth, (req, res) => {
  const entries = db.prepare(
    'SELECT * FROM activity_log WHERE entity_type=? AND entity_id=? ORDER BY timestamp ASC'
  ).all(req.params.type, req.params.id);
  res.json({ entries });
});

app.post('/api/activity', auth, (req, res) => {
  const { entity_type, entity_id, author, text } = req.body;
  if (!entity_type || !entity_id || !author || !text)
    return res.status(400).json({ error: 'Missing fields' });
  const id = uid();
  db.prepare(
    `INSERT INTO activity_log (id,entity_type,entity_id,author,text,timestamp)
     VALUES (?,?,?,?,?,datetime('now','localtime'))`
  ).run(id, entity_type, entity_id, author, text);
  res.json({ entry: db.prepare('SELECT * FROM activity_log WHERE id=?').get(id) });
});

app.delete('/api/activity/:id', auth, (req, res) => {
  db.prepare('DELETE FROM activity_log WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Design Assets ────────────────────────────────────────────────────────────
app.get('/api/design', auth, (req, res) => {
  const assets = db.prepare('SELECT * FROM design_assets ORDER BY created_at DESC').all();
  res.json({ assets });
});

// Save a YouTube link as a design asset (no file write)
app.post('/api/design/video', auth, (req, res) => {
  const { url, label, uploaded_by } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const m = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  if (!m) return res.status(400).json({ error: 'Could not parse a YouTube video ID from that URL' });
  const videoId = m[1];
  const id = uid();
  db.prepare(
    `INSERT INTO design_assets (id,type,filename,original_name,label,section,uploaded_by,created_at)
     VALUES (?,?,?,?,?,?,?,datetime('now','localtime'))`
  ).run(id, 'video', videoId, url, label || url, 'general', uploaded_by || '');
  res.json({ asset: db.prepare('SELECT * FROM design_assets WHERE id=?').get(id) });
});

app.post('/api/design/upload', auth, (req, res) => {
  const { filename, data, type, label, section, uploaded_by } = req.body;
  if (!filename || !data || !type) return res.status(400).json({ error: 'Missing fields' });
  const safe = Date.now() + '-' + filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const dest = path.join(uploadsDir, safe);
  fs.writeFileSync(dest, Buffer.from(data, 'base64'));
  const id = uid();
  db.prepare(
    `INSERT INTO design_assets (id,type,filename,original_name,label,section,uploaded_by,created_at)
     VALUES (?,?,?,?,?,?,?,datetime('now','localtime'))`
  ).run(id, type, safe, filename, label || filename, section || 'general', uploaded_by || '');
  res.json({ asset: db.prepare('SELECT * FROM design_assets WHERE id=?').get(id) });
});

app.put('/api/design/:id', auth, (req, res) => {
  const allowed = ['label', 'section'];
  const fields = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No fields' });
  const sets = Object.keys(fields).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE design_assets SET ${sets} WHERE id=?`).run(...Object.values(fields), req.params.id);
  res.json({ asset: db.prepare('SELECT * FROM design_assets WHERE id=?').get(req.params.id) });
});

app.delete('/api/design/:id', auth, (req, res) => {
  const asset = db.prepare('SELECT * FROM design_assets WHERE id=?').get(req.params.id);
  if (asset) {
    // Video assets store only a YouTube ID — no local file to delete
    if (asset.type !== 'video') {
      const filePath = path.join(uploadsDir, asset.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.prepare('DELETE FROM design_assets WHERE id=?').run(req.params.id);
  }
  res.json({ ok: true });
});

// ─── Contacts ─────────────────────────────────────────────────────────────────
app.get('/api/contacts', auth, (req, res) => {
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE').all();
  res.json({ contacts });
});

app.post('/api/contacts', auth, (req, res) => {
  const { name, company, role, phone, email, notes, avatar_color } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uid();
  db.prepare(
    `INSERT INTO contacts (id, name, company, role, phone, email, notes, avatar_color)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, company||'', role||'', phone||'', email||'', notes||'', avatar_color||'#38bdf8');
  res.json({ contact: db.prepare('SELECT * FROM contacts WHERE id=?').get(id) });
});

app.put('/api/contacts/:id', auth, (req, res) => {
  const allowed = ['name','company','role','phone','email','notes','avatar_color'];
  const fields = {};
  for (const k of allowed) { if (req.body[k] !== undefined) fields[k] = req.body[k]; }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'no fields' });
  const sets = Object.keys(fields).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE contacts SET ${sets} WHERE id=?`).run(...Object.values(fields), req.params.id);
  res.json({ contact: db.prepare('SELECT * FROM contacts WHERE id=?').get(req.params.id) });
});

app.delete('/api/contacts/:id', auth, (req, res) => {
  db.prepare('DELETE FROM reno_contacts WHERE contact_id=?').run(req.params.id);
  db.prepare('DELETE FROM contacts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Reno ↔ Contact assignments
app.get('/api/reno-contacts/:renoId', auth, (req, res) => {
  const rows = db.prepare(
    `SELECT c.* FROM contacts c
     JOIN reno_contacts rc ON rc.contact_id = c.id
     WHERE rc.reno_id = ? ORDER BY c.name COLLATE NOCASE`
  ).all(req.params.renoId);
  res.json({ contacts: rows });
});

app.post('/api/reno-contacts', auth, (req, res) => {
  const { reno_id, contact_id } = req.body;
  if (!reno_id || !contact_id) return res.status(400).json({ error: 'reno_id and contact_id required' });
  const id = uid();
  try {
    db.prepare('INSERT INTO reno_contacts (id, reno_id, contact_id) VALUES (?, ?, ?)').run(id, reno_id, contact_id);
  } catch(e) { /* already assigned — ignore UNIQUE conflict */ }
  res.json({ ok: true });
});

app.delete('/api/reno-contacts/:renoId/:contactId', auth, (req, res) => {
  db.prepare('DELETE FROM reno_contacts WHERE reno_id=? AND contact_id=?').run(req.params.renoId, req.params.contactId);
  res.json({ ok: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Kingsley App running on port ${PORT}`));
