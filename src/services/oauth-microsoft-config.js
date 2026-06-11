// Credenciais OAuth Microsoft — env de build, store e keychain.

const KEYTAR_SERVICE = 'gmail-daily-digest';
const SECRET_KEY = 'microsoft-client-secret';

async function bootstrapMicrosoftOAuthFromEnv(store, keytar) {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();

  if (clientId) {
    store.set('microsoftClientId', clientId);
  }

  if (clientSecret) {
    await keytar.setPassword(KEYTAR_SERVICE, SECRET_KEY, clientSecret);
  }
}

async function resolveMicrosoftOAuthCredentials(store, keytar) {
  const envId = process.env.MICROSOFT_CLIENT_ID?.trim() || '';
  const envSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim() || '';
  const storeId = store.get('microsoftClientId')?.trim() || '';
  const keychainSecret = (await keytar.getPassword(KEYTAR_SERVICE, SECRET_KEY))?.trim() || '';
  const clientId = storeId || envId;
  const clientSecret = keychainSecret || envSecret;
  return { clientId, clientSecret };
}

function isMicrosoftOAuthConfigured(clientId) {
  return Boolean(clientId?.trim());
}

function hasBuiltInMicrosoftOAuthClient() {
  return Boolean(process.env.MICROSOFT_CLIENT_ID?.trim());
}

module.exports = {
  bootstrapMicrosoftOAuthFromEnv,
  resolveMicrosoftOAuthCredentials,
  isMicrosoftOAuthConfigured,
  hasBuiltInMicrosoftOAuthClient,
  KEYTAR_SERVICE,
  SECRET_KEY
};
