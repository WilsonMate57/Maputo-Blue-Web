// ─────────────────────────────────────────────────────────────────────────────
// app.cjs — Startup file for hosts that load the application with require()
// (Plesk Node.js extension: Phusion Passenger on Linux, iisnode on Windows).
// Loads server/.env when present (variables set in the Plesk panel win), then
// starts the ES-module server. Locally keep using `npm start`.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

import('./src/index.js').catch(err => {
  console.error(err);
  process.exit(1);
});
