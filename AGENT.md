# Gmail Daily Digest — AGENT.md

## Ficheiros de referência obrigatórios

Antes de escrever qualquer código de UI, lê sempre estes dois ficheiros:

| Ficheiro | Para quê |
|---|---|
| `DESIGN.md` | Sistema de design completo — fontes, cores, componentes, regras |
| `src/renderer/` | UI implementada (`index.html`, `styles.css`, `renderer.js`) |

Nunca tomar decisões visuais (cores, fontes, borders, espaçamentos) sem consultar o DESIGN.md.

---

## O que é este projecto
App Electron cross-platform (macOS, Windows, Linux) que gera um resumo diário
do Gmail do utilizador, classifica emails por prioridade, sugere tarefas,
detecta eventos de calendário e gera rascunhos de resposta em português.

## Decisões de arquitectura (não alterar sem justificação explícita)

### AI — apenas APIs premium
Decisão definitiva: a app usa exclusivamente APIs cloud premium; não introduzir
modelos locais nem runtimes locais.

Providers suportados (por ordem de recomendação para PT):
1. **Anthropic — claude-haiku-4-5** (recomendado — melhor PT, mais barato)
2. **Google Gemini — gemini-2.5-flash** (alternativa com free tier)
3. **OpenAI — gpt-4.1-mini** (alternativa)

### Credenciais — nunca em código ou ficheiros de texto
- API keys guardadas exclusivamente na keychain do SO via keytar
- Google OAuth tokens guardados via keytar
- Ficheiro .env apenas para desenvolvimento local (está no .gitignore)
- Nunca interpolar credenciais em HTML ou logs

### Gmail — REST API nativa
- Usa fetch() nativo, sem googleapis nem imapflow
- OAuth2 PKCE com loopback `http://127.0.0.1:<porta>/oauth/callback` por omissão (RFC 8252); fallback scheme `com.googleusercontent.apps.<id>:/oauth/callback` para builds empacotadas
- Janelas temporais: `today` (after:YYYY/MM/DD), `week` (newer_than:7d), `month` (newer_than:1m) + pesquisa livre Gmail
- Query digest: `<janela> in:inbox is:unread category:primary`
- Máximo 200 IDs indexados, paginação de 20 por página (DIGEST_PAGE_SIZE)
- Body armazenado até 4000 chars; truncado a 800 chars no user prompt do LLM

---

## Stack técnico

| Camada | Tecnologia |
|---|---|
| Desktop | Electron (processo main em Node.js, renderer vanilla JS) |
| UI | HTML + CSS + vanilla JS (sem framework React por enquanto) |
| Email | Gmail REST API ou Microsoft Graph (fetch nativo; switch na UI) |
| Auth | OAuth2 PKCE — Google + Microsoft (loopback 127.0.0.1) |
| Tokens | keytar (OS keychain — Mac Keychain / Win Credential Manager) |
| AI | Anthropic / OpenAI / Gemini (ver providers abaixo) |
| Segurança | contextIsolation: true, nodeIntegration: false, contextBridge |

---

## Estrutura do projecto

```
mail-daily-digest/
├── src/
│   ├── main.js                  # Processo principal Electron
│   ├── preload.js               # contextBridge — única ponte main ↔ renderer
│   ├── services/
│   │   ├── auth-pkce.js         # OAuth2 PKCE + loopback server + refresh + keytar
│   │   ├── gmail.js             # Gmail REST API (fetch nativo) — digest + search + drafts
│   │   ├── graph-mail.js        # Microsoft Graph Mail — paridade com gmail.js
│   │   ├── auth-microsoft-pkce.js
│   │   ├── oauth-microsoft-config.js
│   │   ├── mail-types.js        # Shape canónico de mensagem
│   │   ├── email-links.js       # Extração e normalização de links de email
│   │   └── oauth-config.js      # Credenciais OAuth Google (env, store, keytar)
│   ├── providers/
│   │   └── llm/
│   │       ├── index.js         # Dispatcher — batching + enrichment
│   │       ├── anthropic.js     # claude-haiku-4-5
│   │       ├── openai.js        # gpt-4.1-mini
│   │       ├── google.js        # gemini-2.5-flash
│   │       └── prompts.js       # System prompt + buildUserPrompt + parseJSON + fallbackItems
│   └── renderer/
│       ├── index.html           # UI principal + CSP headers
│       ├── renderer.js          # Lógica UI
│       └── styles.css           # Estilos
├── .env                         # Só para dev local (NUNCA commitar)
├── .gitignore                   # Inclui .env e node_modules
├── package.json
└── AGENT.md                     # Este ficheiro
```

---

## IPC — canais permitidos (não adicionar sem actualizar preload.js)

```javascript
// Todos os canais expostos via contextBridge em preload.js
window.electronAPI = {
  gmail: { /* legado — preferir mail */ },
  mail: {
    getProvider:      ()                => ipcRenderer.invoke('mail:get-provider'),
    setProvider:      (p)               => ipcRenderer.invoke('mail:set-provider', p),
    auth:             ()                => ipcRenderer.invoke('mail:auth'),
    fetch:            (opts)            => ipcRenderer.invoke('mail:fetch', opts),
    search:           (payload)         => ipcRenderer.invoke('mail:search', payload),
    getProfile:       ()                => ipcRenderer.invoke('mail:profile'),
    logout:           ()                => ipcRenderer.invoke('mail:logout'),
    archive:          (messageId)       => ipcRenderer.invoke('mail:archive', messageId),
    setStar:          (messageId, star) => ipcRenderer.invoke('mail:set-star', { messageId, star }),
    createReplyDraft: (messageId, body) => ipcRenderer.invoke('mail:create-reply-draft', { messageId, body }),
  },
  llm: {
    analyse:     (emails) => ipcRenderer.invoke('llm:analyse', emails),
    getProvider: ()       => ipcRenderer.invoke('llm:get-provider'),
    setProvider: (cfg)    => ipcRenderer.invoke('llm:set-provider', cfg),
  },
  keychain: {
    get:    (key)       => ipcRenderer.invoke('keychain:get', key),
    set:    (key, val)  => ipcRenderer.invoke('keychain:set', key, val),
    delete: (key)       => ipcRenderer.invoke('keychain:delete', key),
  },
  settings: {
    get: ()    => ipcRenderer.invoke('settings:get'),
    set: (cfg) => ipcRenderer.invoke('settings:set', cfg),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },
  ui: {
    emailContextMenu: (opts) => ipcRenderer.invoke('ui:email-context-menu', opts),
  }
}
```

### Notas sobre IPC

- `gmail:fetch` — `opts.timeWindow`: `'today'` | `'week'` | `'month'`; `opts.page`: número de página (0-based)
- `gmail:search` — `payload.query`: string de pesquisa Gmail livre; `payload.page`: página
- `gmail:create-reply-draft` — cria rascunho RFC-822 no mesmo thread via `users.drafts.create`; devolve `{ threadId, openUrl }`
- `ui:email-context-menu` — abre menu nativo contextual (estrela/arquivo); devolve `{ action, messageId, addStar? }`
- `shell:open-external` — abre URL no browser do SO; valida esquema `http/https`
- `settings:get` — devolve config não-sensível + flags booleanas (`hasAnthropicKey`, `hasGoogleAuth`, etc.)

O renderer não tem acesso directo a Node.js. Tudo passa pelo contextBridge.

---

## Prompt de análise de email

### Princípio
- System prompt em inglês (melhor instruction-following nos modelos)
- Output sempre em português europeu
- Lotes de máximo 5 emails por chamada (evita degradação de qualidade)
- temperature: 0.1 para análise estruturada (JSON)
- temperature: 0.6 para geração de draft

### System prompt (ficheiro: src/providers/llm/prompts.js)

Ver o ficheiro directamente — o system prompt evoluiu e inclui agora:
- **LEGITIMACY RULES** — detecção de phishing/spam
- **PRIORITY RULES** — critérios explícitos para `urgent`/`today`/`this_week`/`fyi`
- **TASK RULES** — gerar pelo menos uma tarefa se o email tiver conteúdo accionável
- **LINK RULES** — quando `links_in_email` está presente, as tarefas devem mencionar destino (marca + host)
- **OUTPUT SCHEMA** — array JSON (igual ao abaixo)

```json
[
  {
    "id": "string — original message id",
    "priority": "urgent" | "today" | "this_week" | "fyi",
    "summary": "string — 3 to 5 sentences in Portuguese",
    "warning": "string — aviso PT se suspeito, string vazia se legítimo",
    "needs_reply": boolean,
    "tasks": ["string — acção concreta em PT; inclui destino se tarefa envolve URL"],
    "calendar_events": ["string — data ou reunião detectada"],
    "draft_reply": "string — resposta completa se needs_reply true, string vazia otherwise"
  }
]
```

### User prompt template (buildUserPrompt em prompts.js)

```javascript
// Por cada email no lote inclui:
// - id, from, reply-to (se existe), subject, snippet
// - links_in_email: lista numerada host → url (ou "(none detected)")
// - link_destinations_for_tasks: string compacta para ajudar o modelo
// - body: truncado a 800 chars
`Analyse these ${batch.length} email(s) and return the JSON array.
Start with [ and end with ]. No other text.

--- EMAIL 1 ---
id: ...
from: ...
subject: ...
snippet: ...
links_in_email:
  1. idealista.pt — https://...
link_destinations_for_tasks: Idealista (idealista.pt)
body:
...`
```

### Parâmetros por provider

```javascript
// Análise estruturada (JSON) — todos os providers
{ temperature: 0.1, max_tokens: 2000 }
```

### Enriquecimento pós-análise (src/providers/llm/index.js)

Após análise, `enrichAnalysisWithLinks` adciona `email_links` a cada item (links relevantes do email normalizados para display na UI) e limpa as tarefas de sufixos de link gerados pelo LLM.

---

## Providers LLM — configuração

### Anthropic (recomendado)

```javascript
// src/providers/llm/anthropic.js
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    temperature: 0.1,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }]
  })
})
const data = await response.json()
return data.content[0].text
```

### OpenAI

```javascript
// src/providers/llm/openai.js
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4.1-mini',
    temperature: 0.1,
    max_tokens: 2000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ]
  })
})
const data = await response.json()
return data.choices[0].message.content
```

### Google Gemini

```javascript
// src/providers/llm/google.js
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\n' + userPrompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
    })
  }
)
const data = await response.json()
return data.candidates[0].content.parts[0].text
```

---

## Gmail — filtros e limites

```javascript
// main.js
const DIGEST_PAGE_SIZE  = 20;   // emails mostrados por página
const MAX_DIGEST_EMAILS = 200;  // IDs indexados por query (paginação server-side)

// providers/llm/index.js
const MAX_BATCH_SIZE = 5;       // emails por chamada LLM (evita degradação de qualidade)

// services/gmail.js — body armazenado e truncado no user prompt
body: body.slice(0, 4000)       // armazenado no objecto email
(e.body || '').slice(0, 800)    // enviado ao LLM em buildUserPrompt

// Query digest dinâmica (gmailDigestTimeClause):
//   today  → after:YYYY/MM/DD in:inbox is:unread category:primary
//   week   → newer_than:7d in:inbox is:unread category:primary
//   month  → newer_than:1m in:inbox is:unread category:primary
// Pesquisa livre: query do utilizador sem modificadores adicionais

// Processamento em lotes — Promise.all por batch, resultados concatenados
const batches = chunk(emails, MAX_BATCH_SIZE)
const results = await Promise.all(batches.map(b => provider.analyzeEmails(b, opts)))
const allResults = results.flat()
```

---

## Parsing do JSON de resposta

Todos os providers devolvem texto — parse defensivo obrigatório (ver `parseJSON` em `prompts.js`):

```javascript
function parseJSON(raw) {
  const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim()
  const arrMatch = clean.match(/\[[\s\S]*\]/)
  if (arrMatch) return JSON.parse(arrMatch[0])
  // fallback: objeto com campo items (alguns modelos envolvem o array)
  const obj = JSON.parse(clean)
  if (Array.isArray(obj.items)) return obj.items
  if (Array.isArray(obj)) return obj
  throw new Error('No JSON array found in response')
}

// Em caso de falha no parse, fallbackItems() devolve um array com snippets brutos
// (priority: 'fyi', needs_reply: false, tasks: []) para não bloquear a UI
```

---

## Segurança — checklist obrigatório

- [ ] contextIsolation: true em todos os BrowserWindows
- [ ] nodeIntegration: false em todos os BrowserWindows
- [ ] Todas as API keys guardadas via keytar, nunca em ficheiros
- [ ] .env no .gitignore
- [ ] CSP definido em index.html (sem unsafe-eval, sem unsafe-inline)
- [ ] OAuth loopback: servidor HTTP efémero em 127.0.0.1 (porto aleatório) — fecha após receber o code
- [ ] OAuth scheme custom (`com.googleusercontent.apps.<id>:`) registado via `setAsDefaultProtocolClient` para builds empacotadas
- [ ] Sem interpolação de conteúdo de email em HTML (risco XSS)
- [ ] Respostas do LLM tratadas como texto não confiável antes do parse

---

## Distribuição e OAuth para utilizadores finais

O fluxo da app é **um utilizador = uma autorização**: cada pessoa que instala clica em ligar ao Google, inicia sessão na **sua** conta e os tokens OAuth ficam na keychain **desse** dispositivo — não há uma conta “central” do servidor; o acesso ao Gmail é sempre o da conta que autorizou.

Para **qualquer pessoa** poder instalar o binário e usar Gmail sem ser “utilizador de teste” manual na Consola, o **OAuth consent screen** do projecto Google Cloud tem de estar **em produção** (modo *Testing* só permite emails explicitamente adicionados como testadores). Os scopes **`gmail.modify`** (alterar etiquetas/arquivar) e leitura de perfil são sensíveis/restritos; em apps públicos a Google costuma exigir **verificação da aplicação** (e documentação sobre uso dos dados) antes de remover avisos ou bloqueios para contas externas. Ao mudarem os scopes OAuth, utilizadores já ligados devem **terminar sessão e autorizar outra vez** nesta app.

Na prática comum de produto desktop, **um único par** Client ID (e Secret, conforme o tipo de cliente) do **teu** projecto é embutido ou pré-configurado no instalador; todos os utilizadores partilham essas credenciais de *cliente OAuth*, mas cada um obtém **refresh tokens próprios** ao consentir. Alternativa avançada: cada power-user cria o seu projecto na Cloud Console e cola Client ID/Secret nas definições. Uma evolução descrita noutros pontos deste documento é um **backend** (ex.: Cloudflare Worker) que centraliza o registo OAuth e evita embutir segredos no cliente.

---

## Qualidade aplicada (não regredir)

| Área | Estado |
|---|---|
| SonarQube | Projecto `HCCM-Consulting_mail-daily-digest` — importar em sonarcloud.io com `sonar-project.properties` |
| Snyk SCA | 0 vulnerabilidades (`npm` / overrides glob) |
| Snyk Code | 1× `HttpToHttps` em `oauth-loopback.js` — falso positivo documentado em `docs/SECURITY-OAUTH-LOOPBACK.md`; exclusão em `.snyk` |
| String#replaceAll() em vez de replace() | Aplicado em gmail.js e prompts |
| Optional chaining em payloads Gmail | Aplicado em gmail.js |
| npm overrides glob=10.5.0 | Aplicado (fix inflight vulnerability) |

---

## Features implementadas

- [x] Gmail OAuth PKCE conecta em macOS, Windows e Linux
- [x] Digest: fetch paginado (20/página, até 200) — janelas today/week/month
- [x] Pesquisa livre Gmail (`gmail:search`) com paginação
- [x] Análise via LLM: priority, summary, warning, tasks, calendar_events, draft_reply
- [x] Extracção e display de links relevantes de cada email (email-links.js)
- [x] Auto-refresh da caixa de entrada a cada 10 minutos
- [x] Arquivar email (remove INBOX + UNREAD) e marcar estrela (STARRED)
- [x] Menu contextual nativo (⋯ ou clique direito) — arquivo + estrela
- [x] Rascunho de resposta criado via `gmail:create-reply-draft` no mesmo thread
- [x] Outlook pessoal via Graph (`mail:*`, endpoint `consumers`)
- [x] API key guardada na keychain do SO (keytar)
- [x] Build gera .dmg + .exe + .AppImage

## Outlook pessoal (Microsoft Graph)

- Switch **Gmail | Outlook (pessoal)** na topbar (`mailProvider` no store)
- OAuth endpoint `/consumers` — só contas pessoais; **não** tenants M365 por cliente
- Developer regista uma app no Azure Portal; utilizadores só autorizam login: `docs/MICROSOFT-OAUTH.md`
- Scopes: `Mail.ReadWrite`, `User.Read`, `offline_access`
- Pesquisa Graph (`$search`) — sintaxe limitada vs Gmail
- IPC unificado: namespace `mail:*` (router em `main.js`)

## Fora de âmbito (próximas iterações)

- Briefing automático agendado (scheduler / cron)
- Notificações push
- Múltiplas contas Gmail
- Subscrição / billing integrado
- Backend Cloudflare Worker (para tier pago / OAuth centralizado)