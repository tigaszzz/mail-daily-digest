// OAuth 2.0 Authorization Code + PKCE — contas pessoais Microsoft (Outlook.com, Hotmail, Live).
// O developer regista UMA app no portal Azure; utilizadores finais só fazem login (sem configurar Entra).

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { shell } = require('electron');
const keytar = require('keytar');
const {
  createLoopbackOAuthServer,
  isLoopbackOAuthCallbackUrl
} = require('./oauth-loopback');

const SERVICE = 'mail-daily-digest-pkce';
const ACCOUNT = 'microsoft-tokens';

/** Só contas pessoais (@outlook.com, @hotmail.com, @live.com) — não tenants M365/empresa. */
const AUTH_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const AUTHORIZE_URL = `${AUTH_BASE}/authorize`;
const TOKEN_URL = `${AUTH_BASE}/token`;
const SCOPES = [
  'Mail.ReadWrite',
  'User.Read',
  'offline_access',
  'openid',
  'profile'
].join(' ');

const oauthCallbackBus = new EventEmitter();

function formatOAuthUserError(error, errorDescription) {
  const code = String(error || '').trim();
  const desc = String(errorDescription || '').trim();
  switch (code) {
    case 'access_denied':
      return 'Autorização cancelada. Volta a tentar e aceita as permissões no ecrã Microsoft.';
    case 'admin_consent_required':
      return 'Esta conta parece ser de trabalho/escola. Usa uma conta pessoal Outlook.com ou Hotmail.';
    case 'invalid_client':
      return 'Não foi possível completar a ligação. Tenta novamente mais tarde.';
    default:
      return desc || code || 'Erro desconhecido na autorização Microsoft';
  }
}

function emitOAuthCallbackFromUrl(url) {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  if (code) oauthCallbackBus.emit('callback', { code });
  else oauthCallbackBus.emit('callback', { error: formatOAuthUserError(error, errorDescription) });
}

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function waitForOAuthCallback(timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      oauthCallbackBus.removeListener('callback', onCallback);
      reject(new Error('Timeout: autorização Microsoft não recebida em 5 minutos.'));
    }, timeoutMs);

    function onCallback({ code, error }) {
      clearTimeout(timer);
      oauthCallbackBus.removeListener('callback', onCallback);
      if (code) resolve(code);
      else reject(new Error(`Microsoft OAuth erro: ${error}`));
    }

    oauthCallbackBus.once('callback', onCallback);
  });
}

async function exchangeCode(code, codeVerifier, clientId, clientSecret, redirectUri) {
  const fields = {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
    scope: SCOPES
  };
  if (clientSecret?.trim()) fields.client_secret = clientSecret.trim();

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });

  if (!res.ok) {
    throw new Error(`Falha na troca de código Microsoft: ${await res.text()}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  const fields = {
    refresh_token: refreshToken,
    client_id: clientId,
    grant_type: 'refresh_token',
    scope: SCOPES
  };
  if (clientSecret?.trim()) fields.client_secret = clientSecret.trim();

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });

  if (!res.ok) {
    throw new Error(`Falha ao renovar token Microsoft: ${await res.text()}`);
  }
  return res.json();
}

async function saveTokens(tokens) {
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(tokens));
}

async function loadTokens() {
  const raw = await keytar.getPassword(SERVICE, ACCOUNT);
  return raw ? JSON.parse(raw) : null;
}

async function clearTokens() {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}

async function hasStoredTokens() {
  const t = await loadTokens();
  return Boolean(t?.refresh_token);
}

async function getValidAccessToken(clientId, clientSecret) {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) return null;

  if (tokens.expiry_date && Date.now() < tokens.expiry_date - 60_000) {
    return tokens.access_token;
  }

  const refreshed = await refreshAccessToken(tokens.refresh_token, clientId, clientSecret);
  const merged = {
    ...tokens,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
    expiry_date: Date.now() + (refreshed.expires_in ?? 3600) * 1000
  };
  await saveTokens(merged);
  return merged.access_token;
}

async function startPKCEFlow(clientId, clientSecret) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const lb = await createLoopbackOAuthServer(emitOAuthCallbackFromUrl);
  const redirectUri = lb.redirectUri;
  const codePromise = waitForOAuthCallback();

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('prompt', 'select_account');

  try {
    await shell.openExternal(authUrl.toString());
    const code = await codePromise;
    const tokenData = await exchangeCode(code, codeVerifier, clientId, clientSecret, redirectUri);
    await saveTokens({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
      scope: tokenData.scope ?? '',
      redirect_uri: redirectUri
    });
  } finally {
    lb.server?.close();
  }
}

module.exports = {
  startPKCEFlow,
  getValidAccessToken,
  hasStoredTokens,
  clearTokens,
  isLoopbackOAuthCallbackUrl
};
