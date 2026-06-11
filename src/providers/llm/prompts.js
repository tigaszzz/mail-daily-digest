// Shared prompt + parsing helpers used by all LLM providers.
// System prompt in English for best instruction-following.
// Output always in European Portuguese.

const { extractEmailLinks, formatLinkDestinations } = require('../../services/email-links');

const SYSTEM_PROMPT = `You are an expert email analyst and assistant.
Always respond ONLY with valid JSON. No markdown, no explanation, no preamble.
Always write summary, tasks, warnings, labels and draft_reply in European Portuguese.

LEGITIMACY RULES — evaluate these FIRST before any other field:
- needs_reply: true ONLY if a real person sent a direct message requiring a genuine response
- draft_reply: MUST be empty string "" for emails that:
    * Request passwords, credentials, banking data or sensitive personal information
    * Are phishing, scam, fraud or use artificial urgency ("account blocked", "you won a prize")
    * Are from unknown senders with unusual requests or requests to click links
    * Are newsletters, marketing or automated notifications disguised as personal messages
- warning: short string in Portuguese if the email is suspicious or potentially malicious; empty string if legitimate
- For suspicious emails: priority "fyi", needs_reply false, tasks [], draft_reply ""

CATEGORY RULES — assign exactly one category per email:
- important: a real person or institution writing about something that matters to the user
  (requests, replies, invoices to act on, deadlines, appointments, legal/financial matters)
- transactional: automated but legitimate — receipts, confirmations, security alerts,
  shipping updates, promotional offers from services the user uses
- newsletter: editorial digests, curated content, job alerts, event invitations from mailing lists

TRANSACTIONAL LABEL — for category transactional or newsletter, set transactional_label to exactly one of:
"Promoção" (marketing/offers), "Receipt" (receipts/invoices paid), "Auto" (automated alerts/notifications), "Newsletter" (editorial).
For category important set transactional_label to "".

PRIORITY RULES — assign exactly one value per email (be conservative with "urgent"):
- urgent: real emergency only — hard deadline within 24 hours, explicit "urgente"/"ASAP" from a known person (not marketing), legal/financial/account risk, or a meeting/deadline in the next 24h that requires immediate action. Never for newsletters, ads, or artificial urgency.
- today: should be handled today — direct reply expected, time-sensitive request, appointment or deadline tomorrow, important document to approve/review today.
- this_week: actionable but not today — can wait a few days, follow-up this week, low-urgency requests, optional reading with mild interest.
- fyi: informational only — newsletters, receipts, automated notifications, marketing (legitimate), no action needed this week.

PRIMARY ACTION — primary_action_label: a short call-to-action in Portuguese (2-4 words, e.g. "Pagar agora",
"Confirmar presença", "Rever documento") ONLY when the email has one obvious concrete action with priority
urgent or today. Empty string otherwise.

TASK RULES — be generous with tasks:
- Always suggest at least one task if the email has any actionable content
- Examples: "Responder ao email", "Verificar documento no Netbanco", "Avaliar oferta antes de [date]",
  "Rever ofertas de emprego em [company]", "Ler artigo sobre [topic]", "Cancelar subscrição se não for relevante"
- Only use empty tasks [] for pure spam with zero actionable content

LINK RULES — mandatory when links_in_email lists URLs (not "(none detected)"):
- Every actionable email with links_in_email MUST have at least one task that names the destination (brand + host), e.g. "Ver imóveis no Idealista (idealista.pt)".
- Use links_in_email for wording; never invent URLs not listed there.
- Prefer brand/host over raw URLs; add a short action (ver, confirmar, rever, candidatar).
- Several destinations → separate tasks or one task with destinations joined by " · ".
- Phishing/suspicious emails: tasks [] and do not suggest clicking links.

OUTPUT SCHEMA — return exactly this JSON array, one object per email:
[
  {
    "id": "string — original message id",
    "priority": "urgent" | "today" | "this_week" | "fyi",
    "category": "important" | "transactional" | "newsletter",
    "transactional_label": "Promoção" | "Receipt" | "Auto" | "Newsletter" | "",
    "primary_action_label": "string — short Portuguese CTA or empty string",
    "summary": "string — 3 to 5 sentences in Portuguese: context, main request, what is at stake. May use **bold** for amounts, dates and names.",
    "warning": "string — short Portuguese warning if suspicious, empty string if legitimate",
    "needs_reply": boolean,
    "tasks": ["string — concrete action in Portuguese; include site/link destination when the task involves a URL from the email"],
    "calendar_events": ["string — date or meeting detected, e.g. 'Pagar fatura NOS — 28 de maio'"],
    "draft_reply": "string — complete reply with greeting, body and sign-off if needs_reply true, empty string otherwise"
  }
]`;

const NEWSLETTER_PROMPT = `You receive N newsletter emails: subject, sender, body excerpt (max 800 chars each).
Respond ONLY with strict JSON (no markdown, no preamble):
{
  "overview": "1 parágrafo em PT-PT (60–90 palavras) sintetizando os temas dominantes. Tom: jornalístico, sem emojis. Destaca 1–2 nomes próprios em **bold**. Não menciona promoções ou newsletters individuais — apenas tendências.",
  "sources": [
    { "name": "<sender em ≤ 22 chars>", "meta": "<contagem ou tema em ≤ 4 palavras>" }
  ]
}
Maximum 6 sources. No text outside the JSON.`;

function formatLinksBlock(links) {
  if (!links.length) return 'links_in_email: (none detected)';
  const lines = links.map((l, i) => `  ${i + 1}. ${l.host} — ${l.url}`);
  return `links_in_email:\n${lines.join('\n')}`;
}

function buildUserPrompt(batch) {
  const lines = batch.map((e, i) => {
    const links = e.links?.length
      ? e.links
      : extractEmailLinks({ body: e.body });
    const linkHint = links.length
      ? `\nlink_destinations_for_tasks: ${formatLinkDestinations(links)}`
      : '';
    return `
--- EMAIL ${i + 1} ---
id: ${e.id}
from: ${e.from}${e.replyTo ? `\nreply-to: ${e.replyTo}` : ''}
subject: ${e.subject}
snippet: ${e.snippet || ''}
${formatLinksBlock(links)}${linkHint}
body:
${(e.body || '').slice(0, 800)}`;
  }).join('\n');

  return `Analyse these ${batch.length} email(s) and return the JSON array.\nStart with [ and end with ]. No other text.\n${lines}`;
}

function buildNewsletterPrompt(newsletters) {
  const lines = newsletters.map((e, i) => `
--- NEWSLETTER ${i + 1} ---
from: ${e.from}
subject: ${e.subject}
excerpt:
${(e.body || e.snippet || '').slice(0, 800)}`).join('\n');

  return `Synthesise these ${newsletters.length} newsletter(s) and return the JSON object.\nStart with { and end with }. No other text.\n${lines}`;
}

function stripJsonFences(raw) {
  return (raw || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function parseJSON(raw) {
  const clean = stripJsonFences(raw);

  // Try array first
  const arrMatch = /\[[\s\S]*\]/.exec(clean);
  if (arrMatch) return JSON.parse(arrMatch[0]);

  // Fallback: try wrapped object {"items": [...]}
  const obj = JSON.parse(clean);
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj)) return obj;
  throw new Error('No JSON array found in response');
}

function parseNewsletterJSON(raw) {
  const clean = stripJsonFences(raw);
  const objMatch = /\{[\s\S]*\}/.exec(clean);
  if (!objMatch) throw new Error('No JSON object found in newsletter response');
  const obj = JSON.parse(objMatch[0]);
  const overview = typeof obj.overview === 'string' ? obj.overview.trim() : '';
  if (!overview) throw new Error('Newsletter synthesis without overview');
  const sources = Array.isArray(obj.sources)
    ? obj.sources
        .filter((s) => s && typeof s.name === 'string')
        .slice(0, 6)
        .map((s) => ({ name: s.name.slice(0, 22), meta: String(s.meta || '').slice(0, 40) }))
    : [];
  return { overview, sources };
}

function fallbackItems(messages, reason) {
  console.warn('[llm] Falling back to raw snippets:', reason);
  return messages.map(m => ({
    id: m.id,
    priority: 'fyi',
    category: 'transactional',
    transactional_label: 'Auto',
    primary_action_label: '',
    summary: m.snippet || '',
    warning: '',
    needs_reply: false,
    tasks: [],
    calendar_events: [],
    draft_reply: ''
  }));
}

module.exports = {
  SYSTEM_PROMPT,
  NEWSLETTER_PROMPT,
  buildUserPrompt,
  buildNewsletterPrompt,
  parseJSON,
  parseNewsletterJSON,
  fallbackItems,
  formatLinksBlock
};
