# Google OAuth — uso público sem avisos

Para **qualquer pessoa** com conta Google usar a app (não só emails de teste), o projecto na [Google Cloud Console](https://console.cloud.google.com/) tem de estar configurado e **verificado**. O código da app já usa o fluxo correcto (Desktop + PKCE + loopback `127.0.0.1`).

## O que causa avisos hoje

| Situação | O que o utilizador vê |
|----------|------------------------|
| App em **Teste** | Só contas adicionadas como «testadores» |
| App **não verificada** com scope `gmail.modify` | «Esta app não foi validada pela Google» (pode continuar em Avançadas) |
| Branding antigo (ex. «GTD») | Nome errado no ecrã de consentimento |
| Client ID tipo **Web** em vez de **Computador** | `invalid_request` / redirect inválido |

## Checklist na Consola (ordem recomendada)

### 1. Projecto e APIs

1. Cria ou escolhe um projecto (ex. **Gemini Project** ou um dedicado «Mail Digest»).
2. Activa **Gmail API**: APIs e serviços → Biblioteca → Gmail API → Ativar.

### 2. Ecrã de consentimento OAuth

Menu **Google Auth Platform** → **Branding**:

- **Nome da aplicação:** `Gmail Daily Digest` (ou o nome final do produto).
- **Email de apoio:** o teu email.
- **Logótipo:** ícone da app (120×120 px).
- **Homepage:** URL pública do projecto (GitHub Pages, site, etc.).
- **Política de privacidade:** URL **obrigatória** para produção — explica que tokens ficam no dispositivo, que dados Gmail são lidos para resumo IA, e que não vendes dados.
- **Termos de utilização:** recomendado (pode ser a mesma página com secção extra).

Menu **Público-alvo**:

- Tipo: **Externo**.
- Estado: **Em produção** (não «Em teste»). Em teste só funcionam emails na lista de testadores.

Menu **Acesso a dados** — scopes:

- `https://www.googleapis.com/auth/gmail.modify`
- `openid`
- `email`

Preenche a **justificação** para scopes Gmail restritos (ler/resumir email, arquivar, estrela, rascunho de resposta na app).

Menu **Clientes**:

- Tipo: **Aplicação para computador** (Desktop).
- Nome: ex. `Mail-Digest`.
- Um Client ID + Secret por cliente Desktop (podes rodiar o secret antigo).

### 3. Verificação Google (remove o aviso principal)

Scope `gmail.modify` é **restrito**. Para contas fora da tua organização sem ecrã «app não verificada»:

1. Menu **Central de verificação** → pedido de verificação.
2. Vídeo curto ou notas: mostrar login, consentimento, lista de emails, arquivar/estrela.
3. Aguardar revisão (dias a semanas).

Até lá, utilizadores podem usar **Avançadas → Aceder** no aviso (limitado a 100 testadores se a app estiver em Teste).

### 4. Credenciais na app

#### Desenvolvimento (`npm run dev`)

Preenche `.env` (copia de `.env.example`) ou usa as Definições da app:

```bash
GOOGLE_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
npm run dev
```

#### Distribuição (instaladores `.dmg` / `.exe`)

O **developer** regista **uma** app OAuth na Google Cloud. As credenciais são injectadas **no build** — o utilizador final **não** as vê nem configura.

1. Preenche `.env` com `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` (e opcionalmente `MICROSOFT_*`).
2. Corre o empacotamento — o script `scripts/inject-oauth.js` gera `build/oauth-build.js` (gitignored); `electron-builder.config.js` deriva o protocolo OAuth a partir desse ficheiro (nada no `package.json` commitado):

```bash
npm run dist:mac   # ou dist:win
```

3. O instalador inclui o Client ID/Secret embutidos. Cada utilizador obtém **tokens OAuth próprios** na keychain ao clicar «Entrar com Gmail» — não partilham a caixa de correio entre si. O Client ID **não** aparece no repositório Git — só no `.env` local e no binário empacotado.

> **Nota de segurança:** num cliente Desktop com PKCE, o Client ID é público por natureza; o secret não é um segredo forte (pode ser extraído do binário). A protecção real são os **tokens por utilizador** na keychain e o fluxo PKCE.

## Fluxo técnico na app

- Redirect: `http://127.0.0.1:<porta>/oauth/callback` (RFC 8252, sem registo de portas na Consola).
- PKCE: não expõe o secret no URL; secret opcional no token exchange para clientes Desktop.
- Tokens: keychain do macOS / Windows Credential Manager.

## Depois de mudar scopes ou cliente

Utilizadores devem **Sair do Gmail** na app e **Entrar com Gmail** outra vez.

## Referências

- [OAuth 2.0 para apps de ambiente de trabalho](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Verificação de scopes sensíveis](https://support.google.com/cloud/answer/9110914)
