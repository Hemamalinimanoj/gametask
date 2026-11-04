# Ashen Roads - PHP backend (login, database) - v15.44

Login, username-and-password sign-up, and the accounts database run on **PHP** (`api/index.php`, SQLite file in `database/`). Sign-up does not require email or OTP.
Online ROOMS (lobby + multiplayer) still use the Node server, because normal PHP hosting cannot keep WebSockets open.
Solo play needs only PHP.

## 1. Test on your own PC (2 minutes)
1. Install PHP 8 (or XAMPP). Check:  `php -v`  and  `php -m` lists **pdo_sqlite** (if it does not, that is OK - v15.45 then stores accounts in `database/ashen-*.json.php`).
2. Open a terminal in this folder and run:  `php -S localhost:8000`   (or double-click `START-PHP.bat`)
3. Open http://localhost:8000/api/index.php?r=health  ->  must show `{"ok":true,...,"sqlite":true,"writable":true}`
4. Open http://localhost:8000 and create an account with a username and password.

## 2. Put it on a PHP website (Hostinger, cPanel, InfinityFree, any Apache/LiteSpeed/Nginx + PHP 7.4+)
1. Upload the WHOLE folder to `public_html` (the `assets` folder is big - use the file manager's zip upload).
2. Make `database/` writable (permission 775, or 777 on some free hosts).
3. Copy `api/config.sample.php` to `api/config.php` and set `ADMIN_USERNAME` if you want to enable the private admin page.
4. Open `https://yourdomain.com/api/index.php?r=health` - it must show `"ok":true`. Then open the site and create your account.
5. Nginx hosts: `.htaccess` is ignored, so add  `location ~ ^/(database|server|tools)/ { deny all; }`  and  `location ~ /\.env { deny all; }`.
   Best of all: set `DATA_DIR` in `api/config.php` to a folder OUTSIDE the public web folder.

**Netlify cannot run PHP.** If you keep the game pages on Netlify, put the PHP website address in `js/server-config.js`:
`window.ASHEN_API_URL = 'https://yourdomain.com';`  and set `ALLOWED_ORIGINS` in `api/config.php` to your Netlify address.

## 3. Online rooms (optional): connect the Node server to the PHP accounts
On the Node server (Render / your PC) set:
- `AUTH_MODE=php`
- `AUTH_SECRET=` the SAME text as in PHP (`AUTH_SECRET` in `api/config.php`, or the text inside `database/secret.key`)
- `PHP_API_URL=https://yourdomain.com/api/index.php`   (so the admin page gets play time / deaths / wins)

and in `js/server-config.js` set `window.ASHEN_SERVER_URL = 'https://your-node-server';`.
The Node server only CHECKS the login token; accounts stay in the PHP database.

## Database
`database/ashen.sqlite` (accounts, activity), `database/players.csv` (open in Excel), `database/secret.key`.
Passwords are stored only as bcrypt hashes. Back the folder up.
Accounts made earlier with the Node login (`users.json`, scrypt hashes) are NOT copied: players register again.
Want the old Node login back?  `window.ASHEN_BACKEND = 'node';` in `js/server-config.js`.

## Admin page
Set `ADMIN_USERNAME` in `api/config.php` to your own account name, log in, open `/admin.html`.
