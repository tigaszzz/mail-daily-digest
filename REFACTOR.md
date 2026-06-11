# REDESIGN — Briefing Colorido (v0.5)

> Engineering prompt. Paste into Cursor / Claude Code at the root of `gmail-daily-digest`. Visual reference: `mockups/colorful-sample.html` (Confetti Cream palette · iris brand + multi-color categories). Estimated effort: 8–12h end-to-end.

---

## 1 · Context

The Mail Digest app is currently a **2-pane email client** (sidebar list + detail panel). We are pivoting to a **single-column "morning briefing" paradigm**: the app opens to a scrolling document with three sections — `O que precisa de ti`, `O que eu proponho`, `O que eu tratei` — plus a floating ask bar at the bottom that previews a future conversation mode.

The app must look indistinguishable from `mockups/colorful-sample.html` once changes are applied. That mockup is the canonical visual source. When in doubt, open it side-by-side and match it.

This refactor **incorporates Iterations 1 (auto-categorization) and 2 (newsletter compression) from `ITERATIONS.md`** because the new layout requires them. Iterations 3 (follow-ups) and 4 (reply queue) remain separate and will dock into the briefing structure later.

> **Project reality notes (jun 2026):** providers are Anthropic / OpenAI / Google only — local models (WebLLM/Gemma) and Ollama were removed from the project and must NOT be reintroduced. The app also supports **Outlook personal (Microsoft Graph)** via the `mail:*` IPC router and a Gmail+Outlook login gate — both must survive this refactor. API keys live in the **OS keychain (keytar)**, not in electron-store.

---

## 2 · Visual System

### 2.1 Replace the entire `:root` token block in `src/renderer/styles.css`

```css
:root {
  /* Foundation — warm cream paper */
  --bg:       #faf6ee;
  --bg2:      #ffffff;
  --bg3:      #f3ede0;
  --bg-rail:  #f6f1e6;
  --border:   rgba(20,17,13,0.10);
  --border2:  rgba(20,17,13,0.16);
  --border3:  rgba(20,17,13,0.28);
  --ink:      #14110d;
  --text:     #14110d;
  --text2:    #4a4540;
  --text3:    #7a7068;

  /* Brand — iris violet (monday.com-inspired) */
  --brand:     #6c5cf0;
  --brand-2:   #5546d4;
  --brand-on:  #ffffff;
  --brand-bg:  #efeaff;
  --brand-tint:#f5f1ff;

  /* Category palette — each owns one part of the digest */
  --urgent:    #e0444c;   --urgent-2:  #c2353d;   --urgent-bg: #fde7e9;
  --sunset:    #f59e0b;   --sunset-2:  #d48409;   --sunset-bg: #fff0d0;
  --emerald:   #10b981;   --emerald-2: #099268;   --emerald-bg:#d6f4e8;
  --sky:       #4f7ce5;   --sky-2:     #3961c6;   --sky-bg:    #e0eaff;
  --grape:     #a855f7;   --grape-2:   #8636d3;   --grape-bg:  #f1e3ff;
  --rose:      #f43f5e;   --rose-2:    #d12e4d;   --rose-bg:   #ffe1e6;
  --slate:     #6b88a0;   --slate-bg:  #e7eef4;
}
```

### 2.2 Replace font imports in `src/renderer/index.html`

> **Estado actual:** fontes self-hosted — woff2 variáveis em `src/renderer/fonts/`,
> declaradas em `fonts/fonts.css` (sem CDN; CSP `font-src 'self'`).

```html
<link rel="stylesheet" href="fonts/fonts.css" />
```

Replace ALL font-family rules across `styles.css`:
- Display / titles → `'Fraunces', serif` with `font-variation-settings: 'opsz' 144, 'SOFT' 30-50` for hero, `'opsz' 36, 'SOFT' 30` for card subjects.
- UI / body → `'Inter Tight', sans-serif`, base weight **450**, line-height **1.55–1.65**.
- Metadata / mono → `'JetBrains Mono', monospace`.

**Remove all references to DM Serif Display, Syne, and DM Mono.** They no longer exist in this project.

### 2.3 Component CSS

Copy the CSS for these components verbatim from `mockups/colorful-sample.html` into `src/renderer/styles.css`, grouped in this order:

```
.topbar, .brand-mark, .brand-dot, .brand-name, .icon-btn, .avatar
.page (max-width 800px, padding 40px 32px 80px)
.hero, .hero-stripe (rainbow), .hero-body, .hero-date, .stats, .stat
.section, .section-head, .section-dot
.card, .card-stripe, .card-body, .card-meta, .card-summary, .card-actions
.badge (.urgent/.today/.week/.fyi/.news/.event/.followup/.ai)
.btn, .btn-primary, .btn-brand, .btn-urgent (with svg sizing)
.event-card, .event-date, .event-day, .event-month
.task-card (+ .done state), .task-check
.news-card (+ .news-summary italic Fraunces), .news-sources, .news-source
.trans-list, .trans-row, .trans-dot
.convo-hint
.ask-bar (fixed bottom, centered, dark pill)
```

Do not modify the values when copying — match the mockup exactly.

---

## 3 · Schema Changes (LLM output)

The new layout requires a richer schema. The single source of truth is now this briefing object:

```jsonc
{
  "briefing": {
    "salutation_time": "morning|afternoon|evening",
    "summary": "Li 23 emails desde ontem. 2 precisam de ti, 4 podem esperar.",
    "stats": {
      "urgent": 0,
      "today": 2,
      "this_week": 4,
      "handled": 17,
      "estimated_minutes": 11
    }
  },
  "needs_you": [
    {
      "id": "<gmail_msg_id>",
      "priority": "urgent|today|this_week",
      "category": "important|transactional",
      "sender": "NOS",
      "address": "info@info.nos.pt",
      "date_iso": "2026-05-23T14:02:00Z",
      "subject": "Não recebemos o pagamento da fatura NOS",
      "summary": "A NOS diz que a fatura de €67.40 não foi paga. Prazo 28 Mai...",
      "actions": ["primary", "remind", "view", "ignore"],
      "primary_action_label": "Pagar agora",
      "draft_reply": null
    }
  ],
  "proposed": {
    "events": [
      {
        "day": 28,
        "month_short": "Mai",
        "title": "Pagar fatura NOS · €67.40",
        "meta": "extraído de email · sugestão 09:00 · lembrete 1 dia antes",
        "source_id": "<msg_id>",
        "color": "grape"
      }
    ],
    "tasks": [
      {
        "text": "Responder ao Lutz sobre certificate monitoring",
        "suggested_time": "hoje à tarde",
        "source_id": "<msg_id>",
        "done": false
      }
    ]
  },
  "handled": {
    "newsletter_synthesis": {
      "overview": "Esta semana o ciclo tech foi dominado por **Andrej Karpathy a juntar-se à Anthropic**...",
      "sources": [
        { "name": "Medium Daily Digest", "meta": "3 artigos" },
        { "name": "Chez Vous Paris", "meta": "eventos dom." }
      ]
    },
    "transactional": [
      {
        "id": "<msg_id>",
        "category": "Promoção|Receipt|Auto|Newsletter",
        "color": "sunset|emerald|slate|sky",
        "sender": "Uber",
        "text": "last chance, deals won't wait",
        "status": "arquivado|marcado · revisar"
      }
    ]
  }
}
```

### 3.1 Update `src/providers/llm/prompts.js`

The new `SYSTEM_PROMPT` instructs the model in PT-PT to:

- Classify each email into `important | transactional | newsletter` AND a priority `urgent | today | this_week | fyi`.
- `needs_you`: items with priority ∈ {urgent, today, this_week} AND category ∈ {important, transactional}. Cap at 8.
- `proposed.events`: any datetime, deadline, or appointment mentioned in `needs_you` items.
- `proposed.tasks`: action items derived from `needs_you` items, max 6.
- `handled.transactional`: items with category=transactional AND priority=fyi. Cap at 12.
- `handled.newsletter_synthesis`: filled by the second pass (see §4).
- `briefing.summary`: ≤ 28 palavras, em PT-PT, factual e directo.
- Estimated minutes = `needs_you.length × 3.5` rounded.

Add a fallback: if the model returns an old-shape array (current `items[]`), the renderer should detect and migrate it to `needs_you[]` with sensible defaults.

---

## 4 · Two-pass newsletter compression

After the first classification pass:

1. Filter messages with `category === "newsletter"`.
2. If `count >= 2`, call the LLM a second time with `NEWSLETTER_PROMPT` (defined below). Merge response into `handled.newsletter_synthesis`.
3. If `count < 2` or second call fails, omit `newsletter_synthesis` and put the items into `handled.transactional` with `category: "Newsletter"`.

### 4.1 `NEWSLETTER_PROMPT`

```
Recebes N newsletter emails: subject, sender, body excerpt (≤ 800 chars each).
Produz JSON estrito:
{
  "overview": "1 parágrafo em PT-PT (60–90 palavras) sintetizando os temas dominantes. Tom: jornalístico, sem emojis. Destaca 1–2 nomes próprios em **bold**. Não menciona promoções ou newsletters individuais — apenas tendências.",
  "sources": [
    { "name": "<sender em ≤ 22 chars>", "meta": "<contagem ou tema em ≤ 4 palavras>" }
  ]
}
Máximo 6 sources. Sem texto fora do JSON.
```

Implement this for ALL providers (Anthropic, OpenAI, Google). Use the same JSON-mode flags as the first pass.

---

## 5 · Layout — `src/renderer/index.html`

Rewrite the body to:

```html
<header class="topbar">
  <div class="brand-mark">
    <span class="brand-dot"></span>
    <span class="brand-name">Mail Digest</span>
  </div>
  <div class="top-meta">
    <button class="icon-btn" id="btn-refresh" title="Actualizar"><!-- SVG --></button>
    <button class="icon-btn" id="btn-settings" title="Definições"><!-- SVG --></button>
    <div class="avatar" id="avatar"><div class="avatar-inner">TI</div></div>
  </div>
</header>

<main class="page" id="briefing-root">
  <!-- renderer.js mounts here -->
</main>

<div class="ask-bar" id="ask-bar">
  <div class="ask-prompt"><strong>Pergunta algo</strong> — ex: "o que recebi do banco esta semana?"</div>
  <span class="ask-kbd">⌘ K</span>
  <button class="ask-go" title="Falar"><!-- SVG arrow --></button>
</div>

<!-- Settings modal stays as overlay, restyled to match new tokens -->
<div class="modal" id="settings-modal" hidden>...</div>
```

---

## 6 · `src/renderer/renderer.js`

Replace the existing master-detail controller with a function `renderBriefing(briefing)` that mounts sections into `#briefing-root`:

```js
function renderBriefing(b) {
  const root = document.getElementById('briefing-root');
  root.innerHTML = '';
  root.appendChild(renderHero(b.briefing, b.stats));
  if (b.needs_you?.length) root.appendChild(renderNeedsYou(b.needs_you));
  if (b.proposed?.events?.length || b.proposed?.tasks?.length)
    root.appendChild(renderProposed(b.proposed));
  if (b.handled?.newsletter_synthesis || b.handled?.transactional?.length)
    root.appendChild(renderHandled(b.handled));
  root.appendChild(renderConvoHint());
}
```

Each sub-renderer produces the exact DOM from the mockup. Use `document.createElement` (no innerHTML for user-supplied strings — escape). Wire button click handlers to IPC events:

- `Pagar agora` / primary action → `window.api.action('primary', { id })`
- `Lembrete` → `window.api.action('remind', { id, day, month })`
- `Adicionar` (event) → `window.api.calendar.add({ event })`
- `Aceitar` (task) → `window.api.task.accept({ task })`
- `Ignorar` → `window.api.action('ignore', { id })`
- `Falar com o assistente` / ask bar → `window.api.convo.open()` (stub: opens placeholder modal)

For this iteration, IPC handlers in `main.js` log and return `{ ok: true }`. Real integrations are roadmap items.

### 6.1 Hero greeting logic

```js
const hour = new Date().getHours();
const salutation = hour < 12 ? 'Bom dia' : hour < 19 ? 'Boa tarde' : 'Boa noite';
const firstName = (settings.displayName || 'Tiago').split(' ')[0];
// Render: <h1>{salutation}, <em>{firstName}</em>.</h1>
```

Apply the gradient text effect on `<em>` via the class already in the mockup CSS.

### 6.2 Stats

```js
[
  { key: 'urgent',    label: ['Urgentes',   stats.urgent === 0 ? 'nada urgente' : `${stats.urgent} por resolver`], cls: 'urgent', n: stats.urgent },
  { key: 'today',     label: ['Hoje',       'precisam de ti'], cls: 'today',  n: stats.today },
  { key: 'this_week', label: ['Esta semana','podem esperar'],  cls: 'week',   n: stats.this_week },
  { key: 'handled',   label: ['Tratei',     'já arquivado'],   cls: 'fyi',    n: stats.handled }
]
```

---

## 7 · Files to change

| File | Action |
|------|--------|
| `src/renderer/index.html` | REWRITE — new structure, new font imports, restyled settings modal |
| `src/renderer/styles.css` | REWRITE — new tokens + all components from mockup |
| `src/renderer/renderer.js` | REWRITE — `renderBriefing` + sub-renderers + IPC wiring |
| `src/providers/llm/prompts.js` | UPDATE — new `SYSTEM_PROMPT` + `NEWSLETTER_PROMPT` + safeParse migration |
| `src/providers/llm/anthropic.js` | UPDATE — `analyzeEmails` returns briefing schema; second pass for newsletters |
| `src/providers/llm/openai.js` | UPDATE — same as above with `response_format: { type: 'json_object' }` |
| `src/providers/llm/google.js` | UPDATE — same with `responseMimeType: 'application/json'` |
| `src/main.js` | UPDATE — new IPC channels: `action`, `calendar:add`, `task:accept`, `convo:open` (all stubs returning `{ok:true}`) |
| `DESIGN.md` | REWRITE — document new tokens, fonts, layout, exceptions |
| `README.md` | UPDATE — screenshot section now references briefing UI |

Do NOT touch: `src/services/auth-pkce.js`, `src/services/auth-microsoft-pkce.js`, `src/services/oauth-loopback.js`, `src/services/gmail.js`, `src/services/graph-mail.js`, `src/providers/llm/index.js` (interface), OAuth flows, keychain logic, the `mail:*` IPC router, electron-store schema (other than adding a `displayName` field). The Gmail+Outlook login gate must be preserved (restyled to the new tokens).

---

## 8 · Step-by-step plan

1. **Tokens & fonts.** Update `index.html` font imports. Replace `:root` block in `styles.css`. Boot the app — UI breaks visually but no JS errors.
2. **Layout skeleton.** Rewrite `index.html` body. Stub `renderer.js` with hard-coded sample briefing JSON (copy from mockup). Verify hero + stats + sections render.
3. **Port component CSS.** Copy every component class from `colorful-sample.html` to `styles.css`. Match the mockup pixel for pixel.
4. **First-pass LLM update.** Update `SYSTEM_PROMPT` in `prompts.js`. Test with each provider. Stats must populate. `needs_you` and `handled.transactional` must split correctly.
5. **Second-pass newsletter compression.** Add `NEWSLETTER_PROMPT` and the two-pass logic to each provider module. Test with a real digest that has ≥3 newsletters.
6. **renderBriefing function.** Replace stub data with real briefing object from IPC. Verify the renderer reacts to provider switching.
7. **IPC stubs.** Wire all action buttons. For now, main logs and returns ok. Add a console toast in the renderer to confirm the action fired.
8. **Floating ask bar.** Visually present, opens a modal "Conversation mode em breve" on click. Stub for later iteration.
9. **Settings modal.** Restyle to match new tokens. Provider switcher logic unchanged.
10. **Smoke test all providers.** Claude, GPT, Gemini. Verify briefing renders + stats accurate + no JS errors.
11. **Update `DESIGN.md`.** Replace content. Document the rainbow stripe and gradient text as deliberate exceptions to "no gradients".
12. **Commit.** `feat(renderer): pivot to briefing layout · colorful-sample palette · two-pass LLM`.

---

## 9 · Acceptance criteria

- [ ] App opens to briefing view. No sidebar list visible.
- [ ] Hero shows time-aware greeting `Bom dia/tarde/noite, {name}.` with brand-gradient `<em>` on the first-name.
- [ ] Rainbow stripe at top of hero card.
- [ ] 4 colored stat pills with tabular Fraunces numbers.
- [ ] "O que precisa de ti" renders only when `needs_you.length > 0`. Each card has colored top stripe matching `priority`.
- [ ] "O que eu proponho" renders only when events or tasks exist. Events use grape, tasks use sunset, done tasks use emerald.
- [ ] "O que eu tratei" shows newsletter compression card (italic Fraunces summary + sources grid) + transactional list with colored dots.
- [ ] Convo hint card visible above the floating ask bar.
- [ ] Floating ask bar always visible at bottom, centred desktop / full-width mobile.
- [ ] Settings reachable via icon-btn in topbar.
- [ ] All providers (Anthropic, OpenAI, Google) return valid briefing JSON.
- [ ] All text ≥ 4.5:1 contrast on light backgrounds.
- [ ] No emoji as structural icon. All icons are inline SVG.
- [ ] No console errors, no CSP violations, no missing CSS variables.

---

## 10 · DO NOT

- Do NOT keep the old 2-pane sidebar+detail layout. **Delete it.**
- Do NOT use emojis as structural icons. Inline SVG only (16×16 with `stroke="currentColor"`).
- Do NOT add `box-shadow` to cards except `ask-bar` (already in mockup).
- Do NOT introduce new dependencies. Use existing fetch + IPC + electron-store.
- Do NOT change OAuth flow, Gmail fetch logic, or provider abstraction interface.
- Do NOT rename existing IPC channels for settings/auth/gmail/digest. ADD new channels.
- Do NOT inline CSS in `index.html`. All CSS lives in `styles.css`.
- Do NOT cache the briefing JSON under the old `items[]` shape. Migrate gracefully.
- Do NOT remove the provider switcher in settings.
- Do NOT skip the second LLM pass for newsletters — make it conditional on `newsletterCount >= 2`, but don't omit it entirely.
- Do NOT reintroduce local models (WebLLM/Gemma) or Ollama — APIs premium only (decisão definitiva, ver AGENT.md).

---

## 11 · Future iteration slots (pre-allocated)

- **Follow-ups** (ITERATIONS.md #3) will add a fourth section between `proposed` and `handled`, key `standby[]`. Pre-allocate render order: hero → needs_you → proposed → **standby** → handled.
- **Reply queue** (ITERATIONS.md #4) renders at the very top of `needs_you[]` with badge `Pendente`. Add field `briefing.reply_queue_count` for the hero summary line.
- **Conversation mode** (Direction 3 in `mockups/radical-layouts.html`) replaces the placeholder modal with a real chat panel using the same providers. Define IPC channels now: `convo:open`, `convo:send`, `convo:history`. Stub all three.
- **Voice fingerprint** sits on top of `draft_reply` generation. No layout change needed.

---

## 12 · Notes on tokens not to break

The settings panel keeps these existing keys; do not rename:

- electron-store: `provider` (`anthropic|openai|google`), `anthropicModel` / `openaiModel` / `googleModel`, `googleClientId`, `microsoftClientId`, `mailProvider` (`gmail|microsoft`), `autoRefreshHour`
- **OS keychain (keytar)** — nunca em electron-store: `anthropic-api-key`, `openai-api-key`, `google-api-key`, `google-client-secret`, `microsoft-client-secret`

Add ONE new key (electron-store):

- `displayName` — string, default `''`, used for the greeting. Optional in UI.

---

End of prompt.
