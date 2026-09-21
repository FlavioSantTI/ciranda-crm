'use strict';

// src/core/errors.ts
var WaConnectorError = class extends Error {
  /** Marcador estável para `isWaConnectorError` (sobrevive a cópias do módulo em bundles distintos). */
  isWaConnectorError = true;
  code;
  provider;
  status;
  retryAfterMs;
  constructor(code, message, options = {}) {
    super(message, options.cause === void 0 ? void 0 : { cause: options.cause });
    this.name = "WaConnectorError";
    this.code = code;
    this.provider = options.provider;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
};
function statusToErrorCode(status) {
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 429) return "RATE_LIMITED";
  return "PROVIDER_ERROR";
}
function redactSecrets(text, secrets) {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      result = result.split(secret).join("***");
    }
  }
  return result;
}

// src/core/chat-id.ts
var WHATSAPP_INVITE_PREFIX = "https://chat.whatsapp.com/";
function normalizeInviteLink(value) {
  return value.startsWith(WHATSAPP_INVITE_PREFIX) ? value : `${WHATSAPP_INVITE_PREFIX}${value}`;
}

// src/core/http.ts
function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}
var RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 502, 503, 504]);
var RETRY_AFTER_MAX_MS = 3e4;
var HttpClient = class {
  baseUrl;
  headers;
  timeoutMs;
  retries;
  secrets;
  provider;
  fetchImpl;
  constructor(options) {
    this.baseUrl = stripTrailingSlashes(options.baseUrl);
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 3e4;
    this.retries = options.retries ?? 2;
    this.secrets = options.secrets ?? [];
    this.provider = options.provider;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }
  async request(options) {
    const url = this.buildUrl(options);
    const method = resolveMethod(options);
    const canRetry = method === "GET" || method === "HEAD" || options.idempotent === true;
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await sleep(lastError?.retryAfterMs ?? backoffMs(attempt));
      }
      try {
        return await this.attempt(url, options);
      } catch (error) {
        if (!(error instanceof WaConnectorError)) {
          throw error;
        }
        lastError = error;
        const retryable = canRetry && (error.code === "NETWORK_ERROR" || error.status !== void 0 && RETRYABLE_STATUSES.has(error.status));
        if (!retryable) {
          throw error;
        }
      }
    }
    throw lastError ?? new WaConnectorError("NETWORK_ERROR", "Falha de rede sem detalhes.", {
      provider: this.provider
    });
  }
  async attempt(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const method = resolveMethod(options);
    try {
      const hasJsonBody = options.body !== void 0;
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          ...hasJsonBody ? { "content-type": "application/json" } : {},
          ...this.headers,
          ...options.headers
        },
        body: hasJsonBody ? JSON.stringify(options.body) : void 0,
        signal: controller.signal
      });
      if (!response.ok) {
        const bodyText = await safeText(response);
        const retryAfterMs = response.status === 429 || response.status === 503 ? parseRetryAfterMs(response.headers.get("retry-after")) : void 0;
        throw new WaConnectorError(
          statusToErrorCode(response.status),
          this.redact(
            `HTTP ${response.status} em ${method} ${options.path}: ${truncate(bodyText, 400)}`
          ),
          { provider: this.provider, status: response.status, retryAfterMs }
        );
      }
      if (response.status === 204) {
        return void 0;
      }
      if (options.responseType === "base64") {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer).toString("base64");
      }
      const text = await safeText(response);
      if (text.length === 0) {
        return void 0;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("json") || looksLikeJson(text)) {
        try {
          return JSON.parse(text);
        } catch {
        }
      }
      return text;
    } catch (error) {
      if (error instanceof WaConnectorError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new WaConnectorError(
          "TIMEOUT",
          this.redact(`Timeout ap\xF3s ${this.timeoutMs}ms em ${method} ${options.path}.`),
          { provider: this.provider, cause: error }
        );
      }
      throw new WaConnectorError(
        "NETWORK_ERROR",
        this.redact(`Erro de rede em ${method} ${options.path}: ${errorMessage(error)}`),
        { provider: this.provider, cause: error }
      );
    } finally {
      clearTimeout(timer);
    }
  }
  buildUrl(options) {
    const path = options.path.startsWith("/") ? options.path : `/${options.path}`;
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== void 0) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
  redact(text) {
    return redactSecrets(text, this.secrets);
  }
};
function resolveMethod(options) {
  return options.method ?? (options.body !== void 0 ? "POST" : "GET");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function backoffMs(attempt) {
  return Math.min(4e3, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
}
function parseRetryAfterMs(headerValue) {
  if (headerValue === null) return void 0;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return void 0;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 48 || code > 57) return void 0;
  }
  const seconds = Number(trimmed);
  return Math.min(RETRY_AFTER_MAX_MS, seconds * 1e3);
}
async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}\u2026`;
}
function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function looksLikeJson(text) {
  const first = text.trimStart().charAt(0);
  return first === "{" || first === "[";
}

// src/adapters/quepasa/index.ts
var PROVIDER = "quepasa";
var QUEPASA_CAPABILITIES = [
  "instance.status",
  "instance.logout",
  "messages.sendText",
  "messages.sendMedia",
  "messages.edit",
  "messages.delete",
  "messages.markRead",
  "messages.sendLocation",
  "messages.sendContactCard",
  "messages.sendPoll",
  "groups.getInviteLink",
  "contacts.getProfilePicture",
  "chats.archive",
  "chats.unarchive",
  "chats.markRead",
  "chats.markUnread",
  "presence.setTyping",
  "labels.list",
  "labels.create",
  "labels.update",
  "labels.delete",
  "labels.addToChat",
  "labels.removeFromChat",
  "webhooks.parse"
];
function quepasa(options) {
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    // Header confirmado no código-fonte (`GetRequestParameter`, prioridade path -> query -> form ->
    // header): `X-QUEPASA-TOKEN`. Enviado em toda requisição; para as rotas v3 (`/v3/bot/{token}/...`)
    // o token TAMBÉM precisa estar embutido no path (ver `botPath`) — o roteador `chi` exige um
    // segmento naquela posição para casar a rota, e ele tem precedência sobre qualquer header/query.
    headers: { "X-QUEPASA-TOKEN": options.token },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.token],
    provider: PROVIDER,
    fetch: options.fetch
  });
  const instance = {
    connect: () => connectInstance(http),
    status: () => statusInstance(http),
    logout: () => logoutInstance(http)
  };
  const messages = {
    sendText: (input) => sendText(http, options.token, input),
    sendMedia: (input) => sendMedia(http, options.token, input),
    edit: (input) => editMessage(http, input),
    delete: (input) => deleteMessage(http, input),
    markRead: (input) => markMessageRead(http, input),
    sendLocation: (input) => sendLocation(http, options.token, input),
    sendContactCard: (input) => sendContactCard(http, options.token, input),
    sendPoll: (input) => sendPoll(http, options.token, input)
  };
  const groups = {
    getInviteLink: (groupId) => getGroupInviteLink(http, options.token, groupId)
  };
  const contacts = {
    getProfilePicture: (chatId) => getContactProfilePicture(http, options.token, chatId)
  };
  const chats = {
    archive: (chatId) => setChatArchived(http, chatId, true),
    unarchive: (chatId) => setChatArchived(http, chatId, false),
    markRead: (chatId) => setChatRead(http, chatId, true),
    markUnread: (chatId) => setChatRead(http, chatId, false)
  };
  const presence = {
    setTyping: (input) => setTyping(http, input)
  };
  const labels = {
    list: () => listLabels(http),
    create: (input) => createLabel(http, input),
    update: (input) => updateLabel(http, input),
    delete: (labelId) => deleteLabel(http, labelId),
    addToChat: (input) => setChatLabel(http, input, true),
    removeFromChat: (input) => setChatLabel(http, input, false)
  };
  return {
    provider: PROVIDER,
    capabilities: QUEPASA_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    labels,
    parseWebhook: (input) => parseWebhook(input)
  };
}
function toQuepasaChatId(chatId) {
  return chatId;
}
function botPath(token, suffix) {
  return `/v3/bot/${encodeURIComponent(token)}${suffix}`;
}
async function connectInstance(http) {
  const body = await http.request({ method: "GET", path: "/scan" });
  return { qr: void 0, raw: body };
}
async function statusInstance(http) {
  const body = await http.request({
    method: "GET",
    path: "/command",
    query: { action: "status" }
  });
  const record = asRecord(body);
  return { state: mapConnectionState(record ? asString(record.status) : void 0), raw: body };
}
function mapConnectionState(status) {
  switch (status) {
    case "Ready":
      return "connected";
    case "Disconnected":
    case "Stopped":
    case "UnVerified":
    case "UnPrepared":
      return "disconnected";
    case "Connected":
    case "Connecting":
    case "Starting":
    case "Stopping":
    case "Restarting":
    case "Reconnecting":
    case "Fetching":
    case "Halting":
      return "connecting";
    default:
      return "unknown";
  }
}
async function logoutInstance(http) {
  await http.request({ method: "GET", path: "/command", query: { action: "stop" } });
}
async function sendText(http, token, input) {
  const chatId = toQuepasaChatId(input.to);
  const body = { chatId, text: input.text };
  const response = await http.request({
    method: "POST",
    path: botPath(token, "/sendtext"),
    body
  });
  return mapSendResponse(response, chatId);
}
function stripDataUriPrefix(base64) {
  const commaIndex = base64.indexOf(",");
  return base64.startsWith("data:") && commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
}
async function sendMedia(http, token, input) {
  if (input.media.kind === "sticker") {
    return sendSticker(http, token, input);
  }
  const chatId = toQuepasaChatId(input.to);
  const body = { chatId };
  if (input.media.url !== void 0) {
    body.url = input.media.url;
  } else if (input.media.base64 !== void 0) {
    body.content = stripDataUriPrefix(input.media.base64);
  } else {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'QuePasa: sendMedia exige "media.url" ou "media.base64".',
      { provider: PROVIDER }
    );
  }
  if (input.caption) {
    body.text = input.caption;
  }
  if (input.media.filename) {
    body.fileName = input.media.filename;
  }
  const path = input.media.url !== void 0 ? "/sendurl" : "/sendencoded";
  const response = await http.request({
    method: "POST",
    path: botPath(token, path),
    body
  });
  return mapSendResponse(response, chatId);
}
async function sendSticker(http, token, input) {
  const chatId = toQuepasaChatId(input.to);
  const sticker = {};
  if (input.media.url !== void 0) {
    sticker.url = input.media.url;
  } else if (input.media.base64 !== void 0) {
    sticker.content = input.media.base64;
  } else {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'QuePasa: sendMedia exige "media.url" ou "media.base64".',
      { provider: PROVIDER }
    );
  }
  const response = await http.request({
    method: "POST",
    path: botPath(token, "/send"),
    body: { chatId, sticker }
  });
  return mapSendResponse(response, chatId);
}
function mapSendResponse(body, requestedChatId) {
  return extractMessageEnvelope(body, `quepasa-${Date.now()}`, requestedChatId);
}
function extractMessageEnvelope(body, fallbackId, fallbackChatId) {
  const record = asRecord(body);
  const message = record ? asRecord(record.message) : void 0;
  const id = (message ? asString(message.id) : void 0) ?? fallbackId;
  const chatId = (message ? asString(message.chatId) : void 0) ?? fallbackChatId;
  return { id, chatId, timestamp: void 0, raw: body };
}
async function editMessage(http, input) {
  const chatId = toQuepasaChatId(input.to);
  const response = await http.request({
    method: "PUT",
    path: "/edit",
    body: { messageId: input.messageId, content: input.text }
  });
  return mapEditResponse(response, chatId, input.messageId);
}
function mapEditResponse(body, requestedChatId, messageId) {
  return extractMessageEnvelope(body, messageId, requestedChatId);
}
async function deleteMessage(http, input) {
  await http.request({
    method: "DELETE",
    path: `/message/${encodeURIComponent(input.messageId)}`
  });
}
async function markMessageRead(http, input) {
  await http.request({ method: "POST", path: "/read", body: [input.messageId] });
}
async function sendLocation(http, token, input) {
  const chatId = toQuepasaChatId(input.to);
  const location = {
    latitude: input.latitude,
    longitude: input.longitude
  };
  if (input.name) location.name = input.name;
  if (input.address) location.address = input.address;
  const response = await http.request({
    method: "POST",
    path: botPath(token, "/send"),
    body: { chatId, location }
  });
  return mapSendResponse(response, chatId);
}
async function sendContactCard(http, token, input) {
  const chatId = toQuepasaChatId(input.to);
  const response = await http.request({
    method: "POST",
    path: botPath(token, "/send"),
    body: { chatId, contact: { phone: input.contactPhone, name: input.contactName } }
  });
  return mapSendResponse(response, chatId);
}
async function sendPoll(http, token, input) {
  const chatId = toQuepasaChatId(input.to);
  const poll = { question: input.question, options: input.options };
  if (input.allowMultipleAnswers) poll.selections = input.options.length;
  const response = await http.request({
    method: "POST",
    path: botPath(token, "/send"),
    body: { chatId, poll }
  });
  return mapSendResponse(response, chatId);
}
async function getGroupInviteLink(http, token, groupId) {
  const response = await http.request({
    method: "GET",
    path: botPath(token, `/invite/${encodeURIComponent(groupId)}`)
  });
  const record = asRecord(response);
  const url = record ? asString(record.url) : void 0;
  return { link: normalizeInviteLink(url ?? ""), raw: response };
}
async function getContactProfilePicture(http, token, chatId) {
  const response = await http.request({
    method: "GET",
    path: botPath(token, `/picinfo/${encodeURIComponent(chatId)}`)
  });
  const record = asRecord(response);
  const info = record ? asRecord(record.info) : void 0;
  return { url: info ? asString(info.url) : void 0, raw: response };
}
async function setChatArchived(http, chatId, archive) {
  await http.request({
    method: "POST",
    path: "/chat/archive",
    body: { chatid: toQuepasaChatId(chatId), archive }
  });
}
async function setChatRead(http, chatId, read) {
  await http.request({
    method: "POST",
    path: read ? "/chat/markread" : "/chat/markunread",
    body: { chatid: toQuepasaChatId(chatId) }
  });
}
async function setTyping(http, input) {
  const type = input.state === "composing" ? "text" : input.state === "recording" ? "audio" : "paused";
  await http.request({
    method: "POST",
    path: "/chat/presence",
    body: { chatid: toQuepasaChatId(input.to), type }
  });
}
async function listLabels(http) {
  const body = await http.request({ method: "GET", path: "/labels" });
  const record = asRecord(body);
  const items = record && Array.isArray(record.labels) ? record.labels : [];
  return items.map((item) => mapQuepasaLabel(item));
}
async function createLabel(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/labels",
    body: { name: input.name, color: input.color }
  });
  const record = asRecord(body);
  const label = record ? asRecord(record.label) : void 0;
  return mapQuepasaLabel(label ?? { name: input.name, color: input.color });
}
async function updateLabel(http, input) {
  await http.request({
    method: "PUT",
    path: "/labels",
    body: { id: toQuepasaLabelId(input.labelId), name: input.name, color: input.color }
  });
}
async function deleteLabel(http, labelId) {
  await http.request({
    method: "DELETE",
    path: "/labels",
    body: { id: toQuepasaLabelId(labelId) }
  });
}
async function setChatLabel(http, input, add) {
  await http.request({
    method: add ? "POST" : "DELETE",
    path: "/chat/labels",
    body: { chatid: toQuepasaChatId(input.chatId), labelid: toQuepasaLabelId(input.labelId) }
  });
}
function toQuepasaLabelId(labelId) {
  return Number(labelId);
}
function mapQuepasaLabel(body) {
  const record = asRecord(body);
  const idRaw = record?.id;
  const id = typeof idRaw === "number" ? String(idRaw) : "";
  return {
    id,
    name: (record ? asString(record.name) : void 0) ?? "",
    color: record ? asString(record.color) : void 0,
    raw: body
  };
}
function parseWebhook(input) {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook QuePasa: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe(input) {
  const body = input.body;
  const record = asRecord(body);
  if (!record) {
    return [unknownEvent(body, "Corpo do webhook QuePasa n\xE3o \xE9 um objeto JSON.")];
  }
  const instanceId = asString(record.wid) || firstHeaderValue(input.headers, "x-quepasa-wid");
  const type = asString(record.type);
  switch (type) {
    case "text":
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
    case "poll":
    case "location":
    case "contact":
      return [mapMessageEvent(record, type, instanceId, body)];
    case "view_once":
      return [mapMessageEvent(record, type, instanceId, body)];
    case "system":
      return [mapSystemEvent(record, instanceId, body)];
    case "group":
      return [mapGroupEvent(record, instanceId, body)];
    case "call":
      return [
        unknownEvent(
          body,
          'Evento "call" do QuePasa n\xE3o tem CanonicalEvent equivalente nesta fase (o contrato central n\xE3o modela chamadas de voz/v\xEDdeo).',
          instanceId
        )
      ];
    case "revoke":
      return [
        unknownEvent(
          body,
          'Evento "revoke" do QuePasa (mensagem apagada) n\xE3o tem CanonicalEvent equivalente nesta fase.',
          instanceId
        )
      ];
    case "unhandled":
      return [
        unknownEvent(
          body,
          'QuePasa reportou "unhandled" para este evento (n\xE3o classificado nem pelo pr\xF3prio provider).',
          instanceId
        )
      ];
    default:
      return [
        unknownEvent(
          body,
          `Payload de webhook QuePasa n\xE3o reconhecido nesta fase (type="${type ?? "ausente"}").`,
          instanceId
        )
      ];
  }
}
var KIND_BY_TYPE = {
  text: "text",
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
  sticker: "sticker",
  poll: "poll",
  location: "location",
  contact: "contact"
};
function mapMessageEvent(record, type, instanceId, rawBody) {
  const fromMe = asBoolean(record.fromme) ?? false;
  const chat = asRecord(record.chat);
  const participant = asRecord(record.participant);
  const kind = KIND_BY_TYPE[type] ?? "unknown";
  const attachment = asRecord(record.attachment);
  const message = {
    id: asString(record.id) ?? `quepasa-unknown-${Date.now()}`,
    chatId: (chat ? asString(chat.id) : void 0) ?? "unknown",
    from: participant ? asString(participant.id) : void 0,
    fromMe,
    // `timestamp` é RFC3339 (time.Time nativo do Go, sem MarshalJSON customizado no próprio campo)
    // — diferente da maioria dos providers deste pacote, que usam epoch em segundos ou ms.
    timestamp: parseIsoTimestamp(record.timestamp),
    kind,
    text: asString(record.text),
    media: attachment && isMediaKind(kind) ? buildMediaRef(kind, attachment) : void 0,
    quotedId: asString(record.inreply),
    raw: rawBody
  };
  return {
    type: fromMe ? "message.sent" : "message.received",
    provider: PROVIDER,
    instanceId,
    message,
    raw: rawBody
  };
}
var MEDIA_KINDS = /* @__PURE__ */ new Set([
  "image",
  "video",
  "audio",
  "document",
  "sticker"
]);
function isMediaKind(kind) {
  return MEDIA_KINDS.has(kind);
}
function buildMediaRef(kind, attachment) {
  return {
    kind,
    url: asString(attachment.url),
    mimeType: asString(attachment.mime),
    filename: asString(attachment.filename)
  };
}
function mapSystemEvent(record, instanceId, rawBody) {
  const id = asString(record.id);
  if (id === "deliveryreceipt" || id === "readreceipt") {
    const chat = asRecord(record.chat);
    const messageId = asString(record.text);
    if (!messageId) {
      return unknownEvent(
        rawBody,
        `Recibo QuePasa ("${id}") sem o id real da mensagem no campo "text".`,
        instanceId
      );
    }
    const ack = id === "readreceipt" ? "read" : "delivered";
    return {
      type: "message.ack",
      provider: PROVIDER,
      instanceId,
      messageId,
      chatId: chat ? asString(chat.id) : void 0,
      ack,
      raw: rawBody
    };
  }
  const info = asRecord(record.info);
  const event = info ? asString(info.event) : void 0;
  const state = mapSystemEventToState(event);
  if (!state) {
    return unknownEvent(
      rawBody,
      `Evento "system" do QuePasa com info.event="${event ?? "ausente"}" sem InstanceState equivalente nesta fase.`,
      instanceId
    );
  }
  return { type: "connection.update", provider: PROVIDER, instanceId, state, raw: rawBody };
}
function mapSystemEventToState(event) {
  switch (event) {
    case "connected":
    case "pair_success":
      return "connected";
    case "disconnected":
    case "stopped":
    case "deleted":
    case "logged_out":
      return "disconnected";
    case "qr_scan":
      return "qr";
    default:
      return void 0;
  }
}
function mapGroupEvent(record, instanceId, rawBody) {
  const chat = asRecord(record.chat);
  const groupId = chat ? asString(chat.id) : void 0;
  if (!groupId) {
    return unknownEvent(rawBody, 'Evento "group" do QuePasa sem "chat.id".', instanceId);
  }
  return { type: "group.update", provider: PROVIDER, instanceId, groupId, raw: rawBody };
}
function unknownEvent(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER, instanceId, raw, reason };
}
function parseIsoTimestamp(value) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}
function firstHeaderValue(headers, name) {
  if (!headers) return void 0;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return void 0;
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString(value) {
  return typeof value === "string" ? value : void 0;
}
function asBoolean(value) {
  return typeof value === "boolean" ? value : void 0;
}

exports.quepasa = quepasa;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map