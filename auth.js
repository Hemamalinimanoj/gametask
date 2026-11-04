// Ashen Roads accounts + authorization. Zero dependencies (Node crypto only).
//
//   POST /api/register {username, password} -> {ok, token, user}       create an account
//   POST /api/login    {username, password}  -> {ok, token, user}      log in to an EXISTING account
//   GET  /api/me       (Authorization: Bearer <token>) -> {ok, user}   is my token still valid?
//   POST /api/logout-all (Authorization: Bearer <token>)               invalidate every token of this account
//
// The game WebSocket (lobby + match) calls verifyToken(m.token) on 'join', so nobody can play without an account.
//
// STORAGE: by default accounts are saved in the DATABASE FOLDER (database/users.json, players.csv, pending.json, secret.key; DATA_DIR overrides it). Free hosts (Render free, Heroku...) WIPE that disk on every restart/deploy, so for live hosting
//   set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (free database at upstash.com, also accepts KV_REST_API_URL / KV_REST_API_TOKEN). Accounts AND the
//   token-signing key are then kept there and survive every restart.
// Environment (all optional): AUTH_REQUIRED (1 = login needed to play, 0 = off), AUTH_SECRET (token signing key),
//   DATA_DIR (default database/), TOKEN_DAYS (365), TRUST_PROXY (1 behind Render/Nginx), ADMIN_USERNAME (admin dashboard account),
//   RESEND_API_KEY and EMAIL_FROM (verified sender; required for new registrations).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net'), tls = require('tls');

const AUTH_REQUIRED = process.env.AUTH_REQUIRED !== '0';
// v15.44: AUTH_MODE=php -> accounts live in the PHP backend (api/index.php). This server only CHECKS the signature of its tokens
// (AUTH_SECRET must be the SAME text as in the PHP config / database/secret.key) and sends play statistics to PHP_API_URL.
const PHP_MODE = String(process.env.AUTH_MODE || '').toLowerCase() === 'php';
const MY = require('./mysql-store');   // v15.54: every account is ALSO saved in MySQL (phpMyAdmin) - see server/mysql-store.js
const mysqlSynced = new Map();   // account id -> what was last written to MySQL
const mysqlSig = (u) => JSON.stringify([u.name, u.email, u.salt, u.hash, u.ver, u.wins, u.stats || {}]);
function mysqlPush() {   // writes only the accounts that changed since the last write
  if (!MY.state.ready) return Promise.resolve();
  const batch = [];
  for (const u of users.values()) { const sig = mysqlSig(u); if (mysqlSynced.get(u.id) !== sig) batch.push([u, sig]); }
  if (!batch.length) return Promise.resolve();
  return MY.upsert(batch.map((b) => b[0])).then(() => { for (const [u, sig] of batch) mysqlSynced.set(u.id, sig); }, () => {});
}
const PHP_API_URL = String(process.env.PHP_API_URL || '').trim();   // e.g. https://yourdomain.com/api/index.php
const LEGACY_DIR = path.join(__dirname, 'data');   // v15.37-v15.40 kept the accounts here
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'database');   // v15.41: the DATABASE FOLDER next to index.html (blocked from the web by server.js)
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const TOKEN_MS = (+process.env.TOKEN_DAYS || 365) * 86400000;
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME || process.env.DYNO || process.env.K_SERVICE);   // hosts that put a proxy in front: the real client address is in X-Forwarded-For
const USER_RE = /^[A-Za-z0-9_]{3,14}$/;   // 14 = the longest name the game shows
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASS = 6, MAX_PASS = 128;
const OTP_MS = 10 * 60 * 1000, OTP_TRIES = 5;

try { fs.mkdirSync(DATA_DIR, {recursive: true}); } catch (e) { console.error('Auth: cannot create data folder ' + DATA_DIR + ': ' + e.message); }
if (!process.env.DATA_DIR) {   // accounts made by an older version (server/data) move into the database folder once
  try { for (const f of ['users.json', 'pending.json', 'secret.key']) { const a = path.join(LEGACY_DIR, f), b = path.join(DATA_DIR, f); if (fs.existsSync(a) && !fs.existsSync(b)) { fs.copyFileSync(a, b); console.log('Auth: copied ' + f + ' from server/data to the database folder.'); } } } catch (e) { console.error('Auth: could not copy the old accounts: ' + e.message); }
}
try {
  const rd = path.join(DATA_DIR, 'README.txt');
  if (!fs.existsSync(rd)) fs.writeFileSync(rd, 'ASHEN ROADS DATABASE FOLDER\r\n\r\nusers.json    accounts: username, password HASH (never the real password), created time, wins\r\nplayers.csv   the same list as a table you can open in Excel (no passwords)\r\npending.json  legacy pending registrations from older versions\r\nsecret.key    key that signs the login tokens - keep it private\r\n\r\nBack this folder up. Do not share it. The web server refuses to send any file from here.\r\nOn free hosting (Render / Heroku) this folder is wiped on every restart: use the Upstash database instead (see README).\r\n');
} catch (e) {}

// ---------------------------------------------------------------- remote storage (Upstash Redis REST - plain HTTPS, no packages)
const RURL = String(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/$/, ''), RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const REMOTE = !!(RURL && RTOK);
async function rcmd(args) {
  const r = await fetch(RURL, {method: 'POST', headers: {Authorization: 'Bearer ' + RTOK, 'Content-Type': 'application/json'}, body: JSON.stringify(args), signal: AbortSignal.timeout(8000)});
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok || !j || j.error) throw new Error('storage: ' + ((j && j.error) || 'HTTP ' + r.status));
  return j.result;
}
const UKEY = (lower) => 'ashen:user:' + lower;
const PKEY = (lower) => 'ashen:pending:' + lower;
const EKEY = (email) => 'ashen:email:' + crypto.createHash('sha256').update(email).digest('hex');

// ---------------------------------------------------------------- signing secret
let SECRET = crypto.randomBytes(48);   // provisional; replaced by the real one before the server starts listening
async function loadSecret() {
  if (process.env.AUTH_SECRET) return Buffer.from(process.env.AUTH_SECRET);
  if (PHP_MODE) console.error('Auth: AUTH_MODE=php but AUTH_SECRET is not set - copy the text of database/secret.key (PHP) into AUTH_SECRET, otherwise nobody can join.');
  if (REMOTE) {   // one key shared by every restart: tokens keep working
    await rcmd(['SET', 'ashen:secret', crypto.randomBytes(48).toString('hex'), 'NX']);
    return Buffer.from(await rcmd(['GET', 'ashen:secret']), 'utf8');
  }
  const f = path.join(DATA_DIR, 'secret.key');
  try { const x = fs.readFileSync(f); if (x.length >= 32) return x; } catch (e) {}
  const x = crypto.randomBytes(48);
  try { fs.writeFileSync(f, x, {mode: 0o600}); } catch (e) { console.error('Auth: could not save secret.key (tokens will stop working after a restart): ' + e.message); }
  return x;
}

// ---------------------------------------------------------------- user store
// users = in-memory cache (every lookup is instant); file mode saves users.json, remote mode writes through to Upstash.
let users = new Map();   // lower-case username -> {id, name, email, salt, hash, ver, created}
let pending = new Map(); // lower-case username -> pending email registration
const activity = new Map(); // account id -> {lastActive, sessions}
function loadFile() {
  try {
    const j = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    for (const u of j.users || []) users.set(u.name.toLowerCase(), u);
  } catch (e) { if (e.code !== 'ENOENT') console.error('Auth: users.json unreadable, starting empty: ' + e.message); }
  try {
    const j = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
    for (const p of j.registrations || []) if (p.expires > Date.now()) pending.set(p.name.toLowerCase(), p);
  } catch (e) { if (e.code !== 'ENOENT') console.error('Auth: pending.json unreadable, starting empty: ' + e.message); }
}
const iso = (t) => t ? new Date(t).toISOString() : '';
function buildCsv(esc) {   // v15.43: registration + activity per player (no passwords)
  esc = esc || ((v) => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; });
  const rows = ['username,email,registered,last_login,last_active,logins,play_minutes,matches,deaths,wins'];
  for (const u of users.values()) { const s = u.stats || {}; rows.push([u.name, u.email || '', iso(u.created), iso(s.lastLogin), iso(s.lastActive), s.logins | 0, Math.round((s.playSec || 0) / 60), s.matches | 0, s.deaths | 0, Number.isSafeInteger(u.wins) ? u.wins : 0].map(esc).join(',')); }
  return rows.join('\r\n') + '\r\n';
}
function saveCsv() {   // readable copy of the player list (no passwords)
  try {
    const esc = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };   // a leading = + - @ would run as a formula in Excel
    fs.writeFileSync(path.join(DATA_DIR, 'players.csv'), buildCsv(esc), {mode: 0o600});
  } catch (e) {}
}
function saveUsers() {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({users: [...users.values()]}), {mode: 0o600});
  fs.renameSync(tmp, USERS_FILE);
  saveCsv();
  mysqlPush();
}
function savePending() {
  const tmp = PENDING_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({registrations: [...pending.values()]}), {mode: 0o600});
  fs.renameSync(tmp, PENDING_FILE);
}
async function loadRemote() {
  let cur = '0', n = 0;
  do {
    const [next, keys] = await rcmd(['SCAN', cur, 'MATCH', 'ashen:user:*', 'COUNT', 500]); cur = String(next);
    for (let i = 0; i < keys.length; i += 100) {
      const vals = await rcmd(['MGET', ...keys.slice(i, i + 100)]);
      for (const v of vals) if (v) { try { const u = JSON.parse(v); users.set(u.name.toLowerCase(), u); n++; } catch (e) {} }
    }
  } while (cur !== '0');
  return n;
}
const saveUser = async (u) => { if (REMOTE) await rcmd(['SET', UKEY(u.name.toLowerCase()), JSON.stringify(u)]); else saveUsers(); };
async function findUser(key) {   // cache first, then the remote database (e.g. registered by another server instance)
  let u = users.get(key);
  if (!u && REMOTE) { const raw = await rcmd(['GET', UKEY(key)]); if (raw) { try { u = JSON.parse(raw); users.set(key, u); } catch (e) {} } }
  return u;
}
async function findEmail(email) {
  if ([...users.values()].some(u => u.email && u.email.toLowerCase() === email)) return true;
  if (!REMOTE) return false;
  return !!(await rcmd(['GET', EKEY(email)]));
}
async function getPending(key) {
  let p = pending.get(key);
  if (!p && REMOTE) {
    const raw = await rcmd(['GET', PKEY(key)]);
    if (raw) { try { p = JSON.parse(raw); pending.set(key, p); } catch (e) {} }
  }
  return p;
}
async function savePendingRegistration(p, create) {
  const key = p.name.toLowerCase();
  if (REMOTE) {
    const result = await rcmd(create ? ['SET', PKEY(key), JSON.stringify(p), 'NX'] : ['SET', PKEY(key), JSON.stringify(p)]);
    if (create && result !== 'OK') return false;
  } else {
    if (create && pending.has(key)) return false;
    pending.set(key, p);
    try { savePending(); }
    catch (e) { if (create) pending.delete(key); throw e; }
  }
  pending.set(key, p);
  return true;
}
async function removePending(key) {
  if (REMOTE) {
    await rcmd(['DEL', PKEY(key)]);
    pending.delete(key);
  } else {
    const old = pending.get(key);
    pending.delete(key);
    try { savePending(); }
    catch (e) { if (old) pending.set(key, old); throw e; }
  }
}
// resolves when accounts + signing key are loaded (server.js starts listening only after this)
const ready = (async () => {
  try {
    SECRET = await loadSecret();
    if (REMOTE) console.log('Auth: accounts are stored in the remote database (Upstash) - ' + await loadRemote() + ' account(s) loaded.');
    else {
      loadFile(); saveCsv();
      if (!PHP_MODE && MY.state.wanted) {   // v15.54: MySQL (phpMyAdmin) is the main account database; users.json stays as a backup copy
        try {
          await MY.init();
          for (const u of await MY.loadUsers()) { users.set(u.name.toLowerCase(), u); mysqlSynced.set(u.id, mysqlSig(u)); }
          await mysqlPush();   // accounts that only exist in users.json are copied into MySQL now
          console.log('Auth: accounts are saved in MySQL database "' + MY.state.db + '" (open phpMyAdmin -> ' + MY.state.db + ' -> users) - ' + users.size + ' account(s).');
        } catch (e) {
          MY.state.ready = false; MY.state.error = e.message;
          console.error('Auth: MySQL is NOT used - ' + e.message + '\n      Accounts stay in database/users.json. Start XAMPP MySQL (and Apache), check DB_* in api/config.php, then restart this server.');
        }
      }
      console.log('Auth: accounts and pending registrations are stored in ' + DATA_DIR + ' (' + users.size + ' account(s)).');
      if ((process.env.RENDER || process.env.DYNO) && !process.env.DATA_DIR) console.warn('Auth WARNING: this host wipes its disk on every restart/deploy, so accounts WILL BE LOST. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (free at upstash.com) - see README.');
    }
  } catch (e) { console.error('Auth: storage start-up failed: ' + e.message + '  (check UPSTASH_REDIS_REST_URL / TOKEN)'); if (REMOTE) throw e; }
})();

// ---------------------------------------------------------------- passwords: scrypt with a random salt per user
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, {N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024}, (e, k) => e ? rej(e) : res(k)));
const DUMMY_SALT = crypto.randomBytes(16);   // unknown username costs the same time as a wrong password (no account-name probing)
function otpHash(salt, code) { return crypto.createHmac('sha256', SECRET).update(salt + code).digest(); }
function createOtp() {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), salt = crypto.randomBytes(16).toString('hex');
  return {code, salt, hash: otpHash(salt, code).toString('hex')};
}
const OTP_SUBJECT = 'Your Ashen Roads verification code';
const otpHtml = (code) => '<!doctype html><html><body style="margin:0;padding:0;background:#0b0f10;font-family:Arial,Helvetica,sans-serif">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f10;padding:28px 12px"><tr><td align="center">' +
  '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#151a1c;border:1px solid #3a2a1a;border-radius:6px">' +
  '<tr><td align="center" style="padding:28px 24px 6px"><div style="font-size:13px;letter-spacing:6px;color:#ff6a3d;font-weight:bold">ASHEN</div>' +
  '<div style="font-size:34px;letter-spacing:8px;color:#f1ece2;font-weight:bold;margin-top:2px">ROADS</div></td></tr>' +
  '<tr><td align="center" style="padding:14px 28px 4px;color:#b9c3bc;font-size:15px;line-height:1.5">Welcome, survivor! Use this code to verify your email and finish creating your account:</td></tr>' +
  '<tr><td align="center" style="padding:18px 24px"><div style="display:inline-block;padding:14px 26px;background:#0b0f10;border:2px solid #ffc65d;border-radius:6px;font-size:38px;letter-spacing:12px;font-weight:bold;color:#ffd36b;font-family:Consolas,Menlo,monospace">' + code + '</div></td></tr>' +
  '<tr><td align="center" style="padding:0 28px 26px;color:#8a958e;font-size:13px;line-height:1.5">This code expires in 10 minutes.<br>If you did not try to create an account, you can ignore this email.</td></tr>' +
  '</table></td></tr></table></body></html>';
const otpText = (code) => 'Your Ashen Roads verification code is ' + code + '. It expires in 10 minutes.\r\nIf you did not try to create an account, ignore this email.';
// ---- SMTP client (Gmail, Outlook, Brevo, any mail server). Zero packages: Node net + tls only. Implicit TLS (port 465) or STARTTLS (587).
function smtpSend(o) {
  return new Promise((resolve, reject) => {
    let sock = null, finished = false, lineBuf = '', cur = [], waiter = null; const queued = [];
    const timer = setTimeout(() => finish(new Error('SMTP timeout')), 20000);
    function finish(err) { if (finished) return; finished = true; clearTimeout(timer); try { sock && sock.destroy(); } catch (e) {} err ? reject(err) : resolve(); }
    const onData = (d) => {
      lineBuf += d.toString('utf8'); let i;
      while ((i = lineBuf.indexOf('\r\n')) >= 0) {
        const line = lineBuf.slice(0, i); lineBuf = lineBuf.slice(i + 2); cur.push(line);
        if (/^\d{3}( |$)/.test(line)) { const r = {code: +line.slice(0, 3), text: cur.join('\n')}; cur = []; if (waiter) { const w = waiter; waiter = null; w(r); } else queued.push(r); }
      }
    };
    const attach = (s) => { sock = s; s.on('data', onData); s.on('error', finish); s.on('close', () => finish(new Error('SMTP connection closed early'))); };
    const read = () => new Promise(res => { if (queued.length) res(queued.shift()); else waiter = res; });
    const cmd = async (line, ok) => { sock.write(line + '\r\n'); const r = await read(); if (!ok.includes(r.code)) throw new Error('SMTP ' + r.code + ' after ' + line.split(' ')[0] + ': ' + r.text.slice(0, 160)); return r; };
    const b64s = (x) => Buffer.from(x, 'utf8').toString('base64');
    const addr = (x) => { const m = /<([^>]+)>/.exec(String(x)); return (m ? m[1] : String(x)).trim(); };
    (async () => {
      for (const x of [o.from, o.to, o.subject]) if (/[\r\n]/.test(String(x))) throw new Error('bad header');
      await new Promise((res, rej) => { const s = o.secure ? tls.connect({host: o.host, port: o.port, servername: o.host}, res) : net.connect({host: o.host, port: o.port}, res); s.once('error', rej); attach(s); });
      let r = await read(); if (r.code !== 220) throw new Error('SMTP greeting: ' + r.text.slice(0, 120));
      r = await cmd('EHLO ashen-roads', [250]);
      if (!o.secure && o.starttls !== false && /STARTTLS/i.test(r.text)) {
        await cmd('STARTTLS', [220]);
        const raw = sock; raw.removeAllListeners('data'); raw.removeAllListeners('close'); raw.removeAllListeners('error'); raw.on('error', finish);
        const t = tls.connect({socket: raw, servername: o.host});
        await new Promise((res, rej) => { t.once('secureConnect', res); t.once('error', rej); });
        lineBuf = ''; cur = []; queued.length = 0; attach(t);
        await cmd('EHLO ashen-roads', [250]);
      }
      if (o.user) { await cmd('AUTH LOGIN', [334]); await cmd(b64s(o.user), [334]); await cmd(b64s(o.pass), [235]); }
      await cmd('MAIL FROM:<' + addr(o.from) + '>', [250]); await cmd('RCPT TO:<' + o.to + '>', [250, 251]); await cmd('DATA', [354]);
      const bnd = 'ashen' + crypto.randomBytes(8).toString('hex');
      const head = ['From: ' + o.from, 'To: ' + o.to, 'Subject: ' + o.subject, 'Date: ' + new Date().toUTCString().replace('GMT', '+0000'), 'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@ashen-roads>', 'MIME-Version: 1.0',
        o.html ? 'Content-Type: multipart/alternative; boundary="' + bnd + '"' : 'Content-Type: text/plain; charset=utf-8', o.html ? 'Content-Transfer-Encoding: 8bit' : 'Content-Transfer-Encoding: 8bit'];
      const raw = o.html ? ['--' + bnd, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', String(o.text), '--' + bnd, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', String(o.html), '--' + bnd + '--'].join('\r\n') : String(o.text);
      const body = raw.split(/\r?\n/).map(l => l.startsWith('.') ? '.' + l : l).join('\r\n');
      sock.write(head.join('\r\n') + '\r\n\r\n' + body + '\r\n.\r\n');
      r = await read(); if (r.code !== 250) throw new Error('SMTP rejected the message: ' + r.text.slice(0, 160));
      try { sock.write('QUIT\r\n'); } catch (e) {}
      finish();
    })().catch(finish);
  });
}
function smtpConfig() {
  const user = String(process.env.SMTP_USER || '').trim(); let pass = String(process.env.SMTP_PASS || ''), host = String(process.env.SMTP_HOST || '').trim();
  if (!host && /@(gmail|googlemail)\.com$/i.test(user)) host = 'smtp.gmail.com';
  if (!host) return null;
  if (/gmail|google/i.test(host)) pass = pass.replace(/\s+/g, '');   // Google shows app passwords as 4 groups with spaces
  const port = +process.env.SMTP_PORT || 465, secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== '0' : port === 465;
  const from = String(process.env.EMAIL_FROM || (user ? 'Ashen Roads <' + user + '>' : '')).trim();
  if (!from) return null;
  return {host, port, secure, starttls: process.env.SMTP_STARTTLS !== '0', user, pass, from};
}
// -> 'email' (really sent) | 'console' (no email provider set up: the code is printed in the server window, only the server owner can read it)
async function sendOtp(email, code) {
  const apiKey = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (apiKey && from) {
    const endpoint = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && url.hostname === '127.0.0.1')) throw new Error('Resend API URL must use HTTPS.');
    const r = await fetch(url, {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({from, to: [email], subject: OTP_SUBJECT, text: otpText(code), html: otpHtml(code)}),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) {
      let detail = '';
      try { const body = await r.json(); detail = body && body.message ? ': ' + body.message : ''; } catch (e) {}
      throw new Error('Resend rejected the verification email (HTTP ' + r.status + ')' + detail);
    }
    return 'email';
  }
  const sm = smtpConfig();
  if (sm) { await smtpSend({...sm, to: email, subject: OTP_SUBJECT, text: otpText(code), html: otpHtml(code)}); return 'email'; }
  if (process.env.OTP_CONSOLE !== '0') {
    console.log('\n==================== ASHEN ROADS: email is not set up yet ====================\n  Verification code for ' + email + ' :  ' + code + '   (valid 10 minutes)\n  To send real emails fill in the SMTP_ lines in the .env file (see README).\n==============================================================================\n');
    return 'console';
  }
  const e = new Error('Email verification is not configured. Set SMTP_USER + SMTP_PASS (Gmail app password) or RESEND_API_KEY + EMAIL_FROM on the backend.');
  e.code = 'email_not_configured';
  throw e;
}
function sendFailed(res, e) {
  if (e && e.code === 'email_not_configured') return fail(res, 503, e.code, e.message);
  console.error('Auth: could not send the verification email: ' + (e && e.message));
  return fail(res, 502, 'email_failed', 'Could not send the verification email. Check the email address, or ask the server owner to check the email settings (SMTP / Resend).');
}

// ---------------------------------------------------------------- tokens: base64url(payload).HMAC-SHA256
const b64 = (b) => Buffer.from(b).toString('base64url');
function sign(body) { return crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); }
function makeToken(u) {
  const body = b64(JSON.stringify({sub: u.id, u: u.name, v: u.ver, exp: Date.now() + TOKEN_MS}));
  return body + '.' + sign(body);
}
function verifyToken(tok) {   // -> {id, name} or null
  if (typeof tok !== 'string' || tok.length > 400) return null;
  const i = tok.indexOf('.'); if (i < 1) return null;
  const body = tok.slice(0, i), sig = tok.slice(i + 1), want = sign(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (e) { return null; }
  if (!p || !(p.exp > Date.now())) return null;
  if (PHP_MODE) return (typeof p.sub === 'string' && typeof p.u === 'string' && p.sub && p.u) ? {id: p.sub, name: p.u} : null;   // PHP owns the accounts
  const u = users.get(String(p.u || '').toLowerCase());
  if (!u || u.id !== p.sub || u.ver !== p.v) return null;   // account deleted, or "logout everywhere" was used
  return {id: u.id, name: u.name};
}
const bearer = (req) => { const h = String(req.headers.authorization || ''); return /^Bearer /i.test(h) ? h.slice(7).trim() : ''; };

// ---------------------------------------------------------------- administrator and live activity
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();   // v15.50: several admins allowed, comma separated
const ADMINS = new Set(ADMIN_USERNAME.split(',').map(x => x.trim()).filter(Boolean));
function adminAccount(req) {
  const acct = verifyToken(bearer(req));
  return acct && ADMINS.has(acct.name.toLowerCase()) ? acct : null;
}
// ---- v15.43: activity is SAVED (users.json / Upstash): logins, play time, matches, deaths, wins + an event log (database/activity.log)
const EVENTS_FILE = path.join(DATA_DIR, 'activity.log'), recentEvents = [], dirtyUsers = new Set();
let eventsLoaded = false;
function userById(uid) { for (const u of users.values()) if (u.id === uid) return u; return null; }
const stat = (u) => u.stats || (u.stats = {logins: 0, lastLogin: 0, lastActive: 0, playSec: 0, matches: 0, deaths: 0});
function storageInfo() {   // v15.50: for /status - proves where the accounts live (no names, no e-mails, no paths)
  let writable = true; if (!REMOTE && !PHP_MODE) { try { fs.accessSync(DATA_DIR, fs.constants.W_OK); } catch (e) { writable = false; } }
  return {login: PHP_MODE ? 'php' : 'node', storage: (PHP_MODE ? 'php-backend' : REMOTE ? 'upstash-database' : 'database-folder (users.json + players.csv)') + (MY.state.ready ? ' + MySQL "' + MY.state.db + '"' : MY.state.wanted ? ' (MySQL NOT connected: ' + (MY.state.error || 'starting') + ')' : ''), writable, accounts: users.size};
}
function phpForward(uid, type, extra) {   // fire-and-forget: tell the PHP backend what the player did (join / leave / death / win)
  if (!PHP_MODE || !PHP_API_URL) return;
  try {
    const body = JSON.stringify({uid, type, ...(extra || {})});
    fetch(PHP_API_URL + (PHP_API_URL.includes('?') ? '&' : '?') + 'r=event', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Ashen-Key': sign(body)}, body, signal: AbortSignal.timeout(8000)}).catch(() => {});
  } catch (e) {}
}
function deviceOf(req) {   // v15.50: "192.168.29.5 · Chrome / Windows" for the admin activity log (no cookies, nothing secret)
  const ua = String(req.headers['user-agent'] || ''), ip = String(clientIp(req)).replace(/^::ffff:/, '');
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '?';
  return ip + ' · ' + br + ' / ' + os;
}
function logEvent(uid, type, detail, asName) {
  if (PHP_MODE) return;   // the PHP backend keeps the activity log
  const u = userById(uid), ev = {t: Date.now(), user: u ? u.name : (asName || '?'), type, detail: String(detail || '').slice(0, 120)};
  recentEvents.push(ev); if (recentEvents.length > 300) recentEvents.shift();
  try {
    if (REMOTE) rcmd(['LPUSH', 'ashen:events', JSON.stringify(ev)]).then(() => rcmd(['LTRIM', 'ashen:events', 0, 999])).catch(() => {});
    else fs.appendFile(EVENTS_FILE, JSON.stringify(ev) + '\n', () => {});
  } catch (e) {}
}
function bumpActive(u) { const s = stat(u), n = Date.now(); if (n - s.lastActive > 60000) { s.lastActive = n; dirtyUsers.add(u); } }
async function flushUsers() { for (const u of [...dirtyUsers]) { dirtyUsers.delete(u); try { await saveUser(u); } catch (e) { dirtyUsers.add(u); } } }
setInterval(flushUsers, 15000).unref();
async function adminEvents() {
  if (REMOTE) { try { return (await rcmd(['LRANGE', 'ashen:events', 0, 99])).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean); } catch (e) { return []; } }
  if (!eventsLoaded) { eventsLoaded = true; try { const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean).slice(-300); const old = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); recentEvents.unshift(...old.slice(0, Math.max(0, old.length - recentEvents.length))); } catch (e) {} }
  return recentEvents.slice(-100).reverse();
}
function recordDeath(uid) { if (PHP_MODE) return phpForward(uid, 'death', {}); const u = userById(uid); if (!u) return; stat(u).deaths++; dirtyUsers.add(u); logEvent(uid, 'death', ''); }
function adminCsv() { return buildCsv(); }
function trackSession(uid, sessionId, session) {
  let a = activity.get(uid);
  if (!a) { a = {lastActive: Date.now(), sessions: new Map()}; activity.set(uid, a); }
  a.lastActive = Date.now();
  a.sessions.set(sessionId, {...session, connectedAt: Date.now(), lastActive: Date.now()});
  const u = userById(uid); if (u) { if (session.page === 'game') stat(u).matches++; bumpActive(u); dirtyUsers.add(u); }
  logEvent(uid, 'join', (session.page || '') + ' · room ' + (session.room || ''));
  phpForward(uid, 'join', {page: session.page || '', detail: (session.page || '') + ' · room ' + (session.room || '')});
}
function touchSession(uid, sessionId, phase) {
  const a = activity.get(uid);
  if (!a) return;
  const _u = userById(uid); if (_u) bumpActive(_u);
  const s = a.sessions.get(sessionId);
  if (s) { s.lastActive = Date.now(); if (phase) s.phase = phase; }
  a.lastActive = Date.now();
}
function removeSession(uid, sessionId) {
  const a = activity.get(uid);
  if (!a) return;
  const _s = a.sessions.get(sessionId);
  if (_s) { const u = userById(uid), sec = Math.max(0, Math.round((Date.now() - _s.connectedAt) / 1000)); if (u && _s.page === 'game') { stat(u).playSec += sec; dirtyUsers.add(u); } logEvent(uid, 'leave', (_s.page || '') + ' · ' + Math.round(sec / 60 * 10) / 10 + ' min'); phpForward(uid, 'leave', {page: _s.page || '', sec, detail: (_s.page || '') + ' · ' + Math.round(sec / 60 * 10) / 10 + ' min'}); }
  a.sessions.delete(sessionId);
  a.lastActive = Date.now();
}
function touchAccount(uid) {
  const _u = userById(uid); if (_u) bumpActive(_u);
  let a = activity.get(uid);
  if (!a) { a = {lastActive: 0, sessions: new Map()}; activity.set(uid, a); }
  a.lastActive = Date.now();
}
function adminPlayers() {
  return [...users.values()].map(u => {
    const a = activity.get(u.id);
    return {
      name: u.name, email: u.email || '', created: u.created || 0,
      wins: Number.isSafeInteger(u.wins) ? u.wins : 0,
      logins: (u.stats && u.stats.logins) | 0, lastLogin: (u.stats && u.stats.lastLogin) || 0, playMinutes: Math.round(((u.stats && u.stats.playSec) || 0) / 60),
      matches: (u.stats && u.stats.matches) | 0, deaths: (u.stats && u.stats.deaths) | 0,
      lastActive: Math.max(a ? a.lastActive : 0, (u.stats && u.stats.lastActive) || 0),
      online: !!(a && a.sessions.size),
      sessions: a ? [...a.sessions.values()].map(s => ({room: s.room, page: s.page, phase: s.phase, lastActive: s.lastActive})) : []
    };
  });
}
async function recordWin(uid) {
  if (PHP_MODE) { phpForward(uid, 'win', {detail: 'last survivor'}); return true; }
  const u = [...users.values()].find(x => x.id === uid);
  if (!u) return false;
  u.wins = (Number.isSafeInteger(u.wins) ? u.wins : 0) + 1;
  logEvent(uid, 'win', 'last survivor');
  await saveUser(u);
  return true;
}

// ---------------------------------------------------------------- brute-force protection
const ipHits = new Map(), fails = new Map();   // ip -> {n, t0}   |   username -> {n, until, t0}
function clientIp(req) {
  if (TRUST_PROXY) { const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (x) return x; }
  return req.socket.remoteAddress || '?';
}
function ipLimited(ip) {   // 30 login/register requests per minute per address
  const now = Date.now(); let b = ipHits.get(ip);
  if (!b || now - b.t0 > 60000) { b = {n: 0, t0: now}; ipHits.set(ip, b); }
  return ++b.n > 30;
}
const locked = (name) => { const f = fails.get(name); return !!f && f.until > Date.now(); };
function noteFail(name) {   // 6 wrong passwords for one account -> that account is locked for 5 minutes
  const now = Date.now(); let f = fails.get(name);
  if (!f || now - f.t0 > 900000) f = {n: 0, until: 0, t0: now};
  if (++f.n >= 6) { f.until = now + 300000; f.n = 0; f.t0 = now; }
  fails.set(name, f);
}
setInterval(() => { const now = Date.now(); for (const [k, b] of ipHits) if (now - b.t0 > 60000) ipHits.delete(k); for (const [k, f] of fails) if (f.until < now && now - f.t0 > 900000) fails.delete(k); }, 60000).unref();

// ---------------------------------------------------------------- HTTP
const HEAD = {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'X-Content-Type-Options': 'nosniff'};
const reply = (res, code, o) => { res.writeHead(code, HEAD); res.end(JSON.stringify(o)); };
const fail = (res, code, error, message) => reply(res, code, {ok: false, error, message});
function readJson(req, cb) {
  let n = 0; const ch = [];
  req.on('data', c => { n += c.length; if (n > 4096) { req.destroy(); return; } ch.push(c); });
  req.on('end', () => { try { const o = JSON.parse(Buffer.concat(ch).toString() || '{}'); cb(o && typeof o === 'object' ? o : null); } catch (e) { cb(null); } });
  req.on('error', () => {});
}
const publicUser = (u) => ({id: u.id, name: u.name});

async function register(req, res, b) {
  const name = typeof b.username === 'string' ? b.username.trim() : '', pw = typeof b.password === 'string' ? b.password : '';
  if (!USER_RE.test(name)) return fail(res, 400, 'bad_username', 'Username must be 3-14 letters, numbers or _ (no spaces).');
  if (pw.length < MIN_PASS || pw.length > MAX_PASS) return fail(res, 400, 'bad_password', 'Password must be at least ' + MIN_PASS + ' characters.');
  const key = name.toLowerCase();
  if (await findUser(key)) return fail(res, 409, 'taken', 'That username is already taken. Pick another one, or log in if it is yours.');
  const salt = crypto.randomBytes(16), hash = await scrypt(pw, salt);
  const u = {id: crypto.randomBytes(8).toString('hex'), name, email: '', salt: salt.toString('hex'), hash: hash.toString('hex'), ver: 1, created: Date.now()};
  if (REMOTE && await rcmd(['SET', UKEY(key), JSON.stringify(u), 'NX']) !== 'OK') return fail(res, 409, 'taken', 'That username is already taken. Pick another one, or log in if it is yours.');
  users.set(key, u);
  try {
    if (!REMOTE) saveUsers();
  } catch (e) {
    users.delete(key);
    throw e;
  }
  const s = stat(u); s.logins = 1; s.lastLogin = s.lastActive = Date.now(); dirtyUsers.add(u);
  logEvent(u.id, 'register', deviceOf(req));
  reply(res, 201, {ok: true, token: makeToken(u), user: publicUser(u)});
}
async function verifyEmail(req, res, b) {
  const name = typeof b.username === 'string' ? b.username.trim() : '', email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const code = typeof b.code === 'string' ? b.code.trim() : '', key = name.toLowerCase();
  if (!USER_RE.test(name) || !EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return fail(res, 400, 'bad_code', 'Enter the 6-digit email code.');
  const p = await getPending(key);
  if (!p || p.email !== email) return fail(res, 400, 'expired', 'That verification request expired. Start account creation again.');
  if (p.expires <= Date.now()) { await removePending(key); return fail(res, 400, 'expired', 'That code expired. Start account creation again.'); }
  const got = otpHash(p.otpSalt, code), want = Buffer.from(p.otpHash, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
    p.attempts++;
    if (p.attempts >= OTP_TRIES) { await removePending(key); return fail(res, 429, 'too_many_codes', 'Too many incorrect codes. Start account creation again.'); }
    await savePendingRegistration(p, false);
    return fail(res, 400, 'bad_code', 'That code is incorrect. Check your email and try again.');
  }
  if (await findUser(key)) { await removePending(key); return fail(res, 409, 'taken', 'That username is already taken.'); }
  if (await findEmail(email)) { await removePending(key); return fail(res, 409, 'email_taken', 'That email is already linked to an account.'); }
  if (REMOTE && await rcmd(['SET', EKEY(email), key, 'NX']) !== 'OK') { await removePending(key); return fail(res, 409, 'email_taken', 'That email is already linked to an account.'); }
  const u = {id: crypto.randomBytes(8).toString('hex'), name: p.name, email, salt: p.salt, hash: p.hash, ver: 1, created: Date.now()};
  if (REMOTE && await rcmd(['SET', UKEY(key), JSON.stringify(u), 'NX']) !== 'OK') {
    await rcmd(['DEL', EKEY(email)]);
    await removePending(key);
    return fail(res, 409, 'taken', 'That username is already taken.');
  }
  users.set(key, u);
  try {
    if (!REMOTE) saveUsers();
  } catch (e) {
    users.delete(key);
    throw e;
  }
  try { await removePending(key); }
  catch (e) { console.error('Auth: verified account saved, but pending registration cleanup failed: ' + e.message); }
  { const s = stat(u); s.logins = 1; s.lastLogin = s.lastActive = Date.now(); dirtyUsers.add(u); logEvent(u.id, 'register', email + ' · ' + deviceOf(req)); }
  reply(res, 201, {ok: true, token: makeToken(u), user: publicUser(u)});
}
async function resendOtp(req, res, b) {
  const name = typeof b.username === 'string' ? b.username.trim() : '', email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!USER_RE.test(name) || !EMAIL_RE.test(email)) return fail(res, 400, 'bad_request', 'Enter a valid username and email.');
  const key = name.toLowerCase(), p = await getPending(key);
  if (!p || p.email !== email || p.expires <= Date.now()) return reply(res, 202, {ok: true});
  const otp = createOtp();
  p.otpSalt = otp.salt; p.otpHash = otp.hash; p.expires = Date.now() + OTP_MS; p.attempts = 0;
  await savePendingRegistration(p, false);
  let delivery; try { delivery = await sendOtp(email, otp.code); } catch (e) { return sendFailed(res, e); }
  reply(res, 200, {ok: true, delivery});
}
async function login(req, res, b) {
  const name = typeof b.username === 'string' ? b.username.trim() : '', pw = typeof b.password === 'string' ? b.password : '';
  if (!name || !pw || pw.length > MAX_PASS) return fail(res, 400, 'missing', 'Enter your username and password.');
  const key = name.toLowerCase();
  if (locked(key)) return fail(res, 429, 'locked', 'Too many wrong passwords. Try again in a few minutes.');
  const u = await findUser(key);
  const got = await scrypt(pw, u ? Buffer.from(u.salt, 'hex') : DUMMY_SALT);
  if (!u || !crypto.timingSafeEqual(got, Buffer.from(u.hash, 'hex'))) { noteFail(key); logEvent(u ? u.id : 0, 'login_failed', (u ? 'wrong password' : 'unknown username') + ' · ' + deviceOf(req), name.replace(/[<>\u0000-\u001f]/g, '').slice(0, 14)); return fail(res, 401, 'invalid', 'Wrong username or password.'); }
  fails.delete(key);
  { const s = stat(u); s.logins++; s.lastLogin = s.lastActive = Date.now(); dirtyUsers.add(u); logEvent(u.id, 'login', deviceOf(req)); }
  reply(res, 200, {ok: true, token: makeToken(u), user: publicUser(u)});
}

// returns true when the request was an /api/ request (and has been answered)
function handleHttp(req, res, url) {
  if (!url.startsWith('/api/')) return false;
  if (req.method === 'OPTIONS') { res.writeHead(204, HEAD); res.end(); return true; }
  if (url === '/api/me' && req.method === 'GET') {
    const a = verifyToken(bearer(req));
    if (!a) fail(res, 401, 'unauthorized', 'Please log in.');
    else { touchAccount(a.id); reply(res, 200, {ok: true, user: {...a, admin: ADMINS.has(a.name.toLowerCase())}}); }
    return true;
  }
  if (url === '/api/logout-all' && req.method === 'POST') {
    const a = verifyToken(bearer(req));
    if (!a) { fail(res, 401, 'unauthorized', 'Please log in.'); return true; }
    const u = [...users.values()].find(x => x.id === a.id);
    if (u) { u.ver++; saveUser(u).then(() => reply(res, 200, {ok: true}), () => { u.ver--; fail(res, 500, 'server', 'Server error, try again.'); }); } else reply(res, 200, {ok: true});
    return true;
  }
  if ((url === '/api/register' || url === '/api/login') && req.method === 'POST') {
    if (ipLimited(clientIp(req))) { fail(res, 429, 'slow_down', 'Too many attempts. Wait a minute and try again.'); return true; }
    readJson(req, (b) => {
      if (!b) return fail(res, 400, 'bad_request', 'Bad request.');
      const action = url === '/api/register' ? register : login;
      action(req, res, b).catch((e) => { console.error('Auth error:', e && e.message); if (!res.headersSent) fail(res, 500, 'server', 'Server error, try again.'); });
    });
    return true;
  }
  fail(res, 404, 'not_found', 'Unknown API.'); return true;
}

module.exports = {storageInfo, _smtpSend: smtpSend, AUTH_REQUIRED, handleHttp, verifyToken, adminAccount, adminPlayers, adminEvents, adminCsv, recordDeath, flushUsers, trackSession, touchSession, removeSession, touchAccount, recordWin, ready};
