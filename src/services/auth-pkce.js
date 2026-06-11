// OAuth 2.0 Authorization Code Flow with PKCE for Google.
//
// Why PKCE for a desktop/Electron app:
//   - No client_secret required — safe to ship in a native app
//   - Uses the OS browser so SSO sessions (Google Workspace, etc.) are reused
//   - code_verifier never leaves the app; code_challenge proves ownership
//
// Setup: Google Cloud Console → Credentials → OAuth 2.0 Client ID
//   Application type: "Desktop app"
//   Redirect: loopback http://127.0.0.1:<port>/oauth/callback (RFC 8252; sem registo por porta)
//   Alternativa empacotada: com.googleusercontent.apps.<id>:/oauth/callback
//   Enable: Gmail API

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { shell } = require('electron');
const keytar = require('keytar');
const {
  createLoopbackOAuthServer,
  isLoopbackOAuthCallbackUrl,
  isOAuthCallbackPath
} = require('./oauth-loopback');

const SERVICE = 'mail-daily-digest-pkce';
const ACCOUNT = 'google-tokens';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'openid',
  'email'
].join(' ');

const oauthCallbackBus = new EventEmitter();

// ---------------------------------------------------------------------------
// Redirect URI / protocol (Google desktop — scheme must contain a period)
// ---------------------------------------------------------------------------

/** @param {string} clientId e.g. 123-abc.apps.googleusercontent.com */
function oauthProtocolFromClientId(clientId) {
  const prefix = String(clientId || '')
    .trim()
    .replace(/\.apps\.googleusercontent\.com$/i, '');
  if (!prefix) throw new Error('Google Client ID inválido.');
  return `com.googleusercontent.apps.${prefix}`;
}

/** Redirect URI registered implicitly for Desktop clients. */
function redirectUriForClientId(clientId) {
  return `${oauthProtocolFromClientId(clientId)}:/oauth/callback`;
}

function isOAuthCallbackUrl(urlString) {
  if (isLoopbackOAuthCallbackUrl(urlString)) return true;
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  const protocol = url.protocol;
  if (!protocol.startsWith('com.googleusercontent.apps.') || !protocol.endsWith(':')) {
    return false;
  }
  return isOAuthCallbackPath(url);
}

/** Mensagens legíveis para erros comuns do ecrã de consentimento Google. */
function formatOAuthUserError(error, errorDescription) {
  const code = String(error || '').trim();
  const desc = String(errorDescription || '').trim();
  switch (code) {
    case 'access_denied':
      return 'Autorização cancelada. Volta a tentar e clica em «Permitir» no ecrã Google.';
    case 'admin_policy_enforced':
      return 'A tua organização Google Workspace bloqueou esta aplicação.';
    case 'invalid_scope':
      return 'Scope OAuth inválido — confirma gmail.modify no ecrã de consentimento da Consola.';
    case 'org_internal':
      return 'Esta app está limitada a contas da organização (modo interno na Consola).';
    case 'invalid_client':
      return 'Client ID/Secret inválidos — verifica credenciais tipo «Aplicação para computador».';
    default:
      return desc || code || 'Erro desconhecido na autorização Google';
  }
}

function emitOAuthCallbackFromUrl(url) {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');
  if (code) oauthCallbackBus.emit('callback', { code });
  else oauthCallbackBus.emit('callback', { error: formatOAuthUserError(error, errorDescription) });
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier() {
  // RFC 7636 §4.1 — 32 random bytes → 43 base64url chars (within 43-128 range)
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// Custom-protocol OAuth callback (empacotado / fallback)
// ---------------------------------------------------------------------------

/**
 * Called from the main process when the OS opens the app via the registered
 * custom URL scheme (see main.js — setAsDefaultProtocolClient).
 */
function handleOAuthRedirect(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    oauthCallbackBus.emit('callback', { error: 'URL de callback inválida' });
    return;
  }

  if (!isOAuthCallbackUrl(urlString)) return;
  emitOAuthCallbackFromUrl(url);
}

function waitForOAuthCallback(timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      oauthCallbackBus.removeListener('callback', onCallback);
      reject(new Error('Timeout: autorização não recebida em 5 minutos.'));
    }, timeoutMs);

    function onCallback({ code, error }) {
      clearTimeout(timer);
      oauthCallbackBus.removeListener('callback', onCallback);
      if (code) resolve(code);
      else reject(new Error(`Google OAuth erro: ${error}`));
    }

    oauthCallbackBus.once('callback', onCallback);
  });
}

// ---------------------------------------------------------------------------
// Token exchange + refresh
// ---------------------------------------------------------------------------

function tokenRequestBody(fields) {
  const body = new URLSearchParams(fields);
  return body;
}

async function exchangeCode(code, codeVerifier, clientId, clientSecret, redirectUri) {
  const fields = {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier
  };
  if (clientSecret?.trim()) fields.client_secret = clientSecret.trim();
  const body = tokenRequestBody(fields);

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Falha na troca de código por token: ${msg}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  const fields = {
    refresh_token: refreshToken,
    client_id: clientId,
    grant_type: 'refresh_token'
  };
  if (clientSecret?.trim()) fields.client_secret = clientSecret.trim();
  const body = tokenRequestBody(fields);

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Falha ao renovar token: ${msg}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Token persistence (keytar — OS keychain)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true if a refresh_token is stored (i.e. user has authorised). */
async function hasStoredTokens() {
  const t = await loadTokens();
  return Boolean(t?.refresh_token);
}

/**
 * Returns a valid access_token, refreshing silently if needed.
 * Returns null if no tokens are stored.
 */
async function getValidAccessToken(clientId, clientSecret) {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) return null;

  // Still valid with 60 s buffer?
  if (tokens.expiry_date && Date.now() < tokens.expiry_date - 60_000) {
    return tokens.access_token;
  }

  // Refresh silently
  const refreshed = await refreshAccessToken(tokens.refresh_token, clientId, clientSecret);
  const merged = {
    ...tokens,
    access_token: refreshed.access_token,
    expiry_date: Date.now() + (refreshed.expires_in ?? 3600) * 1000
  };
  await saveTokens(merged);
  return merged.access_token;
}

/**
 * Opens the OS browser with the Google consent screen and waits for the
 * authorization code (loopback em dev; protocolo custom se useLoopback=false).
 * Stores tokens in the OS keychain when done.
 *
 * @param {{ useLoopback?: boolean }} [opts] useLoopback=true em npm start (recomendado)
 */
async function startPKCEFlow(clientId, clientSecret, opts = {}) {
  const useLoopback = opts.useLoopback !== false;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  let redirectUri;
  let loopbackServer = null;

  if (useLoopback) {
    const lb = await createLoopbackOAuthServer(emitOAuthCallbackFromUrl);
    loopbackServer = lb.server;
    redirectUri = lb.redirectUri;
  } else {
    redirectUri = redirectUriForClientId(clientId);
  }

  const codePromise = waitForOAuthCallback();

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('prompt', 'select_account consent');

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
    loopbackServer?.close();
  }
}

module.exports = {
  startPKCEFlow,
  getValidAccessToken,
  hasStoredTokens,
  clearTokens,
  handleOAuthRedirect,
  oauthProtocolFromClientId,
  redirectUriForClientId,
  isOAuthCallbackUrl,
  isLoopbackOAuthCallbackUrl
};
