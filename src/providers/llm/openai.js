// OpenAI provider — native fetch (sem pacote npm `openai`).
const {
  SYSTEM_PROMPT, NEWSLETTER_PROMPT,
  buildUserPrompt, buildNewsletterPrompt,
  parseJSON, parseNewsletterJSON, fallbackItems
} = require('./prompts');

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

async function complete(system, userPrompt, { apiKey, model = 'gpt-4.1-mini' } = {}, { jsonObject = false } = {}) {
  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 2000,
      ...(jsonObject ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
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
  const raw = await complete(
    NEWSLETTER_PROMPT, buildNewsletterPrompt(messages), opts, { jsonObject: true }
  );
  return parseNewsletterJSON(raw);
}

module.exports = { analyzeEmails, analyzeNewsletters };
