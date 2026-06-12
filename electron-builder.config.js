'use strict';
// Config electron-builder — protocols OAuth derivados de build/oauth-build.js (gitignored).
// Nunca commitar Client ID no package.json.

const path = require('node:path');
const fs = require('node:fs');
const { oauthProtocolFromClientId } = require('./src/services/auth-pkce');

function loadGoogleClientId() {
  const oauthPath = path.join(__dirname, 'build', 'oauth-build.js');
  if (!fs.existsSync(oauthPath)) return '';
  try {
    return String(require(oauthPath).googleClientId || '').trim();
  } catch {
    return '';
  }
}

const pkgBuild = require('./package.json').build;
const googleClientId = loadGoogleClientId();

let protocols = [];
if (googleClientId) {
  try {
    const scheme = oauthProtocolFromClientId(googleClientId);
    protocols = [{ name: 'Mail Digest OAuth', schemes: [scheme] }];
  } catch {
    console.warn('[electron-builder] Google Client ID inválido em build/oauth-build.js — sem protocolo OAuth.');
  }
}

module.exports = {
  ...pkgBuild,
  protocols
};
