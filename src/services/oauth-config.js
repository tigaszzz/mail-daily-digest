// Credenciais OAuth Google — env de build, store e keychain.

const KEYTAR_SERVICE = 'gmail-daily-digest';
const SECRET_KEY = 'google-client-secret';

/**
 * Pré-preenche Client ID/Secret a partir de variáveis de ambiente (build/distribuição).
 * Cada utilizador continua com tokens OAuth próprios na keychain.
 */
async function bootstrapOAuthFromEnv(store, keytar) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

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
  const clientId = store.get('googleClientId')?.trim() || '';
  const clientSecret = (await keytar.getPassword(KEYTAR_SERVICE, SECRET_KEY))?.trim() || '';
  return { clientId, clientSecret };
}

/** Cliente Desktop + PKCE pode funcionar sem secret; o ID é obrigatório. */
function isOAuthConfigured(clientId) {
  return Boolean(clientId?.trim());
}

function hasBuiltInOAuthClient() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim());
}

module.exports = {
  bootstrapOAuthFromEnv,
  resolveGoogleOAuthCredentials,
  isOAuthConfigured,
  hasBuiltInOAuthClient,
  KEYTAR_SERVICE,
  SECRET_KEY
};
