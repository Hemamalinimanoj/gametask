<?php
/*
 * ASHEN ROADS - PHP BACKEND  (username/password register + login + accounts database + admin)
 *
 * Needs: PHP 7.4+. Uses SQLite (pdo_sqlite) when the host has it; if not, it automatically stores the same data in
 * database/ashen-*.json.php files instead - so login works on every host. No composer, no packages.
 * Database: MySQL / MariaDB (phpMyAdmin) when DB_NAME is set in api/config.php  -> see README-MYSQL.md.
 * Otherwise SQLite file  database/ashen.sqlite  (+ readable copy database/players.csv).  The folder must be writable.
 * Settings: copy api/config.sample.php to api/config.php and fill it in (or use real environment variables).
 *
 * Endpoints (called by the game as  api/index.php?r=<name> ):
 *   POST r=register      {username,password}             -> {ok,token,user}            creates an account
 *   POST r=login         {username,password}            -> {ok,token,user}
 *   GET  r=me            (header X-Ashen-Token / Authorization: Bearer <token>) -> {ok,user}
 *   POST r=logout-all    (token)                        -> {ok}   every old token of this account stops working
 *   GET  r=admin-overview / r=admin-export (token of ADMIN_USERNAME)
 *   POST r=event         (called by the Node multiplayer server, signed with AUTH_SECRET)
 *
 * Tokens use the SAME format as the Node server (base64url(json).HMAC-SHA256), so the Node multiplayer server can check them
 * when it runs with AUTH_MODE=php and the same AUTH_SECRET.
 */
error_reporting(E_ALL);
ini_set('display_errors', '0');

$CONFIG = array();
$cf = __DIR__ . '/config.php';
if (is_file($cf)) { $c = include $cf; if (is_array($c)) $CONFIG = $c; }

function cfg($k, $d = '') {
    global $CONFIG;
    if (isset($CONFIG[$k]) && $CONFIG[$k] !== '') return $CONFIG[$k];
    $e = getenv($k);
    return ($e !== false && $e !== '') ? $e : $d;
}

$DATA = cfg('DATA_DIR', '') !== '' ? rtrim((string)cfg('DATA_DIR'), '/\\') : dirname(__DIR__) . '/database';
if (!is_dir($DATA)) { @mkdir($DATA, 0775, true); }

const USER_RE  = '/^[A-Za-z0-9_]{3,14}$/';
const EMAIL_RE = '/^[^\s@]+@[^\s@]+\.[^\s@]+$/';
const MIN_PASS = 6;
const MAX_PASS = 128;
const OTP_MS   = 600000;   // 10 minutes
const OTP_TRIES = 5;

// ------------------------------------------------------------------ small helpers
function now_ms() { return (int)round(microtime(true) * 1000); }

function cors() {
    $allow = trim((string)cfg('ALLOWED_ORIGINS', '*'));
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
    if ($allow === '*' || $allow === '') {
        header('Access-Control-Allow-Origin: *');
    } else {
        $list = array_map('trim', explode(',', $allow));
        if ($origin !== '' && in_array($origin, $list, true)) { header('Access-Control-Allow-Origin: ' . $origin); header('Vary: Origin'); }
    }
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Ashen-Token, X-Ashen-Key');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Max-Age: 600');
}

function out($code, $arr) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail($code, $error, $message) { out($code, array('ok' => false, 'error' => $error, 'message' => $message)); }

function body_json() {
    $raw = file_get_contents('php://input', false, null, 0, 8192);
    $j = json_decode($raw === false ? '' : $raw, true);
    return is_array($j) ? $j : null;
}

function b64u($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64u_dec($s) { return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

function client_ip() {
    if (cfg('TRUST_PROXY', '') === '1' && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $x = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        if ($x !== '') return $x;
    }
    return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '?';
}

// ------------------------------------------------------------------ database: MySQL (phpMyAdmin) | SQLite | JSON files
// MySQL is used when DB_NAME is set (api/config.php or environment). Else SQLite, else the JSON-file fallback.
function db_driver() {
    static $d = null;
    if ($d !== null) return $d;
    if (trim((string)cfg('DB_NAME', '')) !== '') return $d = 'mysql';
    if (class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true)) return $d = 'sqlite';
    return $d = 'file';
}
function has_sqlite() { return db_driver() === 'sqlite'; }

function db_mysql() {
    if (!class_exists('PDO') || !in_array('mysql', PDO::getAvailableDrivers(), true)) throw new RuntimeException('MySQL: the PHP pdo_mysql extension is not enabled (in XAMPP it is on by default; on a host enable "pdo_mysql" / "mysqli" in PHP extensions).');
    $host = (string)cfg('DB_HOST', 'localhost'); $port = (string)cfg('DB_PORT', '3306');
    $name = (string)cfg('DB_NAME', ''); $user = (string)cfg('DB_USER', 'root'); $pass = (string)cfg('DB_PASS', '');
    $opt = array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_TIMEOUT => 6);
    $dsn = 'mysql:host=' . $host . ';port=' . $port . ';charset=utf8mb4';
    try {
        try { $pdo = new PDO($dsn . ';dbname=' . $name, $user, $pass, $opt); }
        catch (PDOException $e) {
            if ((int)$e->getCode() !== 1049 && stripos($e->getMessage(), 'Unknown database') === false) throw $e;   // 1049 = database does not exist yet -> create it (works with the XAMPP root user)
            $tmp = new PDO($dsn, $user, $pass, $opt);
            $tmp->exec('CREATE DATABASE IF NOT EXISTS `' . str_replace('`', '', $name) . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
            $pdo = new PDO($dsn . ';dbname=' . $name, $user, $pass, $opt);
        }
    } catch (PDOException $e) {
        throw new RuntimeException('MySQL: cannot connect to database "' . $name . '" on ' . $host . ' as "' . $user . '" - ' . $e->getMessage() . '  (check DB_HOST / DB_NAME / DB_USER / DB_PASS in api/config.php and that MySQL is running)');
    }
    $T = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(32) NOT NULL PRIMARY KEY, name VARCHAR(32) NOT NULL, name_lc VARCHAR(32) NOT NULL, email VARCHAR(190) NOT NULL,
        pass_hash VARCHAR(255) NOT NULL, ver INT NOT NULL DEFAULT 1, created BIGINT NOT NULL DEFAULT 0, wins INT NOT NULL DEFAULT 0,
        logins INT NOT NULL DEFAULT 0, last_login BIGINT NOT NULL DEFAULT 0, last_active BIGINT NOT NULL DEFAULT 0,
        play_sec INT NOT NULL DEFAULT 0, matches INT NOT NULL DEFAULT 0, deaths INT NOT NULL DEFAULT 0,
        UNIQUE KEY uq_name_lc (name_lc), UNIQUE KEY uq_email (email)' . ')' . $T);
    $pdo->exec('CREATE TABLE IF NOT EXISTS pending (
        name_lc VARCHAR(32) NOT NULL PRIMARY KEY, name VARCHAR(32) NOT NULL, email VARCHAR(190) NOT NULL, pass_hash VARCHAR(255) NOT NULL,
        otp_salt VARCHAR(64) NOT NULL, otp_hash VARCHAR(128) NOT NULL, expires BIGINT NOT NULL, attempts INT NOT NULL DEFAULT 0)' . $T);
    $pdo->exec('CREATE TABLE IF NOT EXISTS events (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, ts BIGINT NOT NULL, `user` VARCHAR(64) NOT NULL, `type` VARCHAR(32) NOT NULL, detail VARCHAR(255) NOT NULL DEFAULT \'\')' . $T);
    $pdo->exec('CREATE TABLE IF NOT EXISTS rate (
        k VARCHAR(190) NOT NULL PRIMARY KEY, n INT NOT NULL, t0 BIGINT NOT NULL, `until` BIGINT NOT NULL DEFAULT 0)' . $T);
    return $pdo;
}

function db() {
    static $pdo = null;
    global $DATA;
    if ($pdo) return $pdo;
    if (db_driver() === 'mysql') return $pdo = db_mysql();
    if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) throw new RuntimeException('The PHP pdo_sqlite extension is not installed on this host.');
    if (!is_dir($DATA) || !is_writable($DATA)) throw new RuntimeException('The database folder is not writable: ' . $DATA . ' (give it write permission, e.g. chmod 775).');
    $pdo = new PDO('sqlite:' . $DATA . '/ashen.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_lc TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
        pass_hash TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
        logins INTEGER NOT NULL DEFAULT 0, last_login INTEGER NOT NULL DEFAULT 0, last_active INTEGER NOT NULL DEFAULT 0,
        play_sec INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS pending (
        name_lc TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, pass_hash TEXT NOT NULL,
        otp_salt TEXT NOT NULL, otp_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user TEXT NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL DEFAULT "")');
    $pdo->exec('CREATE TABLE IF NOT EXISTS rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t0 INTEGER NOT NULL, until INTEGER NOT NULL DEFAULT 0)');
    return $pdo;
}
function q($sql, $args = array()) {
    $d = db_driver();
    if ($d === 'mysql') {   // the file only uses SQLite-style SQL; translate the two differences MySQL has
        $sql = preg_replace('/^INSERT OR REPLACE INTO/i', 'REPLACE INTO', $sql);
        $sql = preg_replace('/\buntil\b/', '`until`', $sql);   // UNTIL is a reserved word in MySQL 8
    }
    if ($d !== 'file') { $st = db()->prepare($sql); $st->execute($args); return $st; }
    return json_q($sql, $args);   // host has no pdo_sqlite -> same accounts, stored in database/ashen-*.json.php instead
}

// ------------------------------------------------------------------ FALLBACK DATABASE (used only when the host has no pdo_sqlite)
// A tiny file database that understands exactly the few SQL statements this file uses. Each table = one file
// database/ashen-<table>.json.php (starts with a PHP exit line, so a browser can never download the content).
class JsonStmt {
    private $rows; private $i = 0;
    function __construct($rows) { $this->rows = $rows; }
    function fetch() { return $this->i < count($this->rows) ? $this->rows[$this->i++] : false; }
    function fetchAll() { $r = array_slice($this->rows, $this->i); $this->i = count($this->rows); return $r; }
}
function json_tables() {
    return array(
        'users'   => array('pk' => 'id',      'unique' => array('name_lc', 'email'), 'def' => array('ver' => 1, 'created' => 0, 'wins' => 0, 'logins' => 0, 'last_login' => 0, 'last_active' => 0, 'play_sec' => 0, 'matches' => 0, 'deaths' => 0)),
        'pending' => array('pk' => 'name_lc', 'unique' => array(), 'def' => array('attempts' => 0)),
        'events'  => array('pk' => 'id',      'unique' => array(), 'def' => array('detail' => '')),
        'rate'    => array('pk' => 'k',       'unique' => array(), 'def' => array('until' => 0)),
    );
}
function json_load($t) {
    global $DATA;
    $f = $DATA . '/ashen-' . $t . '.json.php';
    $raw = is_file($f) ? (string)file_get_contents($f) : '';
    $nl = strpos($raw, "\n");
    $j = $nl === false ? null : json_decode(substr($raw, $nl + 1), true);
    return is_array($j) && isset($j['rows']) ? $j : array('seq' => 0, 'rows' => array());
}
function json_save($t, $d) {
    global $DATA;
    $f = $DATA . '/ashen-' . $t . '.json.php';
    if (file_put_contents($f, "<?php http_response_code(403); exit; ?>\n" . json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) === false) throw new RuntimeException('The database folder is not writable: ' . $DATA);
}
function json_where($conds, &$args) {   // "a = ? AND b < ?"  -> list of array(col, op, value); takes its values from the front of $args
    $out = array();
    foreach (explode(' AND ', $conds) as $c) {
        if (!preg_match('/^(\w+) ?(<=|>=|=|<|>) ?\?$/', trim($c), $m)) throw new RuntimeException('Unsupported condition: ' . $c);
        $out[] = array($m[1], $m[2], array_shift($args));
    }
    return $out;
}
function json_match($row, $conds) {
    foreach ($conds as $c) {
        $a = isset($row[$c[0]]) ? $row[$c[0]] : null; $b = $c[2];
        if ($c[1] === '=') { if ((string)$a !== (string)$b) return false; }
        elseif ($c[1] === '<') { if (!((float)$a < (float)$b)) return false; }
        elseif ($c[1] === '>') { if (!((float)$a > (float)$b)) return false; }
        elseif ($c[1] === '<=') { if (!((float)$a <= (float)$b)) return false; }
        else { if (!((float)$a >= (float)$b)) return false; }
    }
    return true;
}
function json_val($tok, &$args) { $tok = trim($tok); return $tok === '?' ? array_shift($args) : (strpos($tok, '.') !== false ? (float)$tok : (int)$tok); }
function json_q($sql, $args) {
    global $DATA;
    if (!is_dir($DATA) || !is_writable($DATA)) throw new RuntimeException('The database folder is not writable: ' . $DATA . ' (give it write permission, e.g. chmod 775).');
    $sql = trim(preg_replace('/\s+/', ' ', $sql));
    $lock = fopen($DATA . '/ashen.lock', 'c');
    if (!$lock) throw new RuntimeException('The database folder is not writable: ' . $DATA);
    flock($lock, LOCK_EX);
    try { $rows = json_run($sql, array_values($args)); }
    finally { flock($lock, LOCK_UN); fclose($lock); }
    return new JsonStmt($rows);
}
function json_run($sql, $args) {
    $T = json_tables();
    if (preg_match('/^DELETE FROM events WHERE id NOT IN \(SELECT id FROM events ORDER BY id DESC LIMIT (\d+)\)$/i', $sql, $m)) {
        $d = json_load('events'); usort($d['rows'], function ($a, $b) { return $b['id'] - $a['id']; });
        $d['rows'] = array_slice($d['rows'], 0, (int)$m[1]); json_save('events', $d); return array();
    }
    if (preg_match('/^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (\w+) (ASC|DESC))?(?: LIMIT (\d+))?$/i', $sql, $m)) {
        if (!isset($T[$m[2]])) throw new RuntimeException('Unknown table ' . $m[2]);
        $conds = isset($m[3]) && $m[3] !== '' ? json_where($m[3], $args) : array();
        $rows = array(); $d = json_load($m[2]);
        foreach ($d['rows'] as $r) if (json_match($r, $conds)) $rows[] = $r;
        if (!empty($m[4])) { $col = $m[4]; $dir = strtoupper($m[5]) === 'DESC' ? -1 : 1;
            usort($rows, function ($a, $b) use ($col, $dir) { $x = isset($a[$col]) ? $a[$col] : 0; $y = isset($b[$col]) ? $b[$col] : 0; return $x == $y ? 0 : ($x < $y ? -$dir : $dir); }); }
        if (!empty($m[6])) $rows = array_slice($rows, 0, (int)$m[6]);
        if (trim($m[1]) !== '*') { $cols = array_map('trim', explode(',', $m[1])); $o = array();
            foreach ($rows as $r) { $x = array(); foreach ($cols as $c) $x[$c] = isset($r[$c]) ? $r[$c] : null; $o[] = $x; } $rows = $o; }
        return $rows;
    }
    if (preg_match('/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i', $sql, $m)) {
        $t = $m[1]; if (!isset($T[$t])) throw new RuntimeException('Unknown table ' . $t);
        $sets = array();
        foreach (explode(',', $m[2]) as $a) {
            if (!preg_match('/^\s*(\w+)\s*=\s*(\?|-?\d+|(\w+)\s*\+\s*(\?|\d+))\s*$/', $a, $x)) throw new RuntimeException('Unsupported SET: ' . $a);
            if (isset($x[3]) && $x[3] !== '') $sets[] = array($x[1], 'add', $x[3], json_val($x[4], $args));
            else $sets[] = array($x[1], 'set', null, json_val($x[2], $args));
        }
        $conds = json_where($m[3], $args);
        $d = json_load($t);
        foreach ($d['rows'] as $i => $r) {
            if (!json_match($r, $conds)) continue;
            foreach ($sets as $st) { if ($st[1] === 'add') $r[$st[0]] = (isset($r[$st[2]]) ? $r[$st[2]] : 0) + $st[3]; else $r[$st[0]] = $st[3]; }
            $d['rows'][$i] = $r;
        }
        json_save($t, $d); return array();
    }
    if (preg_match('/^DELETE FROM (\w+) WHERE (.+)$/i', $sql, $m)) {
        $t = $m[1]; if (!isset($T[$t])) throw new RuntimeException('Unknown table ' . $t);
        $conds = json_where($m[2], $args); $d = json_load($t); $keep = array();
        foreach ($d['rows'] as $r) if (!json_match($r, $conds)) $keep[] = $r;
        $d['rows'] = $keep; json_save($t, $d); return array();
    }
    if (preg_match('/^INSERT (OR REPLACE )?INTO (\w+) \((.+?)\) VALUES \((.+)\)$/i', $sql, $m)) {
        $t = $m[2]; if (!isset($T[$t])) throw new RuntimeException('Unknown table ' . $t);
        $cols = array_map('trim', explode(',', $m[3])); $vals = explode(',', $m[4]);
        $row = $T[$t]['def'];
        foreach ($cols as $i => $c) $row[$c] = json_val($vals[$i], $args);
        $d = json_load($t); $pk = $T[$t]['pk']; $replace = trim($m[1]) !== '';
        if ($pk === 'id' && $t === 'events') { $d['seq'] = (int)$d['seq'] + 1; $row['id'] = $d['seq']; }
        else {
            $keep = array();
            foreach ($d['rows'] as $r) {
                if ((string)$r[$pk] === (string)$row[$pk]) { if ($replace) continue; throw new RuntimeException('UNIQUE constraint failed: ' . $pk); }
                foreach ($T[$t]['unique'] as $u) if ((string)$r[$u] === (string)$row[$u]) throw new RuntimeException('UNIQUE constraint failed: ' . $u);
                $keep[] = $r;
            }
            $d['rows'] = $keep;
        }
        $d['rows'][] = $row; json_save($t, $d); return array();
    }
    throw new RuntimeException('Unsupported query: ' . $sql);
}

function find_user_by_name($lc) { return q('SELECT * FROM users WHERE name_lc = ?', array($lc))->fetch() ?: null; }
function find_user_by_id($id) { return q('SELECT * FROM users WHERE id = ?', array($id))->fetch() ?: null; }
function find_user_by_email($email) { return q('SELECT * FROM users WHERE email = ?', array($email))->fetch() ?: null; }

function log_event($user, $type, $detail = '') {
    q('INSERT INTO events (ts, user, type, detail) VALUES (?,?,?,?)', array(now_ms(), (string)$user, (string)$type, substr((string)$detail, 0, 120)));
    if (random_int(1, 60) === 1) {   // keep only the newest 2000 events
        if (db_driver() === 'mysql') { $m = q('SELECT MAX(id) AS m FROM events')->fetch(); if ($m && (int)$m['m'] > 2000) q('DELETE FROM events WHERE id <= ?', array((int)$m['m'] - 2000)); }
        else q('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 2000)');
    }
}

function csv_cell($v) {
    $v = (string)$v;
    if (preg_match('/^[=+\-@]/', $v)) $v = "'" . $v;   // a leading = + - @ would run as a formula in Excel
    return '"' . str_replace('"', '""', $v) . '"';
}
function iso($ms) { return $ms ? gmdate('Y-m-d\TH:i:s\Z', (int)($ms / 1000)) : ''; }
function display_email($email) { return preg_match('/@no-email\.invalid$/i', (string)$email) ? '' : (string)$email; }
function build_csv() {
    $rows = array('username,email,registered,last_login,last_active,logins,play_minutes,matches,deaths,wins');
    foreach (q('SELECT * FROM users ORDER BY created ASC')->fetchAll() as $u) {
        $rows[] = implode(',', array_map('csv_cell', array($u['name'], display_email($u['email']), iso($u['created']), iso($u['last_login']), iso($u['last_active']),
            $u['logins'], round($u['play_sec'] / 60), $u['matches'], $u['deaths'], $u['wins'])));
    }
    return implode("\r\n", $rows) . "\r\n";
}
function save_csv() { global $DATA; @file_put_contents($DATA . '/players.csv', build_csv(), LOCK_EX); }

// ------------------------------------------------------------------ signing secret + tokens
function secret() {
    static $s = null;
    global $DATA;
    if ($s !== null) return $s;
    $env = (string)cfg('AUTH_SECRET', '');
    if ($env !== '') return $s = $env;
    $f = $DATA . '/secret.key';
    if (is_file($f)) { $x = trim((string)@file_get_contents($f)); if (strlen($x) >= 32) return $s = $x; }
    $x = bin2hex(random_bytes(32));
    if (@file_put_contents($f, $x, LOCK_EX) === false) throw new RuntimeException('Cannot save database/secret.key (folder not writable?).');
    @chmod($f, 0600);
    return $s = $x;
}
function sign($body) { return b64u(hash_hmac('sha256', $body, secret(), true)); }
function make_token($u) {
    $days = (int)cfg('TOKEN_DAYS', '365'); if ($days < 1) $days = 365;
    $body = b64u(json_encode(array('sub' => $u['id'], 'u' => $u['name'], 'v' => (int)$u['ver'], 'exp' => now_ms() + $days * 86400000), JSON_UNESCAPED_SLASHES));
    return $body . '.' . sign($body);
}
function verify_token($tok) {   // -> user row or null
    if (!is_string($tok) || $tok === '' || strlen($tok) > 400) return null;
    $i = strpos($tok, '.'); if ($i === false || $i < 1) return null;
    $body = substr($tok, 0, $i); $sig = substr($tok, $i + 1);
    if (!hash_equals(sign($body), $sig)) return null;
    $p = json_decode((string)b64u_dec($body), true);
    if (!is_array($p) || !isset($p['exp']) || $p['exp'] <= now_ms()) return null;
    $u = find_user_by_name(strtolower((string)(isset($p['u']) ? $p['u'] : '')));
    if (!$u || $u['id'] !== (isset($p['sub']) ? $p['sub'] : null) || (int)$u['ver'] !== (int)(isset($p['v']) ? $p['v'] : -1)) return null;   // deleted account, or "logout everywhere"
    return $u;
}
function req_token() {
    if (!empty($_SERVER['HTTP_X_ASHEN_TOKEN'])) return trim($_SERVER['HTTP_X_ASHEN_TOKEN']);   // works even when the host strips the Authorization header
    $h = '';
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) $h = $_SERVER['HTTP_AUTHORIZATION'];
    elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $h = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    elseif (function_exists('getallheaders')) { foreach (getallheaders() as $k => $v) if (strtolower($k) === 'authorization') $h = $v; }
    return preg_match('/^Bearer\s+(.+)$/i', $h, $m) ? trim($m[1]) : '';
}
function current_user() { return verify_token(req_token()); }
function is_admin($u) {
    $a = strtolower(trim((string)cfg('ADMIN_USERNAME', '')));
    return $a !== '' && $u && strtolower($u['name']) === $a;
}
function touch_active($uid) { $n = now_ms(); q('UPDATE users SET last_active = ? WHERE id = ? AND last_active < ?', array($n, $uid, $n - 60000)); }

// ------------------------------------------------------------------ brute-force protection (stored in SQLite, PHP has no memory between requests)
function ip_limited() {
    $now = now_ms(); $k = 'ip:' . client_ip();
    if (random_int(1, 40) === 1) q('DELETE FROM rate WHERE t0 < ? AND until < ?', array($now - 900000, $now));
    $r = q('SELECT n, t0 FROM rate WHERE k = ?', array($k))->fetch();
    if (!$r || $now - (int)$r['t0'] > 60000) { q('INSERT OR REPLACE INTO rate (k, n, t0, until) VALUES (?,1,?,0)', array($k, $now)); return false; }
    $n = (int)$r['n'] + 1; q('UPDATE rate SET n = ? WHERE k = ?', array($n, $k));
    return $n > 30;   // 30 login/register requests per minute per address
}
function is_locked($lc) { $r = q('SELECT until FROM rate WHERE k = ?', array('fail:' . $lc))->fetch(); return $r && (int)$r['until'] > now_ms(); }
function note_fail($lc) {
    $now = now_ms(); $k = 'fail:' . $lc; $r = q('SELECT n, t0 FROM rate WHERE k = ?', array($k))->fetch();
    $n = 0; $t0 = $now; if ($r && $now - (int)$r['t0'] <= 900000) { $n = (int)$r['n']; $t0 = (int)$r['t0']; }
    $until = 0; if (++$n >= 6) { $until = $now + 300000; $n = 0; $t0 = $now; }   // 6 wrong passwords -> account locked for 5 minutes
    q('INSERT OR REPLACE INTO rate (k, n, t0, until) VALUES (?,?,?,?)', array($k, $n, $t0, $until));
}
function clear_fail($lc) { q('DELETE FROM rate WHERE k = ?', array('fail:' . $lc)); }

// ------------------------------------------------------------------ passwords + OTP
function pw_verify($pw, $hash) {
    if ($hash === null) { password_verify($pw, '$2y$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234'); return false; }   // unknown user costs the same time as a wrong password
    return password_verify($pw, $hash);
}
function otp_hash($salt, $code) { return hash_hmac('sha256', $salt . $code, secret()); }
function create_otp() {
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT); $salt = bin2hex(random_bytes(16));
    return array('code' => $code, 'salt' => $salt, 'hash' => otp_hash($salt, $code));
}

class AshenMailConfigError extends RuntimeException {}

// ------------------------------------------------------------------ e-mail (Resend API, SMTP/Gmail, PHP mail(), or a log file)
function otp_subject() { return 'Your Ashen Roads verification code'; }
function otp_text($code) { return "Your Ashen Roads verification code is $code. It expires in 10 minutes.\r\nIf you did not try to create an account, ignore this email."; }
function otp_html($code) {
    return '<!doctype html><html><body style="margin:0;padding:0;background:#0b0f10;font-family:Arial,Helvetica,sans-serif">' .
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f10;padding:28px 12px"><tr><td align="center">' .
    '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#151a1c;border:1px solid #3a2a1a;border-radius:6px">' .
    '<tr><td align="center" style="padding:28px 24px 6px"><div style="font-size:13px;letter-spacing:6px;color:#ff6a3d;font-weight:bold">ASHEN</div>' .
    '<div style="font-size:34px;letter-spacing:8px;color:#f1ece2;font-weight:bold;margin-top:2px">ROADS</div></td></tr>' .
    '<tr><td align="center" style="padding:14px 28px 4px;color:#b9c3bc;font-size:15px;line-height:1.5">Welcome, survivor! Use this code to verify your email and finish creating your account:</td></tr>' .
    '<tr><td align="center" style="padding:18px 24px"><div style="display:inline-block;padding:14px 26px;background:#0b0f10;border:2px solid #ffc65d;border-radius:6px;font-size:38px;letter-spacing:12px;font-weight:bold;color:#ffd36b;font-family:Consolas,Menlo,monospace">' . $code . '</div></td></tr>' .
    '<tr><td align="center" style="padding:0 28px 26px;color:#8a958e;font-size:13px;line-height:1.5">This code expires in 10 minutes.<br>If you did not try to create an account, you can ignore this email.</td></tr>' .
    '</table></td></tr></table></body></html>';
}
function addr_of($from) { return preg_match('/<([^>]+)>/', $from, $m) ? trim($m[1]) : trim($from); }

function smtp_conf() {
    $user = trim((string)cfg('SMTP_USER', '')); $pass = (string)cfg('SMTP_PASS', ''); $host = trim((string)cfg('SMTP_HOST', ''));
    if ($host === '' && preg_match('/@(gmail|googlemail)\.com$/i', $user)) $host = 'smtp.gmail.com';
    if ($host === '') return null;
    if (preg_match('/gmail|google/i', $host)) $pass = preg_replace('/\s+/', '', $pass);   // Google shows app passwords as 4 groups with spaces
    $port = (int)cfg('SMTP_PORT', '465'); if ($port < 1) $port = 465;
    $from = trim((string)cfg('EMAIL_FROM', $user !== '' ? 'Ashen Roads <' . $user . '>' : ''));
    if ($from === '') return null;
    return array('host' => $host, 'port' => $port, 'secure' => $port === 465, 'user' => $user, 'pass' => $pass, 'from' => $from);
}

function smtp_send($c, $to, $subject, $text, $html) {
    $fp = @stream_socket_client(($c['secure'] ? 'ssl://' : 'tcp://') . $c['host'] . ':' . $c['port'], $en, $es, 15, STREAM_CLIENT_CONNECT);
    if (!$fp) throw new RuntimeException('SMTP connect failed: ' . $es);
    stream_set_timeout($fp, 20);
    $read = function () use ($fp) {
        $o = '';
        while (($l = fgets($fp, 1024)) !== false) { $o .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; }
        return $o;
    };
    $cmd = function ($s, $ok) use ($fp, $read) {
        if ($s !== '') fwrite($fp, $s . "\r\n");
        $r = $read(); $code = (int)substr($r, 0, 3);
        if (!in_array($code, $ok, true)) throw new RuntimeException('SMTP said: ' . trim($r));
        return $r;
    };
    try {
        $cmd('', array(220));
        $ehlo = 'EHLO ' . (isset($_SERVER['SERVER_NAME']) && $_SERVER['SERVER_NAME'] !== '' ? $_SERVER['SERVER_NAME'] : 'localhost');
        $cmd($ehlo, array(250));
        if (!$c['secure']) {
            $cmd('STARTTLS', array(220));
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('SMTP: could not start TLS');
            $cmd($ehlo, array(250));
        }
        if ($c['user'] !== '') {
            $cmd('AUTH LOGIN', array(334)); $cmd(base64_encode($c['user']), array(334)); $cmd(base64_encode($c['pass']), array(235));
        }
        $cmd('MAIL FROM:<' . addr_of($c['from']) . '>', array(250));
        $cmd('RCPT TO:<' . $to . '>', array(250, 251));
        $cmd('DATA', array(354));
        $bd = 'ashen' . bin2hex(random_bytes(8));
        $msg = 'From: ' . $c['from'] . "\r\nTo: <" . $to . ">\r\nSubject: =?UTF-8?B?" . base64_encode($subject) . "?=\r\nDate: " . date('r') .
            "\r\nMessage-ID: <" . bin2hex(random_bytes(8)) . '@ashenroads>' . "\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"$bd\"\r\n\r\n" .
            "--$bd\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text)) .
            "--$bd\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$bd--";
        $msg = preg_replace('/^\./m', '..', $msg);   // dot-stuffing
        fwrite($fp, $msg . "\r\n.\r\n");
        $r = $read(); if ((int)substr($r, 0, 3) !== 250) throw new RuntimeException('SMTP said: ' . trim($r));
        @fwrite($fp, "QUIT\r\n");
    } finally { @fclose($fp); }
}

function http_post_json($url, $headers, $json) {
    $h = array_merge(array('Content-Type: application/json'), $headers);
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, array(CURLOPT_POST => true, CURLOPT_POSTFIELDS => $json, CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12));
        $resp = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        return array($code, (string)$resp);
    }
    $ctx = stream_context_create(array('http' => array('method' => 'POST', 'header' => implode("\r\n", $h), 'content' => $json, 'timeout' => 12, 'ignore_errors' => true)));
    $resp = @file_get_contents($url, false, $ctx); $code = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) $code = (int)$m[1];
    return array($code, (string)$resp);
}

// -> 'email' (really sent)  |  'console' (no mail set up: the code is written to database/otp-log.txt, only the owner can read it)
function send_otp($email, $code) {
    global $DATA;
    $key = trim((string)cfg('RESEND_API_KEY', '')); $from = trim((string)cfg('EMAIL_FROM', ''));
    if ($key !== '' && $from !== '') {
        list($st, $resp) = http_post_json('https://api.resend.com/emails', array('Authorization: Bearer ' . $key),
            json_encode(array('from' => $from, 'to' => array($email), 'subject' => otp_subject(), 'text' => otp_text($code), 'html' => otp_html($code))));
        if ($st < 200 || $st >= 300) throw new RuntimeException('Resend rejected the email (HTTP ' . $st . ') ' . substr($resp, 0, 200));
        return 'email';
    }
    $sm = smtp_conf();
    if ($sm) { smtp_send($sm, $email, otp_subject(), otp_text($code), otp_html($code)); return 'email'; }
    if (cfg('MAIL_DRIVER', '') === 'mail') {   // the host's own sendmail (works on many cPanel / Hostinger plans)
        $f = trim((string)cfg('EMAIL_FROM', 'Ashen Roads <noreply@' . (isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost') . '>'));
        $ok = @mail($email, '=?UTF-8?B?' . base64_encode(otp_subject()) . '?=', otp_html($code),
            "From: $f\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8");
        if (!$ok) throw new RuntimeException('PHP mail() failed');
        return 'email';
    }
    // no email set up: on your own PC the code goes to database/otp-log.txt; on a LIVE website that would leave players stuck, so it shows an error instead (set OTP_CONSOLE=1 to force the log file)
    $hostName = isset($_SERVER['HTTP_HOST']) ? strtolower(preg_replace('/:\d+$/', '', (string)$_SERVER['HTTP_HOST'])) : 'localhost';
    $isLocal = (bool)preg_match('/^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/', $hostName);
    if ((string)cfg('OTP_CONSOLE', $isLocal ? '1' : '0') !== '0') {
        @file_put_contents($DATA . '/otp-log.txt', gmdate('c') . "  code for $email : $code  (valid 10 minutes)\n", FILE_APPEND | LOCK_EX);
        return 'console';
    }
    throw new AshenMailConfigError('Email verification is not configured on this server.');
}
function send_failed($e) {
    if ($e instanceof AshenMailConfigError) fail(503, 'email_not_configured', $e->getMessage() . ' The owner must set SMTP_USER + SMTP_PASS (Gmail app password) or RESEND_API_KEY + EMAIL_FROM in api/config.php.');
    error_log('Ashen: could not send the verification email: ' . $e->getMessage());
    fail(502, 'email_failed', 'Could not send the verification email. Check the email address, or ask the server owner to check the email settings (SMTP / Resend).');
}

// ------------------------------------------------------------------ actions
function public_user($u) { return array('id' => $u['id'], 'name' => $u['name']); }
function str_field($b, $k) { return isset($b[$k]) && is_string($b[$k]) ? trim($b[$k]) : ''; }

function act_register($b) {
    $name = str_field($b, 'username'); $pw = isset($b['password']) && is_string($b['password']) ? $b['password'] : '';
    $lc = strtolower($name);
    if (!preg_match(USER_RE, $name)) fail(400, 'bad_username', 'Username must be 3-14 letters, numbers or _ (no spaces).');
    if (strlen($pw) < MIN_PASS || strlen($pw) > MAX_PASS) fail(400, 'bad_password', 'Password must be at least ' . MIN_PASS . ' characters.');
    if (find_user_by_name($lc)) fail(409, 'taken', 'That username is already taken. Pick another one, or log in if it is yours.');
    q('DELETE FROM pending WHERE name_lc = ?', array($lc));
    $id = bin2hex(random_bytes(8)); $now = now_ms(); $email = $id . '@no-email.invalid';
    try {
        q('INSERT INTO users (id, name, name_lc, email, pass_hash, ver, created, logins, last_login, last_active) VALUES (?,?,?,?,?,1,?,1,?,?)',
            array($id, $name, $lc, $email, password_hash($pw, PASSWORD_DEFAULT), $now, $now, $now));
    } catch (Exception $e) {
        if (find_user_by_name($lc)) fail(409, 'taken', 'That username is already taken.');
        throw $e;
    }
    log_event($name, 'register', '');
    save_csv();
    $u = find_user_by_id($id);
    out(201, array('ok' => true, 'token' => make_token($u), 'user' => public_user($u)));
}

function act_verify($b) {
    $name = str_field($b, 'username'); $email = strtolower(str_field($b, 'email')); $code = str_field($b, 'code'); $lc = strtolower($name);
    if (!preg_match(USER_RE, $name) || !preg_match(EMAIL_RE, $email) || !preg_match('/^\d{6}$/', $code)) fail(400, 'bad_code', 'Enter the 6-digit email code.');
    $p = q('SELECT * FROM pending WHERE name_lc = ?', array($lc))->fetch();
    if (!$p || $p['email'] !== $email) fail(400, 'expired', 'That verification request expired. Start account creation again.');
    if ((int)$p['expires'] <= now_ms()) { q('DELETE FROM pending WHERE name_lc = ?', array($lc)); fail(400, 'expired', 'That code expired. Start account creation again.'); }
    if (!hash_equals($p['otp_hash'], otp_hash($p['otp_salt'], $code))) {
        $att = (int)$p['attempts'] + 1;
        if ($att >= OTP_TRIES) { q('DELETE FROM pending WHERE name_lc = ?', array($lc)); fail(429, 'too_many_codes', 'Too many incorrect codes. Start account creation again.'); }
        q('UPDATE pending SET attempts = ? WHERE name_lc = ?', array($att, $lc));
        fail(400, 'bad_code', 'That code is incorrect. Check your email and try again.');
    }
    $id = bin2hex(random_bytes(8)); $now = now_ms();
    try {
        q('INSERT INTO users (id, name, name_lc, email, pass_hash, ver, created, logins, last_login, last_active) VALUES (?,?,?,?,?,1,?,1,?,?)',
            array($id, $p['name'], $lc, $email, $p['pass_hash'], $now, $now, $now));
    } catch (Exception $e) {   // duplicate username/email (PDOException with SQLite, RuntimeException with the file database)
        q('DELETE FROM pending WHERE name_lc = ?', array($lc));
        if (find_user_by_name($lc)) fail(409, 'taken', 'That username is already taken.');
        fail(409, 'email_taken', 'That email is already linked to an account.');
    }
    q('DELETE FROM pending WHERE name_lc = ?', array($lc));
    log_event($p['name'], 'register', $email);
    save_csv();
    $u = find_user_by_id($id);
    out(201, array('ok' => true, 'token' => make_token($u), 'user' => public_user($u)));
}

function act_resend($b) {
    $name = str_field($b, 'username'); $email = strtolower(str_field($b, 'email'));
    if (!preg_match(USER_RE, $name) || !preg_match(EMAIL_RE, $email)) fail(400, 'bad_request', 'Enter a valid username and email.');
    $lc = strtolower($name); $p = q('SELECT * FROM pending WHERE name_lc = ?', array($lc))->fetch();
    if (!$p || $p['email'] !== $email || (int)$p['expires'] <= now_ms()) out(202, array('ok' => true));
    $otp = create_otp();
    q('UPDATE pending SET otp_salt=?, otp_hash=?, expires=?, attempts=0 WHERE name_lc=?', array($otp['salt'], $otp['hash'], now_ms() + OTP_MS, $lc));
    try { $delivery = send_otp($email, $otp['code']); } catch (Exception $e) { send_failed($e); }
    out(200, array('ok' => true, 'delivery' => $delivery));
}

function act_login($b) {
    $name = str_field($b, 'username'); $pw = isset($b['password']) && is_string($b['password']) ? $b['password'] : '';
    if ($name === '' || $pw === '' || strlen($pw) > MAX_PASS) fail(400, 'missing', 'Enter your username and password.');
    $lc = strtolower($name);
    if (is_locked($lc)) fail(429, 'locked', 'Too many wrong passwords. Try again in a few minutes.');
    $u = find_user_by_name($lc);
    if (!pw_verify($pw, $u ? $u['pass_hash'] : null) || !$u) { note_fail($lc); fail(401, 'invalid', 'Wrong username or password.'); }
    clear_fail($lc);
    if (password_needs_rehash($u['pass_hash'], PASSWORD_DEFAULT)) q('UPDATE users SET pass_hash = ? WHERE id = ?', array(password_hash($pw, PASSWORD_DEFAULT), $u['id']));
    $n = now_ms();
    q('UPDATE users SET logins = logins + 1, last_login = ?, last_active = ? WHERE id = ?', array($n, $n, $u['id']));
    log_event($u['name'], 'login', '');
    out(200, array('ok' => true, 'token' => make_token($u), 'user' => public_user($u)));
}

function act_me() {
    $u = current_user();
    if (!$u) fail(401, 'unauthorized', 'Please log in.');
    touch_active($u['id']);
    $p = public_user($u); $p['admin'] = is_admin($u);
    out(200, array('ok' => true, 'user' => $p));
}

function act_logout_all() {
    $u = current_user();
    if (!$u) fail(401, 'unauthorized', 'Please log in.');
    q('UPDATE users SET ver = ver + 1 WHERE id = ?', array($u['id']));
    out(200, array('ok' => true));
}

function admin_players() {
    $now = now_ms(); $list = array();
    foreach (q('SELECT * FROM users')->fetchAll() as $u) {
        $list[] = array('name' => $u['name'], 'email' => display_email($u['email']), 'created' => (int)$u['created'], 'wins' => (int)$u['wins'], 'logins' => (int)$u['logins'],
            'lastLogin' => (int)$u['last_login'], 'playMinutes' => (int)round($u['play_sec'] / 60), 'matches' => (int)$u['matches'], 'deaths' => (int)$u['deaths'],
            'lastActive' => (int)$u['last_active'], 'online' => ((int)$u['last_active'] > $now - 180000), 'sessions' => array());
    }
    return $list;
}
// PUBLIC rank list (v15.47): anyone may read it - names and stats only, never e-mails
function act_leaderboard() {
    $list = admin_players();
    usort($list, function ($a, $b) { return ($b['wins'] <=> $a['wins']) ?: ($b['matches'] <=> $a['matches']) ?: ($a['deaths'] <=> $b['deaths']) ?: ($a['created'] <=> $b['created']); });
    $rows = array();
    foreach (array_slice($list, 0, 50) as $p) $rows[] = array('name' => $p['name'], 'wins' => $p['wins'], 'matches' => $p['matches'], 'deaths' => $p['deaths'], 'playMinutes' => $p['playMinutes'], 'online' => $p['online']);
    out(200, array('ok' => true, 'total' => count($list), 'players' => $rows));
}
function act_admin_overview() {
    $u = current_user();
    if (!is_admin($u)) out(403, array('ok' => false, 'message' => 'Admin access is not enabled for this account.'));
    $players = admin_players();
    $events = array();
    foreach (q('SELECT ts, user, type, detail FROM events ORDER BY id DESC LIMIT 100')->fetchAll() as $e) $events[] = array('t' => (int)$e['ts'], 'user' => $e['user'], 'type' => $e['type'], 'detail' => $e['detail']);
    $top = $players; usort($top, function ($a, $b) { return ($b['wins'] <=> $a['wins']) ?: ($b['created'] <=> $a['created']); });
    usort($players, function ($a, $b) { return $b['created'] <=> $a['created']; });
    $online = 0; foreach ($players as $p) if ($p['online']) $online++;
    out(200, array('ok' => true, 'totals' => array('registered' => count($players), 'online' => $online, 'rooms' => 0),
        'topPlayers' => array_slice($top, 0, 5), 'registeredPlayers' => $players, 'rooms' => array(), 'events' => $events));
}
function act_admin_export() {
    $u = current_user();
    if (!is_admin($u)) out(403, array('ok' => false, 'message' => 'Admin access is not enabled for this account.'));
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="ashen-roads-players.csv"');
    header('Cache-Control: no-store');
    echo build_csv(); exit;
}

// Node multiplayer server -> PHP: play statistics (join / leave / death / win). Signed with the shared AUTH_SECRET.
function act_event() {
    $raw = file_get_contents('php://input', false, null, 0, 4096);
    $key = isset($_SERVER['HTTP_X_ASHEN_KEY']) ? $_SERVER['HTTP_X_ASHEN_KEY'] : '';
    if (!is_string($raw) || $key === '' || !hash_equals(b64u(hash_hmac('sha256', $raw, secret(), true)), $key)) fail(403, 'forbidden', 'Bad signature.');
    $b = json_decode($raw, true); if (!is_array($b)) fail(400, 'bad_request', 'Bad request.');
    $u = find_user_by_id(isset($b['uid']) ? (string)$b['uid'] : ''); if (!$u) out(200, array('ok' => true));
    $type = isset($b['type']) ? (string)$b['type'] : ''; $page = isset($b['page']) ? (string)$b['page'] : ''; $detail = isset($b['detail']) ? (string)$b['detail'] : '';
    $n = now_ms(); $sec = max(0, min(86400, (int)(isset($b['sec']) ? $b['sec'] : 0)));
    if ($type === 'join') q('UPDATE users SET last_active = ?, matches = matches + ? WHERE id = ?', array($n, $page === 'game' ? 1 : 0, $u['id']));
    elseif ($type === 'leave') q('UPDATE users SET last_active = ?, play_sec = play_sec + ? WHERE id = ?', array($n, $page === 'game' ? $sec : 0, $u['id']));
    elseif ($type === 'death') q('UPDATE users SET deaths = deaths + 1, last_active = ? WHERE id = ?', array($n, $u['id']));
    elseif ($type === 'win') q('UPDATE users SET wins = wins + 1, last_active = ? WHERE id = ?', array($n, $u['id']));
    else out(200, array('ok' => true));
    log_event($u['name'], $type, $detail);
    out(200, array('ok' => true));
}

// ------------------------------------------------------------------ router
cors();
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

try {
    $route = isset($_GET['r']) ? (string)$_GET['r'] : '';
    if ($route === '' && isset($_SERVER['REQUEST_URI']) && preg_match('#/api/(?:index\.php/)?([A-Za-z0-9_./-]+)#', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), $m)) $route = $m[1];
    $route = strtolower(str_replace('/', '-', trim($route, '/')));
    $method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

    if ($route === 'health') {
        $h = array('ok' => true, 'php' => PHP_VERSION, 'sqlite' => has_sqlite(), 'storage' => db_driver(), 'writable' => (db_driver() === 'mysql') ? true : is_writable($DATA));
        if (db_driver() === 'mysql') {   // show the MySQL result here instead of failing, so the login page can still explain the problem
            try { db(); $h['db_ok'] = true; $h['database'] = (string)cfg('DB_NAME', ''); $c = q('SELECT COUNT(*) AS c FROM users')->fetch(); $h['accounts'] = (int)$c['c']; }
            catch (Throwable $e) { $h['db_ok'] = false; $h['db_error'] = $e->getMessage(); }
        }
        out(200, $h);
    }
    if ($route === 'leaderboard' && $method === 'GET') act_leaderboard();
    if ($route === 'me' && $method === 'GET') act_me();
    if ($route === 'logout-all' && $method === 'POST') act_logout_all();
    if ($route === 'admin-overview') act_admin_overview();
    if ($route === 'admin-export-csv' || $route === 'admin-export.csv' || $route === 'admin-export') act_admin_export();
    if ($route === 'event' && $method === 'POST') act_event();
    if (in_array($route, array('register', 'login'), true) && $method === 'POST') {
        if (ip_limited()) fail(429, 'slow_down', 'Too many attempts. Wait a minute and try again.');
        $b = body_json(); if ($b === null) fail(400, 'bad_request', 'Bad request.');
        if ($route === 'register') act_register($b);
        if ($route === 'login') act_login($b);
    }
    fail(404, 'not_found', 'Unknown API.');
} catch (Throwable $e) {
    error_log('Ashen PHP: ' . $e->getMessage());
    $m = $e->getMessage();
    $setup = (strpos($m, 'pdo_sqlite') !== false || strpos($m, 'not writable') !== false || strpos($m, 'secret.key') !== false || strpos($m, 'MySQL:') === 0);
    fail(500, 'server', $setup ? 'Server setup problem: ' . $m : 'Server error, try again.');
}
