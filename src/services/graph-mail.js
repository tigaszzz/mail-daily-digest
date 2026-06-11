// Microsoft Graph Mail API — paridade com gmail.js (shape canónico).

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const { extractEmailLinks } = require('./email-links');

const DIGEST_TIME_WINDOWS = new Set(['today', 'week', 'month']);

let archiveFolderIdCache = null;

function graphHeaders(accessToken, extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function graphTimeIso(timeWindow) {
  const w = DIGEST_TIME_WINDOWS.has(timeWindow) ? timeWindow : 'today';
  const now = new Date();
  if (w === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  if (w === 'month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString();
  }
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function outlookWebUrl(messageId) {
  return `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(messageId)}`;
}

function formatGraphAddress(addr) {
  if (!addr?.emailAddress) return '';
  const { name, address } = addr.emailAddress;
  if (name && address) return `${name} <${address}>`;
  return address || name || '';
}

function bodyToPlain(body) {
  if (!body) return '';
  const content = body.content || '';
  if (body.contentType === 'html') {
    return content
      .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
      .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll('&nbsp;', ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();
  }
  return String(content).trim();
}

function normalizeGraphMessage(m) {
  const plainBody = bodyToPlain(m.body);
  const html = m.body?.contentType === 'html' ? (m.body?.content || '') : '';
  const links = extractEmailLinks({ body: plainBody, html });
  const flagged = m.flag?.flagStatus === 'flagged';

  return {
    provider: 'microsoft',
    id: m.id,
    threadId: m.conversationId || m.id,
    subject: m.subject || '',
    from: formatGraphAddress(m.from),
    replyTo: '',
    to: (m.toRecipients || []).map(formatGraphAddress).filter(Boolean).join(', '),
    date: m.receivedDateTime || '',
    snippet: m.bodyPreview || '',
    body: plainBody.slice(0, 4000),
    links,
    labels: [
      ...(m.isRead ? [] : ['UNREAD']),
      ...(flagged ? ['STARRED'] : [])
    ],
    url: m.webLink || outlookWebUrl(m.id)
  };
}

async function graphFetchJson(url, accessToken, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: graphHeaders(accessToken, init.headers)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API erro ${res.status}: ${err}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function buildInboxFilter(timeWindow, includeFocused) {
  const since = graphTimeIso(timeWindow);
  let f = `isRead eq false and receivedDateTime ge ${since}`;
  if (includeFocused) f += " and inferenceClassification eq 'focused'";
  return f;
}

function clearArchiveFolderCache() {
  archiveFolderIdCache = null;
}

async function listInboxMessageIds(accessToken, filter, maxIds = 200) {
  const params = new URLSearchParams({
    '$filter': filter,
    '$orderby': 'receivedDateTime desc',
    '$select': 'id',
    '$top': '100'
  });
  let url = `${GRAPH_BASE}/me/mailFolders/inbox/messages?${params}`;
  const ids = [];

  while (url && ids.length < maxIds) {
    const data = await graphFetchJson(url, accessToken);
    for (const row of data.value || []) {
      if (row.id) ids.push(row.id);
      if (ids.length >= maxIds) break;
    }
    url = ids.length < maxIds ? data['@odata.nextLink'] : null;
  }

  return { ids, total: ids.length };
}

async function listSearchMessageIds(accessToken, queryText, maxIds = 200) {
  const q = String(queryText || '').trim();
  if (!q) return { ids: [], total: 0 };

  const params = new URLSearchParams({
    '$search': `"${q.replaceAll('"', '')}"`,
    '$select': 'id',
    '$top': '100'
  });
  let url = `${GRAPH_BASE}/me/messages?${params}`;
  const ids = [];
  const headers = { ConsistencyLevel: 'eventual' };

  while (url && ids.length < maxIds) {
    const res = await fetch(url, { headers: graphHeaders(accessToken, headers) });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Graph pesquisa erro ${res.status}: ${err}`);
    }
    const data = await res.json();
    for (const row of data.value || []) {
      if (row.id) ids.push(row.id);
      if (ids.length >= maxIds) break;
    }
    url = ids.length < maxIds ? data['@odata.nextLink'] : null;
  }

  return { ids, total: ids.length };
}

async function hydrateGraphMessages(accessToken, ids) {
  const select =
    'id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead,flag,webLink';

  const results = await Promise.all(ids.map(async (id) => {
    try {
      const m = await graphFetchJson(
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}?$select=${select}`,
        accessToken
      );
      return normalizeGraphMessage(m);
    } catch {
      return null;
    }
  }));

  return results.filter(Boolean);
}

async function fetchMessagePage(accessToken, listIdsFn, { page = 0, pageSize = 20, maxMessages = 200 } = {}) {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20;
  const { ids, total } = await listIdsFn(accessToken, maxMessages);
  const start = safePage * safeSize;
  const pageIds = ids.slice(start, start + safeSize);
  const emails = pageIds.length ? await hydrateGraphMessages(accessToken, pageIds) : [];
  return { emails, total, page: safePage, pageSize: safeSize };
}

async function fetchRecentMessagesPage(
  accessToken,
  { timeWindow = 'today', page = 0, pageSize = 20, maxMessages = 200 } = {}
) {
  let filter = buildInboxFilter(timeWindow, true);
  let listFn = async (token, max) => {
    try {
      return await listInboxMessageIds(token, filter, max);
    } catch (e) {
      if (!String(e.message).includes('inferenceClassification')) throw e;
      filter = buildInboxFilter(timeWindow, false);
      return listInboxMessageIds(token, filter, max);
    }
  };
  return fetchMessagePage(accessToken, listFn, { page, pageSize, maxMessages });
}

async function fetchMessagesBySearchQueryPage(
  accessToken,
  queryText,
  { page = 0, pageSize = 20, maxMessages = 200 } = {}
) {
  const q = typeof queryText === 'string' ? queryText.trim() : '';
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20;
  if (!q) return { emails: [], total: 0, page: 0, pageSize: safeSize };

  const listFn = (token, max) => listSearchMessageIds(token, q, max);
  return fetchMessagePage(accessToken, listFn, { page, pageSize, maxMessages });
}

async function getArchiveFolderId(accessToken) {
  if (archiveFolderIdCache) return archiveFolderIdCache;
  const data = await graphFetchJson(`${GRAPH_BASE}/me/mailFolders/archive`, accessToken);
  if (!data?.id) throw new Error('Pasta arquivo Microsoft não encontrada.');
  archiveFolderIdCache = data.id;
  return archiveFolderIdCache;
}

async function archiveMessage(accessToken, messageId) {
  const destinationId = await getArchiveFolderId(accessToken);
  await graphFetchJson(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/move`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ destinationId })
    }
  );
  await graphFetchJson(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({ isRead: true })
    }
  );
}

async function setMessageStar(accessToken, messageId, star) {
  await graphFetchJson(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        flag: { flagStatus: star ? 'flagged' : 'notFlagged' }
      })
    }
  );
}

async function createReplyDraft(accessToken, messageId, bodyPlainUtf8) {
  const body = typeof bodyPlainUtf8 === 'string' ? bodyPlainUtf8.trim() : '';
  if (!body) throw new Error('Corpo do rascunho vazio.');

  const draft = await graphFetchJson(
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/createReply`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        message: {
          body: {
            contentType: 'Text',
            content: body
          }
        }
      })
    }
  );

  const threadId = draft?.conversationId || messageId;
  const openUrl = draft?.webLink || outlookWebUrl(messageId);
  return { threadId, openUrl };
}

module.exports = {
  fetchRecentMessagesPage,
  fetchMessagesBySearchQueryPage,
  archiveMessage,
  setMessageStar,
  createReplyDraft,
  clearArchiveFolderCache
};
