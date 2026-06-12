# Mail Digest

App desktop (Electron) que transforma a caixa de entrada num **briefing diário**: lê os emails não lidos do Gmail ou Outlook pessoal, analisa-os com IA e apresenta um documento único — o que precisa de ti, o que a app propõe (tarefas e eventos) e o que já foi tratado, incluindo uma síntese jornalística das newsletters.

> UI "Briefing Colorido" (paleta Confetti Cream): tipografia Fraunces / Inter Tight / JetBrains Mono **self-hosted**, sem CDNs externos. Sistema visual documentado em [`DESIGN.md`](DESIGN.md).

## Funcionalidades

- **Briefing matinal em coluna única** — hero com saudação personalizada, stats coloridas e três secções: _O que precisa de ti_, _O que eu proponho_, _O que eu tratei_
- **Correio**: Gmail (OAuth 2.0 PKCE com loopback) e **Outlook pessoal** (Microsoft Graph, contas @outlook.com/Hotmail/Live) — selector no topo da app
- **IA em duas passagens**: classificação de cada email (categoria, prioridade, tarefas, eventos, rascunho de resposta) + síntese agregada de newsletters
- **3 providers de IA** à escolha: Anthropic (`claude-haiku-4-5`), OpenAI (`gpt-4.1-mini`) ou Google Gemini (`gemini-2.5-flash`)
- **Segurança**: tokens OAuth e API keys guardados na **keychain do SO** (keytar), nunca em ficheiros; CSP restritiva; deteção de phishing nos resumos
- Acções por email: arquivar, marcar com estrela, criar rascunho de resposta no próprio fio

## Requisitos

- Node.js 18+ e npm
- Conta Google e/ou Microsoft pessoal
- API key de pelo menos um provider de IA (Anthropic, OpenAI ou Google AI)

## Começar (desenvolvimento)

```bash
git clone https://github.com/tigaszzz/mail-daily-digest.git
cd mail-daily-digest
npm install
cp .env.example .env   # preencher credenciais OAuth (ver abaixo)
npm run dev
```

### Configurar OAuth

| Provider | O que precisas | Guia |
|---|---|---|
| Gmail | Cliente OAuth tipo «Aplicação para computador» na Google Cloud Console | [`docs/GOOGLE-OAUTH-PRODUCAO.md`](docs/GOOGLE-OAUTH-PRODUCAO.md) |
| Outlook pessoal | App registration no portal Azure (só o developer regista; utilizadores só fazem login) | [`docs/MICROSOFT-OAUTH.md`](docs/MICROSOFT-OAUTH.md) |

Preenche `GOOGLE_OAUTH_CLIENT_ID` / `MICROSOFT_CLIENT_ID` (e secrets, se aplicável) no `.env` — ou directamente nas **Definições** da app. Notas de segurança do fluxo loopback: [`docs/SECURITY-OAUTH-LOOPBACK.md`](docs/SECURITY-OAUTH-LOOPBACK.md).

### Chaves de IA

Nas **Definições → Modelo de IA**, escolhe o provider e cola a API key — fica guardada na keychain do sistema operativo.

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Arranca em modo dev (DevTools destacadas) |
| `npm start` | Arranca em modo normal |
| `npm run pack` | Build sem instalador (pasta `dist/`) |
| `npm run dist:mac` | Instalador macOS (dmg + zip, x64 + arm64) |
| `npm run dist:win` | Instalador Windows (NSIS, x64) |
| `npm run dist:linux` | AppImage + deb (x64) |

## Arquitectura

```
src/
├── main.js                  # Processo principal — janela, IPC, lifecycle OAuth
├── preload.js               # contextBridge — única ponte main ↔ renderer
├── renderer/                # UI (briefing) — HTML, CSS, JS sem frameworks
│   └── fonts/               # Fontes variáveis self-hosted (woff2)
├── providers/llm/           # Anthropic / OpenAI / Google + prompts e montagem do briefing
└── services/                # Gmail API, Microsoft Graph, OAuth PKCE, extracção de links
```

- Renderer corre com `contextIsolation: true` e `nodeIntegration: false`; só comunica por IPC tipado exposto no preload
- O shape canónico de mensagem é partilhado pelos dois providers de correio (`services/mail-types.js`)
- Sem modelos locais (decisão definitiva — ver [`AGENT.md`](AGENT.md)); apenas APIs premium

## Qualidade

Validado com **SonarQube** (0 issues) e **Snyk** (code + dependências, 0 vulnerabilidades). Config em `sonar-project.properties` e `.snyk`.

## Roadmap

- Follow-ups (secção _standby_ — "à espera de resposta")
- Reply queue (fila de rascunhos pendentes)
- Conversation mode (chat real por trás da ask bar ⌘K)
- Integrações reais de calendário/tarefas (actualmente stubs IPC)

## Licença

MIT © Tiago Almeida
