# Microsoft OAuth — Outlook pessoal (Microsoft Graph)

Ligação a **contas pessoais** Microsoft: `@outlook.com`, `@hotmail.com`, `@live.com`.

**Não é** integração para cada organização configurar a sua app no Entra ID. **Tu** (desenvolvedor) registas **uma** aplicação no portal Azure; cada utilizador final só clica «Entrar com Outlook» e autoriza o acesso ao **próprio** correio.

## Quem configura o quê

| Quem | O quê |
|------|--------|
| **Tu (dev)** | Uma vez: app no Azure Portal + Client ID/Secret na app ou `.env` |
| **Utilizador final** | Só login Microsoft pessoal — **não** cria app no Entra, **não** é admin de tenant |

Contas **trabalho/escola** (Microsoft 365 da empresa) **não são suportadas** nesta versão (`/consumers` no login).

## 1. Registo da aplicação (só o developer)

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**
2. **Name:** `Mail Digest`
3. **Supported account types:** **Personal Microsoft accounts only**
4. **Redirect URI** — plataforma **Mobile and desktop applications**:
   - `http://127.0.0.1/oauth/callback` (a app usa loopback dinâmico `http://127.0.0.1:<porta>/oauth/callback`)

> O portal chama-se «Entra ID» mas aqui serves apenas para **obter Client ID/Secret** da tua app pública — não é um produto «Azure tenant por cliente».

## 2. Credenciais

1. **Overview** → **Application (client) ID**
2. **Certificates & secrets** → **New client secret**

## 3. Permissões API (delegadas)

**API permissions** → **Microsoft Graph** → **Delegated**:

| Permissão | Uso na app |
|-----------|------------|
| `Mail.ReadWrite` | Inbox, arquivar, flag, rascunho de resposta |
| `User.Read` | Perfil / avatar |
| `offline_access` | Refresh token (keychain) |
| `openid`, `profile` | Identidade |

Não é necessário **Grant admin consent** para contas pessoais.

## 4. Variáveis de ambiente (opcional)

```bash
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
```

Ou nas **Definições** da app.

## 5. Limitações vs Gmail

- Pesquisa: Graph `$search` (palavras-chave), não sintaxe Gmail.
- Focused Inbox: aproximado com `inferenceClassification` quando disponível.

## Referências

- [Microsoft identity platform — desktop apps](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft Graph mail API](https://learn.microsoft.com/en-us/graph/api/resources-mail-api-overview)
