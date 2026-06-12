// Erros com mensagem segura para o utilizador final (sem paths de docs nem detalhes técnicos).

class UserFacingError extends Error {
  constructor(message, devDetail) {
    super(message);
    this.name = 'UserFacingError';
    this.devDetail = devDetail || message;
  }
}

function oauthNotConfigured(provider) {
  const label = provider === 'microsoft' ? 'Outlook' : 'Gmail';
  return new UserFacingError(
    `Não foi possível ligar ao ${label}. Tenta novamente mais tarde.`,
    `OAuth client not configured (${provider})`
  );
}

function oauthSessionRequired(provider) {
  const label = provider === 'microsoft' ? 'Outlook' : 'Gmail';
  return new UserFacingError(
    `Liga a tua conta ${label} para continuar.`,
    `No OAuth session (${provider})`
  );
}

function logDevDetail(err) {
  if (err?.devDetail) console.warn('[mail-digest]', err.devDetail);
}

module.exports = {
  UserFacingError,
  oauthNotConfigured,
  oauthSessionRequired,
  logDevDetail
};
