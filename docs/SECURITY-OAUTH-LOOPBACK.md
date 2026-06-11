# OAuth loopback — nota de segurança (Snyk / Sonar)

## Contexto

Apps desktop Google e Microsoft usam redirect **HTTP** para `http://127.0.0.1:<porta>/oauth/callback` (RFC 8252 §7.3). O código vive em [`src/services/oauth-loopback.js`](../src/services/oauth-loopback.js).

## Porque o Snyk reporta `javascript/HttpToHttps`

O servidor é `node:http.createServer` ligado apenas a **127.0.0.1**. Não expõe credenciais na rede local; o authorization code é trocado imediatamente por tokens via HTTPS (`oauth2.googleapis.com`, `login.microsoftonline.com`).

## Mitigações na app

- Servidor efémero (fecha após o callback)
- Só aceita path `/oauth/callback`
- Tokens guardados na keychain do SO (keytar)

## Política Snyk

Ficheiro [`.snyk`](../.snyk) exclui `oauth-loopback.js` do Snyk Code (exclusão de ficheiro, não supressão de regra em outros paths).

Se o scan MCP/CI ainda listar o achado, ignorar na UI Snyk com razão «RFC 8252 OAuth loopback» ou confirmar que a exclusão `.snyk` está activa no pipeline.
