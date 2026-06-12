// Credenciais OAuth injectadas no build (build/oauth-build.js, fora de src/).

const fs = require('node:fs');
const path = require('node:path');

const BUILD_OAUTH_PATH = path.join(__dirname, '..', '..', 'build', 'oauth-build.js');

let config = {
  googleClientId: '',
  googleClientSecret: '',
  microsoftClientId: '',
  microsoftClientSecret: ''
};

if (fs.existsSync(BUILD_OAUTH_PATH)) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    config = require(BUILD_OAUTH_PATH);
  } catch {
    // Build corrupto — credenciais vêm de .env ou Definições em dev.
  }
}

function getBuiltInOAuth() {
  return {
    googleClientId: String(config.googleClientId || '').trim(),
    googleClientSecret: String(config.googleClientSecret || '').trim(),
    microsoftClientId: String(config.microsoftClientId || '').trim(),
    microsoftClientSecret: String(config.microsoftClientSecret || '').trim()
  };
}

module.exports = { getBuiltInOAuth };
