# v15.54 - NODE LOGIN NOW SAVES IN MySQL (phpMyAdmin)
- NEW `server/mysql-store.js`: the Node server (START-ONLINE.bat / npm start) writes every account (username, password hash, logins, wins, deaths, play time...) into the MySQL table `ashen_roads.users`. No npm package: it uses XAMPP's `mysql.exe`. Settings come from `api/config.php` (DB_*).
- First start copies the old `database/users.json` accounts into MySQL; MySQL is read on every start. `users.json` stays as a backup.
- If MySQL is not running the server still works (users.json) and prints the reason.
- (reverted) the v15.53 XAMPP auto-detect in js/server-config.js - Node + MySQL is now the single default.

# v15.52 - LOGIN DATA IN phpMyAdmin (MySQL)
- `api/index.php` can now store accounts in MySQL / MariaDB (the database you see in phpMyAdmin). Set `DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASS` in `api/config.php` (XAMPP defaults are already filled in: database `ashen_roads`, user `root`, empty password).
- The database and the 4 tables (users, pending, events, rate) are created automatically; `database/ashen_roads.sql` is an optional phpMyAdmin import.
- `?r=health` now shows `"storage":"mysql"`, `"db_ok"` and the account count (or `db_error` if MySQL cannot be reached).
- No `DB_NAME` = the old SQLite / file storage as before.
- Guide: `README-MYSQL.md`.

# v15.51 - CHARACTER PICKER REMOVED + SNIPER REMOVED
- **Character change removed:** the CHOOSE CHARACTER / CHANGE CHARACTER buttons (main menu + lobby), the 3D selection screen and the 10 extra character models are gone. Every player is the original soldier again (also for the other players in a match).
  - Deleted: `js/characters.js`, `js/charselect.js`, `js/rigs/characterRig.js`, `assets/models/characters/`, `tools/test-characters.js`.
  - Server: the `ch` field and the `{t:'char'}` message are gone; accounts no longer store a character. main.js / lobby.html no longer read or send a character id.
  - Everything else from v15.50 stays (admin login activity, `/status`, login backend auto-detect, ...).
- **Sniper removed:** weapon, 4x scope (right mouse / Space / SCOPE button), sniper rounds, sniper ammo from loot / air drops, weapon slot + key 4, key-help lines, server-side sniper damage / range / `hasSn` check.
- **Rooftop nests removed** (they only existed for the sniper: green ROOF ACCESS doors, roof climbing with F, the gold rifle pickups, and the rule that nothing on the street could hurt you on a roof). F is back to car in / out only. Buildings keep their normal collision.
- Deleted: `assets/models/weapons/winchester_model_70.glb` + its credit file.
- Petrol bomb (key 5), machine gun (key 3) and the rifle / club are unchanged.
- `package.json` test script no longer calls `test-characters.js`.

# v15.50 - 10 playable 3D characters
- NEW `assets/models/characters/` - 10 rigged GLB characters (5 M / 5 F), clips Idle / Walk / Run / Jump / Death.
- NEW `js/characters.js` (registry + saved choice), `js/charselect.js` (3D selection screen: rotate, zoom, ALL/MALE/FEMALE filter, SELECT CHARACTER + CONFIRM, animation preview), `js/rigs/characterRig.js` (same interface as SoldierRig, so rifle / club / MG / sniper / molotov still work).
- lobby.html: CHOOSE CHARACTER button (join screen + squad panel); every player's avatar is his own chosen model.
- main.js: local player + every remote player is built from the character that player chose; remote players walk/run by real speed and play Death.
- server: whitelisted `ch` id in join / welcome / joined, `{t:'char'}` changes ONLY the sender's own character; remembered per account.
- index.html: CHOOSE CHARACTER on the main menu. Nothing picked yet = the original soldier (unchanged).
- tools/test-characters.js (27 checks).
- ADMIN login activity: every login / registration now records IP + browser/OS (e.g. `192.168.29.5 · Chrome / Android`); wrong-password and unknown-username attempts are logged as FAILED LOGIN. Several admins allowed: `ADMIN_USERNAME=name1,name2`.
- NEW `/status` page on the game server (http://host:port/status): shows login mode, where accounts are stored, whether the folder is writable and how many accounts exist (no names / e-mails).
- auth.html: if PHP login does not answer but the Node game server does (any port 8000-8010), it switches to the Node login by itself; a small line at the bottom shows `v15.50 · login: node|php · host` so you can see which copy is really running.
- FIX login: `js/server-config.js` now detects the backend by itself (PHP only if api/index.php really answers, otherwise the Node login). A wrong/forced 'php' setting no longer shows "The login backend did not answer" on the Node server (port 8000/8001).

# v15.49 - PETROL BOMB (molotov) + LOGIN USES THE NODE BACKEND
- **New weapon: Petrol Bomb** (model `assets/models/weapons/molotov.glb`). Key **5** / weapon slot / Q cycles to it. Click / ATK = throw. You start every match with **3**; orange-beam loot on the map gives **+2** each (max 8).
- The lit bottle flies in an arc and breaks on a zombie, a wall or the ground. **Fire stays on that spot for ~10 seconds** (flames, smoke, glow, scorch mark that fades). Zombies inside burn (26 dmg/s) and keep burning ~3 s after they leave; the first splash also hurts everything near it. **You** take damage when you stand in the flames.
- Online: the throw is relayed by the server (`molo` message, rate-limited, position clamped). Everybody sees the fire and can be burned by it; zombies are damaged only for the thrower (zombies are local to each client).
- If the model is not loaded yet a plain green bottle is used, so throwing never breaks.
- Login: `js/server-config.js` now defaults to the Node backend (`ASHEN_BACKEND = 'node'`) - START-ONLINE.bat / `npm start` serve the login. Use `'php'` only on PHP hosting.
- Tests: `tools/test-multiplayer.js` checks the petrol bomb relay (67 checks pass).

# v15.48 - LOGIN PAGE FIXES FOR GOING LIVE
- **"Change email or password" fixed:** the server keeps the FIRST password for a pending sign-up (10 min), so changing the password always failed with a confusing error. The button is now **WRONG EMAIL? CHANGE IT**: it keeps username + password, jumps to the email box, and the server message now explains what to do.
- **Live site without email set up:** before, the sign-up pretended to work and told the player to read `database/otp-log.txt` (players can't). Now, on a real website with no email configured, sign-up shows a clear error for the owner (set `SMTP_USER` + `SMTP_PASS` in `api/config.php`). On localhost the log-file mode still works. `OTP_CONSOLE=1` forces the old behaviour (testing only).
- Phones: tabs and the big yellow button no longer wrap onto two lines; keyboard no longer pops open by itself on load; subtitle changes with the mode (CREATE YOUR SURVIVOR / LOG IN TO SURVIVE / CHECK YOUR EMAIL).
- Server health re-checks no longer pile up when a free host is slow to wake up.
- Cache fix: `server-config.js`, `auth-client.js`, `auth.css` load with `?v=15.48`, so after you upload a new version the browser/host cache can't keep serving the old backend address.

# v15.47 - PUBLIC RANK LIST FOR EVERYONE
- New page `leaderboard.html` (top 50 survivors by wins, then matches; shows wins, matches, deaths, play time, online/offline). **No login or admin needed.** E-mails and other private data are never sent.
- New public API: PHP `api/index.php?r=leaderboard` (and `/api/leaderboard` on the Node server).
- Every player now sees a **RANKS** button next to LOGOUT (main menu and lobby). The admin page still has its own Top 5 + full player table.

# v15.46 - SNIPER ON ONLY TWO ROOFTOPS
- The Winchester sniper now lies on just TWO buildings (the one nearest the start + another one at least 45 m away), not on every roof. Climb up (F at the door), walk onto the rifle = picked up, then key 4 / right mouse / Space = 4x scope and shoot. The other roofs are still climbable but have no rifle. A new match puts both rifles back.

# v15.45 - FIX: "pdo_sqlite is missing" on the login page
- The login backend no longer needs the `pdo_sqlite` PHP extension. If the host has it, SQLite is used as before; if not, `api/index.php` automatically keeps the same accounts in `database/ashen-users.json.php` (+ pending / events / rate files). Passwords are still bcrypt hashes. `?r=health` now also shows `"storage":"sqlite"` or `"file"`.
- The login page no longer stops with the pdo_sqlite message.

# v15.44 - PHP BACKEND (login + database) + SNIPER LIES ON THE ROOFTOPS
- **Login page fixed:** it no longer probes ports 8000-8010 or tells you to "run START-ONLINE.bat" / set a Node URL. It now talks to ONE backend (`api/index.php`) and, when something is wrong, says exactly what (PHP off, pdo_sqlite missing, database folder not writable, Netlify cannot run PHP, wrong ASHEN_API_URL) with a test link.
- **PHP backend (`api/index.php`, PHP 7.4+, no packages):** register, 6-digit email OTP (Gmail/SMTP, Resend, host mail(), or `database/otp-log.txt` when nothing is set up), verify, resend, login, `me`, logout-all, admin overview + CSV. Accounts live in the SQLite database `database/ashen.sqlite` (+ `players.csv`). Passwords = bcrypt. Login rate limit (30/min per IP) and 5-minute lock after 6 wrong passwords, also in the database.
- Tokens use the same format as before, so the Node multiplayer server accepts them with `AUTH_MODE=php` + the same `AUTH_SECRET`; it sends join / leave / death / win to PHP (`PHP_API_URL`) for the admin page.
- Settings: `api/config.sample.php` -> `api/config.php`. Setup guide: `README-PHP.md`. `START-PHP.bat` runs it on your PC (`php -S localhost:8000`).
- The old Node login still exists: `window.ASHEN_BACKEND = 'node'` in `js/server-config.js`.
- **Sniper:** you no longer start with it. A Winchester Model 70 floats on every roof (gold glow + tall gold beam). Climb a building with F, walk onto the rifle = picked up (12 rounds, equipped), then key 4 / right mouse / Space = 4x scope. Rifles on other roofs give +8 rounds. New match = pick it up again. Online: the server accepts sniper shots only from a player who picked it up on a roof.

# v15.43 - ADMIN: SAVED PLAYER DETAILS + ACTIVITY LOG
- Fixed local server discovery on Live Server: login, lobby, and gameplay now search through port 8010, matching the server's automatic port fallback.
- **Everything the admin sees is now stored in the database** (`database/users.json`, or Upstash on live hosting) and survives restarts: username, email, registration date, **last login, last activity, number of logins, play time (online matches), matches, deaths, wins**.
- **Activity log:** register, login, join / leave a room (with minutes played), win, death - saved in `database/activity.log` (or Upstash list `ashen:events`). The admin page shows the latest 100 events.
- **Download for Excel:** button DOWNLOAD PLAYERS on `admin.html` (also saved automatically as `database/players.csv`, now with all the activity columns). Only the admin account can download it.
- Setup unchanged: register your own account, set `ADMIN_USERNAME` to that exact name, restart, open `admin.html`. Passwords are never shown or exported (only scrypt hashes exist, in users.json).
- Note: solo (offline) play is counted as a login / last activity only; room joins, play time, deaths and wins come from online rooms.
- New test: `node tools/test-admin.js` (11 checks, includes a server restart).

# v15.42 - VICTORY SCREEN + NICER VERIFICATION EMAIL
- **YOU WIN screen redesigned:** golden trophy, spinning light rays, falling confetti, big gold gradient title, survivor rank badge (S / A / B / C from zombies defeated and time), 4 stat tiles that slide in one by one, glowing PLAY AGAIN button. The YOU DIED screen is unchanged.
- **Verification email:** the 6-digit code now arrives as a proper styled Ashen Roads email (HTML + plain-text fallback) through SMTP (Gmail) and through Resend.
- Sign-up already asks for username + email + password and sends the code (v15.41). If your sign-up page shows NO email box you are looking at an old copy of auth.html - replace the whole folder / redeploy this version.
- Fixed a flaky check in `tools/test-smtp.js` (it sometimes picked 6 digits from the mail headers instead of the code).

# v15.41 - SIGN-UP WITH EMAIL OTP + DATABASE FOLDER
- **First visit = CREATE ACCOUNT:** the login page now opens on the sign-up form (username, email, password) when the device has never logged in. The server emails a 6-digit OTP; the account is created only after the code is typed.
- **OTP email without a paid service:** new SMTP sender (no packages). Put `SMTP_USER` + `SMTP_PASS` (Gmail app password) in a `.env` file and the code arrives in the player's inbox. Other providers: `SMTP_HOST` / `SMTP_PORT`. Resend still works. With nothing configured the code is printed in the server window instead of failing with an error.
- **`database/` folder:** accounts now live in `database/users.json` (+ `players.csv` readable in Excel, `pending.json`, `secret.key`, `README.txt`) instead of `server/data/`. Old accounts are copied over automatically. The folder, `server/` and `.env` can't be downloaded from the web.
- Clear error when the email can't be sent (wrong address / wrong SMTP login) instead of "Server error".
- Tests: new `node tools/test-smtp.js` (18 checks: fake mail server, OTP, wrong/right code, database files, blocked downloads).

# v15.40 - SNIPER FIXES (roof shots, online hits, load size)
- **Roof shots:** the building under your feet no longer blocks your own sniper shot (before, a zombie closer than ~11 m to the wall below could not be hit from the roof). A shot that would land inside your own building now stops on the roof surface. The range readout in the scope uses the same rule.
- **Online:** a hit from another player now reaches you on a roof (the roof protection used to block real players too, not only zombies / creatures). Zombies and creatures still cannot touch you up there.
- **Download size:** `winchester_model_70.glb` 12.2 MB -> 0.9 MB (textures 1024 px, same shape and position, nothing else changed).

# v15.39 - SNIPER (Winchester Model 70), 4x SCOPE, ROOFTOP SNIPER NESTS
- **Sniper weapon:** your `winchester_model_70.glb` is in `assets/models/weapons/` (credit file next to it, CC-BY 4.0). Key **4** (or the new weapon slot / Q-cycle) takes it out. Bolt action: 1 shot every 1.15 s, 350 damage (kills any zombie), the bullet goes through 2 zombies, range 260 m, own ammo (start 12, max 30). Every ammo box / pickup also gives sniper rounds, a rooftop nest restocks +8 (every 2 min per building).
- **4x scope:** hold **RIGHT MOUSE** (or **Space** = on / off, or the **SCOPE 4x** button on a phone). First-person view, exactly 4x zoom, black scope ring + crosshair, live range readout (metres to whatever is under the crosshair), slow breathing sway (crouch = steadier), slower mouse / finger while zoomed, walking slowed, laser sight + aim assist off. The shot leaves exactly through the middle of the scope. Look angle goes far enough down to shoot a street from a 50 m tower.
- **Rooftop nests:** every building has a green glowing ROOF ACCESS door. Stand in front of it, press **F** (phone: **STAIRS** button) -> short fade -> you stand on the roof with the sniper out. Low wall round the edge, you cannot fall; walk to the edge to shoot down (a wall of the building blocks shots that would have to go through the roof). Walk onto the green pad + **F** to go back down. Zombies gather at the foot of the building but cannot hit you up there.
- **Online:** your height is synced (others see you on the roof and can shoot you from the street), the server decides sniper damage (70, range 270 m, max ~1 shot / s).
- Backend / login: unchanged (accounts are stored by `server/auth.js`, see README).

# v15.38 - REAL CARS (Nissan R34 + Ford Escort)
- **Old environment cars removed:** the blocky box jeep and the unused box car-wreck code are gone.
- **Two real car models added** (`assets/models/vehicles/`): Nissan Skyline GT-R R34 and Ford Escort RS1600 Mk1. Both were repacked for the web: 41 MB -> 17 MB, textures 1024 px, meshes merged per material (37 / 51 draw calls instead of 766 / 138).
- Press **F** near a car to get in / out (works for either car). Green squares on the minimap and big map show both cars. R34 is faster (max 24), Escort slower (max 20). Cars still run over zombies.

# v15.37b - LIVE HOSTING FIX (accounts survive restarts)
- **Remote account storage:** set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (free Upstash Redis, see README) and accounts + the token-signing key live in that database instead of the host's wiped disk. The server loads them before it starts listening; new names are claimed atomically (`SET NX`).
- **Login page on live hosting:** only probes its own address (no pointless :8000 tries), shows "server is waking up" for a sleeping free host and keeps retrying by itself.
- **Proxy-aware:** real client IP (X-Forwarded-For) is used for the login rate limit on Render / Railway / Fly / Heroku / Cloud Run.
- `render.yaml`: health check path + env slots for the Upstash variables. New test: `node tools/test-auth-remote.js` (simulates a wiped disk between restarts).

# v15.37 - LOGIN / CREATE ACCOUNT (authorization)
- **New page `auth.html`:** LOGIN tab for existing players, CREATE ACCOUNT tab for new players. Username 3-14 letters/numbers/_ (unique, not case sensitive), password min 6.
- **Whole game is behind the login:** `index.html` and `lobby.html` send you to `auth.html` when you are not logged in (`js/auth-client.js`). A LOGOUT button + your name sits on the main menu and in the lobby top bar.
- **Backend (`server/auth.js`, no npm packages):** `POST /api/register`, `POST /api/login`, `GET /api/me`, `POST /api/logout-all`. Passwords are hashed with scrypt + random salt (never stored in plain text), accounts live in `server/data/users.json`, login gives a signed token (30 days) sent as `Authorization: Bearer`.
- **Authorization on the game socket:** lobby AND match WebSocket `join` must carry a valid token, otherwise the server answers `unauth` and closes. Your in-game name is the ACCOUNT name, so nobody can pretend to be somebody else.
- **Protection:** 30 login/register tries per minute per IP, account locks 5 min after 6 wrong passwords, same error for unknown user / wrong password, `server/data` can't be downloaded.
- Env: `AUTH_REQUIRED=0` turns the login off, `AUTH_SECRET` fixes the signing key, `DATA_DIR` moves the account file. Tests: `node tools/test-auth.js` (old tests run with AUTH_REQUIRED=0).

# v15.35 - faster player, bullets you can really find and collect, clearer phone buttons
- **Speed:** walk 4.6 -> 6.2 m/s, run 9.0 -> 11.5, crouch 2.4 -> 3.0 (leg / arm animation + footsteps sped up to match). Phone stick: a push of ~62 % already gives full walk speed (before a medium push = half speed, which felt very slow); a full push = run.
- **Bullets:** start with 60 (was 30); ammo box +40 (was +30); 180 boxes on the streets (was 120) + 50 crates (was 34); bullets slide towards you when you are within ~6 m and the pick-up reach is 2.4 m (was 1.5) so a phone player does not need to land exactly on the box.
- **Low-ammo arrow** now shows from 10 bullets (was only at 0), and the bullets count sits ON the ATK button (turns red and pulses when low / empty).
- **Phone buttons:** colour coded rings (red ATK, green MED, blue SWITCH, amber RELOAD ...), bigger buttons in portrait.

# v15.34 - STAMINA bolt pickups + even bigger map / zone
- **Stamina pickup:** 16 green round tokens with a white lightning-bolt symbol (green beam, green dot on the minimap and the big map) lie around the city. Picking one gives FULL stamina and UNLIMITED sprint for 20 s (the stamina text shows BOOST 20s...). Works solo and online (same ids / same places for everybody, taken tokens disappear for the others).
- **Bigger map and zone:** streets phone / online 7 -> 8 (city -384 … +384), PC solo stays 9 (-432 … +432). Blue zone now starts at the city edge (400 online/phone, 448 PC solo; was 340), phases are 72 % / 47 % / 25 % / 10 % of that. Loot, landing spots and ground pickups are spread over the whole bigger city.

# v15.33 - faster walk, bigger zone, more bullets, easier phone buttons
- **Walk / run:** walk 3.6 -> 4.6 m/s, run 7.2 -> 9.0, crouch 1.9 -> 2.4. Leg animation (soldier rig), arm swing and footstep sounds were sped up by the same factor so the feet do not slide.
- **Blue zone bigger:** start radius 260 -> 340, phases 190/120/60/22 -> 260/170/90/35 (more time to run). Loot and the plane landing spots now cover the whole bigger zone (they stayed inside the middle 150 m before).
- **Bullets:** 120 ammo boxes on the streets (was 45), 34 ammo crates (was 14), 10 starter pickups next to the start now mostly bullets, ammo box = +30 (was +20), zombies / animals drop bullets more often. **Wood:** 26 (was 60), 18 % of random pickups (was 45 %), fewer wood drops.
- **Phone buttons:** bigger invisible touch area around every round icon / weapon slot / RUN / AIM button, readable labels (8-10 px), short vibration when pressed, pressed ring, slight see-through, no accidental zoom / long-press menu.

# v15.32 - more zombies/animals online, no fake winner, machine gun in solo
- **Fake winner fixed:** online, killing 10 zombies ended the match with "YOU WIN" (the solo goal), so a player who cleared the few zombies "won" before the others were dead. Online the zombie goal now never ends the match - the winner is only the LAST SURVIVOR.
- **Zombies and animals were too few online:** solo keeps 5 zombies, but a room now gets up to 14 zombies (9 on phones) and 14 animals/insects (9 on phones) per player, they come from every side and refill every 2.5-5 s (zombies) / 1.2-3 s (animals), so nobody can clear the map and then just hunt the other player.
- **Machine gun in solo:** it was a single gun at a random spot of a 300 m map, so it was never found outside a room. Solo now has TWO machine guns on the streets near the start (purple beam + purple dot on the map). Online stays ONE shared gun (first come, first served).

# v15.31 - one machine gun, special keys, bigger zone
- **Machine gun** (the new M4-style model, repacked from 18.7 MB to 3.2 MB): ONE lies on the map (same place for every player online); the first player to reach it owns it and everybody gets "<name> took the MACHINE GUN!". Picking it up gives a FULL 100-bullet magazine, equips it, and a second pickup / an air drop adds another 100 (max 200).
- Rules: 12 bullets / s, no reload, own ammo (rifle ammo boxes do not refill it), 40 damage to zombies (rifle 100), **9 damage to players** (rifle 25). When it is empty you are put back on the rifle. SWITCH cycles rifle -> club -> machine gun; keys 1 / 2 / 3, or **G** = machine gun on / off.
- It is held in the soldier's front hand (the baked rifle barrel is folded away while it is out), follows the camera tilt.
- Map: machine guns are **PURPLE** - a tall purple beam in the world, a purple diamond on the minimap (an arrow on the rim of the minimap when it is out of range) and a big purple "MG" dot on the big map (+ a "Machine gun xN" line in its legend).
- Server: only a player who really picked up a machine gun (loot ids 900-909, first come first served) can fire one; damage and fire-rate limits are decided by the server (new tests, 64 pass).
- **Keys:** **Tab** or L = big map, **G** = machine gun, **F1** or **?** = list of every key (the hint line at the bottom shows them too).
- **Bigger blue zone** (single player and multiplayer): start radius 170 -> 260, phases 110/65/30/10 -> 190/120/60/22 with a little more time between them.

# v15.29 - mobile ATK icon
- ATK icon: tap = one attack, HOLD = keeps attacking (like holding the left mouse button on PC). Before, a hold fired only once, so the rifle needed a tap for every bullet.
- The finger on ATK stays attached when it drifts off the icon; touch fallback for old phones; releases on tab switch.
- Looking around by dragging the screen now also works while another finger holds ATK or the joystick (it counted every finger on the screen and ignored the drag).

# v15.28 - wood stick in the player's hand
- The club was mounted on a guessed point beside the rifle barrel (floating, not in a hand, and it did not follow the camera tilt). It is now mounted on the soldier's real front-hand point (measured on the mesh) and follows the body when you aim up / down.
- While the club is out the rifle barrel in front of the hand is folded away, so you no longer see a rifle and a stick at the same time; SWITCH back to the rifle brings it back.

# v15.27 - SWITCH icon
- Phone: a tap inside the SWITCH icon now works even if another layer covers it or swallows the touch.
- PC: the mouse is locked to the game so the round icon cannot be clicked; the icon now shows its key (Q). Q, mouse wheel and 1/2 switch weapon.

# v15.26 - hit validation, keep-alive, room size
- **Anti-cheat:** a hit only counts after a real shot (one hit per shot, within 2 s) and when the target is near the shot line; damage is fixed by the server (25).
- **Render free plan:** while a room exists the server pings its own /health every 10 min so it is not put to sleep (KEEP_ALIVE=0 turns it off).
- **Room size:** the server sends MAX_PLAYERS to the lobby, so the seat counter follows the env variable.
- Still per-player: zombies and creatures.

# v15.26 - server-side hit validation (anti-cheat)
- A `hit` now only counts if the shooter really sent a `shot` in the last 2 s (one hit per shot) AND the target stands within 4 m of that shot's line and within gun range. Hacked clients can no longer hit anybody anywhere.
- Damage is decided by the server (25 per gun hit), not by the number the client sends.
- HIT_TOLERANCE env var (metres, default 4) can be raised for very laggy players.
- Tests: 60 protocol checks + 24 client checks pass.

# v15.25 - multiplayer fixes
- **Winner never won:** a player who died kept being re-broadcast by the server with his last hp>0, so everybody still saw him alive and the last survivor never got YOU WIN. Dead players are now final (also after a reconnect).
- **Lobby ghosts:** lobby sockets and game sockets are separated (pg). Squad mates no longer show up as ghost enemies when the lobby hops to the game page; game sockets no longer break the lobby countdown.
- **Start line:** the barrier waits for PEOPLE (per-tab cid), not sockets, so a reload/reconnect can't open it early; a friend who closes the tab after LAUNCH is dropped after 60 s instead of freezing everybody for the full timeout.
- **After the match** the room resets to a fresh lobby with a new seed (before: new players joined the finished match in a 10 m zone).
- Server credits kills itself (15 s window), caps/rate-limits hits, shots, chat, lobby and flood; validates all input; 64 KB frame limit; fragmented frames supported.
- Positions are sent only when they change (serialised once) + full snapshot on join; slow phones no longer pile up memory.
- Ghost players vanish instantly when a TCP connection ends (was up to 15 s).
- Room size 8 = lobby seats (server said 20 -> 9th+ player was invisible but blocked READY). Duplicate names get numbered.
- Reconnect: the old half-open socket is replaced at once, dead stays dead, picked loot is cleaned up.
- HTTP: path-traversal hole (sibling folders with the same prefix) closed, malformed URLs no longer hang, ETag/304, gzip, assets cached 1 h (a refresh no longer re-downloads ~80 MB).
- Tests: `npm test` (56 protocol checks + 25 checks that run the real js/main.js multiplayer code and the real lobby.html script against the real server).

# v15.24
- SWITCH icon fixed: self-contained rifle/club toggle with toast feedback, pointer+touch+click binding (de-duplicated), weapon-slot icons get touch/click fallbacks, mouse wheel also switches weapon (desktop pointer-lock).

# Ashen Roads v4 – what changed

## Speed (phone / laptop / PC)
- Heavy kit buildings (28k–64k vertices each) now only render close up (95 m phone / 120 m PC). Further away a cheap textured block
  stands in (ONE instanced draw per building type). They only cast shadows inside 55/75 m.
- ~58 % of buildings are now cheap procedural blocks instead of kit models.
- Auto resolution scaler: if fps < ~38 it lowers render resolution, then switches bloom off, then sun shadows. It raises it again when fps is steady.
- Phone tier: no bloom, 1024 shadow map, smaller shadow area, 3 street-lamp lights (was 8), lower anisotropy, pixel ratio 1.15–1.5.
- Camera / laser / ricochet code no longer allocates objects every frame; minimap redraws at 20 fps; laser beams share geometry.
- `?lite=1` in the URL forces the light tier.

## Laser reflection
- The red aiming laser bounces off walls, cars, trunks and props (2 mirrored segments + glowing dot where it lands).
- Fired shots ricochet off surfaces with a reflected beam and sparks.

## Dog on mobile
- Portrait phones get a wider vertical FOV and a slightly farther camera.
- The dog follows closer (1.5 m behind / 0.95 m beside you in portrait), runs faster to keep up and teleports back earlier.
- Dog material has a little self-light so it is visible at night.

## Rain
- GPU rain streaks, ground ripples, wet glossy roads, darker sky/fog, rain sound, lightning + thunder in heavy spells.
- Rain comes and goes in spells. **H** toggles it.

## Buildings
- City grew from 8x8 to 10x10 blocks (streets ±240).
- New building types in the same ruined-city style: 6/8-storey brick flats, 12/16-storey concrete & glass towers, warehouses.
  Windows light up at night, some are broken. Rooftop water tanks, AC units and antennas.

## v4.1
- SUN / DARK / AUTO theme: K key (phone: theme button) locks noon, midnight, or the normal cycle.
- Laser sight and shots now also reflect off zombie bodies, not only walls.

## v8 – bigger city + longer view
- Playable city 10x10 -> 14x14 blocks on PC (12x12 on phones): streets now reach +-336 (+-288 phone).
- Far skyline ring: 3 extra rings of tall procedural blocks beyond the edge (2 on phones). Cheap instanced draws, no collision, no shadows.
- Fog thinned (0.010 -> 0.0058 base, night/rain proportionally) so buildings stay visible much further away.
- Ground plane 1000 -> 1500 so the outer ring never hangs over empty void.

## v9 – faster player, slow regen + heal effects, 3D hindrances
- Player faster: walk 2.8 -> 3.6, run 5.6 -> 7.2, crouch 1.5 -> 1.9 (soldier leg cycle + footsteps sped up to match, so no foot sliding).
- Slow regen: player +1.5 HP/s after 6 s without damage, zombies +2 HP/s after 5 s without being hit.
  Effects: rising green "+" sprites, expanding green ring on the ground, green screen-edge pulse + glowing HP bar for the player. Medkit gives a bigger burst.
- Hindrances: 3D instanced obstacles pop up out of the street ahead of you (rise-from-ground animation + dust ring), max 12 (8 phone), removed when you leave them behind:
  concrete barrier + sandbags (solid, block you AND zombies), barbed wire (slows you and zombies to ~40 %), burning barrel (solid, 4 dmg/0.5 s to you, 8 dmg/0.5 s to zombies in 1.6 m).
  They show on the minimap (grey = solid, purple = wire, orange = fire).

## v10 – even bigger environment
- Playable city 14x14 -> 18x18 blocks on PC (streets +-432), 12x12 -> 14x14 on phones (+-336). Far skyline ring is still added beyond the edge.
- Ground plane 1500 -> 2000.
- Street furniture + roadside clutter (bollards, drains, manholes, cones, barrels, crates, barriers, trash) scale with the bigger map so the streets are not emptier.
- Speed: street-lamp light sorting now ~8x per second (was every frame) and the bulb glow is set once instead of per lamp.

## v11 – Animated Enemies pack added (rat, spider, snake, frog, wasp)
- The 5 FBX files were converted to GLB (skeleton + skin + all animation clips) -> assets/models/creatures/*.glb. Models face +Z, stand on y=0 and are already scaled (rat 1.0 m, spider 1.6 m, snake 1.9 m, frog 0.9 m, wasp 1.1 m).
- Animations: rat/spider/snake use Walk (wandering) and Run/Walk (chasing) with the clip speed matched to the ground speed so feet don't slide; Jump = lunge attack; Attack; Death.
  Frog hops (movement follows the Jump clip), snake flips belly-up when it dies (no Death clip in the pack), wasp plays Flying all the time, circles you, dives to sting (Attack clip), pulls back up, and falls from the sky when shot (Death clip).
- They spawn around you every 7-14 s (max 4 on PC, 3 on phone), share the zombie systems: gun/laser/auto-aim/melee/dog/fire barrels/regen/health bars/minimap (orange dots). They don't count toward the 5-zombie cap or the kill goal, but drop ammo / medkit / scrap sometimes.

## v12 – insects as hindrances
- Wasp + spider are now "insect hindrances": they attack, but the damage is tiny (1-2 HP) and the real cost is the debuff:
  wasp sting -> you are SLOWED to 60 % for ~2.8 s (amber screen pulse); spider bite / lunge -> POISONED for 5 s (1 HP per 0.8 s, no regen while poisoned, green screen pulse + green HP bar). A medkit cures poison.
- Wasps come in small swarms (2-4), insects spawn more often (every 5-11 s), up to 6 creatures at once (4 on phones). Insects have low HP so one hit still kills them.

## v13 – fixes
- Laser is ONLY a sight now: the auto-fire is gone. Desktop = LEFT MOUSE CLICK shoots (hold to keep firing, also works on the click that grabs the mouse); mobile = only the ATK button shoots (touching/dragging the screen just turns the view, it no longer fires the gun). V still toggles the aim assist (laser snaps onto targets) but it never shoots.
- Zombies AND insects both come: zombies now also spawn on a timer (first one ~3 s after the start, then every 9-14 s while under the 5 cap), not only when you walk; insects keep their own timer.
- Insects bigger: wasp x1.6, spider x1.55 (hit boxes, health bars, reach, hover height and leg-speed matching all scaled with them).

## v13 – HIGH QUALITY by default
- Render resolution up to 2x (never below 1x on PC), 4x MSAA anti-aliasing, 4096 sun-shadow map (2048 phone), soft shadows everywhere.
- Full-detail buildings and shadows reach further (170 m / 110 m PC), 16x anisotropic texture filtering, 8 street-lamp lights (4 phone), full-res building atlas and bloom on phones too.
- Auto resolution scaler still protects frame rate but will not drop below 1x on PC. Add `?lite=1` to the URL for the old light tier.

## v13 – multiplayer fixes (everyone plays the SAME world)
- ROOT CAUSE: every player's browser built its own random city, so buildings/cars/trees were in different places for each player. Online mode now builds the city from a fixed seed and one fixed size (14x14 blocks, phones and PCs alike), so all players see and collide with the identical map.
- Pressing PLAY ONLINE reloads the page once in online-world mode (lobby.html already does this). Solo play is unchanged.
- Loot, air drops and the blue zone are now identical for everybody in the room. Late joiners get the zone at the same phase/circle/timer as the others.
- Picking up loot or an air drop removes it for every player; the server remembers what was taken so late joiners don't see old loot.
- Other players now appear as the real soldier model with walking animation (name tag above), not grey cylinders.
- Still per-player (not shared): zombies and creatures, world pickups (scrap/ammo on the roads), the jeep.

## v13 – day / night cycle
- Game now starts in the dark and the SUN RISES after ~30 s; then a bright day (3 min), then dusk and night again (full cycle 6 min). Night is moonlit blue and clearly brighter than before (it was nearly black).
- Brighter dawn/day curve; thinner night fog.
- Online: time of day is driven by the room clock, so every player sees the same sun/night.
- K / theme button still switches AUTO (cycle) / SUN (always day) / DARK (always night).

## v13 – everybody joins and starts TOGETHER (room code flow)
- Share the room code (or the INVITE link in the lobby). Players join the lobby with that code, press READY.
- When ALL players are ready the SERVER starts one shared 6 s countdown (before, every browser ran its own). A newcomer who joins (not ready) cancels it.
- At 0 the server tells everybody to open the game at the same moment, then holds everyone at a "Waiting for squad x / N loaded" screen until the whole squad has finished loading, then everybody starts together (same zone timer, same time of day, same loot). A player who never loads is skipped after 75 s.
- The room (and its seed) is kept alive while the lobby page hops to the game page.
- Joining a match that is already running puts you straight into it.
- Needs at least 2 players in the lobby (MIN_PLAYERS env var on the server changes this).

## v13 – CREATE ROOM / JOIN ROOM
- Lobby start screen now has CREATE ROOM (server invents a short code like 93RJR) and JOIN ROOM (type a friend's code).
- JOIN ROOM only joins a room that exists; a wrong code shows "Room not found" and stays on the start screen. Room full is also reported.
- In the lobby: 🔑 COPY ROOM CODE (on phones it opens the share sheet), 📨 INVITE LINK (?room=CODE pre-fills the join box), and clicking "ROOM xxxxx" at the top copies the code too.
- Codes avoid confusing characters (no 0/O/1/I/L).

## v13 – smoother movement
- The always-high-quality setting could make the game stutter on weaker PCs and phones, which makes walking feel heavy. High quality is now automatic only on capable desktops (more than 4 CPU cores); phones and weak laptops use the light tier again. `?hq=1` forces high, `?lite=1` forces light.
- High tier is lighter: render scale 1.25-1.75x (was up to 2x), 3072 shadow map, and the auto resolution scaler may go down to 0.75x (was locked at 1x) when frames drop.
- A slow frame no longer slows the player down as much (frame time cap 50 ms -> 66 ms).

## v13 – hindrances from ALL sides
- Street obstacles (fire, wire, barricades...) and hindrance creatures (rats, wasps, spiders...) used to spawn only in a cone in FRONT of the player. They now spawn all around: front, back, left and right. (Zombies still come from ahead, as before.)

## v13 – create / join room on the MAIN screen + shareable link
- The first screen now shows CREATE ROOM & SHARE CODE and JOIN ROOM (code box) instead of the old "PLAY ONLINE" box that jumped straight into the game. Both open the lobby (create / join / ready / start together).
- COPY ROOM CODE / INVITE LINK now copy a ready message with the code AND a working link (on localhost it uses your LAN address so friends on the same Wi-Fi can open it).
- Added package.json, Procfile, render.yaml and a README section to host the game on the internet so friends anywhere can join with the code.

## v13 – "Server not reachable" fix
- Cause: the multiplayer server (Node.js) was not running - e.g. the game was opened with Live Server or the old start-game.bat (static server, no multiplayer). The create/join page could not connect.
- The main-screen CREATE / JOIN buttons now check the server first (new /health address) and explain what to do instead of opening a lobby that cannot connect. If the server is found on another port (e.g. you used Live Server) they jump to the right address by themselves.
- The lobby page shows live status ("Multiplayer server connected" / "not running") and reconnects by itself once the server starts.
- tools/start-game.bat and tools/start-online.bat now start the Node server (when Node.js is installed), open the browser only after the server is up, and keep the window open to show any error. They were also saved with Windows line endings (start-online.bat had Linux ones, which can break .bat files).
- The server moves to the next port by itself if 8000 is busy.

## v13 – clearer "server not running" help
- The CREATE / JOIN message now says WHY (opened as a file / Live Server / an old or non-multiplayer server answering / nothing at all) and which addresses were checked.
- After the message the page keeps checking every 2.5 s and continues to the lobby by itself as soon as the server is started - no need to press the button again.

- The pages now also look for the multiplayer server on ports 8001-8010 (the server uses the next free port when 8000 is busy).

## v13 – visible parachute landing, laser on players, enemies from all sides
- DROP INTRO: the camera code of the plane drop was overwritten every frame by the normal camera, so the landing was never visible. Fixed. Now: plane fly-by, the player JUMPS (visible character), short free-fall, striped parachute with lines opens ("PARACHUTE OPEN"), camera swings around the player, slow flare, touchdown with dust ring, canopy collapse and a small shake, then "LANDED". Online: each player lands on a different spot.
- LASER: other players are now real targets: the red laser lands on them (reticle + reflection), the shot stops at walls/zombies in front instead of passing through them. Walls, cars, barrels, barricades and zombies already reflected the beam.
- ENEMIES FROM ALL SIDES: zombies now also spawn around the player in any direction (before: only ahead); hindrance creatures and street obstacles spawn a bit more often (creature cap 8 PC / 5 phone).

## v14 – multiplayer room-code fixes
- BUG: the lobby -> game hand-off clicked PLAY ONLINE before the assets had loaded (`#loadingScreen` is position:fixed, so `offsetParent` was always null). The "everybody loads, then starts together" barrier therefore did not work. The hand-off now waits until the loading screen is really hidden.
- Room code + name travel in the URL (`index.html?autoplay=online&room=CODE&name=NAME`) instead of only localStorage, so several tabs/browsers on one PC no longer overwrite each other's room or name.
- Mic permission is no longer requested automatically on connect (it stalled the connection and made the whole squad wait). Press N / the mic button to enable it; voice links are rebuilt automatically.
- Server: WebSocket ping every 20 s (idle lobby connections are no longer dropped by hosts/proxies); a player who joins the lobby while the squad is loading is waited for; load timeout 75 s -> 120 s.

## v14.1 – real gun-shot sound
- The shot now plays `assets/audio/gun-shot.mp3` (first shot of the supplied clip, trimmed to 1.1 s and normalised) with a tiny random pitch change per shot. If the file can't be loaded the old synthesized shot is used.
- In multiplayer you now also HEAR other players' shots (quieter with distance, panned left/right).

## v15.1 - COMMON ROOM
- New always-open public room for everybody: COMMON ROOM button on the main screen and on the lobby start screen (no code needed). The server creates room `COMMON` on the first visit and everybody after that joins the same one.
- Lobby button shows live player count and whether a match is already running (new `/common` info address on the server). Joining while a match runs puts you straight into it.
- Private CREATE ROOM / JOIN ROOM (code) still work exactly as before.

## v15.2 - laser no longer reflects
- The red laser sight and the fired laser shot now stop on the object they touch (wall, car, tree, zombie, player, ground). The mirrored bounce beams (sight) and the ricochet beam (shots) are removed. The small glow dot at the landing point and the impact sparks stay.

## v15.3 - side buttons / UI layout
- Action buttons are now a compact 2-column grid with a big red ATK button on top (was one column of up to 9 buttons that ran off the top of phone screens and over the minimap). Phones held sideways put the buttons in a 3-column row beside the look stick.
- CHAT / MIC (online) moved from the bottom-right corner (it overlapped the action buttons and the controls hint) to the right edge under the minimap, same button style and size as the others.
- The incoming-message popup (Y = reply) is centred instead of covering the minimap.
- Buttons give pressed feedback and use touch-action:manipulation (no double-tap zoom).

## v15.4 - microphone fixes
- Real cause #1: opened over plain http://<IP> (friends on Wi-Fi) the browser refuses microphone access completely. The game now says so clearly (chat line + toast + lobby message) and how to fix it (host: http://localhost:8000, friends: https link). Other reasons are reported too: permission blocked, no microphone, microphone busy.
- Voice links: WebRTC messages are now processed one at a time and early ICE candidates are queued (they used to arrive before the offer was applied and get dropped, so voice sometimes never connected). Both players switching the mic on at the same moment no longer breaks the link (offer collision handling).
- Incoming voice works even when the stream object is missing; playback is retried on the first click if the browser blocked it. Lobby: audio level meter context is resumed.
- Mic falls back to plain audio constraints when the browser rejects the echo/noise ones.
- New `/ice` address: set env TURN_URL (comma list), TURN_USER, TURN_PASS on the server to add a TURN relay for players behind strict routers / mobile data. Without it only STUN is used.

## v15.5 - sound system
- SOUND BANK: every game sound can now be a real recording. Put files in assets/audio/ named after the event (zombie-groan.mp3, footstep-1.mp3, rain.mp3 ...; full list in assets/audio/README.txt). Variants (-1, -2, ...) are picked at random with a small pitch change. Events without a file keep the old synthesized sound, so nothing breaks. The server lists the folder at /audio-manifest, so only files that exist are requested.
- ambient.mp3 / rain.mp3 loops replace the synthesized wind+drone / rain bed (rain loudness still follows the weather).
- More natural distance: far sounds are muffled (air absorption low-pass) as well as quieter, other players' gunshots arrive with a speed-of-sound delay, and every gunshot has a short slap-back echo off the buildings.
- At most ~28 recorded voices at once so a big fight can't overload the audio.

## v15.6 - laser aligned with the barrel
- The player model used to turn toward the view direction with smoothing, while the laser/bullets used the exact view direction, so the red beam left the muzzle slightly off-axis whenever you turned. When armed, the model now follows the view direction exactly, so the laser always comes straight out of the gun barrel.

## v15.7 - in-game voice / mic fixes
- Voice links now always SEND a track from the start (the real mic if it is already allowed, otherwise a silent placeholder). Turning the mic on later just swaps the track on the open links (replaceTrack): no reset, no new offer, no race. Before, a player who joined without a mic had a receive-only link that could not carry his voice until it was rebuilt, and the rebuild could fail when both sides did it at once.
- The lobby used a send/receive transceiver created before the offer arrived, which browsers do not always match to the incoming offer, so the answering side could end up receive-only. The lobby now uses the same placeholder-track method.
- Mic ON in the lobby is remembered for the tab: after the lobby -> game hop the game switches the mic on again by itself (a few seconds after joining). N / the MIC button still toggles it, and the choice is remembered.
- A late ICE message from a link that was already closed no longer creates a ghost link.
- If a voice link fails (strict router / mobile data), the chat now says so instead of staying silent. For those networks set TURN_URL / TURN_USER / TURN_PASS on the server (see README).
- Reminder: the browser only allows the mic on http://localhost or an https:// address. A plain http://192.168.x.x link can never use the mic.

## v15.8 - laser / bullets no longer pass through walls when you stand close
- When the gun muzzle was inside a wall / car / trunk / prop box (you are pressed against it), that box was skipped completely, so the red laser and the bullets went straight through it. Now such an object blocks the laser and the shot right at the muzzle. Shooting along an open direction is unchanged.

## v15.9 - phone / weak PC freezing
- The loaded models carry huge textures (dog 4096x4096, soldier and pistol 2048x2048, zombie 1024x1024 x4) that used ~200 MB of GPU memory and froze the page on phones. In the light quality tier (phones / weak PCs) they are now shrunk once after loading (dog + soldier 1024, pistol + zombie 512) before they reach the GPU. Desktop high quality is unchanged. ?hq=1 forces full textures, ?lite=1 forces the small ones.

## v15.10 - lobby: room creation can no longer hang silently
- If anything throws while creating / joining a room the lobby used to stay on "Creating room..." forever. It now shows the real error text. The "Server not reachable" message now says exactly what to do (keep start-online.bat open and use http://localhost:8000/lobby.html).

## v15.11 - multiplayer server: easy, hard-to-break start
- New START-ONLINE.bat in the main game folder: double-click it (no need to open tools/ or a terminal). `node server.js` / `npm start` now also work from the game folder (the old "MODULE_NOT_FOUND" came from running `node server\server.js` in the wrong folder, usually the extra outer folder created by unzipping).
- The server no longer dies because of one bad message; the error is printed and every room keeps running.
- If the lobby is opened on Live Server (5500) or as a file and the real server is already running, it jumps to http://localhost:8000/lobby.html by itself.
- The "server is not running" messages now point to START-ONLINE.bat.
- Tested: server started from another folder, room created, second player joined with the code.

## v15.21 - landscape phone play, RUN + AIM buttons, multiplayer reconnect
- Phones: "Rotate your phone" screen in portrait (game auto-pauses), fullscreen + landscape lock on first tap, compact landscape HUD.
- RUN button (tap = sprint while moving, drains stamina, auto-off when out of breath). Joystick run threshold lowered 0.82 -> 0.72.
- AIM button: AUTO (laser locks onto zombies) / MANUAL (you aim with the look stick). Saved between sessions. V key does the same on PC.
- Multiplayer: auto-reconnect (rejoins the same room), longer connect wait for hosted servers, bad messages no longer throw,
  "room not found" handled, server drops ghost players (no reply for 60 s) and never throws on a dead socket.

## v15.22 - mobile icons + multiplayer login fixes
- "Rotate your phone" screen no longer covers the start screen / multiplayer login in portrait (it only appears once you are playing). Taps on text boxes no longer trigger the fullscreen request.
- Skull / ammo / wood icons are now inline SVG (they came from the Font Awesome CDN and showed up blank when the CDN was slow or blocked on phones).
- CHAT / MIC buttons: icon-only round buttons on landscape phones (they overlapped the objective banner).
- Login: localStorage errors (private mode) no longer break CREATE / JOIN; hosted servers that are waking up (Render free plan) get 9-20 s instead of 1.8-3.5 s and show "Server is waking up..." instead of "not running"; bad server messages no longer throw in the lobby.
- Lobby login panel scrolls on short (landscape) phone screens so CREATE / JOIN / COMMON buttons are reachable; inputs are 16 px (no iOS zoom) with 44 px tap targets.

## v15.23 - human models in the lobby (female first)
- Lobby: pick MALE / FEMALE under the callsign box (remembered). FEMALE players are shown as the girl knight model (assets/models/player/girl_knight.glb); everybody sees each other's model (gender travels with the ready/team state, no server change).
- MALE keeps the old blocky body until a male model is added: put the file in assets/models/player/ and set MODELS.m in lobby.html.
- Team colour is now a ring under the feet; a READY player bounces a little.

## v15.36 - front page
- New dark main menu (css/menu.css + start screen in index.html): PLAY button, ENTER key starts the game, RULES icon (top-right, or H / ? key) opens How to play / Keys / Map colours.
- Big map (Tab/L) now shows a MAP COLOURS legend; F1 key list also lists map colours.
