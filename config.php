<?php
// ASHEN ROADS - LIVE SETTINGS.  Fill the 3 lines marked  <-- FILL  and save.  Never share this file.
return array(

  // ---- EMAIL (Gmail) : the 6-digit OTP code is emailed from this address ------------------------------
  'SMTP_USER'  => '',   // <-- FILL  your Gmail address, e.g. ashenroads.game@gmail.com
  'SMTP_PASS'  => '',   // <-- FILL  the 16-letter Google APP PASSWORD (not your normal Gmail password)
  'EMAIL_FROM' => 'Ashen Roads <ashenroads.game@gmail.com>',   // <-- change to your same Gmail address

  // ---- DATABASE = phpMyAdmin / MySQL  (v15.52) ---------------------------------------------------------
  // Accounts, logins and stats are saved in this MySQL database. Tables are created automatically.
  // XAMPP defaults are below (user root, empty password). On a real host use the values from its MySQL panel.
  'DB_HOST' => 'localhost',
  'DB_PORT' => '3306',
  'DB_NAME' => 'ashen_roads',   // the database name you see in phpMyAdmin (created automatically if it does not exist)
  'DB_USER' => 'root',
  'DB_PASS' => '',

  // ---- ADMIN ------------------------------------------------------------------------------------------
  'ADMIN_USERNAME' => '',   // <-- FILL  your own game account name (opens admin.html)

  // ---- leave these as they are ------------------------------------------------------------------------
  'AUTH_SECRET' => '220d7bd06baf1e1aa6539138e078f6246f48dfa9799c8099a7b3959684d14ef4',   // same text is used by START-MYSQL.bat (Node multiplayer server)
  'ALLOWED_ORIGINS' => '*',
  // 'TRUST_PROXY'  => '1',   // remove the // only if the site is behind Cloudflare
);
