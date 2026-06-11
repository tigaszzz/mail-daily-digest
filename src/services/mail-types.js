// Modelo canónico de mensagem — partilhado por Gmail e Microsoft Graph.

/**
 * @typedef {Object} CanonicalMailMessage
 * @property {'gmail'|'microsoft'} provider
 * @property {string} id
 * @property {string} threadId
 * @property {string} subject
 * @property {string} from
 * @property {string} [replyTo]
 * @property {string} [to]
 * @property {string} [date]
 * @property {string} snippet
 * @property {string} body
 * @property {Array<{url:string,label?:string,host?:string}>} links
 * @property {string[]} [labels]
 * @property {string} url
 */

/**
 * @typedef {Object} MailPageResult
 * @property {CanonicalMailMessage[]} emails
 * @property {number} total
 * @property {number} page
 * @property {number} pageSize
 */

module.exports = {};
