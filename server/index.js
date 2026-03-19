const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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
  const allowed = ['status','notes','due_date','owner','name','detail','est_cost'];
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
  res.json({ item: db.prepare('SELECT * FROM inventory WHERE id=?').get(id) });
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
  db.prepare('DELETE FROM inventory WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Renovation Works ─────────────────────────────────────────────────────────
app.get('/api/reno', auth, (req, res) => {
  const works = db.prepare('SELECT * FROM reno_works ORDER BY area, created_at').all();
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

// ─── Scratchpad ───────────────────────────────────────────────────────────────
app.get('/api/scratchpad', auth, (req, res) => {
  const entries = db.prepare('SELECT * FROM scratchpad ORDER BY timestamp DESC LIMIT 200').all();
  res.json({ entries });
});

app.post('/api/scratchpad', auth, (req, res) => {
  const { author, text } = req.body;
  if (!author || !text) return res.status(400).json({ error: 'author and text required' });
  const id = uid();
  db.prepare('INSERT INTO scratchpad (id,author,text,timestamp) VALUES (?,?,?,datetime("now","localtime"))').run(id, author, text);
  res.json({ entry: db.prepare('SELECT * FROM scratchpad WHERE id=?').get(id) });
});

app.delete('/api/scratchpad/:id', auth, (req, res) => {
  db.prepare('DELETE FROM scratchpad WHERE id=?').run(req.params.id);
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

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Kingsley App running on port ${PORT}`));
