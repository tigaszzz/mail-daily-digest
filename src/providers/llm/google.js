// Google Gemini provider — native fetch, no SDK dependency.
const {
  SYSTEM_PROMPT, NEWSLETTER_PROMPT,
  buildUserPrompt, buildNewsletterPrompt,
  parseJSON, parseNewsletterJSON, fallbackItems
} = require('./prompts');

async function complete(system, userPrompt, { apiKey, model = 'gemini-2.5-flash' } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${system}\n\n${userPrompt}` }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
