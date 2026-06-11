// LLM dispatcher — routes to the active provider and handles batching.
// Two-pass workflow: per-email classification (batched) + newsletter synthesis,
// deterministically assembled into the briefing object (ver REFACTOR.md §3).
const anthropic = require('./anthropic');
const openai    = require('./openai');
const google    = require('./google');
const { enrichAnalysisWithLinks } = require('../../services/email-links');

const PROVIDERS = { anthropic, openai, google };

const MAX_BATCH_SIZE = 5;
const MAX_NEEDS_YOU = 8;
const MAX_TASKS = 6;
const MAX_TRANSACTIONAL = 12;
const MINUTES_PER_ITEM = 3.5;
const NEWSLETTER_MIN_FOR_SYNTHESIS = 2;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Analyse emails using the given provider, in batches of MAX_BATCH_SIZE.
 * Returns a flat array of analysis objects (one per email).
 */
async function analyzeWithProvider(name, messages, opts) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Provider desconhecido: ${name}`);

  const batches = chunk(messages, MAX_BATCH_SIZE);
  const results = await Promise.all(batches.map(b => p.analyzeEmails(b, opts)));
  return enrichAnalysisWithLinks(results.flat(), messages);
}

/**
 * Two-pass briefing: classify each email, then synthesise newsletters
 * (second LLM call when there are >= 2). Returns the briefing object.
 */
async function buildBriefingWithProvider(name, messages, opts) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Provider desconhecido: ${name}`);

  const items = await analyzeWithProvider(name, messages, opts);

  const newsletterIds = new Set(
    items.filter((it) => it?.category === 'newsletter').map((it) => it.id)
  );
  const newsletterMessages = messages.filter((m) => newsletterIds.has(m.id));

  let synthesis = null;
  if (newsletterMessages.length >= NEWSLETTER_MIN_FOR_SYNTHESIS && p.analyzeNewsletters) {
    try {
      synthesis = await p.analyzeNewsletters(newsletterMessages, opts);
    } catch (e) {
      console.warn('[llm] Newsletter synthesis falhou — itens vão para transactional:', e.message);
    }
  }

  return assembleBriefing(items, messages, synthesis);
}

// ---------------------------------------------------------------------------
// Briefing assembly (deterministic — batching impede um briefing global do LLM)
// ---------------------------------------------------------------------------

const PT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const EVENT_DATE_RE = new RegExp(String.raw`(\d{1,2})\s*(?:de\s+|[/-])?\s*(${PT_MONTHS.join('|')})`, 'i');
const SENDER_RE = /^(.*?)\s*<([^>]+)>$/;
const ACTIONABLE = new Set(['urgent', 'today', 'this_week']);
const VALID_CATEGORIES = new Set(['important', 'transactional', 'newsletter']);
const PRIORITY_ORDER = { urgent: 0, today: 1, this_week: 2 };
const LABEL_COLORS = {
  'Promoção': 'sunset',
  'Receipt': 'emerald',
  'Auto': 'slate',
  'Newsletter': 'sky'
};

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

function parseEventDate(text, rawDate) {
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

function classifyItems(items) {
  const actionable = [];
  const handledItems = [];
  for (const it of items || []) {
    const priority = ACTIONABLE.has(it?.priority) ? it.priority : 'fyi';
    const category = VALID_CATEGORIES.has(it?.category) ? it.category : 'transactional';
    const entry = { ...it, priority, category };
    if (priority === 'fyi') handledItems.push(entry);
    else actionable.push(entry);
  }
  actionable.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  return { actionable, handledItems };
}

function toNeedsYouEntry(it, raw) {
  const { sender, address } = parseSenderParts(raw.from);
  const draft = typeof it.draft_reply === 'string' && it.draft_reply.trim()
    ? it.draft_reply.trim()
    : null;
  const primaryLabel = typeof it.primary_action_label === 'string' && it.primary_action_label.trim()
    ? it.primary_action_label.trim()
    : null;
  return {
    id: it.id,
    priority: it.priority,
    category: it.category,
    sender,
    address,
    date_iso: raw.date || '',
    subject: raw.subject || '(sem assunto)',
    summary: it.summary || raw.snippet || '',
    warning: it.warning || '',
    actions: ['view', 'archive', 'ignore'],
    primary_action_label: primaryLabel,
    draft_reply: draft,
    url: raw.url || ''
  };
}

function collectEvents(it, raw, events) {
  for (const ev of it.calendar_events || []) {
    const { day, month_short } = parseEventDate(ev, raw.date);
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

function collectTasks(it, raw, tasks) {
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

function resolveTransactionalLabel(it) {
  if (LABEL_COLORS[it.transactional_label]) return it.transactional_label;
  return it.category === 'newsletter' ? 'Newsletter' : 'Auto';
}

function toTransactionalEntry(it, raw) {
  const { sender } = parseSenderParts(raw.from);
  const label = resolveTransactionalLabel(it);
  return {
    id: it.id,
    category: label,
    color: LABEL_COLORS[label] || 'slate',
    sender,
    text: raw.subject || String(it.summary || '').slice(0, 90),
    status: 'na caixa · para rever'
  };
}

function computeStats(actionable, handledItems, needsYouCount) {
  return {
    urgent: actionable.filter((i) => i.priority === 'urgent').length,
    today: actionable.filter((i) => i.priority === 'today').length,
    this_week: actionable.filter((i) => i.priority === 'this_week').length,
    handled: handledItems.length,
    estimated_minutes: Math.round(needsYouCount * MINUTES_PER_ITEM)
  };
}

function buildSummary(stats, total) {
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

function assembleBriefing(items, messages, synthesis) {
  const rawById = new Map((messages || []).map((m) => [m.id, m]));
  const { actionable, handledItems } = classifyItems(items);

  const needsYou = actionable
    .slice(0, MAX_NEEDS_YOU)
    .map((it) => toNeedsYouEntry(it, rawById.get(it.id) || {}));

  const events = [];
  const tasks = [];
  for (const it of actionable) {
    const raw = rawById.get(it.id) || {};
    collectEvents(it, raw, events);
    collectTasks(it, raw, tasks);
  }

  const synthesisActive = Boolean(synthesis?.overview);
  const transactional = handledItems
    .filter((it) => !(synthesisActive && it.category === 'newsletter'))
    .slice(0, MAX_TRANSACTIONAL)
    .map((it) => toTransactionalEntry(it, rawById.get(it.id) || {}));

  const stats = computeStats(actionable, handledItems, needsYou.length);

  return {
    briefing: { summary: buildSummary(stats, (items || []).length), stats },
    needs_you: needsYou,
    proposed: { events, tasks },
    handled: {
      newsletter_synthesis: synthesisActive ? synthesis : null,
      transactional
    }
  };
}

module.exports = {
  analyzeWithProvider,
  buildBriefingWithProvider,
  PROVIDER_NAMES: Object.keys(PROVIDERS)
};
