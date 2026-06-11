// Extração de URLs de emails (texto + HTML) para prompts e enriquecimento de tarefas.

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;

/** Tracking, unsubscribe, infra de email. */
const SKIP_HOST_PARTS = [
  'unsubscribe', 'list-manage', 'mailchi.mp', 'sendgrid.net', 'click.email',
  'email.mg', 'trk.', 'track.', 'tracking', 'beacon', 'doubleclick.net',
  'googleusercontent.com', 'optout', 'hubspotlinks.com', 'list-manage.com'
];

/**
 * Redes sociais e media de entretenimento — não são acções do email.
 * Artigos e notícias (Medium, jornais, etc.) são permitidos.
 */
const IRRELEVANT_HOST_SUFFIXES = [
  'facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'twitter.com', 'x.com', 't.co',
  'linkedin.com', 'lnkd.in', 'tiktok.com', 'pinterest.com', 'pin.it', 'reddit.com',
  'redd.it', 'threads.net', 'snapchat.com', 'whatsapp.com', 'wa.me', 'telegram.org',
  't.me', 'discord.com', 'discord.gg', 'twitch.tv', 'vimeo.com', 'soundcloud.com',
  'spotify.com', 'open.spotify.com', 'music.apple.com', 'itunes.apple.com',
  'mailchimp.com', 'constantcontact.com', 'campaign-archive.com',
  'fonts.googleapis.com', 'fonts.gstatic.com', 'gstatic.com', 'schema.org', 'w3.org',
  'policies.google.com', 'support.google.com'
];

const IRRELEVANT_PATH_PREFIXES = [
  '/share', '/sharer', '/sharer.php', '/intent/', '/home', '/feed', '/reels', '/stories',
  '/unsubscribe', '/optout', '/preferences', '/manage-subscription', '/likes', '/followers'
];

function trimTrailingUrlPunctuation(url) {
  return url.replace(/[.,;:!?)]+$/g, '');
}

function decodeHtmlEntities(s) {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function unwrapRedirectUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') === 'google.com' && u.pathname === '/url') {
      const q = u.searchParams.get('q') || u.searchParams.get('url');
      if (q && /^https?:\/\//i.test(q)) return q;
    }
  } catch {
    /* keep original */
  }
  return url;
}

function isSkippedHost(hostname, pathname = '') {
  const h = (hostname || '').toLowerCase();
  const p = (pathname || '').toLowerCase();
  return SKIP_HOST_PARTS.some((part) => h.includes(part) || p.includes(part));
}

function hostMatchesIrrelevantSuffix(hostname) {
  const h = (hostname || '').toLowerCase().replace(/^www\./, '');
  return IRRELEVANT_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

function pathIsIrrelevant(pathname) {
  const p = (pathname || '').toLowerCase();
  return IRRELEVANT_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix));
}

/** Link não acionável (social, artigo externo, tracking, rodapé legal). */
function isIrrelevantLink(hostname, pathname = '') {
  if (isSkippedHost(hostname, pathname)) return true;
  if (hostMatchesIrrelevantSuffix(hostname)) return true;
  if (pathIsIrrelevant(pathname)) return true;
  return false;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

function brandFromHost(host) {
  const base = host.split('.')[0] || host;
  if (!base) return host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function normalizeCandidate(raw) {
  let url = decodeHtmlEntities(String(raw || '').trim());
  if (!url || url.startsWith('#') || /^mailto:/i.test(url)) return null;
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return null;
  url = trimTrailingUrlPunctuation(unwrapRedirectUrl(url));
  try {
    const u = new URL(url);
    if (isIrrelevantLink(u.hostname, u.pathname)) return null;
    return { host: hostFromUrl(url), url: u.href };
  } catch {
    return null;
  }
}

function normalizedHostKey(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

function normalizedUrlKey(url) {
  return String(url || '').toLowerCase().replace(/\/$/, '');
}

/** Um URL por endereço exacto e um por domínio (evita 5× idealista.pt). */
function dedupeLinks(links) {
  const seenUrl = new Set();
  const seenHost = new Set();
  const out = [];
  for (const raw of links || []) {
    const url = typeof raw === 'string' ? raw : raw?.url;
    if (!url) continue;
    const host = raw?.host || hostFromUrl(url);
    const urlKey = normalizedUrlKey(url);
    const hostKey = normalizedHostKey(host);
    if (seenUrl.has(urlKey) || seenHost.has(hostKey)) continue;
    seenUrl.add(urlKey);
    seenHost.add(hostKey);
    out.push(typeof raw === 'object' && raw.url ? { host, url: raw.url } : { host, url });
  }
  return out;
}

function addLink(seenUrl, seenHost, out, raw, maxLinks) {
  const link = normalizeCandidate(raw);
  if (!link) return;
  const urlKey = normalizedUrlKey(link.url);
  const hostKey = normalizedHostKey(link.host);
  if (seenUrl.has(urlKey) || seenHost.has(hostKey)) return;
  seenUrl.add(urlKey);
  seenHost.add(hostKey);
  out.push(link);
}

/**
 * Links relevantes só do corpo do email (HTML + texto), sem snippet nem rodapés sociais.
 * @param {{ body?: string, html?: string }} parts
 * @param {number} [maxLinks]
 * @returns {{ host: string, url: string }[]}
 */
function extractEmailLinks(parts, maxLinks = 10) {
  const seenUrl = new Set();
  const seenHost = new Set();
  const out = [];
  const { body = '', html = '' } = parts || {};

  if (html) {
    for (const m of html.matchAll(HREF_RE)) {
      addLink(seenUrl, seenHost, out, m[1], maxLinks);
      if (out.length >= maxLinks) return out;
    }
  }

  for (const m of (body || '').matchAll(URL_IN_TEXT_RE)) {
    addLink(seenUrl, seenHost, out, m[0], maxLinks);
    if (out.length >= maxLinks) return out;
  }

  return out;
}

/** Rótulo curto para tarefas: "Idealista (idealista.pt) · Amazon (amazon.es)" */
function formatLinkDestinations(links, max = 3) {
  return links.slice(0, max).map((l) => `${brandFromHost(l.host)} (${l.host})`).join(' · ');
}

function taskMentionsAnyLink(task, links) {
  const t = String(task || '').toLowerCase();
  return links.some(({ host, url }) => {
    const brand = (host.split('.')[0] || '').toLowerCase();
    return t.includes(host.toLowerCase()) || (brand.length > 2 && t.includes(brand))
      || t.includes(url.toLowerCase());
  });
}

function resolveLinkByHost(host, emailLinks) {
  if (!host || !emailLinks?.length) return null;
  const h = host.toLowerCase().replace(/^www\./, '');
  const found = emailLinks.find((l) => {
    const lh = l.host.toLowerCase().replace(/^www\./, '');
    return lh === h || lh.endsWith(`.${h}`) || h.endsWith(`.${lh}`);
  });
  return found?.url || null;
}

const LABEL_HOST_RE = /^(.+?)\s*\(([^)]+)\)\s*$/;

/** Separa texto da tarefa do sufixo " — Marca (host) · …" gerado pelo enrich. */
function parseTaskSuffix(taskText) {
  const raw = String(taskText || '').trim();
  const sep = ' — ';
  const idx = raw.lastIndexOf(sep);
  if (idx === -1) return { text: raw, labelParts: [] };
  const text = raw.slice(0, idx).trim();
  const labelParts = raw.slice(idx + sep.length).split('·').map((p) => p.trim()).filter(Boolean)
    .map((part) => {
      const m = LABEL_HOST_RE.exec(part);
      return m ? { label: m[1].trim(), host: m[2].trim() } : { label: part, host: null };
    });
  return { text, labelParts };
}

/**
 * Tarefa com links clicáveis separados do texto.
 * @returns {{ text: string, links: { label: string, url: string }[] }}
 */
function taskToStructured(taskText, emailLinks = []) {
  const { text, labelParts } = parseTaskSuffix(taskText);
  const taskLinks = [];
  const seen = new Set();

  for (const lp of labelParts) {
    const url = resolveLinkByHost(lp.host, emailLinks);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    taskLinks.push({
      label: lp.label || brandFromHost(lp.host || url),
      url
    });
  }

  if (!taskLinks.length && emailLinks.length) {
    for (const l of emailLinks) {
      if (!taskMentionsAnyLink(text, [l]) || seen.has(l.url)) continue;
      seen.add(l.url);
      taskLinks.push({ label: brandFromHost(l.host), url: l.url });
    }
  }

  return { text, links: taskLinks };
}

/** Links normalizados para a UI (nome + host + url), sem repetidos. */
function toDisplayLinks(emailLinks) {
  return dedupeLinks(emailLinks).map((l) => ({
    label: brandFromHost(l.host),
    host: l.host,
    url: l.url
  }));
}

/**
 * Tarefas só com texto; todos os links do email em email_links (lista vertical na UI).
 */
function enrichAnalysisWithLinks(items, messages) {
  const byId = new Map((messages || []).map((m) => [m.id, m]));
  return (items || []).map((item) => {
    const msg = byId.get(item.id);
    const emailLinks = msg?.links?.length
      ? msg.links
      : extractEmailLinks({ body: msg?.body });

    const rawTasks = Array.isArray(item.tasks) ? item.tasks : [];
    const tasks = rawTasks.map((t) => {
      const raw = typeof t === 'object' && t !== null && typeof t.text === 'string'
        ? t.text
        : String(t ?? '');
      return { text: parseTaskSuffix(raw).text };
    });

    return { ...item, tasks, email_links: toDisplayLinks(emailLinks) };
  });
}

module.exports = {
  extractEmailLinks,
  formatLinkDestinations,
  enrichAnalysisWithLinks,
  taskMentionsAnyLink,
  taskToStructured,
  toDisplayLinks,
  dedupeLinks,
  isIrrelevantLink,
  brandFromHost
};
