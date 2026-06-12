// Electron main process.
//
// IPC channels (all exposed via contextBridge in preload.js):
//   gmail:auth, gmail:fetch, gmail:search, gmail:profile, gmail:logout, gmail:archive, gmail:set-star
//   gmail:create-reply-draft
//   llm:analyse, llm:get-provider, llm:set-provider
//   keychain:get, keychain:set, keychain:delete
//   settings:get, settings:set

const MAX_GMAIL_SEARCH_QUERY_CHARS = 500;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

const { app, BrowserWindow, ipcMain, shell, nativeImage } = require('electron');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const Store  = require('electron-store');
const keytar = require('keytar');

const {
  fetchRecentMessagesPage: fetchGmailRecentMessagesPage,
  fetchMessagesBySearchQueryPage: fetchGmailSearchMessagesPage,
  archiveMessage: archiveGmailMessage,
  setMessageStar: setGmailMessageStar,
  createReplyDraft: createGmailReplyDraft
} = require('./services/gmail');
const {
  fetchRecentMessagesPage: fetchGraphRecentMessagesPage,
  fetchMessagesBySearchQueryPage: fetchGraphSearchMessagesPage,
  archiveMessage: archiveGraphMessage,
  setMessageStar: setGraphMessageStar,
  createReplyDraft: createGraphReplyDraft,
  clearArchiveFolderCache
} = require('./services/graph-mail');
const { startPKCEFlow, getValidAccessToken, hasStoredTokens,
        clearTokens, handleOAuthRedirect, oauthProtocolFromClientId,
        isOAuthCallbackUrl }                                        = require('./services/auth-pkce');
const {
  startPKCEFlow: startMicrosoftPKCEFlow,
  getValidAccessToken: getMicrosoftAccessToken,
  hasStoredTokens: hasMicrosoftStoredTokens,
  clearTokens: clearMicrosoftTokens
} = require('./services/auth-microsoft-pkce');
const {
  bootstrapOAuthFromEnv,
  resolveGoogleOAuthCredentials,
  isOAuthConfigured,
  KEYTAR_SERVICE
} = require('./services/oauth-config');
const {
  bootstrapMicrosoftOAuthFromEnv,
  resolveMicrosoftOAuthCredentials,
  isMicrosoftOAuthConfigured
} = require('./services/oauth-microsoft-config');
const { buildBriefingWithProvider }                               = require('./providers/llm');
const {
  oauthNotConfigured,
  oauthSessionRequired,
  logDevDetail
} = require('./services/user-facing-error');

// Non-sensitive config only — API keys and secrets live in the OS keychain via keytar
const DEFAULT_SETTINGS = {
  provider:           'anthropic',
  anthropicModel:     'claude-haiku-4-5',
  openaiModel:        'gpt-4.1-mini',
  googleModel:        'gemini-2.5-flash',
  googleClientId:     '',
  microsoftClientId:  '',
  mailProvider:       'gmail',
  autoRefreshHour:    8,
  displayName:        ''
};

const MAIL_PROVIDERS = new Set(['gmail', 'microsoft']);

function activeMailProvider() {
  const p = store.get('mailProvider');
  return MAIL_PROVIDERS.has(p) ? p : 'gmail';
}

const store = new Store({ name: 'gmail-daily-digest', defaults: DEFAULT_SETTINGS });

/** Raiz do projecto (package.json) — nunca usar process.argv[1] no OAuth (pode ser o URL de callback). */
const APP_ROOT = fs.realpathSync.native(path.resolve(__dirname, '..'));

/** Carrega .env local (não commitar) para GOOGLE_OAUTH_* e chaves de dev. */
function loadEnvFile() {
  const envPath = path.join(APP_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

const IS_DEV = process.argv.includes('--dev');
if (IS_DEV && !process.env.MICROSOFT_CLIENT_ID?.trim()) {
  const envPath = path.join(APP_ROOT, '.env');
  console.warn(
    '[mail-digest] MICROSOFT_CLIENT_ID vazio no .env em disco (%s). Se editaste no Cursor, guarda o ficheiro (Cmd+S) e reinicia npm run dev.',
    envPath
  );
}

const DIGEST_PAGE_SIZE = 20;
const MAX_DIGEST_EMAILS = 200;

let mainWindow = null;
/** NativeImage carregado no arranque (doca macOS + janela Win/Linux). */
let appIconNative;

/**
 * Ícones em `electron_icons_digest/`.
 * macOS: `BrowserWindow` ignora `icon` na barra de título; a doca usa `app.dock.setIcon`.
 * `nativeImage.createFromPath` com .icns por vezes falha — tentamos .icns e depois PNG.
 */
function loadAppIcon() {
  const dir = path.join(__dirname, '..', 'electron_icons_digest');
  let candidates;
  if (process.platform === 'darwin') {
    candidates = [
      path.join(dir, 'icon.icns'),
      path.join(dir, 'icon_512x512.png'),
      path.join(dir, 'icon.png')
    ];
  } else if (process.platform === 'win32') {
    candidates = [path.join(dir, 'icon.ico')];
  } else {
    candidates = [path.join(dir, 'icon_512x512.png'), path.join(dir, 'icon.png')];
  }

  for (const full of candidates) {
    if (!fs.existsSync(full)) continue;
    try {
      const img = nativeImage.createFromPath(full);
      if (!img.isEmpty()) return img;
    } catch {
      /* tentar seguinte */
    }
  }
  return undefined;
}

// Carregar no arranque do processo (sync) para estar pronto no primeiro tick de whenReady.
appIconNative = loadAppIcon();

function applyDockIcon() {
  if (process.platform !== 'darwin' || !appIconNative || !app.dock) return;
  try {
    app.dock.setIcon(appIconNative);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 820, minWidth: 900, minHeight: 600,
    title: 'Gmail Daily Digest',
    backgroundColor: '#faf6ee',
    show: false,
    ...(appIconNative ? { icon: appIconNative } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow?.isDestroyed()) mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ---------------------------------------------------------------------------
// IPC: keychain
// ---------------------------------------------------------------------------

ipcMain.handle('shell:open-external', (_evt, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('URL inválido para abrir no browser.');
  }
  return shell.openExternal(url);
});

ipcMain.handle('keychain:get', (_evt, key) =>
  keytar.getPassword(KEYTAR_SERVICE, key));

ipcMain.handle('keychain:set', (_evt, key, value) => {
  const oauthKeys = new Set(['google-client-secret', 'microsoft-client-secret']);
  if (oauthKeys.has(key)) {
    throw new Error('Credenciais OAuth não são configuráveis na app.');
  }
  return keytar.setPassword(KEYTAR_SERVICE, key, value);
});

ipcMain.handle('keychain:delete', (_evt, key) =>
  keytar.deletePassword(KEYTAR_SERVICE, key));

// ---------------------------------------------------------------------------
// IPC: settings (non-sensitive only)
// ---------------------------------------------------------------------------

ipcMain.handle('settings:get', async () => {
  const [
    { clientId },
    { clientId: msClientId },
    anthropicKey,
    openaiKey,
    googleKey,
    googleAuth,
    microsoftAuth
  ] = await Promise.all([
    resolveGoogleOAuthCredentials(store, keytar),
    resolveMicrosoftOAuthCredentials(store, keytar),
    keytar.getPassword(KEYTAR_SERVICE, 'anthropic-api-key'),
    keytar.getPassword(KEYTAR_SERVICE, 'openai-api-key'),
    keytar.getPassword(KEYTAR_SERVICE, 'google-api-key'),
    hasStoredTokens(),
    hasMicrosoftStoredTokens()
  ]);
  return {
    provider:       store.get('provider'),
    anthropicModel: store.get('anthropicModel'),
    openaiModel:    store.get('openaiModel'),
    googleModel:    store.get('googleModel'),
    mailProvider:   activeMailProvider(),
    autoRefreshHour: store.get('autoRefreshHour'),
    displayName:    store.get('displayName') || '',
    hasAnthropicKey:       Boolean(anthropicKey),
    hasOpenAIKey:          Boolean(openaiKey),
    hasGoogleKey:          Boolean(googleKey),
    hasGoogleAuth:         googleAuth,
    hasMicrosoftAuth:      microsoftAuth,
    hasGoogleOAuthClient:  isOAuthConfigured(clientId),
    hasMicrosoftOAuthClient: isMicrosoftOAuthConfigured(msClientId)
  };
});

ipcMain.handle('settings:set', (_evt, cfg) => {
  const allowed = new Set([
    'provider', 'anthropicModel', 'openaiModel', 'googleModel',
    'googleClientId', 'microsoftClientId', 'mailProvider', 'autoRefreshHour',
    'displayName'
  ]);
  for (const [k, v] of Object.entries(cfg || {})) {
    if (!allowed.has(k)) continue;
    if (k === 'googleClientId' || k === 'microsoftClientId') continue;
    store.set(k, v);
  }
  if (cfg?.mailProvider !== undefined && !MAIL_PROVIDERS.has(cfg.mailProvider)) {
    throw new Error('mailProvider inválido (gmail ou microsoft).');
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// IPC: Gmail auth
// ---------------------------------------------------------------------------

ipcMain.handle('gmail:auth', async () => {
  const { clientId, clientSecret } = await resolveGoogleOAuthCredentials(store, keytar);
  if (!isOAuthConfigured(clientId)) {
    const err = oauthNotConfigured('gmail');
    logDevDetail(err);
    throw err;
  }
  await startPKCEFlow(clientId, clientSecret, { useLoopback: true });
  return { ok: true };
});

ipcMain.handle('gmail:logout', async () => {
  await clearTokens();
  return { ok: true };
});

ipcMain.handle('gmail:profile', async () => {
  const token = await getGoogleToken();
  const res   = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return { email: '' };
  return res.json();
});

ipcMain.handle('gmail:fetch', async (_evt, opts = {}) => {
  const allowedTW = new Set(['today', 'week', 'month']);
  const timeWindow =
    typeof opts?.timeWindow === 'string' && allowedTW.has(opts.timeWindow)
      ? opts.timeWindow
      : 'today';
  const page =
    typeof opts?.page === 'number' && opts.page >= 0 ? Math.floor(opts.page) : 0;
  const token = await getGoogleToken();
  return fetchGmailRecentMessagesPage(token, {
    timeWindow,
    page,
    pageSize: DIGEST_PAGE_SIZE,
    maxMessages: MAX_DIGEST_EMAILS
  });
});

ipcMain.handle('gmail:search', async (_evt, payload) => {
  let q = typeof payload?.query === 'string' ? payload.query.trim() : '';
  if (!q) throw new Error('Escreve texto de pesquisa (palavras ou filtros Gmail).');
  if (q.length > MAX_GMAIL_SEARCH_QUERY_CHARS)
    q = q.slice(0, MAX_GMAIL_SEARCH_QUERY_CHARS);
  const page =
    typeof payload?.page === 'number' && payload.page >= 0 ? Math.floor(payload.page) : 0;
  const token = await getGoogleToken();
  return fetchGmailSearchMessagesPage(token, q, {
    page,
    pageSize: DIGEST_PAGE_SIZE,
    maxMessages: MAX_DIGEST_EMAILS
  });
});

ipcMain.handle('gmail:archive', async (_evt, messageId) => {
  if (!messageId || typeof messageId !== 'string') {
    throw new Error('Identificador de mensagem inválido.');
  }
  const token = await getGoogleToken();
  await archiveGmailMessage(token, messageId);
  return { ok: true };
});

ipcMain.handle('gmail:set-star', async (_evt, payload) => {
  const messageId = payload?.messageId;
  const star = Boolean(payload?.star);
  if (!messageId || typeof messageId !== 'string') {
    throw new Error('Identificador de mensagem inválido.');
  }
  const token = await getGoogleToken();
  await setGmailMessageStar(token, messageId, star);
  return { ok: true };
});

ipcMain.handle('gmail:create-reply-draft', async (_evt, payload) => {
  const messageId = payload?.messageId;
  const bodyText  = payload?.body;
  if (!messageId || typeof messageId !== 'string')
    throw new Error('Identificador de mensagem inválido.');
  if (typeof bodyText !== 'string' || !bodyText.trim())
    throw new Error('Rascunho de resposta vazio.');
  const token = await getGoogleToken();
  return createGmailReplyDraft(token, messageId, bodyText);
});

// ---------------------------------------------------------------------------
// IPC: Mail router (provider activo: gmail | microsoft)
// ---------------------------------------------------------------------------

ipcMain.handle('mail:get-provider', () => ({
  mailProvider: activeMailProvider()
}));

ipcMain.handle('mail:set-provider', (_evt, provider) => {
  const p = typeof provider === 'string' ? provider.trim() : '';
  if (!MAIL_PROVIDERS.has(p)) throw new Error('Provider de correio inválido.');
  store.set('mailProvider', p);
  return { ok: true, mailProvider: p };
});

ipcMain.handle('mail:auth', async () => {
  if (activeMailProvider() === 'microsoft') {
    const { clientId, clientSecret } = await resolveMicrosoftOAuthCredentials(store, keytar);
    if (!isMicrosoftOAuthConfigured(clientId)) {
      const err = oauthNotConfigured('microsoft');
      logDevDetail(err);
      throw err;
    }
    await startMicrosoftPKCEFlow(clientId, clientSecret);
    return { ok: true };
  }
  const { clientId, clientSecret } = await resolveGoogleOAuthCredentials(store, keytar);
  if (!isOAuthConfigured(clientId)) {
    const err = oauthNotConfigured('gmail');
    logDevDetail(err);
    throw err;
  }
  await startPKCEFlow(clientId, clientSecret, { useLoopback: true });
  return { ok: true };
});

ipcMain.handle('mail:logout', async () => {
  if (activeMailProvider() === 'microsoft') {
    await clearMicrosoftTokens();
    clearArchiveFolderCache();
  } else {
    await clearTokens();
  }
  return { ok: true };
});

ipcMain.handle('mail:profile', async () => {
  const token = await getActiveMailToken();
  if (activeMailProvider() === 'microsoft') {
    const res = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName,displayName`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return { email: '' };
    const j = await res.json();
    return { email: j.mail || j.userPrincipalName || '', name: j.displayName || '' };
  }
  const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return { email: '' };
  return res.json();
});

ipcMain.handle('mail:fetch', async (_evt, opts = {}) => {
  const allowedTW = new Set(['today', 'week', 'month']);
  const timeWindow =
    typeof opts?.timeWindow === 'string' && allowedTW.has(opts.timeWindow)
      ? opts.timeWindow
      : 'today';
  const page =
    typeof opts?.page === 'number' && opts.page >= 0 ? Math.floor(opts.page) : 0;
  const token = await getActiveMailToken();
  const api = mailApi();
  return api.fetchRecent(token, {
    timeWindow,
    page,
    pageSize: DIGEST_PAGE_SIZE,
    maxMessages: MAX_DIGEST_EMAILS
  });
});

ipcMain.handle('mail:search', async (_evt, payload) => {
  let q = typeof payload?.query === 'string' ? payload.query.trim() : '';
  if (!q) {
    throw new Error(
      activeMailProvider() === 'microsoft'
        ? 'Escreve texto de pesquisa (palavras-chave; sintaxe Gmail não se aplica).'
        : 'Escreve texto de pesquisa (palavras ou filtros Gmail).'
    );
  }
  if (q.length > MAX_GMAIL_SEARCH_QUERY_CHARS) q = q.slice(0, MAX_GMAIL_SEARCH_QUERY_CHARS);
  const page =
    typeof payload?.page === 'number' && payload.page >= 0 ? Math.floor(payload.page) : 0;
  const token = await getActiveMailToken();
  const api = mailApi();
  return api.fetchSearch(token, q, {
    page,
    pageSize: DIGEST_PAGE_SIZE,
    maxMessages: MAX_DIGEST_EMAILS
  });
});

ipcMain.handle('mail:archive', async (_evt, messageId) => {
  if (!messageId || typeof messageId !== 'string') {
    throw new Error('Identificador de mensagem inválido.');
  }
  const token = await getActiveMailToken();
  await mailApi().archive(token, messageId);
  return { ok: true };
});

ipcMain.handle('mail:set-star', async (_evt, payload) => {
  const messageId = payload?.messageId;
  const star = Boolean(payload?.star);
  if (!messageId || typeof messageId !== 'string') {
    throw new Error('Identificador de mensagem inválido.');
  }
  const token = await getActiveMailToken();
  await mailApi().setStar(token, messageId, star);
  return { ok: true };
});

ipcMain.handle('mail:create-reply-draft', async (_evt, payload) => {
  const messageId = payload?.messageId;
  const bodyText  = payload?.body;
  if (!messageId || typeof messageId !== 'string')
    throw new Error('Identificador de mensagem inválido.');
  if (typeof bodyText !== 'string' || !bodyText.trim())
    throw new Error('Rascunho de resposta vazio.');
  const token = await getActiveMailToken();
  return mailApi().createReplyDraft(token, messageId, bodyText);
});

async function getGoogleToken() {
  const { clientId, clientSecret } = await resolveGoogleOAuthCredentials(store, keytar);
  if (!isOAuthConfigured(clientId)) {
    const err = oauthNotConfigured('gmail');
    logDevDetail(err);
    throw err;
  }
  const token = await getValidAccessToken(clientId, clientSecret);
  if (!token) throw oauthSessionRequired('gmail');
  return token;
}

async function getMicrosoftToken() {
  const { clientId, clientSecret } = await resolveMicrosoftOAuthCredentials(store, keytar);
  if (!isMicrosoftOAuthConfigured(clientId)) {
    const err = oauthNotConfigured('microsoft');
    logDevDetail(err);
    throw err;
  }
  const token = await getMicrosoftAccessToken(clientId, clientSecret);
  if (!token) throw oauthSessionRequired('microsoft');
  return token;
}

async function getActiveMailToken() {
  return activeMailProvider() === 'microsoft' ? getMicrosoftToken() : getGoogleToken();
}

function mailApi() {
  return activeMailProvider() === 'microsoft'
    ? {
        fetchRecent: fetchGraphRecentMessagesPage,
        fetchSearch: fetchGraphSearchMessagesPage,
        archive: archiveGraphMessage,
        setStar: setGraphMessageStar,
        createReplyDraft: createGraphReplyDraft
      }
    : {
        fetchRecent: fetchGmailRecentMessagesPage,
        fetchSearch: fetchGmailSearchMessagesPage,
        archive: archiveGmailMessage,
        setStar: setGmailMessageStar,
        createReplyDraft: createGmailReplyDraft
      };
}

// ---------------------------------------------------------------------------
// IPC: acções do briefing (stubs — integrações reais são itens de roadmap)
// Canais reservados: action, calendar:add, task:accept, convo:open / convo:send / convo:history
// ---------------------------------------------------------------------------

ipcMain.handle('action', (_evt, payload) => {
  console.info('[briefing] action:', payload?.type, payload?.id || '');
  return { ok: true };
});

ipcMain.handle('calendar:add', (_evt, payload) => {
  console.info('[briefing] calendar:add:', payload?.title || '');
  return { ok: true };
});

ipcMain.handle('task:accept', (_evt, payload) => {
  console.info('[briefing] task:accept:', payload?.text || '');
  return { ok: true };
});

ipcMain.handle('convo:open', () => {
  console.info('[briefing] convo:open (placeholder)');
  return { ok: true };
});

ipcMain.handle('convo:send', () => ({ ok: true }));
ipcMain.handle('convo:history', () => ({ ok: true, messages: [] }));

// ---------------------------------------------------------------------------
// IPC: LLM
// ---------------------------------------------------------------------------

ipcMain.handle('llm:get-provider', () => ({
  provider:       store.get('provider'),
  anthropicModel: store.get('anthropicModel'),
  openaiModel:    store.get('openaiModel'),
  googleModel:    store.get('googleModel')
}));

ipcMain.handle('llm:set-provider', (_evt, cfg) => {
  const allowed = ['provider', 'anthropicModel', 'openaiModel', 'googleModel'];
  for (const k of allowed) {
    if (cfg[k] !== undefined) store.set(k, cfg[k]);
  }
  return { ok: true };
});

ipcMain.handle('llm:analyse', async (_evt, emails) => {
  const provider = store.get('provider');
  const opts     = await buildProviderOpts(provider);
  if (!opts) throw new Error(`Credenciais para "${provider}" não configuradas. Abre Definições e guarda a API key.`);
  return buildBriefingWithProvider(provider, emails, opts);
});

async function buildProviderOpts(provider) {
  switch (provider) {
    case 'anthropic': {
      const apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'anthropic-api-key');
      return apiKey ? { apiKey, model: store.get('anthropicModel') } : null;
    }
    case 'openai': {
      const apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'openai-api-key');
      return apiKey ? { apiKey, model: store.get('openaiModel') } : null;
    }
    case 'google': {
      const apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'google-api-key');
      return apiKey ? { apiKey, model: store.get('googleModel') } : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function registerOAuthProtocol(clientId) {
  if (!clientId?.trim()) return;
  let scheme;
  try {
    scheme = oauthProtocolFromClientId(clientId);
  } catch {
    return;
  }
  app.removeAsDefaultProtocolClient(scheme);
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(scheme);
  } else {
    // Dev: o 3.º arg. tem de ser a pasta do projecto, não argv[1] (no redirect é o URL OAuth).
    const ok = app.setAsDefaultProtocolClient(scheme, process.execPath, [APP_ROOT]);
    if (!ok) {
      console.warn('[oauth] Não foi possível registar o protocolo para', APP_ROOT);
    } else if (process.argv.includes('--dev')) {
      console.info('[oauth] Protocolo', scheme, '→', process.execPath, APP_ROOT);
    }
  }
}

function registerOAuthProtocolFromSettings() {
  registerOAuthProtocol(store.get('googleClientId'));
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function oauthUserDataBaseBeforeReady() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'gmail-daily-digest'
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'gmail-daily-digest');
  }
  return path.join(os.homedir(), '.config', 'gmail-daily-digest');
}

/** Caminho partilhado entre instâncias (PKCE vive só na primeira). */
function oauthPendingFilePath() {
  const base = app.isReady() ? app.getPath('userData') : oauthUserDataBaseBeforeReady();
  return path.join(base, 'pending-oauth.url');
}

function extractOAuthUrlFromArgv(argv) {
  return argv.find((arg) => typeof arg === 'string' && isOAuthCallbackUrl(arg));
}

function deliverOAuthCallback(url) {
  if (!url || !isOAuthCallbackUrl(url)) return;
  handleOAuthRedirect(url);
  focusMainWindow();
}

function forwardOAuthToPrimaryInstance(url) {
  const file = oauthPendingFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, url, 'utf8');
  } catch (err) {
    console.error('[oauth] Falha ao reencaminhar callback para a instância principal:', err);
  }
}

function consumeForwardedOAuth() {
  const file = oauthPendingFilePath();
  try {
    if (!fs.existsSync(file)) return;
    const url = fs.readFileSync(file, 'utf8').trim();
    fs.unlinkSync(file);
    deliverOAuthCallback(url);
  } catch {
    /* ignore */
  }
}

let stopOAuthPendingWatch = null;

function startForwardedOAuthWatch() {
  stopForwardedOAuthWatch();
  const file = oauthPendingFilePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* ignore */
  }
  fs.watchFile(file, { interval: 200 }, (cur, prev) => {
    if (cur.mtimeMs > 0 && cur.mtimeMs !== prev.mtimeMs) consumeForwardedOAuth();
  });
  stopOAuthPendingWatch = () => {
    try {
      fs.unwatchFile(file);
    } catch {
      /* ignore */
    }
    stopOAuthPendingWatch = null;
  };
  consumeForwardedOAuth();
}

function stopForwardedOAuthWatch() {
  if (stopOAuthPendingWatch) {
    stopOAuthPendingWatch();
    stopOAuthPendingWatch = null;
  }
}

function routeOAuthCallbackFromArgv(argv) {
  const url = extractOAuthUrlFromArgv(argv);
  if (url) deliverOAuthCallback(url);
}

/** URL recebida no macOS antes de app.whenReady (open-url). */
let macOpenUrlBeforeReady = null;

if (process.platform === 'darwin') {
  app.on('will-finish-launching', () => {
    app.on('open-url', (event, url) => {
      event.preventDefault();
      if (!isOAuthCallbackUrl(url)) return;
      if (app.isReady()) deliverOAuthCallback(url);
      else macOpenUrlBeforeReady = url;
    });
  });
}

async function startApp() {
  try {
    await app.whenReady();
    await bootstrapOAuthFromEnv(store, keytar);
    await bootstrapMicrosoftOAuthFromEnv(store, keytar);
    applyDockIcon();
    registerOAuthProtocolFromSettings();
    if (macOpenUrlBeforeReady) {
      deliverOAuthCallback(macOpenUrlBeforeReady);
      macOpenUrlBeforeReady = null;
    }
    routeOAuthCallbackFromArgv(process.argv);
    consumeForwardedOAuth();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (err) {
    console.error('[main] Falha no arranque:', err);
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (gotSingleInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    const url = extractOAuthUrlFromArgv(argv);
    if (url) deliverOAuthCallback(url);
    else consumeForwardedOAuth();
    focusMainWindow();
  });

  startApp();

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
} else {
  const url = extractOAuthUrlFromArgv(process.argv);
  if (url) forwardOAuthToPrimaryInstance(url);
  app.exit(0);
}
