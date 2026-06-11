// preload.js — única ponte entre main process e renderer.
// Expõe apenas os canais IPC permitidos via contextBridge.
// O renderer NÃO tem acesso directo a Node.js.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  gmail: {
    auth:       ()     => ipcRenderer.invoke('gmail:auth'),
    fetch:      (opts) => ipcRenderer.invoke('gmail:fetch', opts),
    search:     (payload) =>
      ipcRenderer.invoke(
        'gmail:search',
        typeof payload === 'string' ? { query: payload } : payload
      ),
    getProfile: ()     => ipcRenderer.invoke('gmail:profile'),
    logout:     ()     => ipcRenderer.invoke('gmail:logout'),
    archive:    (messageId)     => ipcRenderer.invoke('gmail:archive', messageId),
    setStar:    (messageId, star) => ipcRenderer.invoke('gmail:set-star', { messageId, star }),
    createReplyDraft: (messageId, body) =>
      ipcRenderer.invoke('gmail:create-reply-draft', { messageId, body })
  },
  mail: {
    getProvider: () => ipcRenderer.invoke('mail:get-provider'),
    setProvider: (provider) => ipcRenderer.invoke('mail:set-provider', provider),
    auth:        () => ipcRenderer.invoke('mail:auth'),
    fetch:       (opts) => ipcRenderer.invoke('mail:fetch', opts),
    search:      (payload) =>
      ipcRenderer.invoke(
        'mail:search',
        typeof payload === 'string' ? { query: payload } : payload
      ),
    getProfile:  () => ipcRenderer.invoke('mail:profile'),
    logout:      () => ipcRenderer.invoke('mail:logout'),
    archive:     (messageId) => ipcRenderer.invoke('mail:archive', messageId),
    setStar:     (messageId, star) => ipcRenderer.invoke('mail:set-star', { messageId, star }),
    createReplyDraft: (messageId, body) =>
      ipcRenderer.invoke('mail:create-reply-draft', { messageId, body })
  },
  llm: {
    analyse:     (emails) => ipcRenderer.invoke('llm:analyse', emails),
    getProvider: ()       => ipcRenderer.invoke('llm:get-provider'),
    setProvider: (cfg)    => ipcRenderer.invoke('llm:set-provider', cfg)
  },
  briefing: {
    action: (type, payload) => ipcRenderer.invoke('action', { type, ...payload })
  },
  calendar: {
    add: (payload) => ipcRenderer.invoke('calendar:add', payload)
  },
  task: {
    accept: (payload) => ipcRenderer.invoke('task:accept', payload)
  },
  convo: {
    open: () => ipcRenderer.invoke('convo:open')
  },
  keychain: {
    get:    (key)       => ipcRenderer.invoke('keychain:get', key),
    set:    (key, val)  => ipcRenderer.invoke('keychain:set', key, val),
    delete: (key)       => ipcRenderer.invoke('keychain:delete', key)
  },
  settings: {
    get: ()    => ipcRenderer.invoke('settings:get'),
    set: (cfg) => ipcRenderer.invoke('settings:set', cfg)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url)
  }
});
