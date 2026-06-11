// Anthropic provider — native fetch, no SDK dependency.
const {
  SYSTEM_PROMPT, NEWSLETTER_PROMPT,
  buildUserPrompt, buildNewsletterPrompt,
  parseJSON, parseNewsletterJSON, fallbackItems
} = require('./prompts');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

async function complete(system, userPrompt, { apiKey, model = 'claude-haiku-4-5' } = {}) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0.1,
      system,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function analyzeEmails(messages, opts = {}) {
  if (!messages.length) return [];
  const raw = await complete(SYSTEM_PROMPT, buildUserPrompt(messages), opts);
  try {
    return parseJSON(raw);
  } catch (e) {
    return fallbackItems(messages, e.message);
  }
}

async function analyzeNewsletters(messages, opts = {}) {
  if (messages.length < 2) return null;
  const raw = await complete(NEWSLETTER_PROMPT, buildNewsletterPrompt(messages), opts);
  return parseNewsletterJSON(raw);
}

module.exports = { analyzeEmails, analyzeNewsletters };
