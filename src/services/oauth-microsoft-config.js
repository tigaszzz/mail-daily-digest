// Credenciais OAuth Microsoft — build injectado, env de dev, store e keychain.

const { app } = require('electron');
const { getBuiltInOAuth } = require('./oauth-built');

const KEYTAR_SERVICE = 'gmail-daily-digest';
const SECRET_KEY = 'microsoft-client-secret';

function builtInMicrosoft() {
  const built = getBuiltInOAuth();
  return {
    clientId: built.microsoftClientId,
    clientSecret: built.microsoftClientSecret
  };
}

async function bootstrapMicrosoftOAuthFromEnv(store, keytar) {
  const built = builtInMicrosoft();

  if (app.isPackaged) {
    if (built.clientId) store.set('microsoftClientId', built.clientId);
    if (built.clientSecret) {
      await keytar.setPassword(KEYTAR_SERVICE, SECRET_KEY, built.clientSecret);
    }
    return;
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim() || built.clientId;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim() || built.clientSecret;

  if (clientId) {
    store.set('microsoftClientId', clientId);
  }

  if (clientSecret) {
    await keytar.setPassword(KEYTAR_SERVICE, SECRET_KEY, clientSecret);
  }
}

async function resolveMicrosoftOAuthCredentials(store, keytar) {
  const built = builtInMicrosoft();

  if (app.isPackaged) {
    const clientId = built.clientId;
    const keychainSecret = (await keytar.getPassword(KEYTAR_SERVICE, SECRET_KEY))?.trim() || '';
    const clientSecret = keychainSecret || built.clientSecret;
    return { clientId, clientSecret };
  }

  const envId = process.env.MICROSOFT_CLIENT_ID?.trim() || '';
  const envSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim() || '';
  const storeId = store.get('microsoftClientId')?.trim() || '';
  const keychainSecret = (await keytar.getPassword(KEYTAR_SERVICE, SECRET_KEY))?.trim() || '';
  const clientId = storeId || envId || built.clientId;
  const clientSecret = keychainSecret || envSecret || built.clientSecret;
  return { clientId, clientSecret };
}

function isMicrosoftOAuthConfigured(clientId) {
  return Boolean(clientId?.trim());
}

function hasBuiltInMicrosoftOAuthClient() {
  const built = builtInMicrosoft();
  return Boolean(
    built.clientId ||
    process.env.MICROSOFT_CLIENT_ID?.trim()
  );
}

module.exports = {
  bootstrapMicrosoftOAuthFromEnv,
  resolveMicrosoftOAuthCredentials,
  isMicrosoftOAuthConfigured,
  hasBuiltInMicrosoftOAuthClient,
  KEYTAR_SERVICE,
  SECRET_KEY
};
