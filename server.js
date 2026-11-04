// Ashen Roads online server v15.26 — zero dependencies. Run: node server/server.js  (needs Node 16+)
// Serves the game files AND the multiplayer WebSocket on the same port.
//
// Accounts: see server/auth.js (AUTH_REQUIRED=0 turns the login requirement off, e.g. for tests).
// Environment (all optional): PORT, MAX_PLAYERS (8), KEEP_ALIVE (1), MIN_PLAYERS (2), CD_MS (6000), LOAD_TIMEOUT (90000), HOP_GRACE (60000),
//   END_GRACE (10000), ALLOWED_ORIGINS (comma list; empty = any), TURN_URL / TURN_USER / TURN_PASS (voice relay).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
// optional .env file next to index.html: lines KEY=value (email settings etc.). Real environment variables win.
try { for (const ln of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(ln); if (m && !/^\s*#/.test(ln)) { let v = m[2]; if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1); if (process.env[m[1]] === undefined) process.env[m[1]] = v; } } } catch (e) {}
const auth = require('./auth');   // accounts: /api/register, /api/login, /api/me + token check for the WebSocket

const LAN_IPS = Object.values(require('os').networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
process.on('uncaughtException', (e) => console.error('Server error (kept running):', e && e.stack || e));   // one bad message must never take every room down
process.on('unhandledRejection', (e) => console.error('Server error (kept running):', e));
let PORT = +process.env.PORT || 8000;
const ROOT = path.resolve(__dirname, '..');
const MAX_PER_ROOM = +process.env.MAX_PLAYERS || 8;            // the lobby screen shows 8 seats, so the server allows 8 (it used to say 20 and the 9th+ player was invisible in the lobby but still blocked the countdown)
const MIN_PLAYERS = +process.env.MIN_PLAYERS || 2, CD_MS = +process.env.CD_MS || 6000;
const LOAD_TIMEOUT = +process.env.LOAD_TIMEOUT || 90000;       // longest the squad waits at the start line for a slow loader (he can still join late)
const HOP_GRACE = +process.env.HOP_GRACE || 60000;             // a player who left the lobby and never opened the game page stops being waited for after this
const END_GRACE = +process.env.END_GRACE || 10000;             // nobody alive any more -> the room goes back to LOBBY after this
const KEEP_LOBBY = +process.env.KEEP_LOBBY_MS || 120000, KEEP_PLAYING = +process.env.KEEP_PLAYING_MS || 60000;   // how long an EMPTY room is kept (lobby<->game page hop / mass reconnect)
const TICK_MS = +process.env.TICK_MS || 66;                    // 15 Hz position batches
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const MG_DMG = +process.env.MG_DMG || 9, MG_ID0 = 900, MG_IDS = 10;   // machine gun: 9 per bullet (rifle 25) - only a player who really picked up a machine gun (loot ids 900-909) may fire it
const GUN_DMG = 25, HIT_TOLERANCE = +process.env.HIT_TOLERANCE || 4;   // metres a target may be off the shot line (interpolation + latency)
const MAX_FRAME = 64 * 1024;                                    // biggest legitimate message is a WebRTC offer (a few KB)

// ---------------------------------------------------------------- static files
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon',
  '.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream','.txt':'text/plain; charset=utf-8','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.m4a':'audio/mp4','.woff':'font/woff','.woff2':'font/woff2','.map':'application/json'};
const GZIP_EXT = new Set(['.html', '.js', '.css', '.json', '.gltf', '.svg', '.txt', '.bin', '.map']);   // .glb/.png/.jpg/.mp3 are already compressed
const gzCache = new Map();   // file -> {etag, buf}
const JSON_HEAD = {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'};

function serveStatic(req, res) {
  let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end('Bad request'); }   // a malformed %-escape used to hang the request
  if (p.includes('\0')) { res.writeHead(400); return res.end('Bad request'); }
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p), rel = path.relative(ROOT, file), parts = rel.split(path.sep);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || parts[0] === 'server' || parts[0] === 'database' || parts.some(s => s.startsWith('.'))) { res.writeHead(403); return res.end('Forbidden'); }   // path.relative (not startsWith) so /app-secret can't pass for /app
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase(), etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const headers = {'Content-Type': MIME[ext] || 'application/octet-stream', 'ETag': etag, 'Vary': 'Accept-Encoding',
      'Cache-Control': parts[0] === 'assets' ? 'public, max-age=3600' : 'no-cache'};   // code is revalidated (cheap 304), the heavy models/textures are cached for an hour -> a refresh no longer re-downloads 80 MB
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    const wantGz = GZIP_EXT.has(ext) && st.size > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (wantGz) {
      const c = gzCache.get(file);
      const send = (buf) => { headers['Content-Encoding'] = 'gzip'; headers['Content-Length'] = buf.length; res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : buf); };
      if (c && c.etag === etag) return send(c.buf);
      return fs.readFile(file, (e, data) => { if (e) { res.writeHead(500); return res.end('Error'); } zlib.gzip(data, {level: 6}, (e2, buf) => { if (e2) { res.writeHead(500); return res.end('Error'); } gzCache.set(file, {etag, buf}); send(buf); }); });
    }
    headers['Content-Length'] = st.size; res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const rs = fs.createReadStream(file); rs.on('error', () => res.destroy()); res.on('close', () => rs.destroy()); rs.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/common') {   // live info for the COMMON ROOM button (players online + phase)
    const r = rooms.get(COMMON_CODE);
    res.writeHead(200, JSON_HEAD);
    return res.end(JSON.stringify({code: COMMON_CODE, players: r ? r.players.size : 0, max: MAX_PER_ROOM, phase: r ? r.phase : 'lobby'}));
  }
  if (url === '/ice') {   // WebRTC servers for voice chat; set TURN_URL (comma list), TURN_USER, TURN_PASS to add a relay for strict networks
    const ice = [{urls: 'stun:stun.l.google.com:19302'}, {urls: 'stun:stun1.l.google.com:19302'}];
    if (process.env.TURN_URL) ice.push({urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || ''});
    res.writeHead(200, JSON_HEAD); return res.end(JSON.stringify({iceServers: ice}));
  }
  if (url === '/audio-manifest') {   // lists the real sound files in assets/audio so the game only requests files that exist
    let files = []; try { files = fs.readdirSync(path.join(ROOT, 'assets', 'audio')).filter(f => /\.(mp3|ogg|wav|m4a)$/i.test(f)); } catch (e) {}
    res.writeHead(200, JSON_HEAD); return res.end(JSON.stringify({files}));
  }
  if (url === '/status') { res.writeHead(200, JSON_HEAD); return res.end(JSON.stringify({ok: true, version: '15.50', ...auth.storageInfo()})); }   // v15.50: open http://<host>:<port>/status to see where login data is stored
  if (url === '/health') { res.writeHead(200, {'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'}); return res.end('ok'); }   // lets the game pages check that this server is running
  if (url === '/api/leaderboard' && req.method === 'GET') {   // v15.47: PUBLIC rank list (names + stats, no e-mails)
    const list = auth.adminPlayers().slice().sort((a, b) => b.wins - a.wins || b.matches - a.matches || a.deaths - b.deaths || a.created - b.created);
    res.writeHead(200, JSON_HEAD);
    return res.end(JSON.stringify({ok: true, total: list.length, players: list.slice(0, 50).map(p => ({name: p.name, wins: p.wins, matches: p.matches || 0, deaths: p.deaths || 0, playMinutes: p.playMinutes || 0, online: !!p.online}))}));
  }
  if (url === '/api/admin/overview' && req.method !== 'OPTIONS') {
    const admin = auth.adminAccount(req);
    if (!admin) { res.writeHead(403, JSON_HEAD); return res.end(JSON.stringify({ok: false, message: 'Admin access is not enabled for this account.'})); }
    const players = auth.adminPlayers();
    const liveRooms = [...rooms.values()].filter(r => r.players.size).map(r => ({
      code: r.code, phase: r.phase,
      players: [...r.players.values()].map(p => ({name: p.name, page: p.pg, dead: !!p.dead}))
    }));
    return auth.adminEvents().then((events) => {
      res.writeHead(200, JSON_HEAD);
      res.end(JSON.stringify({
        ok: true, totals: {registered: players.length, online: players.filter(p => p.online).length, rooms: liveRooms.length},
        topPlayers: players.slice().sort((a, b) => b.wins - a.wins || b.created - a.created).slice(0, 5),
        registeredPlayers: players.sort((a, b) => b.created - a.created), rooms: liveRooms, events
      }));
    }).catch(() => { res.writeHead(500, JSON_HEAD); res.end(JSON.stringify({ok: false, message: 'Could not read the activity log.'})); });
  }
  if (url === '/api/admin/export.csv' && req.method === 'GET') {   // v15.43: download all players + activity as an Excel-readable file
    if (!auth.adminAccount(req)) { res.writeHead(403, JSON_HEAD); return res.end(JSON.stringify({ok: false, message: 'Admin access is not enabled for this account.'})); }
    res.writeHead(200, {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ashen-roads-players.csv"', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'});
    return res.end(auth.adminCsv());
  }
  if (auth.handleHttp(req, res, url)) return;   // login / register / me
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
  serveStatic(req, res);
});

// ---------------------------------------------------------------- minimal WebSocket (RFC 6455)
function wsFrame(str) {   // one text frame, built ONCE and then written to every recipient
  const payload = Buffer.from(str), len = payload.length; let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
function rawWrite(sock, buf) { if (sock.destroyed || !sock.writable) return; try { sock.write(buf); } catch (e) {} }
function wsParse(sock, onMessage) {   // returns feed(chunk); handles fragmentation, ping/pong, close
  let buf = Buffer.alloc(0), fragParts = null, fragLen = 0;
  return function feed(chunk) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = !!(buf[0] & 0x80), op = buf[0] & 0x0f, masked = !!(buf[1] & 0x80); let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > MAX_FRAME) return sock.destroy();   // browsers always mask; anything oversized is abuse
      if (buf.length < off + 4 + len) return;
      const m = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 8) { rawWrite(sock, Buffer.from([0x88, 0])); return sock.end(); }
      if (op === 9) { if (data.length < 126) rawWrite(sock, Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        if (op === 1) { fragParts = []; fragLen = 0; }
        if (!fragParts) continue;
        fragParts.push(data); fragLen += data.length;
        if (fragLen > MAX_FRAME) return sock.destroy();
        if (fin) { const txt = Buffer.concat(fragParts).toString(); fragParts = null; onMessage(txt); }
      }
    }
  };
}

// ---------------------------------------------------------------- rooms
const COMMON_CODE = 'COMMON';   // the always-open public room anybody can join without a code
const rooms = new Map();
let nextId = 1;
// Every socket is either a LOBBY page (pg 'lobby') or a GAME page (pg 'game'). They are kept apart: when a squad hops lobby -> game, the old lobby sockets
// used to show up as ghost players in the game (counted as enemies, so you could never win) and game sockets used to break the lobby countdown.
const isLobby = p => p.pg === 'lobby', isGame = p => p.pg === 'game';
const keyOf = p => p.cid || ('id' + p.id);   // cid = per-tab id sent by the client, the same in the lobby page and the game page -> we know it is the same person
const send = (p, o) => rawWrite(p.sock, wsFrame(JSON.stringify(o)));
function bcast(room, pg, o, exceptId) { const f = wsFrame(JSON.stringify(o)); for (const p of room.players.values()) if (p.pg === pg && p.id !== exceptId) rawWrite(p.sock, f); }
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L so codes are easy to read out loud
const genCode = () => Array.from({length: 5}, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
const newSeed = () => crypto.randomInt(1, 2 ** 31);
function newRoom(code) {
  return {code, players: new Map(), seed: newSeed(), picked: new Set(), phase: 'lobby', matchStart: 0, cd: null, delTimer: null, loadTimer: null, endTimer: null,
    expect: new Set(), loaded: new Set(), grace: new Map(), lastHit: new Map(), fate: new Map(), participants: new Set(), winner: ''};   // fate: player key -> 'dead' | 'done' for this match
}
function clearTimers(room) {
  clearTimeout(room.cd); clearTimeout(room.delTimer); clearTimeout(room.loadTimer); clearTimeout(room.endTimer);
  room.cd = room.delTimer = room.loadTimer = room.endTimer = null;
  for (const t of room.grace.values()) clearTimeout(t); room.grace.clear();
}
function allow(p, key, cap, perSec) {   // token bucket per player and message kind
  const now = Date.now(), b = p.rl[key] || (p.rl[key] = {t: cap, l: now});
  b.t = Math.min(cap, b.t + (now - b.l) * perSec / 1000); b.l = now;
  if (b.t < 1) return false; b.t -= 1; return true;
}
const num = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const vec3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? a.map(v => Math.max(-5000, Math.min(5000, v))) : null;

// ---- match flow: LOBBY (everyone ready) -> COUNTDOWN -> LAUNCH -> LOADING (barrier) -> PLAYING (everybody begins together) -> (nobody alive) -> LOBBY again
function evalLobby(room) {
  if (room.phase !== 'lobby') return;
  const ps = [...room.players.values()].filter(isLobby), ok = ps.length >= MIN_PLAYERS && ps.every(p => p.ready);
  if (ok && !room.cd) { room.cd = setTimeout(() => launchRoom(room), CD_MS); bcast(room, 'lobby', {t: 'cd', ms: CD_MS}); }
  else if (!ok && room.cd) { clearTimeout(room.cd); room.cd = null; bcast(room, 'lobby', {t: 'cdcancel'}); }
}
function launchRoom(room) {          // everyone is told to open the game page at the same moment
  if (room.phase !== 'lobby') return;
  clearTimeout(room.cd); room.cd = null;
  room.phase = 'loading'; room.expect = new Set(); room.loaded = new Set();
  for (const p of room.players.values()) if (isLobby(p)) room.expect.add(keyOf(p));   // we wait for PEOPLE (cid), not sockets: a reload / reconnect can no longer be counted twice
  bcast(room, 'lobby', {t: 'launch'});
  room.loadTimer = setTimeout(() => beginMatch(room), LOAD_TIMEOUT);   // don't wait forever for a player who closed the tab (he can still join late)
}
const liveGameWithKey = (room, k) => [...room.players.values()].some(p => isGame(p) && keyOf(p) === k);
function armGrace(room, k) {   // someone left the lobby: give him HOP_GRACE to open the game page, then stop waiting for him
  if (room.grace.has(k)) return;
  room.grace.set(k, setTimeout(() => {
    room.grace.delete(k);
    if (room.phase !== 'loading' || room.loaded.has(k)) return;
    room.expect.delete(k); announceWait(room); checkBarrier(room);
  }, HOP_GRACE));
}
function clearGrace(room, k) { const t = room.grace.get(k); if (t) { clearTimeout(t); room.grace.delete(k); } }
function announceWait(room) { let n = 0; for (const k of room.expect) if (room.loaded.has(k)) n++; bcast(room, 'game', {t: 'wait', ready: n, total: room.expect.size}); }
function checkBarrier(room) {
  if (room.phase !== 'loading') return;
  for (const k of room.expect) if (!room.loaded.has(k)) return;
  beginMatch(room);
}
function beginMatch(room) {          // all players have loaded the game -> start for everybody at once
  if (room.phase === 'playing') return;
  clearTimeout(room.loadTimer); room.loadTimer = null;
  for (const t of room.grace.values()) clearTimeout(t); room.grace.clear();
  room.phase = 'playing'; room.matchStart = Date.now();
  for (const p of room.players.values()) if (isGame(p) && p.inready) send(p, {t: 'begin', elapsed: 0});
  checkOver(room);
}
function resetRoom(room) {           // match is over: fresh seed, back to the lobby (no more joining a finished match at minute 12 in a 10 m zone)
  clearTimeout(room.cd); clearTimeout(room.loadTimer); clearTimeout(room.endTimer); room.cd = room.loadTimer = room.endTimer = null;
  for (const t of room.grace.values()) clearTimeout(t); room.grace.clear();
  room.phase = 'lobby'; room.seed = newSeed(); room.picked.clear(); room.matchStart = 0; room.expect = new Set(); room.loaded = new Set(); room.lastHit.clear(); room.fate.clear(); room.participants.clear(); room.winner = '';
  for (const p of room.players.values()) { p.dead = p.done = p.inready = p.dirty = false; if (isGame(p)) p.s = null; }
  evalLobby(room);
}
function checkOver(room) {           // nobody alive in the game pages any more -> after END_GRACE the room returns to the lobby
  if (room.phase !== 'playing') return;
  const gamePlayers = [...room.players.values()].filter(isGame), survivors = gamePlayers.filter(p => !p.dead && !p.done);
  if (!room.winner && room.participants.size >= 2 && survivors.length === 1) {
    const winner = survivors[0];
    room.winner = winner.uid;
    bcast(room, 'game', {t: 'win', id: winner.id, name: winner.name});
    auth.recordWin(winner.uid).catch(e => console.error('Auth: failed to record multiplayer win: ' + e.message));
  }
  if (survivors.length > 0 || gamePlayers.length === 0) { clearTimeout(room.endTimer); room.endTimer = null; return; }
  if (room.endTimer) return;
  room.endTimer = setTimeout(() => { room.endTimer = null; if (rooms.get(room.code) !== room || room.phase !== 'playing') return;
    for (const p of room.players.values()) if (isGame(p) && !p.dead && !p.done) return; resetRoom(room); }, END_GRACE);
}
function armDelete(room) {           // empty room: keep it a while (lobby -> game page hop, or everybody reconnecting after a network blip), then forget it
  clearTimeout(room.delTimer);
  const ms = room.phase === 'lobby' ? KEEP_LOBBY : room.phase === 'loading' ? LOAD_TIMEOUT + 30000 : KEEP_PLAYING;
  room.delTimer = setTimeout(() => { if (!room.players.size && rooms.get(room.code) === room) { clearTimers(room); rooms.delete(room.code); } }, ms);
}

// ---------------------------------------------------------------- connections
server.on('upgrade', (req, sock, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return sock.destroy();
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) { try { if (new URL(origin).host !== req.headers.host) { sock.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return sock.destroy(); } } catch (e) { return sock.destroy(); } }
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  sock.setNoDelay(true);   // no Nagle delay on tiny position packets
  let me = null, room = null, lastSeen = Date.now(), closed = false;
  const conn = {t: 600, l: Date.now()};   // per-socket flood guard (WebRTC setup for a full room legitimately bursts a few hundred small messages)
  const hb = setInterval(() => {
    if (sock.destroyed) return;
    if (Date.now() - lastSeen > 60000) { sock.destroy(); return; }   // half-open connection (phone locked / left Wi-Fi): drop the ghost player
    rawWrite(sock, Buffer.from([0x89, 0]));   // WebSocket ping keeps idle connections alive through proxies
  }, 15000);
  const joinTimer = setTimeout(() => { if (!me) sock.destroy(); }, 10000);
  const feed = wsParse(sock, raw => {
    const now = Date.now(); conn.t = Math.min(600, conn.t + (now - conn.l) * 0.3); conn.l = now; if (conn.t < 1) return; conn.t -= 1;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (m.t === 'join') { if (!me) join(m); return; }
    if (!me || !room) return;
    handle(m);
  });
  sock.on('data', c => { lastSeen = Date.now(); feed(c); });
  if (head && head.length) feed(head);
  // ----- join
  function join(m) {
    const pg = m.pg === 'game' ? 'game' : 'lobby';
    // AUTHORIZATION: nobody enters a lobby or a match without a valid login token; the display name is the ACCOUNT name (can't be faked)
    let acct = null;
    if (auth.AUTH_REQUIRED) {
      acct = auth.verifyToken(m.token);
      if (!acct) { rawWrite(sock, wsFrame(JSON.stringify({t: 'err', code: 'unauth'}))); return sock.end(); }
    }
    const cid = typeof m.cid === 'string' ? m.cid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) : '';
    let code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
    if (m.mode === 'create') { do { code = genCode(); } while (rooms.has(code)); }   // CREATE ROOM: the server invents a short unique code to share
    else if (m.mode === 'common') code = COMMON_CODE;   // COMMON ROOM: one shared public room, created on first visit, joined by everybody after
    else if (!code) code = 'PUBLIC';
    let r = rooms.get(code);
    if (m.mode === 'join' && !r) { rawWrite(sock, wsFrame(JSON.stringify({t: 'err', code: 'notfound'}))); return sock.end(); }   // JOIN ROOM only joins a room that exists
    if (!r) { r = newRoom(code); rooms.set(code, r); }
    clearTimeout(r.delTimer); r.delTimer = null;
    // a player coming back after a network blip replaces his own half-open ghost at once (and stays dead if he had died)
    let carryDead = false, carryDone = false;
    if (m.re && cid) {
      for (const o of [...r.players.values()]) if (o.cid === cid && o.pg === pg) { carryDead = o.dead; carryDone = o.done; o.kick(); }
      const f = r.fate.get(cid); if (f === 'dead') carryDead = true; else if (f === 'done') carryDone = true;   // his old socket may already be gone: the room remembers how his match ended
    }
    // somebody arriving FRESH (lobby, or a new game page / restart) at a room whose match nobody is alive in any more gets a fresh match, not a finished one.
    // An automatic reconnect (m.re) never resets: that player is still in his match.
    if (r.phase === 'playing' && !m.re && ![...r.players.values()].some(p => isGame(p) && !p.dead && !p.done)) resetRoom(r);
    if ([...r.players.values()].filter(p => p.pg === pg).length >= MAX_PER_ROOM) { rawWrite(sock, wsFrame(JSON.stringify({t: 'full'}))); return sock.end(); }
    // unique display names inside a room ("Survivor", "Survivor 2" ...) so chat and the kill feed are readable
    const base = String(acct ? acct.name : (m.name || '')).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Survivor'; let name = base;
    for (let n = 2; [...r.players.values()].some(p => p.pg === pg && p.name === name); n++) { const suf = ' ' + n; name = base.slice(0, 14 - suf.length) + suf; }
    room = r;
    me = {id: nextId++, uid: acct ? acct.id : '', sock, name, cid, pg, s: null, dirty: false, ready: false, dead: carryDead, done: carryDone, inready: false, rl: {}, kick: null};
    me.kick = () => { leave(); sock.destroy(); };
    const k = keyOf(me);
    if (acct) {
      auth.trackSession(acct.id, me.id, {room: code, page: pg, phase: r.phase});
      if (pg === 'game') r.participants.add(acct.id);
    }
    send(me, {t: 'welcome', id: me.id, name, room: code, max: MAX_PER_ROOM, port: +PORT, lan: LAN_IPS, seed: room.seed,
      elapsed: room.phase === 'playing' ? (Date.now() - room.matchStart) / 1000 : 0, phase: room.phase, expect: room.expect.size, picked: [...room.picked],
      players: [...room.players.values()].filter(p => p.pg === pg).map(p => ({id: p.id, name: p.name, dead: !!p.dead}))});
    if (pg === 'game') {   // everybody already in the match is shown at once (positions are only re-sent when they change)
      const snap = [...room.players.values()].filter(p => isGame(p) && p.s).map(p => p.s);
      if (snap.length) send(me, {t: 's', p: snap});
    }
    room.players.set(me.id, me);
    if (room.phase === 'loading') { if (pg === 'lobby') room.expect.add(k); else clearGrace(room, k); }   // joined through the lobby while the squad is loading -> wait for him too
    bcast(room, pg, {t: 'joined', id: me.id, name, dead: !!me.dead}, me.id);   // dead: a dead player who reconnects must not come back to life on everybody's screen
    if (pg === 'lobby') evalLobby(room); else checkOver(room);
  }
  // ----- leave (idempotent)
  function leave() {
    if (closed) return; closed = true; clearInterval(hb); clearTimeout(joinTimer);
    const p = me, r = room; me = null;
    if (!p || !r || !r.players.delete(p.id)) return;
    if (p.uid) auth.removeSession(p.uid, p.id);
    bcast(r, p.pg, {t: 'left', id: p.id});
    if (isLobby(p)) evalLobby(r);
    const k = keyOf(p);
    if (r.phase === 'loading' && r.expect.has(k) && !r.loaded.has(k) && !liveGameWithKey(r, k)) armGrace(r, k);   // lobby -> game page hop, or he vanished
    if (isGame(p)) checkOver(r);
    if (!r.players.size) armDelete(r);
  }
  // ----- messages
  function handle(m) {
    if (!allow(me, 'any', 300, 200)) return;
    if (me.uid) auth.touchSession(me.uid, me.id, room.phase);
    switch (m.t) {
      case 'state': {
        if (!isGame(me) || me.dead) break;   // a dead player's last state used to be re-broadcast forever, so he stayed "alive" on every screen and the winner never won
        me.s = [me.id, Math.round(num(m.x, -5000, 5000, 0) * 100) / 100, Math.round(num(m.z, -5000, 5000, 0) * 100) / 100, Math.round(num(m.yaw, -1e4, 1e4, 0) * 1000) / 1000, Math.round(num(m.hp, 0, 500, 0)), m.mv ? 1 : 0, m.veh ? 1 : 0, Math.round(num(m.y, -5, 130, 0) * 10) / 10];
        me.dirty = true; break; }
      case 'chat': {
        const text = String(m.text || '').slice(0, 200); if (!text.trim() || !allow(me, 'chat', 5, 1)) break;
        const to = +m.to || 0, out = {t: 'chat', from: me.id, name: me.name, text, to};
        if (to) { const tp = room.players.get(to); if (tp && tp.pg === me.pg) { send(tp, out); send(me, out); } }
        else bcast(room, me.pg, out);   // sender already shows own line locally
        break; }
      case 'hit': {
        if (!isGame(me) || me.dead || room.phase !== 'playing' || !(me.lastShot && me.lastShot.mg ? allow(me, 'hitmg', 24, 16) : allow(me, 'hit', 6, 8))) break;   // rifle: as before; machine gun fires ~12 bullets / s
        const tp = room.players.get(+m.target || 0);
        if (!tp || tp === me || !isGame(tp) || tp.dead) break;
        // SERVER-SIDE HIT CHECK: a hit only counts if it follows a real 'shot' of this player (one hit per shot, within 2 s)
        // AND the target really stands near that shot's line. A hacked client can no longer hit anybody anywhere for free.
        const sh = me.lastShot;
        if (!sh || sh.used || Date.now() - sh.ts > 2000 || !tp.s) break;
        const tx = tp.s[1] - sh.o[0], tz = tp.s[2] - sh.o[2], along = tx * sh.d[0] + tz * sh.d[2], h2 = sh.d[0] * sh.d[0] + sh.d[2] * sh.d[2];
        if (h2 < 1e-4) break;                                   // shot pointing straight up/down cannot hit a player on the ground
        const t = along / h2;                                   // distance along the flat ray in units of the flat direction length
        const dist = Math.hypot(tx - sh.d[0] * t, tz - sh.d[2] * t);
        if (t < -0.5 || t * Math.sqrt(h2) > 95 || dist > HIT_TOLERANCE) break;   // behind the shooter, beyond gun range, or off the line (lag tolerance)
        sh.used = true;
        room.lastHit.set(tp.id, {from: me.id, ts: Date.now()});
        send(tp, {t: 'hit', from: me.id, name: me.name, dmg: sh.mg ? MG_DMG : GUN_DMG}); break; }   // damage is decided by the server, not by the client
      case 'pick':
        if (!isGame(me) || !allow(me, 'pick', 20, 10)) break;
        if (Number.isInteger(m.id) && m.id >= MG_ID0 && m.id < MG_ID0 + MG_IDS && !room.picked.has(m.id)) me.hasMG = true;   // first one to take that machine gun owns it
        if (m.id === 'drop') bcast(room, 'game', {t: 'pick', id: 'drop'}, me.id);   // loot taken -> everyone loses it
        else if (Number.isInteger(m.id) && m.id >= 0 && m.id < 100000) { room.picked.add(m.id); bcast(room, 'game', {t: 'pick', id: m.id, by: me.name}, me.id); }
        break;
      case 'shot': {
        const o = vec3(m.o), d = vec3(m.d);
        const mg = m.w === 'mg' && me.hasMG === true;     // a machine-gun shot only counts as one for a player who picked one up
        if (!isGame(me) || me.dead || !o || !d || !(mg ? allow(me, 'shotmg', 26, 16) : allow(me, 'shot', 10, 10))) break;
        const dl = Math.hypot(d[0], d[1], d[2]); if (dl < 1e-6) break;
        me.lastShot = {o, d: [d[0] / dl, d[1] / dl, d[2] / dl], ts: Date.now(), used: false, mg};
        bcast(room, 'game', {t: 'shot', id: me.id, o, d}, me.id); break; }
      case 'molo': {   // v15.49: petrol bomb thrown -> everybody else sees the fire (rate-limited, position clamped)
        if (!isGame(me) || me.dead || room.phase !== 'playing' || !allow(me, 'molo', 4, 0.8)) break;
        bcast(room, 'game', {t: 'molo', id: me.id, x: Math.round(num(m.x, -5000, 5000, 0) * 10) / 10, y: Math.round(num(m.y, -5, 200, 0) * 10) / 10, z: Math.round(num(m.z, -5000, 5000, 0) * 10) / 10}, me.id); break; }
      case 'dead': {
        if (!isGame(me) || me.dead) break;
        if (me.uid) auth.recordDeath(me.uid);
        me.dead = true; room.fate.set(keyOf(me), 'dead');
        if (!me.s) me.s = [me.id, 0, 0, 0, 0, 0, 0]; me.s[4] = 0; me.dirty = true;   // everybody gets one final "hp 0" state, then he is never re-sent
        const lh = room.lastHit.get(me.id), killer = lh && Date.now() - lh.ts < 15000 && room.players.get(lh.from);   // the SERVER decides who got the kill (the victim's claim used to be trusted, and never expired)
        bcast(room, 'game', {t: 'dead', id: me.id, name: me.name, by: killer ? killer.id : 0, byName: killer ? killer.name : ''});
        checkOver(room); break; }
      case 'done':   // this player's match is finished (died or won); a winner is announced once
        if (!isGame(me) || me.done) break;
        me.done = true; if (room.fate.get(keyOf(me)) !== 'dead') room.fate.set(keyOf(me), 'done');
        if (!auth.AUTH_REQUIRED && m.won && !me.dead) bcast(room, 'game', {t: 'win', id: me.id, name: me.name});
        checkOver(room); break;
      case 'lb': {   // lobby state / chat / voice-activity relay
        if (!isLobby(me) || !m.d || typeof m.d !== 'object' || !allow(me, 'lb', 20, 10)) break;
        let js; try { js = JSON.stringify(m.d); } catch (e) { break; } if (js.length > 1500) break;
        if (typeof m.d.text === 'string') m.d.text = m.d.text.slice(0, 200);
        if (m.d.k === 'st') me.ready = !!m.d.ready;
        bcast(room, 'lobby', {t: 'lb', from: me.id, d: m.d}, me.id); evalLobby(room); break; }
      case 'startnow': if (isLobby(me)) evalLobby(room); break;
      case 'inready': {   // the game page finished loading and this player is waiting at the start line
        if (!isGame(me)) break;
        me.inready = true; const k = keyOf(me);
        if (room.phase === 'lobby') { room.phase = 'playing'; room.matchStart = Date.now(); clearTimeout(room.cd); room.cd = null; bcast(room, 'lobby', {t: 'launch'}); send(me, {t: 'begin', elapsed: 0}); }
        else if (room.phase === 'loading') { room.loaded.add(k); room.expect.add(k); clearGrace(room, k); announceWait(room); checkBarrier(room); }
        else send(me, {t: 'begin', elapsed: (Date.now() - room.matchStart) / 1000});
        checkOver(room); break; }
      case 'rtc': {
        const tp = room.players.get(+m.to || 0);
        if (!tp || tp.pg !== me.pg || !m.data || typeof m.data !== 'object') break;
        let n = 0; try { n = JSON.stringify(m.data).length; } catch (e) { break; } if (n > 20000) break;
        send(tp, {t: 'rtc', from: me.id, data: m.data}); break; }
    }
  }
  // The http server keeps sockets half-open: when the peer's TCP connection ended (no WebSocket close frame: crashed tab, killed app) 'close' only fired at the next
  // 15 s ping, so the dead player stayed in the room as a ghost. React to the end of the stream right away.
  sock.on('end', () => { leave(); sock.destroy(); });
  sock.on('close', leave); sock.on('error', leave);
});

// state tick: batched positions per room - ONLY players whose state changed since the last tick, serialised once
setInterval(() => {
  for (const room of rooms.values()) {
    let n = 0; const dirty = [];
    for (const p of room.players.values()) if (isGame(p)) { n++; if (p.dirty && p.s) { dirty.push(p.s); } p.dirty = false; }
    if (!dirty.length || n < 2) continue;
    const f = wsFrame(JSON.stringify({t: 's', p: dirty}));
    for (const p of room.players.values()) if (isGame(p) && p.sock.writableLength < 512 * 1024) rawWrite(p.sock, f);   // a stalled phone does not pile up memory: it simply misses frames and gets the next one
  }
}, TICK_MS);

// Render's free plan puts a service to sleep after ~15 min without INBOUND traffic. While any room exists we ping our own public address (RENDER_EXTERNAL_URL is set by Render)
// so an active squad is never put to sleep mid-match. Does nothing locally. Set KEEP_ALIVE=0 to turn off.
if (process.env.RENDER_EXTERNAL_URL && process.env.KEEP_ALIVE !== '0' && typeof fetch === 'function') {
  setInterval(() => { if (rooms.size) fetch(process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '') + '/health').catch(() => {}); }, 10 * 60 * 1000).unref();
}

let portTries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && portTries++ < 10 && !process.env.PORT_STRICT) { console.log('Port ' + PORT + ' is busy - trying ' + (PORT + 1)); PORT++; return server.listen(PORT, '0.0.0.0'); }
  console.error('Server could not start: ' + e.message); process.exit(1);
});
server.on('listening', () => {
  console.log('Ashen Roads online server running.  Keep this window open while you play.\n  This PC:        http://localhost:' + PORT + '/');
  LAN_IPS.forEach(ip => console.log('  Friends (same Wi-Fi):  http://' + ip + ':' + PORT + '/'));
  if (process.env.OPEN_BROWSER) {   // the .bat launchers ask for this: open the game in the browser once the server is really up
    const url = 'http://localhost:' + PORT + (process.env.OPEN_PATH || '/index.html'), cp = require('child_process');
    try { if (process.platform === 'win32') cp.exec('start "" "' + url + '"'); else cp.exec((process.platform === 'darwin' ? 'open "' : 'xdg-open "') + url + '"'); } catch (err) {}
  }
});
auth.ready.then(() => server.listen(PORT, '0.0.0.0'), (e) => { console.error('Server not started: ' + e.message); process.exit(1); });   // accounts + signing key are loaded first
