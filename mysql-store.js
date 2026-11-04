'use strict';
// ASHEN ROADS - saves every account in MySQL (the database you see in phpMyAdmin) - v15.54
// No npm package needed: it talks to MySQL through the `mysql` command-line program that XAMPP already has
// (C:\xampp\mysql\bin\mysql.exe). Settings are read from api/config.php (DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASS),
// or from the environment: MYSQL_BIN, MYSQL_HOST, MYSQL_PORT, MYSQL_DB, MYSQL_USER, MYSQL_PASS. MYSQL_STORE=off disables it.
const fs = require('fs'), path = require('path'), {spawn} = require('child_process');
const ROOT = path.join(__dirname, '..');

function phpConfig() {
  const o = {};
  try {
    const t = fs.readFileSync(path.join(ROOT, 'api', 'config.php'), 'utf8');
    for (const k of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS']) {
      const m = t.match(new RegExp("^[ \\t]*'" + k + "'[ \\t]*=>[ \\t]*'([^']*)'", 'm'));   // a line starting with // is ignored
      if (m) o[k] = m[1];
    }
  } catch (e) {}
  return o;
}
const P = phpConfig(), E = process.env;
const cfg = {
  host: String(E.MYSQL_HOST || P.DB_HOST || '127.0.0.1').replace(/^localhost$/i, '127.0.0.1'),
  port: String(E.MYSQL_PORT || P.DB_PORT || '3306'),
  db: String(E.MYSQL_DB || E.DB_NAME || P.DB_NAME || '').replace(/`/g, ''),
  user: String(E.MYSQL_USER || P.DB_USER || 'root'),
  pass: String(E.MYSQL_PASS !== undefined ? E.MYSQL_PASS : (P.DB_PASS || ''))
};
const wanted = String(E.MYSQL_STORE || '').toLowerCase() !== 'off' && cfg.db !== '';
let BIN = '';
const state = {wanted, ready: false, error: '', db: cfg.db, bin: ''};

function run(bin, sql, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = ['-h', cfg.host, '-P', cfg.port, '-u', cfg.user, '--default-character-set=utf8mb4', '--batch', '--skip-column-names'];
    const env = Object.assign({}, process.env, {MYSQL_PWD: cfg.pass});
    let child, out = '', err = '', done = false;
    const fin = (e, v) => { if (done) return; done = true; clearTimeout(tm); e ? reject(e) : resolve(v); };
    const tm = setTimeout(() => { try { child.kill(); } catch (e) {} fin(new Error('MySQL did not answer in time')); }, timeoutMs || 15000);
    try { child = spawn(bin, args, {env, windowsHide: true}); } catch (e) { return fin(e); }
    child.on('error', (e) => fin(e));
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => code === 0 ? fin(null, out) : fin(new Error((err || 'mysql exited with code ' + code).trim().split('\n')[0])));
    child.stdin.on('error', () => {});
    child.stdin.end(sql);
  });
}

async function findBin() {
  if (E.MYSQL_BIN) return E.MYSQL_BIN;
  const cands = ['C:\\xampp\\mysql\\bin\\mysql.exe', 'C:\\xampp\\mysql\\bin\\mariadb.exe', 'D:\\xampp\\mysql\\bin\\mysql.exe', 'E:\\xampp\\mysql\\bin\\mysql.exe',
    'C:\\wamp64\\bin\\mariadb\\mariadb11.2.2\\bin\\mysql.exe', '/Applications/XAMPP/xamppfiles/bin/mysql', '/opt/lampp/bin/mysql', 'mysql', 'mariadb'];
  for (const c of cands) {
    if (/[\\/]/.test(c)) { if (fs.existsSync(c)) return c; continue; }
    try { await run(c, 'SELECT 1;', 5000); return c; } catch (e) { if (!(e && e.code === 'ENOENT')) { if (/Access denied|Can't connect|Unknown database/i.test(String(e.message))) return c; } }
  }
  return '';
}

const hexStr = (s) => "CONVERT(X'" + Buffer.from(String(s == null ? '' : s), 'utf8').toString('hex') + "' USING utf8mb4)";
const int = (v, max) => (Number.isSafeInteger(v) && v > 0) ? Math.min(v, max || 9007199254740991) : 0;
const I32 = 2147483647;

function toRow(u) {
  const s = u.stats || {};
  const email = u.email ? String(u.email).toLowerCase() : u.id + '@no-email.invalid';
  return '(' + [hexStr(u.id), hexStr(u.name), hexStr(String(u.name).toLowerCase()), hexStr(email), hexStr('scrypt$' + u.salt + '$' + u.hash),
    int(u.ver, I32) || 1, int(u.created), int(u.wins, I32), int(s.logins, I32), int(s.lastLogin), int(s.lastActive), int(s.playSec, I32), int(s.matches, I32), int(s.deaths, I32)].join(',') + ')';
}
const COLS = 'id, name, name_lc, email, pass_hash, ver, created, wins, logins, last_login, last_active, play_sec, matches, deaths';
const UPD = COLS.split(', ').filter((c) => c !== 'id').map((c) => c + '=VALUES(' + c + ')').join(', ');
const USE = 'USE `' + cfg.db + '`;\n';

const SCHEMA = 'CREATE DATABASE IF NOT EXISTS `' + cfg.db + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n' + USE +
  'CREATE TABLE IF NOT EXISTS users (id VARCHAR(32) NOT NULL PRIMARY KEY, name VARCHAR(32) NOT NULL, name_lc VARCHAR(32) NOT NULL, email VARCHAR(190) NOT NULL, ' +
  'pass_hash VARCHAR(255) NOT NULL, ver INT NOT NULL DEFAULT 1, created BIGINT NOT NULL DEFAULT 0, wins INT NOT NULL DEFAULT 0, logins INT NOT NULL DEFAULT 0, ' +
  'last_login BIGINT NOT NULL DEFAULT 0, last_active BIGINT NOT NULL DEFAULT 0, play_sec INT NOT NULL DEFAULT 0, matches INT NOT NULL DEFAULT 0, deaths INT NOT NULL DEFAULT 0, ' +
  'UNIQUE KEY uq_name_lc (name_lc), UNIQUE KEY uq_email (email)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n';

async function init() {
  if (!wanted) throw new Error('MySQL storage is switched off (no DB_NAME in api/config.php)');
  BIN = await findBin();
  if (!BIN) throw new Error('mysql program not found. Start XAMPP, or set MYSQL_BIN=C:\\xampp\\mysql\\bin\\mysql.exe');
  await run(BIN, SCHEMA);
  state.ready = true; state.bin = BIN; state.error = '';
}

async function loadUsers() {
  const out = await run(BIN, USE + 'SELECT id, HEX(name), HEX(email), HEX(pass_hash), ver, created, wins, logins, last_login, last_active, play_sec, matches, deaths FROM users;');
  const list = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split('\t'); if (c.length < 13) continue;
    const dec = (h) => Buffer.from(h === 'NULL' ? '' : h, 'hex').toString('utf8');
    const ph = dec(c[3]).split('$');
    if (ph[0] !== 'scrypt' || ph.length !== 3) continue;   // accounts made by the PHP login (bcrypt) cannot be used by the Node login
    const email = dec(c[2]);
    list.push({id: c[0], name: dec(c[1]), email: /@no-email\.invalid$/i.test(email) ? '' : email, salt: ph[1], hash: ph[2], ver: Number(c[4]) || 1, created: Number(c[5]) || 0,
      wins: Number(c[6]) || 0, stats: {logins: Number(c[7]) || 0, lastLogin: Number(c[8]) || 0, lastActive: Number(c[9]) || 0, playSec: Number(c[10]) || 0, matches: Number(c[11]) || 0, deaths: Number(c[12]) || 0}});
  }
  return list;
}

let chain = Promise.resolve(), warned = false;
function upsert(usersArr) {   // queued: one MySQL call at a time, 15 accounts per call
  const sqls = [];
  for (let i = 0; i < usersArr.length; i += 15) sqls.push(USE + 'INSERT INTO users (' + COLS + ') VALUES ' + usersArr.slice(i, i + 15).map(toRow).join(',') + ' ON DUPLICATE KEY UPDATE ' + UPD + ';\n');
  const p = chain.then(async () => { for (const q of sqls) await run(BIN, q); });
  chain = p.catch(() => {});
  return p.then(() => { warned = false; }, (e) => { if (!warned) { warned = true; console.error('Auth: MySQL save failed - ' + e.message); } throw e; });
}

module.exports = {state, init, loadUsers, upsert, _toRow: toRow, _cfg: cfg};
