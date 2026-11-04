<?php
// Copy this file to  api/config.php  and fill in your values.  (Never share config.php.)
// Reading this file in a browser shows nothing - it only returns settings to index.php.
return array(

  // ---- EMAIL: how the 6-digit OTP code reaches the player (pick ONE way) -------------------------------
  // A) Gmail:  Google Account -> Security -> 2-Step Verification ON -> App passwords -> create "Ashen Roads" (16 letters)
  'SMTP_USER' => '',                 // e.g. yourgame@gmail.com
  'SMTP_PASS' => '',                 // the 16-letter app password (NOT your normal Gmail password)
  // 'SMTP_HOST' => 'smtp-relay.brevo.com',   // other providers (Outlook, Brevo, your hosting mail ...)
  // 'SMTP_PORT' => '587',                    // 465 = TLS, 587 = STARTTLS
  // 'EMAIL_FROM' => 'Ashen Roads <yourgame@gmail.com>',
  // B) Resend:  'RESEND_API_KEY' => 're_xxx',  'EMAIL_FROM' => 'Ashen Roads <noreply@your-verified-domain.com>',
  // C) the hosting's own mail:  'MAIL_DRIVER' => 'mail',   (cPanel / Hostinger - may land in spam)
  // If nothing is set: on your own PC (localhost) the code is written to database/otp-log.txt (only you can read it) - fine for testing.
  // On a LIVE website the sign-up shows an error until email is set up (players cannot read your log file).
  // 'OTP_CONSOLE' => '1',           // force the log-file mode even on a live site (testing only!)

  // ---- DATABASE = phpMyAdmin / MySQL  (v15.52) ---------------------------------------------------------
  // Accounts, logins and stats are saved in this MySQL database. Tables are created automatically.
  // XAMPP defaults are below (user root, empty password). On a real host use the values from its MySQL panel.
  'DB_HOST' => 'localhost',
  'DB_PORT' => '3306',
  'DB_NAME' => 'ashen_roads',   // the database name you see in phpMyAdmin (created automatically if it does not exist)
  'DB_USER' => 'root',
  'DB_PASS' => '',

  // ---- ACCOUNTS -------------------------------------------------------------------------------------------
  'ADMIN_USERNAME' => '',            // your own account name -> it may open admin.html
  'AUTH_SECRET' => '220d7bd06baf1e1aa6539138e078f6246f48dfa9799c8099a7b3959684d14ef4',   // same text is used by START-MYSQL.bat (Node multiplayer server)
                                     // The Node multiplayer server needs THE SAME value as its AUTH_SECRET (see README-PHP.md)
  'ALLOWED_ORIGINS' => '*',          // if the game pages are on another site (Netlify): 'https://your-site.netlify.app'
  // 'TRUST_PROXY' => '1',           // only behind a proxy / Cloudflare
  // 'DATA_DIR' => '/home/you/ashen-database',   // put the database OUTSIDE the web folder (best)
);
