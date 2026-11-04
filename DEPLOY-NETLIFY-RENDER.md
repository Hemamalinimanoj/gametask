# Netlify + Render (how to make login & multiplayer work)

Netlify = only the game pages. Render = the Node server (login + multiplayer).
The error "Netlify serves the static game only. Set ASHEN_SERVER_URL..." means step 3 was not done.

1. Put this folder on GitHub (the .env / database / secret.key are NOT included - good).
2. render.com -> New -> Web Service -> pick the repo -> Start command: `node server/server.js` (render.yaml does this).
   Environment: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (free upstash.com Redis),
   ALLOWED_ORIGINS = https://YOUR-SITE.netlify.app
3. Copy the Render URL (https://ashen-roads.onrender.com) and put it in js/server-config.js:
   window.ASHEN_SERVER_URL = 'https://ashen-roads.onrender.com';
4. Redeploy Netlify. Open /health on the Render URL -> must say "ok".

Easiest alternative: skip Netlify, open the Render URL directly. The server serves the game too.
