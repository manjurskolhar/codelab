#!/usr/bin/env node
/*
 * CodeLab — ICD-10 Coding Practicum website
 * Zero-dependency server: Node.js 22.13+ (uses built-in node:sqlite).
 *   node server.js            start on PORT (default 8080)
 *   node server.js --reset-password admin@example.edu   print a new temporary password for that user
 *   node server.js --create-owner you@example.com Name   create the owner account (manages colleges and plans)
 */
'use strict';
process.removeAllListeners('warning'); // hide the node:sqlite experimental notice
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA = process.env.CODELAB_DATA || path.join(ROOT, 'data');
const FILES = path.join(DATA, 'files');
const PORT = +process.env.PORT || 8080;
const SECURE_COOKIE = process.env.COOKIE_SECURE === '1';
const MAX_UPLOAD = 20 * 1024 * 1024;
const SESSION_DAYS = 7;
const ALLOWED_EXT = ['docx', 'pdf', 'xlsx', 'pptx', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'zip'];
fs.mkdirSync(FILES, { recursive: true });

/* ------------------------------------------------------------------ database */
/* One database holds many colleges ("orgs"). Every user, record, setting and uploaded file belongs to one
   college; the owner account (org_id NULL) manages colleges and plans. Built-in Word documents are shared
   (files.org = ''). */
const db = new DatabaseSync(path.join(DATA, 'codelab.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS orgs(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', max_students INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, contact TEXT DEFAULT '', notes TEXT DEFAULT '', created_at INTEGER);
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','faculty','student','guest')), section TEXT DEFAULT '',
  pw TEXT NOT NULL, must_change INTEGER DEFAULT 1, active INTEGER DEFAULT 1,
  created_by TEXT, created_at INTEGER, expires_at INTEGER, org_id TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER);
CREATE TABLE IF NOT EXISTS records(org TEXT NOT NULL DEFAULT '', kind TEXT, id TEXT, data TEXT NOT NULL, updated_at INTEGER, PRIMARY KEY(org,kind,id));
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, name TEXT, size INTEGER, kind TEXT, owner TEXT, for_user TEXT, path TEXT, created_at INTEGER, org TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS submissions(assignment_id TEXT, student_id TEXT, data TEXT, PRIMARY KEY(assignment_id, student_id));
CREATE TABLE IF NOT EXISTS grades(assignment_id TEXT, student_id TEXT, data TEXT, PRIMARY KEY(assignment_id, student_id));
CREATE TABLE IF NOT EXISTS abstracts(assignment_id TEXT, student_id TEXT, data TEXT, PRIMARY KEY(assignment_id, student_id));`);
const q = (sql) => db.prepare(sql);
const cols = (t) => q(`PRAGMA table_info(${t})`).all().map(c => c.name);
const uid = (p = '') => p + crypto.randomBytes(8).toString('hex');
const now = () => Date.now();
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const RESERVED = ['api', 'ehr', 'codes', 'join', 'register', 'online-program', 'c', 'owner', 'admin', 'static', 'www', 'login', 'files'];

/* ---- upgrade a single-college database (earlier versions) to the multi-college layout ---- */
(function migrate() {
  const hasOrgCol = cols('users').includes('org_id');
  const recHasOrg = cols('records').includes('org');
  if (hasOrgCol && recHasOrg && cols('files').includes('org')) return;
  db.exec('PRAGMA foreign_keys=OFF'); db.exec('BEGIN');
  try {
    if (!hasOrgCol) {
      const old = cols('users');
      db.exec(`CREATE TABLE users_new(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        role TEXT NOT NULL CHECK(role IN ('owner','admin','faculty','student','guest')), section TEXT DEFAULT '',
        pw TEXT NOT NULL, must_change INTEGER DEFAULT 1, active INTEGER DEFAULT 1, created_by TEXT, created_at INTEGER, expires_at INTEGER, org_id TEXT)`);
      db.exec(`INSERT INTO users_new(id,name,email,role,section,pw,must_change,active,created_by,created_at${old.includes('expires_at') ? ',expires_at' : ''})
        SELECT id,name,email,role,section,pw,must_change,active,created_by,created_at${old.includes('expires_at') ? ',expires_at' : ''} FROM users`);
      db.exec('DROP TABLE users; ALTER TABLE users_new RENAME TO users');
    }
    let orgId = null;
    if (q("SELECT COUNT(*) n FROM users WHERE role!='owner'").get().n > 0 && q('SELECT COUNT(*) n FROM orgs').get().n === 0) {
      let site = {}; try { const r = recHasOrg ? null : q("SELECT data FROM records WHERE kind='settings' AND id='site'").get(); if (r) site = JSON.parse(r.data); } catch {}
      const name = (site.institution || site.siteName || 'My college').slice(0, 90);
      let slug = slugify(site.institution || site.siteName) || 'main'; if (RESERVED.includes(slug)) slug = 'main';
      orgId = uid('o');
      q('INSERT INTO orgs(id,slug,name,status,max_students,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run(orgId, slug, name, 'active', 0, null, now());
      q("UPDATE users SET org_id=? WHERE role!='owner' AND org_id IS NULL").run(orgId);
      console.log(`Upgraded to multi-college: your existing site is now the college "${name}" (address /c/${slug}).`);
    }
    if (!recHasOrg) {
      db.exec(`CREATE TABLE records_new(org TEXT NOT NULL DEFAULT '', kind TEXT, id TEXT, data TEXT NOT NULL, updated_at INTEGER, PRIMARY KEY(org,kind,id))`);
      if (orgId) q('INSERT INTO records_new(org,kind,id,data,updated_at) SELECT ?,kind,id,data,updated_at FROM records').run(orgId);
      db.exec('DROP TABLE records; ALTER TABLE records_new RENAME TO records');
    }
    if (!cols('files').includes('org')) {
      db.exec("ALTER TABLE files ADD COLUMN org TEXT NOT NULL DEFAULT ''");
      if (orgId) q("UPDATE files SET org=? WHERE owner!='seed'").run(orgId);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys=ON'); }
})();

if (!cols('users').includes('team')) db.exec("ALTER TABLE users ADD COLUMN team TEXT DEFAULT ''");
if (!cols('users').includes('access')) db.exec("ALTER TABLE users ADD COLUMN access TEXT DEFAULT ''"); /* online program learners: pending | approved | rejected */

/* passwords: scrypt */
function hashPw(pw) { const salt = crypto.randomBytes(16); const h = crypto.scryptSync(pw, salt, 32); return `s1$${salt.toString('hex')}$${h.toString('hex')}`; }
function checkPw(pw, stored) {
  const [v, s, h] = String(stored).split('$'); if (v !== 's1') return false;
  const got = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32); const want = Buffer.from(h, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function tempPassword() { const w = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; const b = crypto.randomBytes(10); for (const x of b) s += w[x % w.length]; return s; }
const pwOk = (pw) => typeof pw === 'string' && pw.length >= 8;

/* records helpers (always scoped to one college: org '' is the platform itself) */
const getRecs = (org, kind) => Object.fromEntries(q('SELECT id,data FROM records WHERE org=? AND kind=?').all(org, kind).map(r => [r.id, JSON.parse(r.data)]));
const getRec = (org, kind, id) => { const r = q('SELECT data FROM records WHERE org=? AND kind=? AND id=?').get(org, kind, id); return r ? JSON.parse(r.data) : null; };
const putRec = (org, kind, id, data) => q('INSERT INTO records(org,kind,id,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(org,kind,id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').run(org, kind, id, JSON.stringify(data), now());
const delRec = (org, kind, id) => q('DELETE FROM records WHERE org=? AND kind=? AND id=?').run(org, kind, id);
const getOrg = (id) => id ? q('SELECT * FROM orgs WHERE id=?').get(id) : null;
const orgExpired = (o) => !!(o && o.expires_at && o.expires_at <= now());

/* ------------------------------------------------------------------ built-in content */
const SEED = path.join(ROOT, 'seed');
const loadSeed = () => JSON.parse(fs.readFileSync(path.join(SEED, 'seed.json'), 'utf8'));
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(k2 => [k2, x[k2]])) : x);
const fileHash = (p) => { try { return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); } catch { return ''; } };
/* built-in Word documents are shared by every college and kept identical to the packaged version */
function syncSeedFiles() {
  if (!fs.existsSync(path.join(SEED, 'seed.json'))) return;
  const man = loadSeed(); let added = 0, updated = 0;
  for (const f of man.files) {
    const src = path.join(SEED, 'docs', f.file), dest = path.join(FILES, f.id), row = q('SELECT * FROM files WHERE id=?').get(f.id);
    if (!row) { fs.copyFileSync(src, dest); q("INSERT INTO files(id,name,size,kind,owner,for_user,path,created_at,org) VALUES(?,?,?,?,?,?,?,?,'')").run(f.id, f.name, fs.statSync(dest).size, f.kind, 'seed', null, f.id, now()); added++; continue; }
    const cur = path.join(FILES, path.basename(row.path));
    if (row.owner === 'seed' && (fileHash(cur) !== fileHash(src) || row.name !== f.name)) { fs.copyFileSync(src, cur); q("UPDATE files SET name=?, size=?, org='' WHERE id=?").run(f.name, fs.statSync(cur).size, f.id); updated++; }
  }
  if (updated) { /* keep document names and sizes on existing assignments in step */
    const meta = Object.fromEntries(man.files.map(f => [f.id, f]));
    for (const r of q("SELECT org,id,data FROM records WHERE kind='assignments'").all()) { const a = JSON.parse(r.data); let ch = false;
      for (const k of ['docs', 'keyDocs']) (a[k] || []).forEach(d => { if (meta[d.fid]) { const row = q('SELECT size FROM files WHERE id=?').get(d.fid); if (d.name !== meta[d.fid].name || d.size !== row?.size) { d.name = meta[d.fid].name; d.size = row?.size ?? d.size; ch = true; } } });
      if (ch) putRec(r.org, 'assignments', r.id, a); }
  }
  if (added || updated) console.log(`Built-in documents: ${added} added, ${updated} updated.`);
}
/* each college gets its own copy of the built-in EHR records and activities (so its faculty can edit them) */
function seedOrg(org) {
  if (!fs.existsSync(path.join(SEED, 'seed.json'))) return { patients: 0, library: 0 };
  const man = loadSeed();
  const fresh = q("SELECT COUNT(*) n FROM records WHERE org=? AND kind IN ('patients','library')").get(org).n === 0;
  let seen = getRec(org, 'meta', 'seeded');
  if (!seen) seen = fresh ? { patients: [], library: [] } : { patients: Object.keys(getRecs(org, 'patients')), library: Object.keys(getRecs(org, 'library')) };
  const n = { patients: 0, library: 0 };
  for (const [kind, items] of [['patients', man.patients], ['library', man.library]]) for (const [id, v] of Object.entries(items)) {
    if (seen[kind].includes(id)) continue;
    if (!getRec(org, kind, id)) { putRec(org, kind, id, v); n[kind]++; }
    seen[kind].push(id);
  }
  putRec(org, 'meta', 'seeded', seen);
  return n;
}
function contentStatus(org) {
  const man = loadSeed(); const out = { patients: [], library: [], missing: 0 };
  const strip = (o) => { const c = { ...o }; delete c.updatedAt; delete c.order; return c; };
  for (const [kind, items] of [['patients', man.patients], ['library', man.library]]) for (const [id, v] of Object.entries(items)) {
    const cur = getRec(org, kind, id); if (!cur) { out.missing++; continue; }
    if (canon(strip(cur)) !== canon(strip(v))) out[kind].push(id);
  }
  return { man, out };
}
function refreshOrg(org) {
  const { man, out } = contentStatus(org);
  for (const id of out.patients) putRec(org, 'patients', id, man.patients[id]);
  for (const id of out.library) { const cur = getRec(org, 'library', id) || {}; putRec(org, 'library', id, { ...man.library[id], order: cur.order ?? man.library[id].order }); }
  seedOrg(org);
  return { patients: out.patients.length, library: out.library.length };
}
syncSeedFiles();
for (const o of q('SELECT id FROM orgs').all()) { const n = seedOrg(o.id); if (n.patients || n.library) console.log(`Added new built-in content to ${getOrg(o.id).name}: ${n.patients} EHR records, ${n.library} activities.`); }

/* ------------------------------------------------------------------ CLI */
if (process.argv[2] === '--reset-password') {
  const u = q('SELECT * FROM users WHERE email=?').get(process.argv[3] || '');
  if (!u) { console.error('No user with that email.'); process.exit(1); }
  const t = tempPassword(); q('UPDATE users SET pw=?, must_change=1, active=1 WHERE id=?').run(hashPw(t), u.id);
  q('DELETE FROM sessions WHERE user_id=?').run(u.id);
  console.log(`Temporary password for ${u.email}: ${t}\nThey will be asked to change it at sign-in.`); process.exit(0);
}
if (process.argv[2] === '--demo') {
  /* demo accounts with known passwords, for trying CodeLab out (change or delete them before real use) */
  const DEMO = [['owner', 'CodeLab Owner', 'owner@codelab.local', 'Owner@2026'], ['admin', 'Demo Admin', 'admin@codelab.local', 'Admin@2026'],
    ['faculty', 'Demo Faculty', 'faculty@codelab.local', 'Faculty@2026'], ['student', 'Demo Student', 'student@codelab.local', 'Student@2026']];
  let org = q("SELECT * FROM orgs WHERE slug='demo'").get();
  if (!org) {
    const id = uid('o');
    q('INSERT INTO orgs(id,slug,name,status,max_students,expires_at,contact,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, 'demo', 'Demo College', 'active', 0, null, '', 'Created by --demo', now());
    putRec(id, 'settings', 'site', { theme: 'navy', custom: {}, siteName: 'CodeLab', institution: 'Demo College', logo: '', showName: true, logoTile: true, topbarHeight: 60, stripeWidth: 3, updatedAt: now() });
    seedOrg(id); org = getOrg(id);
  }

  /* demo online certificate program: independent learners register, pay, get approved, complete practicals, get a certificate */
  let on = q("SELECT * FROM orgs WHERE slug='online'").get();
  if (!on) {
    const id = uid('o');
    q('INSERT INTO orgs(id,slug,name,status,max_students,expires_at,contact,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, 'online', 'CodeLab Online Academy', 'active', 0, null, '', 'Created by --demo', now());
    putRec(id, 'settings', 'site', { theme: 'teal', custom: {}, siteName: 'CodeLab', institution: 'CodeLab Online Academy', logo: '', showName: true, logoTile: true, topbarHeight: 60, stripeWidth: 3, updatedAt: now() });
    putRec(id, 'settings', 'program', { enabled: true, open: true, title: 'ICD-10 Coding Practicum Certificate', fee: '10', currency: 'USD', passMark: 70,
      summary: 'Complete hands-on ICD-10 coding practicals in a hospital-style EHR and earn a certificate of completion.',
      instructions: 'Pay the registration fee of 10 USD by bank transfer to: CodeLab Academy, IBAN SA00 0000 0000 0000 0000 0000 (demo details, replace with your own). Use your email address as the payment reference. Then upload a photo or PDF of the receipt below. Your practicals open when we confirm your payment, usually within 1 working day.',
      link: '', certNote: 'Certificates are issued after every course practical is passed. You will be able to download your certificate here.' });
    seedOrg(id); on = getOrg(id);
  }
  DEMO.push(['admin', 'Program Admin', 'program@codelab.local', 'Program@2026', on.id], ['student', 'Demo Learner', 'learner@codelab.local', 'Learner@2026', on.id]);
  for (const [role, name, email, pw, orgId] of DEMO) {
    const ex = q('SELECT id FROM users WHERE email=?').get(email); const target = role === 'owner' ? null : (orgId || org.id); const learner = orgId && role === 'student';
    if (ex) q('UPDATE users SET pw=?, must_change=0, active=1 WHERE id=?').run(hashPw(pw), ex.id);
    else { const nid = uid('u'); q("INSERT INTO users(id,name,email,role,section,pw,must_change,active,created_by,created_at,expires_at,org_id,access) VALUES(?,?,?,?,?,?,0,1,NULL,?,NULL,?,?)")
      .run(nid, name, email, role, role === 'student' ? (learner ? 'Online' : 'A') : '', hashPw(pw), now(), target, learner ? 'pending' : '');
      if (learner) putRec(target, 'learner', nid, { phone: '', country: 'Saudi Arabia', registeredAt: now() }); }
  }
  /* the demo program's course: six practicals, self-paced (no due date) */
  if (!Object.keys(getRecs(on.id, 'assignments')).length) {
    const admin = q("SELECT id FROM users WHERE email='program@codelab.local'").get(); const lib = getRecs(on.id, 'library');
    ['or1', 'or2', 'f1', 'f2', 'c1', 'c3'].forEach((k, i) => { const t = lib[k]; if (!t) return;
      putRec(on.id, 'assignments', 'a' + uid(), { title: t.title, category: t.group || '', description: t.description || '', instructions: t.instructions || '', docs: t.docs, keyDocs: t.keyDocs || [], ehr: t.ehr, points: t.points || 100, due: '', target: 'all', templateId: k, createdAt: now() + i, createdBy: admin?.id }); });
  }
  console.log('Demo accounts ready (sign in at http://localhost:' + PORT + '/c/demo, or http://localhost:' + PORT + '/ for the owner):');
  for (const [role, , email, pw, o] of DEMO) console.log(`  ${(o ? (role === 'admin' ? 'program admin' : 'learner') : role).padEnd(14)} ${email.padEnd(24)} ${pw}`);
  console.log('Online program: register at http://localhost:' + PORT + '/register, staff sign in at http://localhost:' + PORT + '/c/online');
  console.log('Change these passwords (My account) or remove the accounts before real use.');
  process.exit(0);
}
if (process.argv[2] === '--create-owner') {
  const email = String(process.argv[3] || '').trim().toLowerCase(), name = process.argv.slice(4).join(' ') || 'CodeLab owner';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Usage: node server.js --create-owner you@example.com Your Name'); process.exit(1); }
  if (q('SELECT 1 FROM users WHERE email=?').get(email)) { console.error('That email already has an account. Use a different email for the owner.'); process.exit(1); }
  const t = tempPassword();
  q("INSERT INTO users(id,name,email,role,section,pw,must_change,active,created_by,created_at,org_id) VALUES(?,?,?,'owner','',?,1,1,NULL,?,NULL)").run(uid('u'), name, email, hashPw(t), now());
  console.log(`Owner account created for ${email}. Temporary password: ${t}\nSign in at the site address; you will be asked to choose a new password.`); process.exit(0);
}

/* ------------------------------------------------------------------ http helpers */
const zlib = require('node:zlib');
const MIME = { '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const FMIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'",
};
function send(res, code, body, headers = {}) { res.writeHead(code, { ...SEC, ...headers }); res.end(body); }
function json(res, code, obj) { send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); }
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new HttpError(code, msg); };
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new HttpError(413, 'File is too large (limit 20 MB).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
async function readJson(req) { const b = await readBody(req, 2 * 1024 * 1024); try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch { fail(400, 'Invalid request.'); } }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(a => a[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])); }
function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex'); const u = q('SELECT expires_at FROM users WHERE id=?').get(userId);
  const until = Math.min(now() + SESSION_DAYS * 864e5, u?.expires_at || Infinity);
  q('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(token, userId, until);
  res.setHeader('Set-Cookie', `cdl_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(1, Math.floor((until - now()) / 1000))}${SECURE_COOKIE ? '; Secure' : ''}`);
}
const expired = (u) => !!(u.expires_at && u.expires_at <= now());
const DAY = 864e5;
const fmtDay = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function currentUser(req) {
  const t = cookies(req).cdl_session; if (!t) return null;
  const s = q('SELECT * FROM sessions WHERE token=?').get(t); if (!s || s.expires < now()) return null;
  const u = q('SELECT * FROM users WHERE id=?').get(s.user_id); if (!u || !u.active || expired(u)) return null;
  if (u.role !== 'owner') { const o = getOrg(u.org_id); if (!o || o.status !== 'active') return null; }
  return u;
}
const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, section: u.section || '', team: u.team || '', access: u.access || '', active: !!u.active, mustChange: !!u.must_change, createdBy: u.created_by, createdAt: u.created_at, expiresAt: u.expires_at || null });
const isStaff = (u) => u && (u.role === 'admin' || u.role === 'faculty');
const need = (u, ...roles) => { if (!u) fail(401, 'Please sign in.'); if (roles.length && !roles.includes(u.role)) fail(403, 'You do not have permission to do that.'); if (u.must_change && roles.length) fail(403, 'Change your temporary password first.'); };
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const sameOrg = (u, id) => { const t = q('SELECT * FROM users WHERE id=?').get(id); return t && t.org_id === u.org_id ? t : null; };
/* students in the same team (same college, same non-empty team name), including the student */
const teammates = (u) => u.team ? q("SELECT * FROM users WHERE org_id=? AND role='student' AND active=1 AND team=?").all(u.org_id, u.team) : [u];
const sameTeam = (u, otherId) => { if (!u.team || !otherId) return false; const o = q('SELECT org_id, team FROM users WHERE id=?').get(otherId); return !!o && o.org_id === u.org_id && o.team === u.team; };
const activeStudents = (org) => q("SELECT COUNT(*) n FROM users WHERE org_id=? AND role='student' AND active=1").get(org).n;
function seatCheck(org, adding = 1) {
  const o = getOrg(org); if (!o || !o.max_students) return;
  if (activeStudents(org) + adding > o.max_students) fail(403, `Your plan allows ${o.max_students} active students. Deactivate students who have left, or ask the CodeLab provider to raise the limit.`);
}

/* login throttle */
const attempts = new Map();
function throttle(key, limit = 10) { const a = attempts.get(key) || { n: 0, t: now() }; if (now() - a.t > 15 * 60e3) { a.n = 0; a.t = now(); } a.n++; attempts.set(key, a); if (a.n > limit) fail(429, 'Too many sign-in attempts. Try again in 15 minutes.'); }

/* ------------------------------------------------------------------ visibility */
/* ---- online certificate program (independent learners register and pay; staff approve, grade and certify) ---- */
const PROGRAM_DEFAULT = { enabled: true, open: true, title: 'ICD-10 Coding Practicum Certificate', fee: '10', currency: 'USD', passMark: 70,
  summary: 'Complete hands-on ICD-10 coding practicals in a hospital-style EHR and earn a certificate of completion.',
  instructions: 'Pay the registration fee using the payment method below, then upload a photo or PDF of your receipt. Your access opens when we confirm your payment (usually within 1 working day).',
  link: '', certNote: 'Certificates are issued after every course practical is passed. You will be able to download your certificate here.' };
const programOf = (org) => { const p = org && getRec(org, 'settings', 'program'); return p && p.enabled ? { ...PROGRAM_DEFAULT, ...p } : null; };
const blocked = (u) => u.role === 'student' && (u.access === 'pending' || u.access === 'rejected');
function openProgram() {
  for (const o of q("SELECT * FROM orgs WHERE status='active' ORDER BY created_at").all()) { const pr = programOf(o.id); if (pr && pr.open && !orgExpired(o)) return { o, pr }; }
  return null;
}
function visibleAssignments(u) {
  if (blocked(u)) return {};
  const all = getRecs(u.org_id, 'assignments');
  if (isStaff(u)) return all;
  return Object.fromEntries(Object.entries(all).filter(([, a]) => a.target === 'all' || a.target === u.section).map(([id, a]) => { const c = { ...a }; delete c.keyDocs; return [id, c]; }));
}
function orgInfo(o) {
  return o && { id: o.id, slug: o.slug, name: o.name, status: o.status, maxStudents: o.max_students || 0, expiresAt: o.expires_at || null,
    readOnly: orgExpired(o), students: activeStudents(o.id) };
}
function bootstrap(u) {
  if (u.role === 'owner') return { me: pub(u), owner: true, orgs: ownerOrgs(), patients: {}, assignments: {}, faculty: {}, students: {}, library: {}, work: {}, grades: {} };
  const org = u.org_id;
  const out = { me: pub(u), org: orgInfo(getOrg(org)), patients: blocked(u) ? {} : getRecs(org, 'patients'), assignments: visibleAssignments(u), faculty: {}, students: {}, library: {}, work: {}, grades: {} };
  const pr = programOf(org); if (pr) { out.program = pr; if (isStaff(u)) out.learners = getRecs(org, 'learner'); else if (u.role === 'student') out.learner = getRec(org, 'learner', u.id) || {}; }
  if (isStaff(u)) {
    for (const x of q("SELECT * FROM users WHERE org_id=? AND role IN ('faculty','admin')").all(org)) out.faculty[x.id] = pub(x);
    for (const x of q("SELECT * FROM users WHERE org_id=? AND role='student'").all(org)) out.students[x.id] = pub(x);
    out.joincodes = getRecs(org, 'joincodes');
    if (u.role === 'admin') { out.guests = {}; for (const x of q("SELECT * FROM users WHERE org_id=? AND role='guest'").all(org)) out.guests[x.id] = pub(x); }
    out.library = getRecs(org, 'library');
    for (const r of q('SELECT s.* FROM submissions s JOIN users x ON x.id=s.student_id WHERE x.org_id=?').all(org)) (out.work[r.student_id] ||= {})[r.assignment_id] = JSON.parse(r.data);
    for (const r of q('SELECT g.* FROM grades g JOIN users x ON x.id=g.student_id WHERE x.org_id=?').all(org)) (out.grades[r.student_id] ||= {})[r.assignment_id] = JSON.parse(r.data);
    out.abstracts = {}; for (const r of q('SELECT a.* FROM abstracts a JOIN users x ON x.id=a.student_id WHERE x.org_id=?').all(org)) (out.abstracts[r.student_id] ||= {})[r.assignment_id] = JSON.parse(r.data);
  } else if (u.role === 'guest') {
    out.assignments = {};
    out.library = Object.fromEntries(Object.entries(getRecs(org, 'library')).map(([id, t]) => { const c = { ...t }; delete c.keyDocs; return [id, c]; }));
  } else {
    out.students[u.id] = pub(u);
    out.team = u.team ? teammates(u).map(x => ({ id: x.id, name: x.name })) : [];
    for (const r of q('SELECT * FROM submissions WHERE student_id=?').all(u.id)) (out.work[u.id] ||= {})[r.assignment_id] = JSON.parse(r.data);
    for (const r of q('SELECT * FROM grades WHERE student_id=?').all(u.id)) (out.grades[u.id] ||= {})[r.assignment_id] = JSON.parse(r.data);
    out.abstracts = { [u.id]: {} }; for (const r of q('SELECT * FROM abstracts WHERE student_id=?').all(u.id)) out.abstracts[u.id][r.assignment_id] = JSON.parse(r.data);
  }
  return out;
}
function canReadFile(u, f) {
  if (!u || u.role === 'owner') return false;
  if (f.org && f.org !== u.org_id) return false;          // another college's upload
  if (isStaff(u)) return true;
  if (f.kind === 'activity') return true;
  if (f.kind === 'submission' || f.kind === 'marked') return f.for_user === u.id || sameTeam(u, f.for_user);
  if (f.kind === 'receipt' || f.kind === 'certificate') return f.for_user === u.id;
  return false; // answer keys
}

/* ------------------------------------------------------------------ users */
function createUser(actor, { name, email, role, section, days, team }, org = actor.org_id) {
  name = String(name || '').trim(); email = cleanEmail(email); section = String(section || '').trim(); team = String(team || '').trim().slice(0, 40);
  if (!name) fail(400, 'Enter a name.');
  if (!validEmail(email)) fail(400, `"${email}" is not a valid email address.`);
  if (actor.role !== 'owner') {
    if (role === 'faculty' && actor.role !== 'admin') fail(403, 'Only the admin can add faculty.');
    if (role === 'guest' && actor.role !== 'admin') fail(403, 'Only the admin can add guest accounts.');
    if (!['faculty', 'student', 'guest'].includes(role)) fail(400, 'Role must be faculty, student or guest.');
  } else if (role !== 'admin') fail(400, 'The owner creates college admin accounts only.');
  let expiresAt = null;
  if (role === 'guest') { days = Math.round(+days || 7); if (days < 1 || days > 90) fail(400, 'Guest access can last 1 to 90 days.'); expiresAt = now() + days * DAY; }
  if (q('SELECT 1 FROM users WHERE email=?').get(email)) fail(409, `${email} already has an account.`);
  if (role === 'student') seatCheck(org);
  const temp = tempPassword(), id = uid('u');
  q('INSERT INTO users(id,name,email,role,section,pw,must_change,active,created_by,created_at,expires_at,org_id,team) VALUES(?,?,?,?,?,?,1,1,?,?,?,?,?)').run(id, name, email, role, ['faculty', 'admin'].includes(role) ? '' : section, hashPw(temp), actor.id, now(), expiresAt, org, role === 'student' ? team : '');
  return { user: pub(q('SELECT * FROM users WHERE id=?').get(id)), tempPassword: temp };
}
function manageable(actor, target) {
  if (!target || target.org_id !== actor.org_id) fail(404, 'User not found.');
  if (target.id === actor.id) fail(400, 'Use Change password to manage your own account.');
  if (actor.role === 'admin') return;
  if (actor.role === 'faculty' && target.role === 'student') return;
  fail(403, target.role === 'guest' ? 'Only the admin can manage guest accounts.' : 'Only the admin can manage faculty accounts.');
}

/* ------------------------------------------------------------------ router */
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/setup-status', async (req, res) => json(res, 200, { needsSetup: q('SELECT COUNT(*) n FROM users').get().n === 0 }));
route('POST', '/api/setup', async (req, res) => {
  if (q('SELECT COUNT(*) n FROM users').get().n > 0) fail(409, 'Setup is already complete.');
  const b = await readJson(req); const email = cleanEmail(b.email);
  if (!String(b.name || '').trim() || !validEmail(email)) fail(400, 'Enter your name and a valid email.');
  if (!pwOk(b.password)) fail(400, 'Use a password of at least 8 characters.');
  const id = uid('u');
  q("INSERT INTO users(id,name,email,role,section,pw,must_change,active,created_by,created_at,org_id) VALUES(?,?,?,'owner','',?,0,1,NULL,?,NULL)").run(id, String(b.name).trim(), email, hashPw(b.password), now());
  setSession(res, id); json(res, 200, { ok: true });
});
/* ---- class join codes: students create their own account with a code from their faculty ---- */
const JOIN_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newJoinCode = () => { for (;;) { let c = ''; for (const x of crypto.randomBytes(8)) c += JOIN_ALPHA[x % JOIN_ALPHA.length]; c = c.slice(0, 4) + '-' + c.slice(4); if (!q("SELECT 1 FROM records WHERE kind='joincodes' AND id=?").get(c)) return c; } };
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
function findJoin(code) {
  const r = q("SELECT org, data FROM records WHERE kind='joincodes' AND id=?").get(cleanCode(code)); if (!r) return null;
  const j = JSON.parse(r.data); const o = getOrg(r.org);
  let why = '';
  if (!o || o.status !== 'active') why = 'This college is not accepting sign-ups right now.';
  else if (orgExpired(o)) why = "This college's subscription has ended. Ask your faculty.";
  else if (!j.active) why = 'This class code has been turned off. Ask your faculty for a new one.';
  else if (j.expiresAt && j.expiresAt <= now()) why = 'This class code has expired. Ask your faculty for a new one.';
  else if (j.maxUses && (j.uses || 0) >= j.maxUses) why = 'This class code has been used the maximum number of times. Ask your faculty.';
  return { org: o, j, code: cleanCode(code), why };
}
route('GET', '/api/join/:code', async (req, res, u, p) => {
  throttle('joinlookup|' + (req.socket.remoteAddress || ''), 400);
  const f = findJoin(p.code); if (!f) fail(404, 'That class code was not found. Check it with your faculty.');
  const site = getRec(f.org.id, 'settings', 'site') || {};
  json(res, 200, { college: f.org.name, slug: f.org.slug, section: f.j.section || '', logo: site.logo || '', ok: !f.why, why: f.why });
});
route('POST', '/api/join', async (req, res) => {
  const b = await readJson(req); throttle('join|' + (req.socket.remoteAddress || ''), 150);
  const f = findJoin(b.code); if (!f) fail(404, 'That class code was not found. Check it with your faculty.');
  if (f.why) fail(403, f.why);
  if (!pwOk(b.password)) fail(400, 'Choose a password of at least 8 characters.');
  const creator = q('SELECT * FROM users WHERE id=?').get(f.j.createdBy) || q("SELECT * FROM users WHERE org_id=? AND role IN ('admin','faculty') ORDER BY created_at LIMIT 1").get(f.org.id);
  if (!creator) fail(403, 'This college has no faculty yet.');
  const r = createUser(creator, { name: b.name, email: b.email, role: 'student', section: f.j.section || '', team: f.j.team || '' }, f.org.id);
  q('UPDATE users SET pw=?, must_change=0, created_by=? WHERE id=?').run(hashPw(b.password), 'join:' + f.code, r.user.id);
  f.j.uses = (f.j.uses || 0) + 1; putRec(f.org.id, 'joincodes', f.code, f.j);
  setSession(res, r.user.id); json(res, 200, { ok: true, slug: f.org.slug });
});
route('POST', '/api/joincodes', async (req, res, u) => {
  need(u, 'admin', 'faculty'); const b = await readJson(req);
  const days = Math.round(+b.days || 0); const maxUses = Math.max(0, Math.round(+b.maxUses || 0));
  if (days < 0 || days > 365) fail(400, 'A code can last up to 365 days.');
  const code = newJoinCode();
  const j = { section: String(b.section || '').trim().slice(0, 60), team: '', label: String(b.label || '').trim().slice(0, 80), active: true, uses: 0, maxUses,
    expiresAt: days ? now() + days * DAY : null, createdBy: u.id, createdAt: now() };
  putRec(u.org_id, 'joincodes', code, j); json(res, 200, { code, joincode: j });
});
route('PATCH', '/api/joincodes/:code', async (req, res, u, p) => {
  need(u, 'admin', 'faculty'); const code = cleanCode(p.code); const j = getRec(u.org_id, 'joincodes', code); if (!j) fail(404, 'Code not found.');
  const b = await readJson(req); if (b.active != null) j.active = !!b.active;
  if (b.extendDays) { const d = Math.round(+b.extendDays); if (!(d >= 1 && d <= 365)) fail(400, 'Extend by 1 to 365 days.'); j.expiresAt = Math.max(now(), j.expiresAt || now()) + d * DAY; j.active = true; }
  putRec(u.org_id, 'joincodes', code, j); json(res, 200, { joincode: j });
});
route('DELETE', '/api/joincodes/:code', async (req, res, u, p) => { need(u, 'admin', 'faculty'); delRec(u.org_id, 'joincodes', cleanCode(p.code)); json(res, 200, { ok: true }); });

route('GET', '/api/program', async (req, res) => {
  const op = openProgram(); if (!op) return json(res, 200, { open: false });
  const n = Object.keys(getRecs(op.o.id, 'assignments')).length;
  json(res, 200, { open: true, name: op.o.name, slug: op.o.slug, title: op.pr.title, fee: op.pr.fee, currency: op.pr.currency, summary: op.pr.summary, passMark: op.pr.passMark, practicals: n });
});
route('POST', '/api/register', async (req, res) => {
  const b = await readJson(req); throttle('register|' + (req.socket.remoteAddress || ''), 60);
  const op = openProgram(); if (!op) fail(403, 'Registration is closed at the moment.');
  if (!pwOk(b.password)) fail(400, 'Choose a password of at least 8 characters.');
  if (!b.agree) fail(400, 'Please accept the program terms.');
  const creator = q("SELECT * FROM users WHERE org_id=? AND role='admin' ORDER BY created_at LIMIT 1").get(op.o.id);
  if (!creator) fail(403, 'Registration is not available yet.');
  const r = createUser(creator, { name: b.name, email: b.email, role: 'student', section: 'Online' }, op.o.id);
  q("UPDATE users SET pw=?, must_change=0, created_by='register', access='pending' WHERE id=?").run(hashPw(b.password), r.user.id);
  putRec(op.o.id, 'learner', r.user.id, { phone: String(b.phone || '').slice(0, 40), country: String(b.country || '').slice(0, 60), registeredAt: now() });
  setSession(res, r.user.id); json(res, 200, { ok: true, slug: op.o.slug });
});
route('PUT', '/api/learner/receipt', async (req, res, u) => {
  need(u, 'student'); if (!programOf(u.org_id)) fail(404, 'Not found.');
  const b = await readJson(req); const f = q('SELECT * FROM files WHERE id=?').get(String(b.fileId || ''));
  if (!f || f.kind !== 'receipt' || f.for_user !== u.id) fail(400, 'Upload your receipt first.');
  const L = getRec(u.org_id, 'learner', u.id) || {};
  L.receipt = { fid: f.id, name: f.name, size: f.size, at: f.created_at }; L.receiptAt = now(); L.payRef = String(b.payRef || '').slice(0, 120);
  if (u.access === 'rejected') q("UPDATE users SET access='pending' WHERE id=?").run(u.id);
  putRec(u.org_id, 'learner', u.id, L); json(res, 200, { learner: L });
});
route('PUT', '/api/program', async (req, res, u) => {
  need(u, 'admin'); const cur = programOf(u.org_id); if (!cur) fail(404, 'This college does not run an online program.');
  const b = await readJson(req); const t = (k, n) => b[k] != null ? String(b[k]).slice(0, n) : cur[k];
  const pm = b.passMark != null ? Math.round(+b.passMark) : cur.passMark; if (!(pm >= 0 && pm <= 100)) fail(400, 'Pass mark must be 0-100%.');
  const pr = { ...cur, open: b.open != null ? !!b.open : cur.open, title: t('title', 120), fee: t('fee', 20), currency: t('currency', 10), summary: t('summary', 600), instructions: t('instructions', 3000),
    link: b.link != null ? (/^https?:\/\//i.test(String(b.link).trim()) || !String(b.link).trim() ? String(b.link).trim().slice(0, 500) : fail(400, 'The payment link must start with https://')) : cur.link, certNote: t('certNote', 1000), passMark: pm };
  putRec(u.org_id, 'settings', 'program', pr); json(res, 200, { program: pr });
});
route('POST', '/api/learners/:id/decision', async (req, res, u, p) => {
  need(u, 'admin', 'faculty'); if (!programOf(u.org_id)) fail(404, 'Not found.');
  const t = sameOrg(u, p.id); if (!t || t.role !== 'student') fail(404, 'Learner not found.'); const b = await readJson(req);
  const access = b.approve ? 'approved' : 'rejected'; q('UPDATE users SET access=? WHERE id=?').run(access, t.id);
  const L = getRec(u.org_id, 'learner', t.id) || {}; L.decision = { status: access, note: String(b.note || '').slice(0, 500), by: u.id, at: now() }; putRec(u.org_id, 'learner', t.id, L);
  json(res, 200, { learner: L, access });
});
route('POST', '/api/learners/:id/certificate', async (req, res, u, p) => {
  need(u, 'admin', 'faculty'); if (!programOf(u.org_id)) fail(404, 'Not found.');
  const t = sameOrg(u, p.id); if (!t || t.role !== 'student') fail(404, 'Learner not found.'); const b = await readJson(req);
  const L = getRec(u.org_id, 'learner', t.id) || {};
  if (b.revoke) delete L.certificate;
  else {
    const f = b.fileId ? q('SELECT * FROM files WHERE id=?').get(String(b.fileId)) : null;
    if (b.fileId && (!f || f.kind !== 'certificate' || f.org !== u.org_id)) fail(400, 'Upload the certificate file first.');
    if (f) q('UPDATE files SET for_user=? WHERE id=?').run(t.id, f.id);
    L.certificate = { number: String(b.number || '').slice(0, 60), issuedAt: now(), by: u.id, ...(f ? { fid: f.id, name: f.name, size: f.size, at: f.created_at } : (L.certificate?.fid ? { fid: L.certificate.fid, name: L.certificate.name, size: L.certificate.size, at: L.certificate.at } : {})) };
  }
  putRec(u.org_id, 'learner', t.id, L); json(res, 200, { learner: L });
});

route('POST', '/api/login', async (req, res) => {
  const b = await readJson(req); const email = cleanEmail(b.email);
  throttle(email + '|' + (req.socket.remoteAddress || ''));
  const u = q('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !checkPw(String(b.password || ''), u.pw)) fail(401, 'Email or password is incorrect.');
  if (!u.active) fail(403, 'This account is deactivated. Contact your faculty or admin.');
  if (expired(u)) fail(403, `This guest access ended on ${fmtDay(u.expires_at)}. Ask your college's CodeLab administrator to extend it.`);
  if (u.role !== 'owner') { const o = getOrg(u.org_id); if (!o || o.status !== 'active') fail(403, 'Access for your college is paused. Contact your college administrator.'); }
  attempts.delete(email + '|' + (req.socket.remoteAddress || ''));
  setSession(res, u.id); json(res, 200, { ok: true, mustChange: !!u.must_change });
});
route('POST', '/api/logout', async (req, res) => {
  const t = cookies(req).cdl_session; if (t) q('DELETE FROM sessions WHERE token=?').run(t);
  res.setHeader('Set-Cookie', 'cdl_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); json(res, 200, { ok: true });
});
route('POST', '/api/password', async (req, res, u) => {
  need(u); const b = await readJson(req);
  if (!checkPw(String(b.current || ''), u.pw)) fail(400, 'Your current password is incorrect.');
  if (!pwOk(b.next)) fail(400, 'Use a new password of at least 8 characters.');
  if (b.next === b.current) fail(400, 'Choose a password different from the temporary one.');
  q('UPDATE users SET pw=?, must_change=0 WHERE id=?').run(hashPw(b.next), u.id);
  json(res, 200, { ok: true });
});

/* ---- appearance: each college has its own; org '' is the platform look (owner console, general sign-in) ---- */
const THEME_KEYS = ['navy', 'charcoal', 'teal', 'green', 'plum', 'night'];
route('GET', '/api/settings', async (req, res, u) => {
  const slug = new URL(req.url, 'http://x').searchParams.get('org');
  let org = '', name = '';
  if (slug) { const o = q('SELECT * FROM orgs WHERE slug=?').get(slug); if (o && o.status === 'active') { org = o.id; name = o.name; } }
  else if (u && u.role !== 'owner') { org = u.org_id; name = getOrg(org)?.name || ''; }
  const s = getRec(org, 'settings', 'site') || (org ? { siteName: 'CodeLab', institution: name } : {});
  json(res, 200, { ...s, orgName: name, orgFound: !slug || !!org });
});
route('PUT', '/api/settings', async (req, res, u) => {
  need(u, 'admin', 'owner'); const b = await readJson(req); const hex = /^#[0-9a-fA-F]{6}$/;
  const custom = {}; for (const k of ['topbar', 'rail', 'accent', 'ehrnav']) if (b.custom && hex.test(b.custom[k] || '')) custom[k] = b.custom[k];
  let logo = String(b.logo || '');
  if (logo && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(logo)) fail(400, 'The logo must be a PNG, JPG, WebP or SVG image.');
  if (logo.length > 420000) fail(400, 'The logo is too large. Use an image under 300 KB.');
  const clamp = (v, lo, hi, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const site = { theme: THEME_KEYS.includes(b.theme) ? b.theme : 'navy', custom,
    siteName: String(b.siteName || 'CodeLab').trim().slice(0, 40) || 'CodeLab', institution: String(b.institution || '').trim().slice(0, 90),
    logo, showName: b.showName !== false, logoTile: b.logoTile !== false,
    topbarHeight: clamp(b.topbarHeight, 48, 96, 60), stripeWidth: clamp(b.stripeWidth, 0, 8, 3),
    updatedAt: now(), updatedBy: u.id };
  putRec(u.role === 'owner' ? '' : u.org_id, 'settings', 'site', site); json(res, 200, site);
});

/* ---- built-in content for one college ---- */
route('GET', '/api/admin/content-status', async (req, res, u) => {
  need(u, 'admin'); const { out } = contentStatus(u.org_id);
  json(res, 200, { patients: out.patients.length, library: out.library.length, files: 0, missing: out.missing });
});
route('POST', '/api/admin/refresh-content', async (req, res, u) => { need(u, 'admin'); json(res, 200, { ...refreshOrg(u.org_id), files: 0 }); });
route('GET', '/api/bootstrap', async (req, res, u) => { need(u); json(res, 200, bootstrap(u)); });

/* ---- people ---- */
route('POST', '/api/users', async (req, res, u) => { need(u, 'admin', 'faculty'); json(res, 200, createUser(u, await readJson(req))); });
route('POST', '/api/users/import', async (req, res, u) => {
  need(u, 'admin', 'faculty'); const b = await readJson(req); const rows = Array.isArray(b.rows) ? b.rows.slice(0, 1000) : [];
  const results = rows.map(r => { try { return { ok: true, ...createUser(u, { ...r, role: 'student' }) }; } catch (e) { return { ok: false, email: r.email, name: r.name, error: e.message }; } });
  json(res, 200, { results });
});
route('PATCH', '/api/users/:id', async (req, res, u, p) => {
  need(u, 'admin', 'faculty'); const t = q('SELECT * FROM users WHERE id=?').get(p.id); manageable(u, t); const b = await readJson(req);
  const name = b.name != null ? String(b.name).trim() || t.name : t.name;
  const section = b.section != null && (t.role === 'student' || t.role === 'guest') ? String(b.section).trim() : t.section;
  let expiresAt = t.expires_at;
  if (b.extendDays != null) {
    if (t.role !== 'guest') fail(400, 'Only guest accounts have an end date.');
    const d = Math.round(+b.extendDays); if (!(d >= 1 && d <= 90)) fail(400, 'Extend by 1 to 90 days.');
    expiresAt = Math.max(now(), t.expires_at || now()) + d * DAY;
  }
  if (b.endNow) { if (t.role !== 'guest') fail(400, 'Only guest accounts have an end date.'); expiresAt = now(); }
  const active = b.active != null ? (b.active ? 1 : 0) : t.active;
  if (active && !t.active && t.role === 'student') seatCheck(u.org_id);
  let email = t.email; if (b.email != null) { email = cleanEmail(b.email); if (!validEmail(email)) fail(400, 'Not a valid email.'); if (email !== t.email && q('SELECT 1 FROM users WHERE email=?').get(email)) fail(409, 'That email already has an account.'); }
  const team = b.team != null && t.role === 'student' ? String(b.team).trim().slice(0, 40) : (t.team || '');
  q('UPDATE users SET name=?, email=?, section=?, active=?, expires_at=?, team=? WHERE id=?').run(name, email, section, active, expiresAt, team, t.id);
  if (!active || (expiresAt && expiresAt <= now())) q('DELETE FROM sessions WHERE user_id=?').run(t.id);
  else if (expiresAt) q('UPDATE sessions SET expires=MIN(expires, ?) WHERE user_id=?').run(expiresAt, t.id);
  json(res, 200, { user: pub(q('SELECT * FROM users WHERE id=?').get(t.id)) });
});
route('POST', '/api/users/:id/reset-password', async (req, res, u, p) => {
  need(u, 'admin', 'faculty'); const t = q('SELECT * FROM users WHERE id=?').get(p.id); manageable(u, t);
  const temp = tempPassword(); q('UPDATE users SET pw=?, must_change=1 WHERE id=?').run(hashPw(temp), t.id); q('DELETE FROM sessions WHERE user_id=?').run(t.id);
  json(res, 200, { tempPassword: temp, user: pub(t) });
});
route('DELETE', '/api/users/:id', async (req, res, u, p) => {
  need(u, 'admin', 'faculty'); const t = q('SELECT * FROM users WHERE id=?').get(p.id); manageable(u, t);
  q('DELETE FROM abstracts WHERE student_id=?').run(t.id); q('DELETE FROM users WHERE id=?').run(t.id); json(res, 200, { ok: true });
});

/* ---- EHR records, library activities, assignments ---- */
for (const kind of ['patients', 'library', 'assignments']) {
  route('PUT', `/api/${kind}/:id`, async (req, res, u, p) => {
    need(u, 'admin', 'faculty'); const b = await readJson(req);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(p.id)) fail(400, 'Invalid id.');
    if (!b || typeof b !== 'object') fail(400, 'Invalid data.');
    if (kind === 'assignments' && !getRec(u.org_id, kind, p.id) && q("SELECT 1 FROM records WHERE kind='assignments' AND id=? AND org!=?").get(p.id, u.org_id)) fail(409, 'Invalid id.');
    putRec(u.org_id, kind, p.id, b); json(res, 200, { ok: true });
  });
  route('DELETE', `/api/${kind}/:id`, async (req, res, u, p) => {
    need(u, 'admin', 'faculty'); const org = u.org_id;
    if (kind === 'patients') { const used = [...Object.values(getRecs(org, 'library')), ...Object.values(getRecs(org, 'assignments'))].some(a => a.ehr?.chartId === p.id); if (used) fail(409, 'An activity uses this EHR record. Change that activity first.'); }
    if (kind === 'assignments' && getRec(org, kind, p.id)) { q('DELETE FROM submissions WHERE assignment_id=?').run(p.id); q('DELETE FROM grades WHERE assignment_id=?').run(p.id); q('DELETE FROM abstracts WHERE assignment_id=?').run(p.id); }
    delRec(org, kind, p.id); json(res, 200, { ok: true });
  });
}

/* ---- files ---- */
route('POST', '/api/files', async (req, res, u) => {
  need(u, 'admin', 'faculty', 'student');
  const url = new URL(req.url, 'http://x'); const kind = url.searchParams.get('kind');
  const name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180);
  const ext = name.split('.').pop().toLowerCase();
  if (!['activity', 'key', 'marked', 'submission', 'receipt', 'certificate'].includes(kind)) fail(400, 'Unknown file type.');
  if (kind === 'receipt' && (u.role !== 'student' || !programOf(u.org_id))) fail(403, 'Only program learners upload payment receipts.');
  if (kind === 'receipt' && !['pdf', 'png', 'jpg', 'jpeg'].includes(ext)) fail(400, 'Upload the receipt as a PDF, PNG or JPG.');
  if (!['submission', 'receipt'].includes(kind) && !isStaff(u)) fail(403, 'You do not have permission to upload this file.');
  if (kind === 'submission' && u.role !== 'student') fail(403, 'Only students submit work.');
  if (!ALLOWED_EXT.includes(ext)) fail(400, 'Upload a .docx, .pdf, .xlsx, .pptx or image file.');
  if (kind === 'submission' && !['docx', 'pdf'].includes(ext)) fail(400, 'Upload your completed work as .docx or .pdf.');
  const body = await readBody(req, MAX_UPLOAD); if (!body.length) fail(400, 'The file is empty.');
  let forUser = ['submission', 'receipt'].includes(kind) ? u.id : (['marked', 'certificate'].includes(kind) ? url.searchParams.get('student') : null);
  if (['marked', 'certificate'].includes(kind) && forUser && !sameOrg(u, forUser)) forUser = null;
  const id = uid('f'); fs.writeFileSync(path.join(FILES, id), body);
  q('INSERT INTO files(id,name,size,kind,owner,for_user,path,created_at,org) VALUES(?,?,?,?,?,?,?,?,?)').run(id, name, body.length, kind, u.id, forUser, id, now(), u.org_id);
  json(res, 200, { fid: id, name, size: body.length, at: now() });
});
route('GET', '/api/files/:id', async (req, res, u, p) => {
  need(u); const f = q('SELECT * FROM files WHERE id=?').get(p.id);
  if (!f || !canReadFile(u, f)) fail(404, 'File not found.');
  const fp = path.join(FILES, path.basename(f.path)); if (!fs.existsSync(fp)) fail(404, 'File not found.');
  const ext = f.name.split('.').pop().toLowerCase();
  res.writeHead(200, { ...SEC, 'Content-Type': FMIME[ext] || 'application/octet-stream', 'Content-Length': fs.statSync(fp).size,
    'Content-Disposition': `attachment; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'Cache-Control': 'private, no-store' });
  fs.createReadStream(fp).pipe(res);
});

/* ---- student work and grading ---- */
route('PUT', '/api/work/:aid', async (req, res, u, p) => {
  need(u, 'student'); const a = visibleAssignments(u)[p.aid]; if (!a) fail(404, 'Assignment not found.');
  const gRow = q('SELECT data FROM grades WHERE assignment_id=? AND student_id=?').get(p.aid, u.id); let failedGrade = null;
  if (gRow) { const g0 = JSON.parse(gRow.data); const pr = programOf(u.org_id); if (pr && g0.score / (g0.max || 100) * 100 < pr.passMark) failedGrade = g0; else fail(409, 'This assignment is already graded.'); }
  const b = await readJson(req); const f = q('SELECT * FROM files WHERE id=?').get(String(b.fileId || ''));
  if (!f || f.kind !== 'submission' || f.for_user !== u.id) fail(400, 'Upload your file first.');
  const members = a.teamwork ? teammates(u).filter(m => m.id === u.id || !q('SELECT 1 FROM grades WHERE assignment_id=? AND student_id=?').get(p.aid, m.id)) : [u];
  let mine = null;
  for (const m of members) {
    const prev = q('SELECT data FROM submissions WHERE assignment_id=? AND student_id=?').get(p.aid, m.id); const pd = prev ? JSON.parse(prev.data) : null;
    const sub = { status: 'submitted', file: { fid: f.id, name: f.name, size: f.size, at: f.created_at }, note: String(b.note || '').slice(0, 1000), submittedAt: now(),
      history: [...(pd?.history || []), ...(pd?.file ? [{ file: pd.file, at: pd.submittedAt, ...(m.id === u.id && failedGrade ? { grade: failedGrade } : {}) }] : [])].slice(-5), ...(failedGrade ? { attempt: (pd?.attempt || 1) + 1 } : {}), ...(a.teamwork && u.team ? { team: u.team, by: u.id, byName: u.name } : {}) };
    q('INSERT INTO submissions(assignment_id,student_id,data) VALUES(?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET data=excluded.data').run(p.aid, m.id, JSON.stringify(sub));
    if (m.id === u.id) mine = sub;
  }
  if (failedGrade) q('DELETE FROM grades WHERE assignment_id=? AND student_id=?').run(p.aid, u.id);
  json(res, 200, { submission: mine, members: members.length });
});
/* coding abstract entered by the student in the EHR Coding activity */
const cleanRows = (rows, keys) => (Array.isArray(rows) ? rows : []).slice(0, 60).map(r => Object.fromEntries(keys.map(k => [k, String(r?.[k] ?? '').slice(0, 300)])));
route('PUT', '/api/abstract/:aid', async (req, res, u, p) => {
  need(u, 'student'); const a = visibleAssignments(u)[p.aid]; if (!a) fail(404, 'Assignment not found.');
  { const gr = q('SELECT data FROM grades WHERE assignment_id=? AND student_id=?').get(p.aid, u.id); const pr = programOf(u.org_id);
    if (gr && !(pr && JSON.parse(gr.data).score / (JSON.parse(gr.data).max || 100) * 100 < pr.passMark)) fail(409, 'This assignment is already graded. Your coding summary can no longer be changed.'); }
  const b = await readJson(req);
  const ab = { dx: cleanRows(b.dx, ['code', 'poa', 'case', 'note']), px: cleanRows(b.px, ['code', 'date', 'case', 'note']), comments: String(b.comments || '').slice(0, 4000), chartId: a.ehr?.chartId || '', savedAt: now(),
    ...(a.teamwork && u.team ? { team: u.team, by: u.id, byName: u.name } : {}) };
  const members = a.teamwork ? teammates(u).filter(m => m.id === u.id || !q('SELECT 1 FROM grades WHERE assignment_id=? AND student_id=?').get(p.aid, m.id)) : [u];
  for (const m of members) q('INSERT INTO abstracts(assignment_id,student_id,data) VALUES(?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET data=excluded.data').run(p.aid, m.id, JSON.stringify(ab));
  json(res, 200, { abstract: ab });
});
route('PUT', '/api/grades/:aid/:sid', async (req, res, u, p) => {
  need(u, 'admin', 'faculty'); const a = getRec(u.org_id, 'assignments', p.aid); if (!a) fail(404, 'Assignment not found.');
  const st = sameOrg(u, p.sid); if (!st || st.role !== 'student') fail(404, 'Student not found.');
  const b = await readJson(req); const max = +a.points || 100; const score = +b.score;
  if (!isFinite(score) || score < 0 || score > max) fail(400, `Score must be between 0 and ${max}.`);
  const g = { score, max, feedback: String(b.feedback || '').slice(0, 5000), gradedAt: now(), gradedBy: u.id };
  if (b.fileId) { const f = q('SELECT * FROM files WHERE id=?').get(String(b.fileId)); if (f && f.kind === 'marked' && f.org === u.org_id) { q('UPDATE files SET for_user=? WHERE id=?').run(p.sid, f.id); g.file = { fid: f.id, name: f.name, size: f.size, at: f.created_at }; } }
  const ids = b.applyTeam && st.team ? teammates(st).map(m => m.id) : [p.sid];
  if (ids.length > 1) g.team = st.team;
  for (const id of ids) q('INSERT INTO grades(assignment_id,student_id,data) VALUES(?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET data=excluded.data').run(p.aid, id, JSON.stringify(g));
  json(res, 200, { grade: g, graded: ids.length });
});

/* ------------------------------------------------------------------ owner console */
function ownerOrgs() {
  return q('SELECT * FROM orgs ORDER BY name').all().map(o => {
    const c = (role) => q('SELECT COUNT(*) n FROM users WHERE org_id=? AND role=?').get(o.id, role).n;
    const admins = q("SELECT id,name,email,must_change,active FROM users WHERE org_id=? AND role='admin' ORDER BY created_at").all(o.id).map(a => ({ id: a.id, name: a.name, email: a.email, mustChange: !!a.must_change, active: !!a.active }));
    const last = q('SELECT MAX(s.expires) m FROM sessions s JOIN users x ON x.id=s.user_id WHERE x.org_id=?').get(o.id).m;
    const site = getRec(o.id, 'settings', 'site') || {};
    return { id: o.id, slug: o.slug, name: o.name, status: o.status, maxStudents: o.max_students || 0, expiresAt: o.expires_at || null, contact: o.contact || '', notes: o.notes || '', createdAt: o.created_at,
      students: activeStudents(o.id), studentsTotal: c('student'), faculty: c('faculty'), guests: c('guest'), admins,
      assignments: q("SELECT COUNT(*) n FROM records WHERE org=? AND kind='assignments'").get(o.id).n,
      submissions: q('SELECT COUNT(*) n FROM submissions s JOIN users x ON x.id=s.student_id WHERE x.org_id=?').get(o.id).n,
      lastSignIn: last ? last - SESSION_DAYS * DAY : null, theme: site.theme || 'navy', logo: site.logo || '', program: !!programOf(o.id) };
  });
}
function orgFields(b, o = {}) {
  const name = b.name != null ? String(b.name).trim().slice(0, 90) : o.name;
  if (!name) fail(400, 'Enter the college name.');
  let slug = b.slug != null ? slugify(b.slug) : o.slug;
  if (!slug || slug.length < 2) fail(400, 'Choose a web address of at least 2 letters or numbers.');
  if (RESERVED.includes(slug)) fail(400, `"${slug}" is reserved. Choose another web address.`);
  const clash = q('SELECT id FROM orgs WHERE slug=?').get(slug); if (clash && clash.id !== o.id) fail(409, `The address /c/${slug} is already used by another college.`);
  const max = b.maxStudents != null ? Math.max(0, Math.round(+b.maxStudents || 0)) : (o.max_students || 0);
  let exp = o.expires_at ?? null;
  if (b.expiresOn !== undefined) { if (!b.expiresOn) exp = null; else { const d = new Date(String(b.expiresOn) + 'T23:59:59'); if (isNaN(d)) fail(400, 'Enter a valid end date.'); exp = d.getTime(); } }
  const status = b.status != null ? (b.status === 'suspended' ? 'suspended' : 'active') : (o.status || 'active');
  return { name, slug, max, exp, status, contact: b.contact != null ? String(b.contact).slice(0, 200) : (o.contact || ''), notes: b.notes != null ? String(b.notes).slice(0, 2000) : (o.notes || '') };
}
route('POST', '/api/owner/orgs', async (req, res, u) => {
  need(u, 'owner'); const b = await readJson(req); const f = orgFields({ ...b, slug: b.slug || b.name });
  const adminEmail = cleanEmail(b.adminEmail); if (!String(b.adminName || '').trim() || !validEmail(adminEmail)) fail(400, "Enter the college admin's name and email.");
  if (q('SELECT 1 FROM users WHERE email=?').get(adminEmail)) fail(409, `${adminEmail} already has an account.`);
  const id = uid('o');
  q('INSERT INTO orgs(id,slug,name,status,max_students,expires_at,contact,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, f.slug, f.name, 'active', f.max, f.exp, f.contact, f.notes, now());
  putRec(id, 'settings', 'site', { theme: 'navy', custom: {}, siteName: 'CodeLab', institution: f.name, logo: '', showName: true, logoTile: true, topbarHeight: 60, stripeWidth: 3, updatedAt: now() });
  if (b.program) putRec(id, 'settings', 'program', { ...PROGRAM_DEFAULT, open: false });
  seedOrg(id);
  const admin = createUser(u, { name: b.adminName, email: adminEmail, role: 'admin' }, id);
  json(res, 200, { org: ownerOrgs().find(o => o.id === id), ...admin });
});
route('PATCH', '/api/owner/orgs/:id', async (req, res, u, p) => {
  need(u, 'owner'); const o = getOrg(p.id); if (!o) fail(404, 'College not found.'); const b = await readJson(req);
  const f = orgFields(b, o);
  if (b.extendMonths) { const m = Math.round(+b.extendMonths); if (!(m >= 1 && m <= 36)) fail(400, 'Extend by 1 to 36 months.'); const d = new Date(Math.max(now(), o.expires_at || now())); d.setMonth(d.getMonth() + m); f.exp = d.getTime(); }
  q('UPDATE orgs SET name=?, slug=?, status=?, max_students=?, expires_at=?, contact=?, notes=? WHERE id=?').run(f.name, f.slug, f.status, f.max, f.exp, f.contact, f.notes, o.id);
  if (f.status !== 'active') q('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id=?)').run(o.id);
  json(res, 200, { org: ownerOrgs().find(x => x.id === o.id) });
});
route('POST', '/api/owner/orgs/:id/admins', async (req, res, u, p) => {
  need(u, 'owner'); const o = getOrg(p.id); if (!o) fail(404, 'College not found.'); const b = await readJson(req);
  json(res, 200, createUser(u, { name: b.name, email: b.email, role: 'admin' }, o.id));
});
route('POST', '/api/owner/users/:id/reset-password', async (req, res, u, p) => {
  need(u, 'owner'); const t = q("SELECT * FROM users WHERE id=? AND role='admin'").get(p.id); if (!t) fail(404, 'Admin not found.');
  const temp = tempPassword(); q('UPDATE users SET pw=?, must_change=1, active=1 WHERE id=?').run(hashPw(temp), t.id); q('DELETE FROM sessions WHERE user_id=?').run(t.id);
  json(res, 200, { tempPassword: temp, user: pub(t), org: getOrg(t.org_id)?.name });
});
route('DELETE', '/api/owner/orgs/:id', async (req, res, u, p) => {
  need(u, 'owner'); const o = getOrg(p.id); if (!o) fail(404, 'College not found.'); const b = await readJson(req);
  if (o.status !== 'suspended') fail(409, 'Pause the college first. Only paused colleges can be deleted.');
  if (String(b.confirm || '').toLowerCase() !== o.slug.toLowerCase()) fail(400, `Type the college's web address (${o.slug}) to confirm.`);
  const ids = q('SELECT id FROM users WHERE org_id=?').all(o.id).map(r => r.id);
  for (const id of ids) { q('DELETE FROM submissions WHERE student_id=?').run(id); q('DELETE FROM grades WHERE student_id=?').run(id); q('DELETE FROM abstracts WHERE student_id=?').run(id); }
  for (const f of q('SELECT * FROM files WHERE org=?').all(o.id)) { try { fs.unlinkSync(path.join(FILES, path.basename(f.path))); } catch {} }
  q('DELETE FROM files WHERE org=?').run(o.id); q('DELETE FROM records WHERE org=?').run(o.id); q('DELETE FROM users WHERE org_id=?').run(o.id); q('DELETE FROM orgs WHERE id=?').run(o.id);
  json(res, 200, { ok: true });
});
route('POST', '/api/owner/refresh-all', async (req, res, u) => {
  need(u, 'owner'); const out = {}; for (const o of q('SELECT id,name FROM orgs').all()) out[o.name] = refreshOrg(o.id);
  json(res, 200, { colleges: Object.keys(out).length, patients: Object.values(out).reduce((a, x) => a + x.patients, 0), library: Object.values(out).reduce((a, x) => a + x.library, 0) });
});
route('GET', '/api/owner/content-status', async (req, res, u) => {
  need(u, 'owner'); let n = 0; for (const o of q('SELECT id FROM orgs').all()) { const { out } = contentStatus(o.id); n += out.patients.length + out.library.length; }
  json(res, 200, { differing: n });
});

/* read-only rule for colleges whose subscription has ended */
const READONLY_OK = ['/api/login', '/api/logout', '/api/password', '/api/setup', '/api/join'];
function guardWrite(req, u, pathname) {
  if (!u || u.role === 'owner' || req.method === 'GET' || READONLY_OK.includes(pathname)) return;
  const o = getOrg(u.org_id);
  if (orgExpired(o)) fail(403, `Your college's CodeLab subscription ended on ${fmtDay(o.expires_at)}. The site is read-only until it is renewed. Contact your college administrator.`);
}

/* ------------------------------------------------------------------ server */
const PUBLIC = path.join(ROOT, 'public');
/* static files are compressed once and kept in memory (the ICD-10-CM code book is about 6 MB, under 1 MB compressed) */
const GZ = new Map();
function gzipped(fp) { const m = fs.statSync(fp).mtimeMs; const c = GZ.get(fp); if (c && c.m === m) return c.b; const b = zlib.gzipSync(fs.readFileSync(fp), { level: 9 }); GZ.set(fp, { m, b }); return b; }
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-codelab'] !== '1') fail(400, 'Bad request.'); // blocks cross-site form posts
      for (const r of routes) { if (r.method !== req.method) continue; const m = r.re.exec(url.pathname); if (m) { const u = currentUser(req); guardWrite(req, u, url.pathname); return await r.fn(req, res, u, m.groups || {}); } }
      fail(404, 'Not found.');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed.');
    let file = url.pathname === '/' || url.pathname.startsWith('/ehr/') || /^\/codes(\/[^/]*)?$/.test(url.pathname) || /^\/join(\/[^/]*)?$/.test(url.pathname) || /^\/register\/?$/.test(url.pathname) || /^\/c\/[^/]+\/?$/.test(url.pathname) ? 'index.html' : path.normalize(url.pathname).replace(/^([\\/])+/, '');
    const fp = path.join(PUBLIC, file);
    if (!fp.startsWith(PUBLIC) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const hdr = { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': file === 'index.html' ? 'no-cache' : file === 'icd10cm.json' ? 'public, max-age=86400' : 'public, max-age=300', 'Vary': 'Accept-Encoding' };
    if (/\.(json|js|css|html|svg)$/.test(fp) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) return send(res, 200, gzipped(fp), { ...hdr, 'Content-Encoding': 'gzip' });
    send(res, 200, fs.readFileSync(fp), hdr);
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.code, { error: e.message });
    console.error(e); json(res, 500, { error: 'Something went wrong on the server. Try again.' });
  }
});
setInterval(() => { q('DELETE FROM sessions WHERE expires<?').run(now()); q('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE expires_at IS NOT NULL AND expires_at<=?)').run(now()); }, 600e3).unref();
server.listen(PORT, () => {
  console.log(`CodeLab running at http://localhost:${PORT}  (data folder: ${DATA})`);
  if (q("SELECT COUNT(*) n FROM users").get().n > 0 && !q("SELECT 1 FROM users WHERE role='owner'").get())
    console.log('No owner account yet. To manage colleges, create one with:  node server.js --create-owner you@example.com Your Name');
});
