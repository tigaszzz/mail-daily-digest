// OAuth 2.0 loopback redirect (RFC 8252 §7.3) — servidor HTTP efémero em 127.0.0.1 apenas.
// Google e Microsoft exigem http://127.0.0.1:<porta>/callback para apps desktop; não é tráfego em rede.

const http = require('node:http');

const LOOPBACK_SUCCESS_HTML = `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"><title>Mail Digest</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center">
<p><strong>Ligação concluída.</strong> Podes fechar este separador e voltar à app Mail Digest.</p>
<script>setTimeout(() => window.close(), 800);</script>
</body></html>`;

function isOAuthCallbackPath(url) {
  const pathOnly = (url.pathname || '').replace(/^\//, '');
  return pathOnly === 'oauth/callback';
}

function isLoopbackOAuthCallbackUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  const host = url.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') return false;
  return isOAuthCallbackPath(url);
}

/**
 * @param {(url: URL) => void} onOAuthRedirect — processa code/error da query string
 * @returns {Promise<{ server: import('node:http').Server, redirectUri: string }>}
 */
function createLoopbackOAuthServer(onOAuthRedirect) {
  return new Promise((resolve, reject) => {
    // deepcode ignore HttpToHttps: OAuth 2.0 loopback em 127.0.0.1 (RFC 8252 §7.3); requisito Google/Microsoft desktop
    const server = http.createServer((req, res) => {
      let url;
      try {
        const host = req.headers.host || '127.0.0.1';
        url = new URL(req.url || '/', `http://${host}`);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }

      if (!isOAuthCallbackPath(url)) {
        res.writeHead(404);
        res.end();
        return;
      }

      onOAuthRedirect(url);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(LOOPBACK_SUCCESS_HTML);
      server.close();
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        redirectUri: `http://127.0.0.1:${port}/oauth/callback`
      });
    });
  });
}

module.exports = {
  createLoopbackOAuthServer,
  isLoopbackOAuthCallbackUrl,
  isOAuthCallbackPath,
  LOOPBACK_SUCCESS_HTML
};
