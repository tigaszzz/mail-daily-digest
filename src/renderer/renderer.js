// renderer.js — Briefing Colorido (ver DESIGN.md + REFACTOR.md).
// Comunicação com o processo principal via globalThis.electronAPI apenas.
// Conteúdo dinâmico montado com createElement/textContent — nunca innerHTML
// com strings vindas de emails ou do LLM.

const api = globalThis.electronAPI;
const mail = api.mail;

const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const MAX_NEEDS_YOU = 8;
const MAX_TASKS = 6;
const MAX_TRANSACTIONAL = 12;
const MINUTES_PER_ITEM = 3.5;

let settingsCache = null;
let profileName = '';
let profileEmail = '';
let lastBriefing = null;
let lastRawById = new Map();
let digestRunInProgress = false;
let autoRefreshTimerId = null;
let toastTimerId = null;

const els = {
  loginGate: document.getElementById('login-gate'),
  briefingRoot: document.getElementById('briefing-root'),
  askBar: document.getElementById('ask-bar'),
  askGo: document.getElementById('ask-go'),
  toast: document.getElementById('toast'),
  convoModal: document.getElementById('convo-modal'),
  btnConvoClose: document.getElementById('btn-convo-close'),

  btnLoginGmail: document.getElementById('btn-login-gmail'),
  btnLoginOutlook: document.getElementById('btn-login-outlook'),
  mailProviderLabelWrap: document.getElementById('mail-provider-label-wrap'),
  mailProviderSelect: document.getElementById('mail-provider-select'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnSettings: document.getElementById('btn-settings'),
  userAvatar: document.getElementById('user-avatar'),
  avatarInner: document.getElementById('avatar-inner'),

  settingsPanel: document.getElementById('settings-panel'),
  displayName: document.getElementById('display-name'),
  providerSelect: document.getElementById('provider-select'),
  anthropicKey: document.getElementById('anthropic-key'),
  anthropicModel: document.getElementById('anthropic-model'),
  openaiKey: document.getElementById('openai-key'),
  openaiModel: document.getElementById('openai-model'),
  googleKey: document.getElementById('google-key'),
  googleModel: document.getElementById('google-model'),
  googleClientId: document.getElementById('google-client-id'),
  googleClientSecret: document.getElementById('google-client-secret'),
  googleClientSecretStatus: document.getElementById('google-client-secret-status'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  btnConnectGoogle: document.getElementById('btn-connect-google'),
  btnDisconnectGoogle: document.getElementById('btn-disconnect-google'),
  googleAuthStatus: document.getElementById('google-auth-status'),
  oauthBuiltinHint: document.getElementById('oauth-builtin-hint'),
  anthropicStatus: document.getElementById('anthropic-key-status'),
  openaiStatus: document.getElementById('openai-key-status'),
  googleApiStatus: document.getElementById('google-key-status'),
  microsoftClientId: document.getElementById('microsoft-client-id'),
  microsoftClientSecret: document.getElementById('microsoft-client-secret'),
  microsoftClientSecretStatus: document.getElementById('microsoft-client-secret-status'),
  btnConnectMicrosoft: document.getElementById('btn-connect-microsoft'),
  btnDisconnectMicrosoft: document.getElementById('btn-disconnect-microsoft'),
  microsoftAuthStatus: document.getElementById('microsoft-auth-status'),
  oauthMicrosoftBuiltinHint: document.getElementById('oauth-microsoft-builtin-hint')
};

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

function currentMailProvider() {
  return settingsCache?.mailProvider === 'microsoft' ? 'microsoft' : 'gmail';
}

function isMicrosoftMail() {
  return currentMailProvider() === 'microsoft';
}

function hasActiveMailAuth() {
  return isMicrosoftMail()
    ? Boolean(settingsCache?.hasMicrosoftAuth)
    : Boolean(settingsCache?.hasGoogleAuth);
}

function mailProviderLabel() {
  return isMicrosoftMail() ? 'Outlook' : 'Gmail';
}

// ---------------------------------------------------------------------------
// DOM helpers (sem innerHTML para conteúdo dinâmico)
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/** Converte "texto com **negrito**" em nodes seguros (<strong> apenas). */
function appendWithBold(parent, text) {
  const parts = String(text ?? '').split(/\*\*(.+?)\*\*/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) parent.appendChild(el('strong', '', part));
    else parent.appendChild(document.createTextNode(part));
  });
  return parent;
}

function svgIcon(pathMarkup, viewBox = '0 0 16 16', strokeWidth = '1.5') {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.style.display = 'contents';
  span.innerHTML = `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}">${pathMarkup}</svg>`;
  return span;
}

const ICONS = {
  arrow: '<path d="M2 8h12M9 3l5 5-5 5"/>',
  calendar: '<rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6h12M5 1v3M11 1v3"/>',
  reply: '<path d="M2 3h12v8H6l-4 3z"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  chat: '<path d="M3 12a9 9 0 1 0 4-7.5L3 5v4l4-2"/><path d="M9 11h6M9 14h4"/>'
};

// ---------------------------------------------------------------------------
// Toast + status
// ---------------------------------------------------------------------------

function showToast(msg, type = '') {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.className = `toast ${type}`.trim();
  if (toastTimerId) clearTimeout(toastTimerId);
  toastTimerId = setTimeout(() => {
    els.toast.classList.add('hidden');
    toastTimerId = null;
  }, type === 'error' ? 6000 : 3200);
}

function renderPageStatus(message, { error = false, spinner = false } = {}) {
  const root = els.briefingRoot;
  root.replaceChildren();
  const box = el('div', `page-status${error ? ' error' : ''}`);
  if (spinner) box.appendChild(el('span', 'spinner'));
  box.appendChild(el('span', '', message));
  root.appendChild(box);
}

function setBusy(flag) {
  digestRunInProgress = flag;
  els.btnRefresh?.classList.toggle('is-syncing', flag);
  if (els.btnRefresh) els.btnRefresh.disabled = flag;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  els.btnRefresh?.addEventListener('click', () => void runDigest());
  els.btnSettings?.addEventListener('click', openSettings);
  els.userAvatar?.addEventListener('click', openSettings);
  els.btnSaveSettings?.addEventListener('click', () => void saveSettings());
  els.btnConnectGoogle?.addEventListener('click', () => void connectMail());
  els.btnDisconnectGoogle?.addEventListener('click', () => void disconnectMail());
  els.btnConnectMicrosoft?.addEventListener('click', () => void connectMail());
  els.btnDisconnectMicrosoft?.addEventListener('click', () => void disconnectMail());
  els.providerSelect?.addEventListener('change', onProviderChange);
  els.mailProviderSelect?.addEventListener('change', () => void onMailProviderChange());
  els.btnLoginGmail?.addEventListener('click', () => void connectMailProvider('gmail'));
  els.btnLoginOutlook?.addEventListener('click', () => void connectMailProvider('microsoft'));

  els.askBar?.addEventListener('click', openConvoModal);
  els.btnConvoClose?.addEventListener('click', closeConvoModal);
  els.convoModal?.addEventListener('click', (ev) => {
    if (ev.target === els.convoModal) closeConvoModal();
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      openConvoModal();
    }
    if (ev.key === 'Escape') closeConvoModal();
  });

  els.briefingRoot?.addEventListener('click', (ev) => void onBriefingClick(ev));

  await refreshSettingsView();
  await refreshProfile();

  if (hasActiveMailAuth()) {
    startDigestAutoRefresh();
    await runDigest();
  }
}

// ---------------------------------------------------------------------------
// Auth shell (login gate vs briefing)
// ---------------------------------------------------------------------------

function syncLoginProviderButtons() {
  const s = settingsCache;
  if (els.btnLoginGmail) {
    const on = Boolean(s?.hasGoogleAuth);
    els.btnLoginGmail.classList.toggle('is-connected', on);
    const meta = els.btnLoginGmail.querySelector('.login-provider-meta');
    if (meta) meta.textContent = on ? 'Sessão guardada' : 'Google';
  }
  if (els.btnLoginOutlook) {
    const on = Boolean(s?.hasMicrosoftAuth);
    els.btnLoginOutlook.classList.toggle('is-connected', on);
    const meta = els.btnLoginOutlook.querySelector('.login-provider-meta');
    if (meta) meta.textContent = on ? 'Sessão guardada' : 'Pessoal';
  }
}

function syncAuthShell() {
  const connected = hasActiveMailAuth();

  els.loginGate?.classList.toggle('hidden', connected);
  els.loginGate?.setAttribute('aria-hidden', connected ? 'true' : 'false');
  els.briefingRoot?.classList.toggle('hidden', !connected);
  els.askBar?.classList.toggle('hidden', !connected);
  els.mailProviderLabelWrap?.classList.toggle('hidden', !connected);
  els.btnRefresh?.classList.toggle('hidden', !connected);

  syncLoginProviderButtons();
}

async function connectMailProvider(provider) {
  const p = provider === 'microsoft' ? 'microsoft' : 'gmail';
  try {
    await mail.setProvider(p);
    await refreshSettingsView();
    if (hasActiveMailAuth()) {
      await refreshProfile();
      startDigestAutoRefresh();
      await runDigest();
      return;
    }
    await connectMail();
  } catch (e) {
    const label = p === 'microsoft' ? 'Outlook' : 'Gmail';
    showToast(`Erro ao ligar ${label}: ${e.message}`, 'error');
  }
}

async function connectMail() {
  try {
    showToast(`A abrir autenticação ${mailProviderLabel()}…`);
    await mail.auth();
    await refreshSettingsView();
    await refreshProfile();
    closeSettings();
    startDigestAutoRefresh();
    await runDigest();
  } catch (e) {
    showToast(`Erro ao ligar ${mailProviderLabel()}: ${e.message}`, 'error');
  }
}

async function disconnectMail() {
  stopDigestAutoRefresh();
  await mail.logout();
  const label = mailProviderLabel();
  lastBriefing = null;
  lastRawById = new Map();
  profileName = '';
  profileEmail = '';
  if (els.avatarInner) els.avatarInner.textContent = '?';
  els.briefingRoot?.replaceChildren();
  await refreshSettingsView();
  showToast(`Conta ${label} desligada.`);
}

async function onMailProviderChange() {
  const p = els.mailProviderSelect?.value === 'microsoft' ? 'microsoft' : 'gmail';
  await mail.setProvider(p);
  await refreshSettingsView();
  if (hasActiveMailAuth()) {
    await refreshProfile();
    startDigestAutoRefresh();
    await runDigest();
  } else {
    stopDigestAutoRefresh();
    showToast(`Conta ${mailProviderLabel()} não ligada — escolhe no ecrã de início de sessão.`);
  }
}

async function refreshProfile() {
  if (!hasActiveMailAuth()) return;
  try {
    const prof = await mail.getProfile();
    profileEmail = typeof prof?.email === 'string' ? prof.email : '';
    profileName = typeof prof?.name === 'string' ? prof.name : '';
    const source = (settingsCache?.displayName || profileName || profileEmail.split('@')[0] || '?').trim();
    const ini = source.slice(0, 2).toUpperCase() || '?';
    if (els.avatarInner) els.avatarInner.textContent = ini;
    if (els.userAvatar && profileEmail) els.userAvatar.title = `Definições — sessão: ${profileEmail}`;
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function openSettings() {
  await refreshSettingsView();
  els.settingsPanel.classList.remove('hidden');
}

function closeSettings() {
  els.settingsPanel.classList.add('hidden');
}

async function refreshSettingsView() {
  const s = await api.settings.get();
  settingsCache = s;

  if (els.displayName) els.displayName.value = s.displayName || '';
  els.providerSelect.value = s.provider || 'anthropic';
  els.anthropicModel.value = s.anthropicModel || 'claude-haiku-4-5';
  els.openaiModel.value = s.openaiModel || 'gpt-4.1-mini';
  els.googleModel.value = s.googleModel || 'gemini-2.5-flash';
  els.googleClientId.value = s.googleClientId || '';
  els.googleClientSecret.value = '';
  if (els.microsoftClientId) els.microsoftClientId.value = s.microsoftClientId || '';
  if (els.microsoftClientSecret) els.microsoftClientSecret.value = '';
  if (els.mailProviderSelect) els.mailProviderSelect.value = s.mailProvider || 'gmail';

  els.anthropicKey.value = '';
  els.openaiKey.value = '';
  els.googleKey.value = '';

  setKeyStatus(els.anthropicStatus, s.hasAnthropicKey);
  setKeyStatus(els.openaiStatus, s.hasOpenAIKey);
  setKeyStatus(els.googleApiStatus, s.hasGoogleKey);
  setKeyStatus(els.googleClientSecretStatus, s.hasGoogleClientSecret);
  setKeyStatus(els.microsoftClientSecretStatus, s.hasMicrosoftClientSecret);

  syncBuiltinHint(els.oauthBuiltinHint, s.oauthBuiltInClient,
    'Cliente OAuth Google incluído nesta instalação (build).');
  syncBuiltinHint(els.oauthMicrosoftBuiltinHint, s.oauthBuiltInMicrosoftClient,
    'Cliente OAuth Microsoft incluído nesta instalação (build).');

  syncAuthRow({
    connected: Boolean(s.hasGoogleAuth),
    statusEl: els.googleAuthStatus,
    connectBtn: els.btnConnectGoogle,
    disconnectBtn: els.btnDisconnectGoogle,
    connectedText: 'Conta Google ligada'
  });
  syncAuthRow({
    connected: Boolean(s.hasMicrosoftAuth),
    statusEl: els.microsoftAuthStatus,
    connectBtn: els.btnConnectMicrosoft,
    disconnectBtn: els.btnDisconnectMicrosoft,
    connectedText: 'Conta Microsoft ligada'
  });

  syncAuthShell();
  showProviderBlock(s.provider || 'anthropic');
}

function syncBuiltinHint(elHint, active, text) {
  if (!elHint) return;
  if (active) {
    elHint.textContent = text;
    elHint.classList.remove('hidden');
  } else {
    elHint.classList.add('hidden');
  }
}

function syncAuthRow({ connected, statusEl, connectBtn, disconnectBtn, connectedText }) {
  if (!statusEl) return;
  statusEl.textContent = connected ? connectedText : 'Não ligado';
  statusEl.className = connected ? 'meta keyline connected' : 'meta keyline';
  connectBtn?.classList.toggle('hidden', connected);
  disconnectBtn?.classList.toggle('hidden', !connected);
}

function setKeyStatus(elStatus, hasKey) {
  if (!elStatus) return;
  elStatus.textContent = hasKey ? 'guardada' : '';
  elStatus.className = 'key-status';
  elStatus.hidden = !hasKey;
}

function onProviderChange() {
  showProviderBlock(els.providerSelect.value);
}

function showProviderBlock(provider) {
  document.querySelectorAll('.provider-block').forEach(b => {
    b.classList.toggle('hidden', b.dataset.provider !== provider);
  });
}

async function saveSettings() {
  const provider = els.providerSelect.value;
  const mailProv = els.mailProviderSelect?.value === 'microsoft' ? 'microsoft' : 'gmail';

  await api.settings.set({
    provider,
    displayName: els.displayName?.value.trim() || '',
    anthropicModel: els.anthropicModel.value.trim(),
    openaiModel: els.openaiModel.value.trim(),
    googleModel: els.googleModel.value.trim(),
    googleClientId: els.googleClientId.value.trim(),
    microsoftClientId: els.microsoftClientId?.value.trim() || '',
    mailProvider: mailProv
  });
  await mail.setProvider(mailProv);

  const anthropicKey = els.anthropicKey.value.trim();
  const openaiKey = els.openaiKey.value.trim();
  const googleKey = els.googleKey.value.trim();
  const clientSecret = els.googleClientSecret.value.trim();
  const msSecret = els.microsoftClientSecret?.value.trim() || '';

  if (anthropicKey) await api.keychain.set('anthropic-api-key', anthropicKey);
  if (openaiKey) await api.keychain.set('openai-api-key', openaiKey);
  if (googleKey) await api.keychain.set('google-api-key', googleKey);
  if (clientSecret) await api.keychain.set('google-client-secret', clientSecret);
  if (msSecret) await api.keychain.set('microsoft-client-secret', msSecret);

  await refreshSettingsView();
  await refreshProfile();
  if (lastBriefing) renderBriefing(lastBriefing);
  showToast('Definições guardadas.');
  closeSettings();
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

function startDigestAutoRefresh() {
  stopDigestAutoRefresh();
  autoRefreshTimerId = setInterval(() => {
    if (!digestRunInProgress && hasActiveMailAuth()) void runDigest({ auto: true });
  }, AUTO_REFRESH_INTERVAL_MS);
}

function stopDigestAutoRefresh() {
  if (autoRefreshTimerId != null) {
    clearInterval(autoRefreshTimerId);
    autoRefreshTimerId = null;
  }
}

async function runDigest({ auto = false } = {}) {
  if (!hasActiveMailAuth() || digestRunInProgress) return;
  setBusy(true);
  try {
    if (!auto || !lastBriefing) {
      renderPageStatus('A obter emails…', { spinner: true });
    }
    const result = await mail.fetch({ timeWindow: 'today', page: 0 });
    const emails = result?.emails ?? [];
    lastRawById = new Map(emails.map((e) => [e.id, e]));

    if (!emails.length) {
      lastBriefing = emptyBriefing();
      renderBriefing(lastBriefing);
      return;
    }

    if (!auto) {
      renderPageStatus(`A analisar ${emails.length} email(s) com IA…`, { spinner: true });
    }
    const analysis = await api.llm.analyse(emails);
    lastBriefing = normalizeBriefing(analysis, emails);
    renderBriefing(lastBriefing);
    if (auto) showToast('Briefing actualizado automaticamente.');
  } catch (e) {
    console.error('[renderer] runDigest:', e);
    if (lastBriefing) showToast(`Erro ao actualizar: ${e.message}`, 'error');
    else renderPageStatus(`Erro: ${e.message}`, { error: true });
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// Briefing schema — normalização + migração do shape antigo (items[])
// ---------------------------------------------------------------------------

function emptyBriefing() {
  return {
    briefing: {
      summary: 'Caixa de entrada limpa — nenhum email não lido desde a meia-noite.',
      stats: { urgent: 0, today: 0, this_week: 0, handled: 0, estimated_minutes: 0 }
    },
    needs_you: [],
    proposed: { events: [], tasks: [] },
    handled: { newsletter_synthesis: null, transactional: [] }
  };
}

function normalizeBriefing(analysis, rawEmails) {
  if (analysis && typeof analysis === 'object' && !Array.isArray(analysis) && analysis.briefing) {
    return {
      briefing: {
        summary: String(analysis.briefing.summary || ''),
        stats: {
          urgent: Number(analysis.briefing.stats?.urgent) || 0,
          today: Number(analysis.briefing.stats?.today) || 0,
          this_week: Number(analysis.briefing.stats?.this_week) || 0,
          handled: Number(analysis.briefing.stats?.handled) || 0,
          estimated_minutes: Number(analysis.briefing.stats?.estimated_minutes) || 0
        }
      },
      needs_you: Array.isArray(analysis.needs_you) ? analysis.needs_you.slice(0, MAX_NEEDS_YOU) : [],
      proposed: {
        events: Array.isArray(analysis.proposed?.events) ? analysis.proposed.events : [],
        tasks: Array.isArray(analysis.proposed?.tasks) ? analysis.proposed.tasks.slice(0, MAX_TASKS) : []
      },
      handled: {
        newsletter_synthesis: analysis.handled?.newsletter_synthesis || null,
        transactional: Array.isArray(analysis.handled?.transactional)
          ? analysis.handled.transactional.slice(0, MAX_TRANSACTIONAL)
          : []
      }
    };
  }
  if (Array.isArray(analysis)) return migrateLegacyItems(analysis, rawEmails);
  return emptyBriefing();
}

const PT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const EVENT_DATE_RE = new RegExp(String.raw`(\d{1,2})\s*(?:de\s+|[/-])?\s*(${PT_MONTHS.join('|')})`, 'i');
const SENDER_RE = /^(.*?)\s*<([^>]+)>$/;

function pluralize(n, singular, plural) {
  return n === 1 ? singular : plural;
}

function parseSenderParts(fromRaw) {
  const raw = String(fromRaw || '').trim();
  const m = SENDER_RE.exec(raw);
  if (m) {
    return { sender: m[1].replaceAll('"', '').trim() || m[2], address: m[2].trim() };
  }
  return { sender: raw, address: raw.includes('@') ? raw : '' };
}

function formatEmailTime(dateRaw) {
  const d = new Date(dateRaw);
  if (Number.isNaN(d.getTime())) return String(dateRaw || '');
  const day = d.getDate();
  const month = PT_MONTHS[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const cap = month.charAt(0).toUpperCase() + month.slice(1);
  return `${day} ${cap} · ${hh}:${mm}`;
}

function parseLegacyEventDate(text, rawDate) {
  const m = EVENT_DATE_RE.exec(String(text || ''));
  if (m) {
    const month = m[2].toLowerCase();
    return { day: Number(m[1]), month_short: month.charAt(0).toUpperCase() + month.slice(1) };
  }
  const d = new Date(rawDate);
  if (!Number.isNaN(d.getTime())) {
    const month = PT_MONTHS[d.getMonth()];
    return { day: d.getDate(), month_short: month.charAt(0).toUpperCase() + month.slice(1) };
  }
  return { day: '—', month_short: '' };
}

function guessLegacyCategory(raw) {
  const txt = `${raw?.from || ''} ${raw?.subject || ''}`.toLowerCase();
  if (/recibo|receipt|fatura|invoice|pagamento confirmado/.test(txt)) {
    return { category: 'Receipt', color: 'emerald' };
  }
  if (/newsletter|digest|weekly|semanal|edição/.test(txt)) {
    return { category: 'Newsletter', color: 'sky' };
  }
  if (/promo|sale|%|desconto|off|deal|oferta/.test(txt)) {
    return { category: 'Promoção', color: 'sunset' };
  }
  return { category: 'Auto', color: 'slate' };
}

function splitLegacyByPriority(items) {
  const actionable = [];
  const fyi = [];
  for (const it of items || []) {
    const priority = ['urgent', 'today', 'this_week'].includes(it?.priority) ? it.priority : 'fyi';
    if (priority === 'fyi') fyi.push(it);
    else actionable.push({ ...it, priority });
  }
  const order = { urgent: 0, today: 1, this_week: 2 };
  actionable.sort((a, b) => order[a.priority] - order[b.priority]);
  return { actionable, fyi };
}

function legacyNeedsYouEntry(it, raw) {
  const { sender, address } = parseSenderParts(raw.from);
  const draft = typeof it.draft_reply === 'string' && it.draft_reply.trim() ? it.draft_reply.trim() : null;
  return {
    id: it.id,
    priority: it.priority,
    category: 'important',
    sender,
    address,
    date_iso: raw.date || '',
    subject: raw.subject || '(sem assunto)',
    summary: it.summary || raw.snippet || '',
    warning: it.warning || '',
    actions: ['view', 'archive', 'ignore'],
    primary_action_label: null,
    draft_reply: draft,
    url: raw.url || ''
  };
}

function collectLegacyEvents(it, raw, events) {
  for (const ev of it.calendar_events || []) {
    const { day, month_short } = parseLegacyEventDate(ev, raw.date);
    events.push({
      day,
      month_short,
      title: String(ev),
      meta: `extraído de "${raw.subject || 'email'}"`,
      source_id: it.id,
      color: 'grape'
    });
  }
}

function collectLegacyTasks(it, raw, tasks) {
  for (const t of it.tasks || []) {
    if (tasks.length >= MAX_TASKS) return;
    const text = typeof t === 'object' && t !== null ? String(t.text || '') : String(t);
    if (!text.trim()) continue;
    tasks.push({
      text: text.trim(),
      suggested_time: '',
      source_id: it.id,
      source_subject: raw.subject || '',
      done: false
    });
  }
}

function legacyTransactionalEntry(it, raw) {
  const { sender } = parseSenderParts(raw.from);
  const guess = guessLegacyCategory(raw);
  return {
    id: it.id,
    category: guess.category,
    color: guess.color,
    sender,
    text: raw.subject || it.summary?.slice(0, 90) || '',
    status: 'na caixa · para rever'
  };
}

function buildBriefingSummary(stats, total) {
  const needCount = stats.urgent + stats.today;
  const minutesPart = stats.estimated_minutes > 0
    ? `Cerca de **${stats.estimated_minutes} minutos** para ficares em dia.`
    : '';
  return (
    `Li **${total} email${pluralize(total, '', 's')}** hoje. ` +
    `**${needCount} precisa${pluralize(needCount, '', 'm')} de ti**, ` +
    `**${stats.this_week} pode${pluralize(stats.this_week, '', 'm')} esperar** e ` +
    `${stats.handled} ${pluralize(stats.handled, 'era ruído', 'eram ruído')}. ` +
    minutesPart
  );
}

function migrateLegacyItems(items, rawEmails) {
  const rawById = new Map((rawEmails || []).map((e) => [e.id, e]));
  const { actionable, fyi } = splitLegacyByPriority(items);

  const needsYou = actionable
    .slice(0, MAX_NEEDS_YOU)
    .map((it) => legacyNeedsYouEntry(it, rawById.get(it.id) || {}));

  const events = [];
  const tasks = [];
  for (const it of actionable) {
    const raw = rawById.get(it.id) || {};
    collectLegacyEvents(it, raw, events);
    collectLegacyTasks(it, raw, tasks);
  }

  const transactional = fyi
    .slice(0, MAX_TRANSACTIONAL)
    .map((it) => legacyTransactionalEntry(it, rawById.get(it.id) || {}));

  const stats = {
    urgent: actionable.filter((i) => i.priority === 'urgent').length,
    today: actionable.filter((i) => i.priority === 'today').length,
    this_week: actionable.filter((i) => i.priority === 'this_week').length,
    handled: fyi.length,
    estimated_minutes: Math.round(needsYou.length * MINUTES_PER_ITEM)
  };

  return {
    briefing: { summary: buildBriefingSummary(stats, (items || []).length), stats },
    needs_you: needsYou,
    proposed: { events, tasks },
    handled: { newsletter_synthesis: null, transactional }
  };
}

// ---------------------------------------------------------------------------
// renderBriefing + sub-renderers
// ---------------------------------------------------------------------------

function renderBriefing(b) {
  const root = els.briefingRoot;
  if (!root) return;
  root.replaceChildren();
  root.appendChild(renderHero(b.briefing));
  if (b.needs_you?.length) root.appendChild(renderNeedsYou(b.needs_you));
  if (b.proposed?.events?.length || b.proposed?.tasks?.length) {
    root.appendChild(renderProposed(b.proposed));
  }
  if (b.handled?.newsletter_synthesis || b.handled?.transactional?.length) {
    root.appendChild(renderHandled(b.handled));
  }
  root.appendChild(renderConvoHint());
}

function heroDateLine() {
  const now = new Date();
  const weekdayFull = now.toLocaleDateString('pt-PT', { weekday: 'long' });
  const weekday = weekdayFull.split('-')[0];
  const day = now.getDate();
  const month = PT_MONTHS[now.getMonth()];
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${day} ${month.charAt(0).toUpperCase()}${month.slice(1)} ${now.getFullYear()}`;
}

function greetingFirstName() {
  const source = (settingsCache?.displayName || profileName || profileEmail.split('@')[0] || '').trim();
  if (!source) return '';
  const first = source.split(/[\s.]+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function renderHero(briefing) {
  const hero = el('section', 'hero');
  hero.appendChild(el('div', 'hero-stripe'));
  const body = el('div', 'hero-body');

  body.appendChild(el('div', 'hero-date', heroDateLine()));

  const hour = new Date().getHours();
  let salutation;
  if (hour < 12) salutation = 'Bom dia';
  else if (hour < 19) salutation = 'Boa tarde';
  else salutation = 'Boa noite';
  const h1 = el('h1');
  const name = greetingFirstName();
  if (name) {
    h1.appendChild(document.createTextNode(`${salutation}, `));
    h1.appendChild(el('em', '', name));
    h1.appendChild(document.createTextNode('.'));
  } else {
    h1.appendChild(document.createTextNode(`${salutation}.`));
  }
  body.appendChild(h1);

  const lede = el('p', 'hero-lede');
  appendWithBold(lede, briefing.summary || '');
  body.appendChild(lede);

  const stats = briefing.stats || {};
  const defs = [
    { cls: 'urgent', n: stats.urgent, title: 'Urgentes', sub: stats.urgent ? 'por resolver' : 'nada urgente' },
    { cls: 'today', n: stats.today, title: 'Hoje', sub: 'precisam de ti' },
    { cls: 'week', n: stats.this_week, title: 'Esta semana', sub: 'podem esperar' },
    { cls: 'fyi', n: stats.handled, title: 'Tratei', sub: 'ruído filtrado' }
  ];
  const grid = el('div', 'stats');
  for (const d of defs) {
    const pill = el('div', `stat ${d.cls}`);
    pill.appendChild(el('span', 'num', d.n ?? 0));
    const lbl = el('span', 'lbl');
    lbl.appendChild(el('strong', '', d.title));
    lbl.appendChild(document.createTextNode(d.sub));
    pill.appendChild(lbl);
    grid.appendChild(pill);
  }
  body.appendChild(grid);

  hero.appendChild(body);
  return hero;
}

function sectionHead(dotColorVar, title, meta) {
  const head = el('div', 'section-head');
  const dot = el('div', 'section-dot');
  dot.style.background = `var(${dotColorVar})`;
  head.appendChild(dot);
  head.appendChild(el('h2', '', title));
  if (meta) head.appendChild(el('div', 'section-meta', meta));
  return head;
}

const PRIORITY_CLS = { urgent: 'urgent', today: 'today', this_week: 'week' };
const PRIORITY_BADGE = { urgent: 'Urgente', today: 'Hoje', this_week: 'Semana' };

function renderNeedsYou(items) {
  const section = el('section', 'section');
  const minutes = Math.round(items.length * MINUTES_PER_ITEM);
  section.appendChild(sectionHead('--urgent', 'O que precisa de ti',
    `${items.length} ${items.length === 1 ? 'item' : 'itens'} · ~${minutes} min`));

  for (const item of items) {
    section.appendChild(renderNeedsYouCard(item));
  }
  return section;
}

function renderCardMeta(item, cls) {
  const meta = el('div', 'card-meta');
  meta.appendChild(el('span', `badge ${cls}`, PRIORITY_BADGE[item.priority] || 'Semana'));
  if (item.sender) meta.appendChild(el('span', 'sender', item.sender));
  if (item.address) meta.appendChild(el('span', 'addr', item.address));
  meta.appendChild(el('span', 'time', formatEmailTime(item.date_iso)));
  return meta;
}

function renderDraftBlock(item) {
  const draft = el('div', 'card-draft');
  draft.hidden = true;
  draft.appendChild(el('div', 'card-draft-label', 'Rascunho sugerido'));
  draft.appendChild(el('div', 'card-draft-text', item.draft_reply));
  const draftActions = el('div', 'card-actions');
  draftActions.appendChild(actionBtn('btn btn-primary', `Criar rascunho no ${mailProviderLabel()}`, 'create-draft', item.id));
  draftActions.appendChild(actionBtn('btn', 'Copiar', 'copy-draft', item.id));
  draft.appendChild(draftActions);
  return draft;
}

function renderCardActions(item) {
  const actions = el('div', 'card-actions');
  if (item.primary_action_label) {
    const primary = actionBtn(item.priority === 'urgent' ? 'btn btn-urgent' : 'btn btn-primary',
      item.primary_action_label, 'primary', item.id);
    primary.prepend(svgIcon(ICONS.arrow, '0 0 16 16', '1.6'));
    actions.appendChild(primary);
  }
  if (item.draft_reply) {
    const draftBtn = actionBtn(item.primary_action_label ? 'btn' : 'btn btn-primary',
      'Ver rascunho sugerido', 'toggle-draft', item.id);
    draftBtn.prepend(svgIcon(ICONS.reply));
    actions.appendChild(draftBtn);
  }
  actions.appendChild(actionBtn('btn', `Ver no ${mailProviderLabel()}`, 'view', item.id));
  actions.appendChild(actionBtn('btn', 'Arquivar', 'archive', item.id));
  actions.appendChild(actionBtn('btn', 'Ignorar', 'ignore', item.id));
  return actions;
}

function renderNeedsYouCard(item) {
  const cls = PRIORITY_CLS[item.priority] || 'week';
  const card = el('div', `card ${cls}`);
  card.dataset.messageId = item.id || '';
  card.appendChild(el('div', 'card-stripe'));

  const body = el('div', 'card-body');
  body.appendChild(renderCardMeta(item, cls));
  body.appendChild(el('h3', '', item.subject || '(sem assunto)'));
  if (item.warning) body.appendChild(el('div', 'card-warning', item.warning));

  const summary = el('p', 'card-summary');
  appendWithBold(summary, item.summary || '');
  body.appendChild(summary);

  if (item.draft_reply) body.appendChild(renderDraftBlock(item));
  body.appendChild(renderCardActions(item));

  card.appendChild(body);
  return card;
}

function actionBtn(className, label, action, id) {
  const btn = el('button', className, label);
  btn.type = 'button';
  btn.dataset.action = action;
  if (id) btn.dataset.messageId = id;
  return btn;
}

function renderEventCard(ev) {
  const card = el('div', 'event-card');
  const date = el('div', 'event-date');
  date.appendChild(el('div', 'event-day', ev.day ?? '—'));
  date.appendChild(el('div', 'event-month', ev.month_short || ''));
  card.appendChild(date);

  const info = el('div');
  info.appendChild(el('div', 'event-title', ev.title || ''));
  if (ev.meta) info.appendChild(el('div', 'event-meta', ev.meta));
  card.appendChild(info);

  const add = actionBtn('btn btn-grape', 'Adicionar', 'calendar-add', ev.source_id || '');
  add.prepend(svgIcon(ICONS.plus, '0 0 16 16', '1.7'));
  add.dataset.eventTitle = ev.title || '';
  card.appendChild(add);
  return card;
}

function renderTaskCard(task) {
  const card = el('div', `task-card${task.done ? ' done' : ''}`);
  card.appendChild(el('div', 'task-check'));
  const body = el('div', 'task-body');
  body.appendChild(el('div', 'task-text', task.text || ''));
  const meta = el('div', 'task-meta');
  const source = task.source_subject ? `do email "${task.source_subject}"` : 'sugerida pelo digest';
  meta.appendChild(document.createTextNode(source));
  if (task.suggested_time) meta.appendChild(el('span', 'task-suggest', task.suggested_time));
  body.appendChild(meta);
  card.appendChild(body);
  if (!task.done) {
    const accept = actionBtn('btn', 'Aceitar', 'task-accept', task.source_id || '');
    accept.dataset.taskText = task.text || '';
    card.appendChild(accept);
  }
  return card;
}

function renderProposed(proposed) {
  const section = el('section', 'section');
  const evCount = proposed.events?.length || 0;
  const taskCount = proposed.tasks?.length || 0;
  const metaParts = [];
  if (evCount) metaParts.push(`${evCount} evento${pluralize(evCount, '', 's')}`);
  if (taskCount) metaParts.push(`${taskCount} tarefa${pluralize(taskCount, '', 's')}`);
  section.appendChild(sectionHead('--grape', 'O que eu proponho', metaParts.join(' · ')));

  for (const ev of proposed.events || []) section.appendChild(renderEventCard(ev));
  for (const task of proposed.tasks || []) section.appendChild(renderTaskCard(task));

  return section;
}

function renderNewsletterCard(synth) {
  const news = el('div', 'news-card');
  news.appendChild(el('div', 'news-card-stripe'));
  const body = el('div', 'news-card-body');

  const head = el('div', 'news-card-head');
  head.appendChild(el('span', 'badge news', 'Newsletters'));
  const srcCount = synth.sources?.length || 0;
  head.appendChild(el('span', 'count', `${srcCount} fonte${pluralize(srcCount, '', 's')} · síntese AI`));
  body.appendChild(head);

  const p = el('p', 'news-summary');
  appendWithBold(p, synth.overview);
  body.appendChild(p);

  if (srcCount) {
    const grid = el('div', 'news-sources');
    for (const s of synth.sources) {
      const row = el('div', 'news-source');
      row.appendChild(el('span', 'news-source-dot'));
      row.appendChild(el('span', 'news-source-name', s.name || ''));
      if (s.meta) row.appendChild(el('span', 'news-source-meta', s.meta));
      grid.appendChild(row);
    }
    body.appendChild(grid);
  }
  news.appendChild(body);
  return news;
}

const TRANS_COLOR_VARS = { sunset: '--sunset', emerald: '--emerald', slate: '--slate', sky: '--sky' };

function renderTransactionalRow(t) {
  const row = el('div', 'trans-row');
  const dot = el('div', 'trans-dot');
  dot.style.background = `var(${TRANS_COLOR_VARS[t.color] || '--slate'})`;
  row.appendChild(dot);
  row.appendChild(el('div', 'trans-cat', t.category || 'Auto'));
  const text = el('div', 'trans-text');
  if (t.sender) {
    text.appendChild(el('strong', '', t.sender));
    text.appendChild(document.createTextNode(` — ${t.text || ''}`));
  } else {
    text.textContent = t.text || '';
  }
  row.appendChild(text);
  row.appendChild(el('div', 'trans-status', t.status || ''));
  return row;
}

function renderHandled(handled) {
  const section = el('section', 'section');
  const transCount = handled.transactional?.length || 0;
  const headMeta = transCount ? `${transCount} email${pluralize(transCount, '', 's')}` : 'síntese';
  section.appendChild(sectionHead('--sky', 'O que eu tratei', headMeta));

  const synth = handled.newsletter_synthesis;
  if (synth?.overview) section.appendChild(renderNewsletterCard(synth));

  if (transCount) {
    const list = el('div', 'trans-list');
    for (const t of handled.transactional) list.appendChild(renderTransactionalRow(t));
    section.appendChild(list);
  }

  return section;
}

function renderConvoHint() {
  const hint = el('div', 'convo-hint');
  const icon = el('div', 'convo-hint-icon');
  icon.appendChild(svgIcon(ICONS.chat, '0 0 24 24', '2'));
  hint.appendChild(icon);
  const body = el('div', 'convo-hint-body');
  body.appendChild(el('h3', '', 'Algo não está claro? Pergunta-me.'));
  const p = el('p');
  p.appendChild(document.createTextNode(
    'Posso mostrar threads anteriores, propor um rascunho, ou explicar como cheguei a uma prioridade. '
  ));
  p.appendChild(el('span', 'kbd', '⌘ K'));
  p.appendChild(document.createTextNode(' para começar.'));
  body.appendChild(p);
  hint.appendChild(body);
  const btn = actionBtn('btn btn-brand', 'Falar com o assistente', 'convo-open', '');
  btn.appendChild(svgIcon(ICONS.arrow, '0 0 16 16', '1.6'));
  hint.appendChild(btn);
  return hint;
}

// ---------------------------------------------------------------------------
// Acções do briefing
// ---------------------------------------------------------------------------

async function onBriefingClick(ev) {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.messageId || '';

  switch (action) {
    case 'view':
      openMessageInBrowser(id);
      break;
    case 'archive':
      await archiveMessage(id, btn);
      break;
    case 'ignore':
      await ignoreMessage(id, btn);
      break;
    case 'toggle-draft': {
      const draft = btn.closest('.card-body')?.querySelector('.card-draft');
      if (draft) draft.hidden = !draft.hidden;
      break;
    }
    case 'create-draft':
      await createReplyDraft(id);
      break;
    case 'copy-draft': {
      const text = findNeedsYouItem(id)?.draft_reply || '';
      if (text) {
        await navigator.clipboard.writeText(text);
        showToast('Rascunho copiado para a área de transferência.');
      }
      break;
    }
    case 'primary': {
      await api.briefing.action('primary', { id });
      showToast('Acção registada — integração directa no roadmap.');
      break;
    }
    case 'calendar-add': {
      await api.calendar.add({ sourceId: id, title: btn.dataset.eventTitle || '' });
      showToast('Evento registado — integração com calendário no roadmap.');
      break;
    }
    case 'task-accept': {
      await api.task.accept({ sourceId: id, text: btn.dataset.taskText || '' });
      const card = btn.closest('.task-card');
      if (card) {
        card.classList.add('done');
        const meta = card.querySelector('.task-meta');
        if (meta) meta.textContent = 'aceite agora · marcada como feita';
        btn.remove();
      }
      showToast('Tarefa aceite.');
      break;
    }
    case 'convo-open':
      openConvoModal();
      break;
    default:
      break;
  }
}

function findNeedsYouItem(id) {
  return lastBriefing?.needs_you?.find((i) => i.id === id) || null;
}

function openMessageInBrowser(id) {
  const item = findNeedsYouItem(id);
  const raw = lastRawById.get(id) || {};
  let url = item?.url || raw.url || '';
  if (!url && !isMicrosoftMail()) {
    const tid = raw.threadId || id;
    if (tid) url = `https://mail.google.com/mail/u/0/#inbox/${tid}`;
  }
  if (url) void openBrowserUrl(url);
  else showToast('Sem URL disponível para esta mensagem.', 'error');
}

async function archiveMessage(id, btn) {
  if (!id) return;
  try {
    btn.disabled = true;
    await mail.archive(id);
    removeNeedsYouCard(id);
    showToast(`Email arquivado no ${mailProviderLabel()}.`);
  } catch (e) {
    btn.disabled = false;
    console.error('[renderer] archive:', e);
    showToast(
      e.message?.includes?.('403') || e.message?.includes?.('Insufficient')
        ? 'Permissão insuficiente: desliga e volta a ligar a conta para aceitar os novos acessos.'
        : `Arquivar falhou: ${e.message}`,
      'error'
    );
  }
}

async function ignoreMessage(id, btn) {
  try {
    btn.disabled = true;
    await api.briefing.action('ignore', { id });
    removeNeedsYouCard(id);
    showToast('Ignorado neste briefing.');
  } catch (e) {
    btn.disabled = false;
    showToast(`Erro: ${e.message}`, 'error');
  }
}

function removeNeedsYouCard(id) {
  if (lastBriefing?.needs_you) {
    lastBriefing.needs_you = lastBriefing.needs_you.filter((i) => i.id !== id);
  }
  const card = els.briefingRoot?.querySelector(`.card[data-message-id="${CSS.escape(id)}"]`);
  card?.remove();
}

async function createReplyDraft(id) {
  const text = findNeedsYouItem(id)?.draft_reply || '';
  if (!text.trim()) return;
  try {
    showToast(`A criar rascunho no ${mailProviderLabel()}…`);
    const result = await mail.createReplyDraft(id, text);
    if (result?.openUrl) void openBrowserUrl(result.openUrl);
    showToast(`Rascunho criado — ${mailProviderLabel()} aberto na conversação.`);
  } catch (e) {
    console.error('[renderer] createReplyDraft:', e);
    showToast(`Rascunho: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Modo conversa (placeholder)
// ---------------------------------------------------------------------------

function openConvoModal() {
  if (!hasActiveMailAuth()) return;
  api.convo.open().catch((e) => console.warn('[renderer] convo.open:', e));
  els.convoModal?.setAttribute('open', '');
  els.convoModal?.classList.remove('hidden');
}

function closeConvoModal() {
  els.convoModal?.classList.add('hidden');
  els.convoModal?.removeAttribute('open');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openBrowserUrl(url) {
  if (!url || typeof url !== 'string') return;
  if (api?.shell?.openExternal) {
    try {
      await api.shell.openExternal(url);
      return;
    } catch (e) {
      console.warn('[renderer] shell.openExternal:', e);
    }
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

document.addEventListener('DOMContentLoaded', () => void init());
