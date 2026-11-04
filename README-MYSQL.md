# v15.54 - EASY WAY (use this one): START-ONLINE.bat saves the accounts in MySQL

1. XAMPP Control Panel -> start **MySQL** (Apache is not even needed).
2. Double-click **START-ONLINE.bat** (needs Node.js) and keep the black window open.
3. The window must print:  `Auth: accounts are saved in MySQL database "ashen_roads" ... - N account(s).`
4. Open the game at **http://localhost:8000** (Live Server :5500 also works - it switches to :8000 by itself), register / log in.
5. phpMyAdmin -> `ashen_roads` -> `users` -> **Browse / Refresh**: the accounts are there (old `database/users.json` accounts are copied in automatically on the first start).

If the window prints `Auth: MySQL is NOT used - ...` the reason is written there (MySQL not started, wrong DB_* in api/config.php, or the `mysql` program was not found -
then set `MYSQL_BIN=C:\xampp\mysql\bin\mysql.exe` before starting, or edit the path in START-ONLINE.bat).
http://localhost:8000/status also shows `+ MySQL "ashen_roads"` when it works.
`database/users.json` stays as a backup copy. Passwords are never stored in plain text (scrypt hash).

---- older PHP / XAMPP-Apache method below (optional) ----

# Login data in phpMyAdmin (MySQL) - v15.52

Accounts (username, password HASH, logins, wins, deaths...) are saved in a MySQL database that you can open in phpMyAdmin
(database `ashen_roads`, table `users`). Passwords are never stored in plain text (bcrypt).

## XAMPP on your PC (3 steps)
1. XAMPP Control Panel -> start **Apache** and **MySQL**.
2. Copy this whole folder into `C:\xampp\htdocs\` (e.g. `C:\xampp\htdocs\ashen_roads`).
3. Open **http://localhost/ashen_roads/api/index.php?r=health**  ->  must show `"storage":"mysql"` and `"db_ok":true`.
   Then open **http://localhost/ashen_roads/** , create an account, and look in phpMyAdmin (http://localhost/phpmyadmin) -> `ashen_roads` -> `users`.

The database and tables are created automatically. (Optional: phpMyAdmin -> Import -> `database/ashen_roads.sql`.)

IMPORTANT: use the **localhost/ashen_roads** address (Apache). START-ONLINE.bat / Live Server (5500) do NOT use MySQL - they use the old users.json login.

## Settings (api/config.php)
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`. XAMPP default = root with an empty password.
On a real host (Hostinger / cPanel) create a MySQL database + user in the hosting panel and put those 4 values here.
Remove `DB_NAME` (or leave it empty) to go back to SQLite.

## If `db_ok` is false
`health` shows `db_error`. Common reasons: MySQL not started in XAMPP, wrong `DB_USER`/`DB_PASS`, or `pdo_mysql` disabled.

## Old accounts
Accounts from the Node login (`database/users.json`, scrypt) cannot be copied to MySQL (different password hash) - register again.

## Online rooms (Node server) with MySQL accounts
Run the Node server with `AUTH_MODE=php`, `AUTH_SECRET=<text inside database/secret.key>`,
`PHP_API_URL=http://localhost/ashen_roads/api/index.php`; and in `js/server-config.js` set `window.ASHEN_API_URL='http://localhost/ashen_roads';`
(see README-PHP.md section 3).
