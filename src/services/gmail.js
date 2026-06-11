// Gmail REST API — authenticated with an OAuth2 access token.
// Uses the global fetch() available in Node 18+ / Electron — no googleapis package needed.
//
// Advantages over IMAP:
//   - Server-side query filtering (excludes promotions/social/forums)
//   - Structured JSON payloads (no MIME parsing)
//   - Direct Gmail URLs for each message

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const { extractEmailLinks } = require('./email-links');

// ---------------------------------------------------------------------------
// Body extraction
// ---------------------------------------------------------------------------

function decodeBase64Url(data) {
  if (!data) return '';
  const buf = Buffer.from(data.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
  return buf.toString('utf-8');
}

function htmlToPlainText(html) {
  return html
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function extractBodyAndLinks(payload) {
  if (!payload) return { body: '', links: [], html: '' };
  const stack = [payload];
  let plain = '';
  let html = '';

  while (stack.length) {
    const part = stack.pop();
    if (part.parts?.length) { stack.push(...part.parts); continue; }
    const data = part.body?.data;
    if (!data) continue;
    if (part.mimeType === 'text/plain' && !plain) plain = decodeBase64Url(data);
    else if (part.mimeType === 'text/html' && !html) html = decodeBase64Url(data);
  }

  const body = plain || (html ? htmlToPlainText(html) : '');
  const links = extractEmailLinks({ body, html });
  return { body, links, html };
}

function extractBody(payload) {
  return extractBodyAndLinks(payload).body;
}

function header(headers, name) {
  const h = (headers || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// ---------------------------------------------------------------------------
// Listagem + mensagens completas (reutilização digest / pesquisa)
// ---------------------------------------------------------------------------

/** Lista IDs até `maxIds`, seguindo `nextPageToken` da API Gmail. */
async function listAllMessageIds(accessToken, gmailQuery, maxIds = 200) {
  const h = { Authorization: `Bearer ${accessToken}` };
  const ids = [];
  let pageToken;

  while (ids.length < maxIds) {
    const take = Math.min(100, maxIds - ids.length);
    const params = new URLSearchParams({
      q: gmailQuery,
      maxResults: String(take)
    });
    if (pageToken) params.set('pageToken', pageToken);

    const listRes = await fetch(`${GMAIL_BASE}/messages?${params}`, { headers: h });
    if (!listRes.ok) {
      throw new Error(`Gmail API erro ${listRes.status}: ${listRes.statusText}`);
    }
    const listData = await listRes.json();
    const batch = (listData.messages || []).map(m => m.id);
    ids.push(...batch);
    pageToken = listData.nextPageToken;
    if (!pageToken || batch.length === 0) break;
  }

  return { ids, total: ids.length };
}

async function hydrateFullMessages(accessToken, ids) {
  const h = { Authorization: `Bearer ${accessToken}` };

  const results = await Promise.all(ids.map(async (id) => {
    const msgRes = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, { headers: h });
    if (!msgRes.ok) return null;
    const m = await msgRes.json();
    const hdrs = m.payload?.headers;
    const { body, links } = extractBodyAndLinks(m.payload);
    return {
      id:       m.id,
      threadId: m.threadId,
      subject:  header(hdrs, 'Subject'),
      from:     header(hdrs, 'From'),
      replyTo:  header(hdrs, 'Reply-To'),
      to:       header(hdrs, 'To'),
      date:     header(hdrs, 'Date'),
      snippet:  m.snippet || '',
      body:     body.slice(0, 4000),
      links,
      labels:   m.labelIds || [],
      url:      `https://mail.google.com/mail/u/0/#inbox/${m.id}`
    };
  }));

  return results.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Public API — correio
// ---------------------------------------------------------------------------

const DIGEST_TIME_WINDOWS = new Set(['today', 'week', 'month']);

/** Filtro temporal do digest rápido (sintaxe de pesquisa Gmail). */
function gmailDigestTimeClause(timeWindow) {
  const w = DIGEST_TIME_WINDOWS.has(timeWindow) ? timeWindow : 'today';
  if (w === 'week') return 'newer_than:7d';
  if (w === 'month') return 'newer_than:1m';
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `after:${y}/${m}/${day}`;
}

async function fetchMessagePage(accessToken, gmailQuery, { page = 0, pageSize = 20, maxMessages = 200 } = {}) {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20;
  const { ids, total } = await listAllMessageIds(accessToken, gmailQuery, maxMessages);
  const start = safePage * safeSize;
  const pageIds = ids.slice(start, start + safeSize);
  const emails = pageIds.length ? await hydrateFullMessages(accessToken, pageIds) : [];
  return { emails, total, page: safePage, pageSize: safeSize };
}

async function fetchRecentMessagesPage(
  accessToken,
  { timeWindow = 'today', page = 0, pageSize = 20, maxMessages = 200 } = {}
) {
  const query = [
    gmailDigestTimeClause(timeWindow),
    'in:inbox',
    'is:unread',
    'category:primary'
  ].join(' ');

  return fetchMessagePage(accessToken, query, { page, pageSize, maxMessages });
}

/**
 * Pesquisa livre — mesma sintaxe que gmail.com (`from:`, `subject:`, operadores combinados…).
 */
async function fetchMessagesBySearchQueryPage(
  accessToken,
  queryText,
  { page = 0, pageSize = 20, maxMessages = 200 } = {}
) {
  const q = typeof queryText === 'string' ? queryText.trim() : '';
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20;
  if (!q) return { emails: [], total: 0, page: 0, pageSize: safeSize };
  return fetchMessagePage(accessToken, q, { page, pageSize, maxMessages });
}

async function gmailModify(accessToken, messageId, payload) {
  const res = await fetch(
    `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}/modify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail modify erro ${res.status}: ${err}`);
  }
  return res.json();
}

/** Remove da caixa de entrada e marca como lido — deixa de aparecer no digest. */
async function archiveMessage(accessToken, messageId) {
  return gmailModify(accessToken, messageId, { removeLabelIds: ['INBOX', 'UNREAD'] });
}

/** Estrela = prioritário para o Gmail. star true = add, false = remove */
async function setMessageStar(accessToken, messageId, star) {
  return gmailModify(accessToken, messageId,
    star
      ? { addLabelIds: ['STARRED'] }
      : { removeLabelIds: ['STARRED'] }
  );
}

// ---------------------------------------------------------------------------
// Rascunho de resposta no mesmo fio (users.drafts.create + threadId)
// ---------------------------------------------------------------------------

function stripHeaderBreaking(s) {
  return String(s ?? '')
    .replaceAll(/\r?\n[\t ]+/g, ' ')
    .replaceAll(/[\r\n]+/g, ' ')
    .trim();
}

function extractFirstMailbox(fromHeader) {
  const t = stripHeaderBreaking(fromHeader);
  if (!t) return '';
  const angled = /<([^>\s]+@[^>\s]+)>/.exec(t);
  if (angled) return angled[1].trim().toLowerCase();
  const loose = /\b[^\s<>]+@[^\s<>]+\.[a-zA-Z]{2,}\b/.exec(t);
  return loose?.[0]?.trim().toLowerCase() ?? '';
}

function normalizeAngleMessageId(mid) {
  const t = stripHeaderBreaking(mid);
  if (!t) return '';
  const inner = /<([^>]+)>/.exec(t)?.[1];
  if (inner) return `<${inner.trim()}>`;
  const noAngle = /^[^\s]+$/.exec(t)?.[0];
  return noAngle ? `<${noAngle}>` : '';
}

function replySubject(subjectRaw) {
  const s = stripHeaderBreaking(subjectRaw) || '(sem assunto)';
  return /^Re:\s*/iu.test(s) ? s : `Re: ${s}`;
}

function encodeMimeSubjectUtf8(subject) {
  const s = stripHeaderBreaking(subject);
  if (/^[\x20-\x7E]+$/.test(s)) return s.slice(0, 200);
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function foldBase64MimeBody(b64) {
  let out = '';
  for (let i = 0; i < b64.length; i += 76) out += `${b64.slice(i, i + 76)}\r\n`;
  return out;
}

/** Base64 URL para campo `message.raw` da Gmail API */
function encodeRfc822RawForGmail(rawRfc822) {
  const b64 = Buffer.from(rawRfc822, 'utf8').toString('base64');
  return b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function buildReferencesLine(refsHeaderOriginal, tailMessageIdNormalized) {
  const tokens = [];
  const refs = stripHeaderBreaking(refsHeaderOriginal);
  if (refs)
    tokens.push(...refs.split(/\s+/u).filter(Boolean));
  if (
    tailMessageIdNormalized &&
    (!tokens.length || tokens.at(-1) !== tailMessageIdNormalized)
  )
    tokens.push(tailMessageIdNormalized);
  let line = tokens.join(' ');
  if (line.length > 996) line = line.slice(-996).trimStart();
  return line;
}

async function fetchSendingEmailAddress(accessToken) {
  const r = await fetch(`${GMAIL_BASE}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) throw new Error(`Gmail profile ${r.status}`);
  const j = await r.json();
  if (!j.emailAddress || typeof j.emailAddress !== 'string')
    throw new Error('profile sem emailAddress');
  return stripHeaderBreaking(j.emailAddress).toLowerCase();
}

async function fetchMessageRaw(accessToken, gmailMessageId) {
  const r = await fetch(
    `${GMAIL_BASE}/messages/${encodeURIComponent(gmailMessageId)}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!r.ok) throw new Error(`Mensagem Gmail ${r.status}: ${await r.text()}`);
  return r.json();
}

/**
 * Rascunho de resposta no fio actual (compose “Responder”).
 * Ligação Gmail web: mesmo threadId para o Gmail mostrar quoted original.
 */
async function createReplyDraft(accessToken, gmailMessageId, bodyPlainUtf8) {
  const sending = await fetchSendingEmailAddress(accessToken);
  const m       = await fetchMessageRaw(accessToken, gmailMessageId);
  const threadId = m.threadId;
  const hdrs     = m.payload?.headers;

  const fromHdr      = header(hdrs, 'From');
  const replyToHdr   = header(hdrs, 'Reply-To');
  const toAddr =
    extractFirstMailbox(replyToHdr) || extractFirstMailbox(fromHdr);
  if (!toAddr) throw new Error('Impossível determinar destinatário (From/Reply-To sem email).');

  const origSubject  = stripHeaderBreaking(header(hdrs, 'Subject'));
  const mimeSubject  = encodeMimeSubjectUtf8(replySubject(origSubject));

  const messageIdNormalized = normalizeAngleMessageId(header(hdrs, 'Message-ID'));

  const body = typeof bodyPlainUtf8 === 'string' ? bodyPlainUtf8.trim() : '';
  if (!body) throw new Error('Corpo do rascunho vazio.');

  const bodyB64Wrapped = foldBase64MimeBody(
    Buffer.from(body, 'utf8').toString('base64')
  );

  const headerLines = [
    `From: ${sending}`,
    `To: ${toAddr}`,
    `Subject: ${mimeSubject}`
  ];

  if (messageIdNormalized) {
    const refsTogether =
      buildReferencesLine(header(hdrs, 'References'), messageIdNormalized) ||
      messageIdNormalized;
    headerLines.push(
      `In-Reply-To: ${messageIdNormalized}`,
      `References: ${refsTogether}`
    );
  }

  headerLines.push(
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  );

  const hdr = headerLines.join('\r\n');
  const mime = `${hdr}\r\n\r\n${bodyB64Wrapped}`;

  const rawEncoded = encodeRfc822RawForGmail(mime);

  const res = await fetch(`${GMAIL_BASE}/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        raw:        rawEncoded,
        threadId
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Gmail drafts.create ${res.status}: ${await res.text()}`);
  }

  const openUrl = `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
  return { threadId, openUrl };
}

module.exports = {
  fetchRecentMessagesPage,
  fetchMessagesBySearchQueryPage,
  archiveMessage,
  setMessageStar,
  createReplyDraft
};
