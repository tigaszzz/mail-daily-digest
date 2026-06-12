// Credenciais OAuth Google — build injectado, env de dev, store e keychain.

const { app } = require('electron');
const { getBuiltInOAuth } = require('./oauth-built');

const KEYTAR_SERVICE = 'gmail-daily-digest';
const SECRET_KEY = 'google-client-secret';

function builtInGoogle() {
  return getBuiltInOAuth();
}

/**
 * Pré-preenche Client ID/Secret a partir do build injectado ou variáveis de ambiente (dev).
 * Cada utilizador continua com tokens OAuth próprios na keychain.
 */
async function bootstrapOAuthFromEnv(store, keytar) {
  const built = builtInGoogle();

  if (app.isPackaged) {
    if (built.googleClientId) store.set('googleClientId', built.googleClientId);
    if (built.googleClientSecret) {
      await keytar.setPassword(KEYTAR_SERVICE, SECRET_KEY, built.googleClientSecret);
    }
    return;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || built.googleClientId;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || built.googleClientSecret;

  if (clientId && !store.get('googleClientId')) {
    store.set('googleClientId', clientId);
  }

  if (clientSecret) {
    const existing = await keytar.getPassword(KEYTAR_SERVICE, SECRET_KEY);
    if (!existing) {
      await keytar.setPassword(KEYTAR_SERVICE, SECRET_KEY, clientSecret);
    }
  }
}

async function resolveGoogleOAuthCredentials(store, keytar) {
  const built = builtInGoogle();

  if (app.isPackaged) {
    const clientId = built.googleClientId;
    const keychainSecret = (await keytar.getPassword(KEYTAR_SERVICE, SECRET_KEY))?.trim() || '';
    const clientSecret = keychainSecret || built.googleClientSecret;
    return { clientId, clientSecret };
  }

  const storeId = store.get('googleClientId')?.trim() || '';
  const envId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || '';
  const clientId = storeId || envId || built.googleClientId;
  const keychainSecret = (await keytar.getPassword(KEYTAR_SERVICE, SECRET_KEY))?.trim() || '';
  const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || '';
  const clientSecret = keychainSecret || envSecret || built.googleClientSecret;
  return { clientId, clientSecret };
}

/** Cliente Desktop + PKCE pode funcionar sem secret; o ID é obrigatório. */
function isOAuthConfigured(clientId) {
  return Boolean(clientId?.trim());
}

function hasBuiltInOAuthClient() {
  const built = builtInGoogle();
  return Boolean(
    built.googleClientId ||
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  );
}

module.exports = {
  bootstrapOAuthFromEnv,
  resolveGoogleOAuthCredentials,
  isOAuthConfigured,
  hasBuiltInOAuthClient,
  KEYTAR_SERVICE,
  SECRET_KEY
};
