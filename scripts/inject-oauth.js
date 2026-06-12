#!/usr/bin/env node
// Lê .env (ou variáveis de ambiente do CI) e gera build/oauth-build.js para empacotamento.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const OUT_PATH = path.join(ROOT, 'build/oauth-build.js');

function parseEnvFile(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function readEnv() {
  const fromFile = fs.existsSync(ENV_PATH)
    ? parseEnvFile(fs.readFileSync(ENV_PATH, 'utf8'))
    : {};
  const keys = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'MICROSOFT_CLIENT_ID',
    'MICROSOFT_CLIENT_SECRET'
  ];
  const merged = {};
  for (const key of keys) {
    merged[key] = (process.env[key] || fromFile[key] || '').trim();
  }
  return merged;
}

const env = readEnv();
const googleClientId = env.GOOGLE_OAUTH_CLIENT_ID;
const googleClientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
const microsoftClientId = env.MICROSOFT_CLIENT_ID;
const microsoftClientSecret = env.MICROSOFT_CLIENT_SECRET;

if (!googleClientId) {
  console.error(
    '[inject-oauth] GOOGLE_OAUTH_CLIENT_ID em falta. Preenche .env (cp .env.example .env) antes de npm run dist:*.'
  );
  process.exit(1);
}

const out = `// Gerado por scripts/inject-oauth.js — não editar nem commitar.
module.exports = {
  googleClientId: ${JSON.stringify(googleClientId)},
  googleClientSecret: ${JSON.stringify(googleClientSecret)},
  microsoftClientId: ${JSON.stringify(microsoftClientId)},
  microsoftClientSecret: ${JSON.stringify(microsoftClientSecret)}
};
`;

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, out, 'utf8');
console.log('[inject-oauth] Credenciais OAuth escritas em build/oauth-build.js');
