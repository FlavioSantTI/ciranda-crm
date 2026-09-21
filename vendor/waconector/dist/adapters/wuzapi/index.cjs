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
function extractInviteCode(value) {
  return value.startsWith(WHATSAPP_INVITE_PREFIX) ? value.slice(WHATSAPP_INVITE_PREFIX.length) : value;
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

// src/adapters/wuzapi/index.ts
var PROVIDER = "wuzapi";
var WUZAPI_CAPABILITIES = [
  "instance.connect",
  "instance.status",
  "instance.logout",
  "messages.sendText",
  "messages.sendMedia",
  "messages.sendReaction",
  "messages.edit",
  "messages.delete",
  "messages.markRead",
  "messages.sendLocation",
  "messages.sendContactCard",
  "messages.sendPoll",
  "groups.create",
  "groups.getInfo",
  "groups.list",
  "groups.addParticipants",
  "groups.removeParticipants",
  "groups.promoteParticipants",
  "groups.demoteParticipants",
  "groups.updateSubject",
  "groups.updateDescription",
  "groups.updatePicture",
  "groups.getInviteLink",
  "groups.revokeInviteLink",
  "groups.joinViaInviteLink",
  "groups.leaveGroup",
  "contacts.list",
  "contacts.get",
  "contacts.checkExists",
  "contacts.getProfilePicture",
  "contacts.getAbout",
  "contacts.block",
  "contacts.unblock",
  "contacts.listBlocked",
  "chats.archive",
  "chats.unarchive",
  "presence.setTyping",
  "presence.set",
  "presence.subscribe",
  "channels.list",
  "calls.reject",
  "webhooks.parse"
];
function wuzapi(options) {
  const secrets = [options.token, ...options.adminToken ? [options.adminToken] : []];
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { token: options.token },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets,
    provider: PROVIDER,
    fetch: options.fetch
  });
  const instance = {
    connect: () => connectInstance(http, options),
    status: () => statusInstance(http),
    logout: () => logoutInstance(http)
  };
  const messages = {
    sendText: (input) => sendText(http, input),
    sendMedia: (input) => sendMedia(http, input),
    sendReaction: (input) => sendReaction(http, input),
    edit: (input) => editMessage(http, input),
    delete: (input) => deleteMessage(http, input),
    markRead: (input) => markMessageRead(http, input),
    sendLocation: (input) => sendLocation(http, input),
    sendContactCard: (input) => sendContactCard(http, input),
    sendPoll: (input) => sendPoll(http, input)
  };
  const groups = {
    create: (input) => createGroup(http, input),
    getInfo: (groupId) => getGroupInfo(http, groupId),
    list: () => listGroups(http),
    addParticipants: (input) => updateGroupParticipants(http, input, "add"),
    removeParticipants: (input) => updateGroupParticipants(http, input, "remove"),
    promoteParticipants: (input) => updateGroupParticipants(http, input, "promote"),
    demoteParticipants: (input) => updateGroupParticipants(http, input, "demote"),
    updateSubject: (input) => updateGroupSubject(http, input),
    updateDescription: (input) => updateGroupDescription(http, input),
    updatePicture: (input) => updateGroupPicture(http, input),
    getInviteLink: (groupId) => fetchGroupInviteLink(http, groupId, false),
    revokeInviteLink: (groupId) => fetchGroupInviteLink(http, groupId, true),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, input),
    leaveGroup: (groupId) => leaveGroupCall(http, groupId)
  };
  const contacts = {
    list: () => listContacts(http),
    get: (chatId) => getContact(http, chatId),
    checkExists: (phone) => checkContactExists(http, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, chatId),
    getAbout: (chatId) => getContactAbout(http, chatId),
    block: (chatId) => blockContact(http, chatId),
    unblock: (chatId) => unblockContact(http, chatId),
    listBlocked: () => listBlockedContacts(http)
  };
  const chats = {
    archive: (chatId) => setChatArchived(http, chatId, true),
    unarchive: (chatId) => setChatArchived(http, chatId, false)
  };
  const presence = {
    setTyping: (input) => setTyping(http, input),
    set: (state) => setPresence(http, state),
    subscribe: (chatId) => subscribePresence(http, chatId)
  };
  const channels = {
    list: () => listChannels(http)
  };
  const calls = {
    reject: (input) => rejectCall(http, input)
  };
  return {
    provider: PROVIDER,
    capabilities: WUZAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    channels,
    calls,
    parseWebhook: (input) => parseWebhook(input)
  };
}
function toWuzapiPhone(chatId) {
  return chatId;
}
var MEDIA_ENDPOINTS = {
  image: { path: "/chat/send/image", field: "Image" },
  video: { path: "/chat/send/video", field: "Video" },
  audio: { path: "/chat/send/audio", field: "Audio" },
  document: { path: "/chat/send/document", field: "Document" },
  sticker: { path: "/chat/send/sticker", field: "Sticker" }
};
var DEFAULT_MIME_BY_KIND = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/ogg",
  document: "application/octet-stream",
  sticker: "image/webp"
};
function resolveMediaValue(media) {
  if (media.url) return media.url;
  if (media.base64) {
    if (media.base64.startsWith("data:")) return media.base64;
    const mime = media.mimeType ?? DEFAULT_MIME_BY_KIND[media.kind];
    return `data:${mime};base64,${media.base64}`;
  }
  throw new WaConnectorError(
    "INVALID_INPUT",
    'Wuzapi: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER }
  );
}
async function connectInstance(http, options) {
  const body = { Immediate: options.immediate ?? true };
  if (options.subscribe && options.subscribe.length > 0) {
    body.Subscribe = options.subscribe;
  }
  const connectResponse = await http.request({
    method: "POST",
    path: "/session/connect",
    body
  });
  let qrResponse;
  try {
    qrResponse = await http.request({ method: "GET", path: "/session/qr" });
  } catch {
    qrResponse = void 0;
  }
  const qrData = asRecord(qrResponse?.data);
  const qr = asString(qrData?.QRCode) ?? asString(qrData?.qrcode);
  return {
    qr,
    raw: { connect: connectResponse, qr: qrResponse }
  };
}
async function statusInstance(http) {
  const response = await http.request({ method: "GET", path: "/session/status" });
  const data = asRecord(response.data);
  return { state: mapInstanceState(data), raw: response };
}
async function logoutInstance(http) {
  await http.request({ method: "POST", path: "/session/logout" });
}
function mapInstanceState(data) {
  if (!data) return "unknown";
  const connected = asBoolean(data.connected) ?? asBoolean(data.Connected);
  const loggedIn = asBoolean(data.loggedIn) ?? asBoolean(data.LoggedIn);
  if (connected === void 0 || loggedIn === void 0) return "unknown";
  if (!connected && !loggedIn) return "disconnected";
  if (connected && !loggedIn) return "qr";
  if (connected && loggedIn) return "connected";
  return "connecting";
}
async function sendText(http, input) {
  const phone = toWuzapiPhone(input.to);
  const body = { Phone: phone, Body: input.text };
  if (input.quotedId) {
    body.ContextInfo = { StanzaID: input.quotedId, Participant: phone };
  }
  const response = await http.request({
    method: "POST",
    path: "/chat/send/text",
    body
  });
  return mapSentMessage(response, phone);
}
async function sendMedia(http, input) {
  const phone = toWuzapiPhone(input.to);
  const endpoint = MEDIA_ENDPOINTS[input.media.kind];
  const value = resolveMediaValue(input.media);
  const body = { Phone: phone, [endpoint.field]: value };
  if (input.caption) body.Caption = input.caption;
  if (input.media.mimeType) body.MimeType = input.media.mimeType;
  if (input.media.kind === "document") {
    if (!input.media.filename) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'Wuzapi: sendMedia para "document" exige "media.filename" (campo "FileName" obrigat\xF3rio).',
        { provider: PROVIDER }
      );
    }
    body.FileName = input.media.filename;
  }
  if (input.quotedId) {
    body.ContextInfo = { StanzaID: input.quotedId, Participant: phone };
  }
  const response = await http.request({
    method: "POST",
    path: endpoint.path,
    body
  });
  return mapSentMessage(response, phone);
}
async function sendReaction(http, input) {
  const phone = toWuzapiPhone(input.to);
  const reactionBody = input.emoji === "" ? "remove" : input.emoji;
  const body = { Phone: phone, Body: reactionBody, Id: input.messageId };
  const response = await http.request({
    method: "POST",
    path: "/chat/react",
    body
  });
  return mapSentMessage(response, phone);
}
function mapSentMessage(response, requestedPhone) {
  const data = asRecord(response.data);
  const id = asString(data?.Id) ?? `wuzapi-${Date.now()}`;
  const timestamp = secondsToEpochMs(data?.Timestamp);
  return { id, chatId: requestedPhone, timestamp, raw: response };
}
async function editMessage(http, input) {
  const phone = toWuzapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: "/chat/send/edit",
    body: { Phone: phone, Body: input.text, Id: input.messageId }
  });
  return mapSentMessage(response, phone);
}
async function deleteMessage(http, input) {
  await http.request({
    method: "POST",
    path: "/chat/delete",
    body: { Phone: toWuzapiPhone(input.to), Id: input.messageId }
  });
}
async function markMessageRead(http, input) {
  await http.request({
    method: "POST",
    path: "/chat/markread",
    body: { Id: [input.messageId], ChatPhone: toWuzapiPhone(input.to) }
  });
}
async function sendLocation(http, input) {
  const phone = toWuzapiPhone(input.to);
  const body = {
    Phone: phone,
    Latitude: input.latitude,
    Longitude: input.longitude
  };
  if (input.name) body.Name = input.name;
  const response = await http.request({
    method: "POST",
    path: "/chat/send/location",
    body
  });
  return mapSentMessage(response, phone);
}
async function sendContactCard(http, input) {
  const phone = toWuzapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: "/chat/send/contact",
    body: {
      Phone: phone,
      Name: input.contactName,
      Vcard: buildVcard(input.contactName, input.contactPhone)
    }
  });
  return mapSentMessage(response, phone);
}
async function sendPoll(http, input) {
  const recipient = toWuzapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: "/chat/send/poll",
    body: { group: recipient, header: input.question, options: input.options }
  });
  return mapSentMessage(response, recipient);
}
function buildVcard(name, phone) {
  return `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}
END:VCARD`;
}
async function createGroup(http, input) {
  const participants = input.participants.map(toWuzapiPhone);
  const response = await http.request({
    method: "POST",
    path: "/group/create",
    body: { name: input.subject, participants }
  });
  const data = asRecord(response.data);
  return mapGroupInfo(data, response, {
    subject: input.subject,
    participants: participants.map(toFallbackParticipant)
  });
}
async function getGroupInfo(http, groupId) {
  const response = await http.request({
    method: "GET",
    path: "/group/info",
    query: { groupJID: groupId }
  });
  const data = asRecord(response.data);
  return mapGroupInfo(data, response, { id: groupId });
}
async function listGroups(http) {
  const response = await http.request({ method: "GET", path: "/group/list" });
  const data = asRecord(response.data);
  const groups = Array.isArray(data?.Groups) ? data.Groups : [];
  return groups.map((group) => mapGroupInfo(asRecord(group), group));
}
async function updateGroupParticipants(http, input, action) {
  const phones = input.participants.map(toWuzapiPhone);
  await http.request({
    method: "POST",
    path: "/group/updateparticipants",
    body: { GroupJID: input.groupId, Phone: phones, Action: action }
  });
}
async function updateGroupSubject(http, input) {
  await http.request({
    method: "POST",
    path: "/group/name",
    body: { GroupJID: input.groupId, Name: input.subject }
  });
}
async function updateGroupDescription(http, input) {
  await http.request({
    method: "POST",
    path: "/group/topic",
    body: { GroupJID: input.groupId, Topic: input.description }
  });
}
async function updateGroupPicture(http, input) {
  await http.request({
    method: "POST",
    path: "/group/photo",
    body: { GroupJID: input.groupId, Image: toWuzapiGroupPhoto(input.media) }
  });
}
function toWuzapiGroupPhoto(media) {
  if (media.base64) {
    const commaIndex = media.base64.indexOf(",");
    const raw = media.base64.startsWith("data:") && commaIndex >= 0 ? media.base64.slice(commaIndex + 1) : media.base64;
    return `data:image/jpeg;base64,${raw}`;
  }
  if (media.url) return media.url;
  throw new WaConnectorError(
    "INVALID_INPUT",
    'Wuzapi: groups.updatePicture exige "media.url" ou "media.base64".',
    { provider: PROVIDER }
  );
}
async function fetchGroupInviteLink(http, groupId, reset) {
  const response = await http.request({
    method: "GET",
    path: "/group/invitelink",
    query: { groupJID: groupId, reset }
  });
  const data = asRecord(response.data);
  const link = asString(data?.InviteLink) ?? "";
  return { link: normalizeInviteLink(link), raw: response };
}
async function joinGroupViaInviteLink(http, input) {
  await http.request({
    method: "POST",
    path: "/group/join",
    body: { Code: extractInviteCode(input.invite) }
  });
}
async function leaveGroupCall(http, groupId) {
  await http.request({
    method: "POST",
    path: "/group/leave",
    body: { GroupJID: groupId }
  });
}
function mapGroupInfo(data, raw, fallback = {}) {
  const id = asString(data?.JID) ?? fallback.id ?? "";
  const subject = asString(data?.Name) ?? fallback.subject ?? "";
  const description = asString(data?.Topic);
  const owner = asString(data?.OwnerJID);
  const participants = mapGroupParticipants(data?.Participants) ?? fallback.participants ?? [];
  return { id, subject, description, owner, participants, raw };
}
function mapGroupParticipants(value) {
  if (!Array.isArray(value)) return void 0;
  return value.map((item) => {
    const record = asRecord(item);
    return {
      id: asString(record?.JID) ?? "",
      isAdmin: asBoolean(record?.IsAdmin) ?? false,
      isSuperAdmin: asBoolean(record?.IsSuperAdmin) ?? false
    };
  });
}
function toFallbackParticipant(id) {
  return { id, isAdmin: false, isSuperAdmin: false };
}
async function listContacts(http) {
  const response = await http.request({ method: "GET", path: "/user/contacts" });
  const data = asRecord(response.data);
  if (!data) return [];
  return Object.entries(data).map(([jid, value]) => {
    const record = asRecord(value);
    const name = asString(record?.FullName) ?? asString(record?.FirstName) ?? asString(record?.PushName);
    return { id: jid, name, raw: value };
  });
}
async function fetchUserInfoEntry(http, chatId) {
  const phone = toWuzapiPhone(chatId);
  const response = await http.request({
    method: "POST",
    path: "/user/info",
    body: { Phone: [phone] }
  });
  const data = asRecord(response.data);
  const usersMap = asRecord(data?.Users);
  const entry = usersMap ? firstRecordValue(usersMap) : void 0;
  return { entry, response };
}
async function getContact(http, chatId) {
  const { entry, response } = await fetchUserInfoEntry(http, chatId);
  return { id: chatId, about: asString(entry?.Status), raw: response };
}
async function checkContactExists(http, phone) {
  const target = toWuzapiPhone(phone);
  const response = await http.request({
    method: "POST",
    path: "/user/check",
    body: { Phone: [target] }
  });
  const data = asRecord(response.data);
  const users = Array.isArray(data?.Users) ? data.Users : [];
  const first = asRecord(users[0]);
  return {
    exists: asBoolean(first?.IsInWhatsapp) ?? false,
    chatId: asString(first?.JID),
    raw: response
  };
}
async function getContactProfilePicture(http, chatId) {
  const phone = toWuzapiPhone(chatId);
  const response = await http.request({
    method: "POST",
    path: "/user/avatar",
    body: { Phone: phone, Preview: false }
  });
  const data = asRecord(response.data);
  return { url: asString(data?.url), raw: response };
}
async function getContactAbout(http, chatId) {
  const { entry, response } = await fetchUserInfoEntry(http, chatId);
  return { about: asString(entry?.Status), raw: response };
}
async function blockContact(http, chatId) {
  await http.request({
    method: "POST",
    path: "/user/block",
    body: { Phone: toWuzapiPhone(chatId) }
  });
}
async function unblockContact(http, chatId) {
  await http.request({
    method: "POST",
    path: "/user/unblock",
    body: { Phone: toWuzapiPhone(chatId) }
  });
}
async function listBlockedContacts(http) {
  const response = await http.request({ method: "GET", path: "/user/blocklist" });
  const data = asRecord(response.data);
  return asStringArray(data?.Blocklist);
}
function firstRecordValue(record) {
  for (const value of Object.values(record)) {
    return asRecord(value);
  }
  return void 0;
}
function toWuzapiChatJid(chatId) {
  return chatId.includes("@") ? chatId : `${chatId}@s.whatsapp.net`;
}
async function setChatArchived(http, chatId, archive) {
  await http.request({
    method: "POST",
    path: "/chat/archive",
    body: { jid: toWuzapiChatJid(chatId), archive }
  });
}
async function setTyping(http, input) {
  await http.request({
    method: "POST",
    path: "/chat/presence",
    body: {
      Phone: toWuzapiPhone(input.to),
      State: input.state === "paused" ? "paused" : "composing",
      Media: input.state === "recording" ? "audio" : ""
    }
  });
}
async function setPresence(http, state) {
  await http.request({
    method: "POST",
    path: "/user/presence",
    body: { type: state === "online" ? "available" : "unavailable" }
  });
}
async function subscribePresence(http, chatId) {
  await http.request({
    method: "POST",
    path: "/user/presence/subscribe",
    body: { Phone: toWuzapiPhone(chatId) }
  });
}
async function listChannels(http) {
  const response = await http.request({ method: "GET", path: "/newsletter/list" });
  const data = asRecord(response.data);
  const items = data && Array.isArray(data.Newsletter) ? data.Newsletter : [];
  return items.map((item) => mapWuzapiChannel(item));
}
function mapWuzapiChannel(body) {
  const record = asRecord(body);
  const id = (record ? asString(record.id) : void 0) ?? "";
  const threadMeta = record ? asRecord(record.thread_metadata) : void 0;
  const nameObj = threadMeta ? asRecord(threadMeta.name) : void 0;
  const descriptionObj = threadMeta ? asRecord(threadMeta.description) : void 0;
  const name = (nameObj ? asString(nameObj.text) : void 0) ?? "";
  const description = descriptionObj ? asString(descriptionObj.text) : void 0;
  const subscribersCountText = threadMeta ? asString(threadMeta.subscribers_count) : void 0;
  const subscribersCount = subscribersCountText === void 0 ? void 0 : Number(subscribersCountText);
  return { id, name, description, subscribersCount, raw: body };
}
async function rejectCall(http, input) {
  if (!input.callerId || !input.callId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'calls.reject no Wuzapi exige "callerId" e "callId" (body {call_from, call_id}).',
      { provider: PROVIDER }
    );
  }
  await http.request({
    method: "POST",
    path: "/call/reject",
    body: { call_from: input.callerId, call_id: input.callId }
  });
}
function parseWebhook(input) {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook Wuzapi: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe(input) {
  const body = input.body;
  const record = asRecord(body);
  if (!record) {
    return [unknownEvent(body, "Corpo do webhook Wuzapi n\xE3o \xE9 um objeto JSON.")];
  }
  let eventRecord = record;
  const jsonData = asString(record.jsonData);
  if (jsonData !== void 0) {
    const parsedRecord = asRecord(safeJsonParse(jsonData));
    if (!parsedRecord) {
      return [
        unknownEvent(
          body,
          'Webhook Wuzapi em modo "form": campo "jsonData" n\xE3o cont\xE9m um objeto JSON v\xE1lido.'
        )
      ];
    }
    eventRecord = parsedRecord;
  }
  const instanceId = asString(record.instanceName) ?? asString(eventRecord.instanceName);
  const type = asString(eventRecord.type);
  if (!type) {
    return [unknownEvent(body, 'Payload de webhook Wuzapi sem campo "type".', instanceId)];
  }
  const data = asRecord(eventRecord.event);
  switch (type) {
    case "Message":
      return [mapMessageEvent(instanceId, data, eventRecord, body)];
    case "ReadReceipt":
      return mapReceiptEvent(instanceId, asString(eventRecord.state), data, body);
    case "Connected":
      return [connectionEvent(instanceId, "connected", void 0, body)];
    case "PairSuccess":
      return [connectionEvent(instanceId, "connected", void 0, body)];
    case "Disconnected":
    case "LoggedOut":
    case "ConnectFailure":
      return [connectionEvent(instanceId, "disconnected", void 0, body)];
    case "QR":
      return [connectionEvent(instanceId, "qr", asString(eventRecord.qrCodeBase64), body)];
    case "QRTimeout":
      return [connectionEvent(instanceId, "disconnected", void 0, body)];
    case "GroupInfo":
      return mapGroupInfoEvent(instanceId, data, body);
    case "JoinedGroup":
      return [mapJoinedGroupEvent(instanceId, data, body)];
    default:
      return [unknownEvent(body, `Evento Wuzapi n\xE3o reconhecido: "${type}".`, instanceId)];
  }
}
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function mapMessageEvent(instanceId, data, eventRecord, rawBody) {
  if (!data) {
    return unknownEvent(rawBody, 'Evento "Message" sem campo "event".', instanceId);
  }
  const info = asRecord(data.Info);
  if (!info) {
    return unknownEvent(rawBody, 'Evento "Message" sem "event.Info".', instanceId);
  }
  const fromMe = asBoolean(info.IsFromMe) ?? false;
  const content = mapMessageContent(asRecord(data.Message));
  const media = attachRootMedia(content, eventRecord);
  const message = {
    id: asString(info.ID) ?? "",
    chatId: asString(info.Chat) ?? "",
    from: asString(info.Sender),
    fromMe,
    timestamp: toEpochMs(info.Timestamp) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media,
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
function mapMessageContent(message) {
  if (!message) return { kind: "unknown" };
  if (typeof message.conversation === "string") {
    return { kind: "text", text: message.conversation };
  }
  const extendedText = asRecord(message.extendedTextMessage);
  if (extendedText) {
    return { kind: "text", text: asString(extendedText.text) };
  }
  const image = asRecord(message.imageMessage);
  if (image) {
    return { kind: "image", text: asString(image.caption), media: buildMediaRef("image", image) };
  }
  const video = asRecord(message.videoMessage);
  if (video) {
    return { kind: "video", text: asString(video.caption), media: buildMediaRef("video", video) };
  }
  const audio = asRecord(message.audioMessage);
  if (audio) {
    return { kind: "audio", media: buildMediaRef("audio", audio) };
  }
  const document = asRecord(message.documentMessage);
  if (document) {
    return {
      kind: "document",
      text: asString(document.caption),
      media: buildMediaRef("document", document)
    };
  }
  const sticker = asRecord(message.stickerMessage);
  if (sticker) {
    return { kind: "sticker", media: buildMediaRef("sticker", sticker) };
  }
  if (message.locationMessage) return { kind: "location" };
  if (message.contactMessage) return { kind: "contact" };
  if (message.reactionMessage) return { kind: "reaction" };
  if (message.pollCreationMessage || message.pollUpdateMessage) return { kind: "poll" };
  return { kind: "unknown" };
}
function buildMediaRef(kind, record) {
  const url = asString(record.URL) ?? asString(record.url);
  if (!url) return void 0;
  return {
    kind,
    url,
    mimeType: asString(record.mimetype),
    filename: asString(record.fileName)
  };
}
function attachRootMedia(content, eventRecord) {
  if (content.kind === "text" || content.kind === "unknown") return content.media;
  const rootBase64 = asString(eventRecord.base64);
  if (!rootBase64) return content.media;
  const kind = content.kind;
  return {
    kind,
    url: content.media?.url,
    base64: rootBase64,
    mimeType: content.media?.mimeType ?? asString(eventRecord.mimeType),
    filename: content.media?.filename ?? asString(eventRecord.fileName)
  };
}
function mapReceiptEvent(instanceId, state, data, rawBody) {
  if (!data) {
    return [unknownEvent(rawBody, 'Evento "ReadReceipt" sem campo "event".', instanceId)];
  }
  const messageIds = asStringArray(data.MessageIDs);
  if (messageIds.length === 0) {
    return [unknownEvent(rawBody, 'Evento "ReadReceipt" sem "event.MessageIDs".', instanceId)];
  }
  const chatId = asString(data.Chat);
  const ack = mapAckState(state);
  return messageIds.map((messageId) => {
    return {
      type: "message.ack",
      provider: PROVIDER,
      instanceId,
      messageId,
      chatId,
      ack,
      raw: rawBody
    };
  });
}
function mapAckState(state) {
  if (state === "Delivered") return "delivered";
  if (state === "Read" || state === "ReadSelf") return "read";
  return "sent";
}
function connectionEvent(instanceId, state, qr, rawBody) {
  return { type: "connection.update", provider: PROVIDER, instanceId, state, qr, raw: rawBody };
}
function unknownEvent(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER, instanceId, raw, reason };
}
function mapGroupInfoEvent(instanceId, data, rawBody) {
  if (!data) {
    return [unknownEvent(rawBody, 'Evento "GroupInfo" sem campo "event".', instanceId)];
  }
  const groupId = asString(data.JID);
  if (!groupId) {
    return [unknownEvent(rawBody, 'Evento "GroupInfo" sem "event.JID".', instanceId)];
  }
  const events = [];
  const pushParticipantChange = (action, value) => {
    const participants = asStringArray(value);
    if (participants.length > 0) {
      events.push(groupUpdateEvent(instanceId, groupId, action, participants, rawBody));
    }
  };
  pushParticipantChange("participants.add", data.Join);
  pushParticipantChange("participants.remove", data.Leave);
  pushParticipantChange("participants.promote", data.Promote);
  pushParticipantChange("participants.demote", data.Demote);
  if (asRecord(data.Name)) {
    events.push(groupUpdateEvent(instanceId, groupId, "subject", void 0, rawBody));
  }
  if (asRecord(data.Topic)) {
    events.push(groupUpdateEvent(instanceId, groupId, "description", void 0, rawBody));
  }
  if (events.length === 0) {
    return [
      unknownEvent(
        rawBody,
        'Evento "GroupInfo" sem mudan\xE7a reconhecida (Join/Leave/Promote/Demote/Name/Topic ausentes ou n\xE3o populados).',
        instanceId
      )
    ];
  }
  return events;
}
function mapJoinedGroupEvent(instanceId, data, rawBody) {
  if (!data) {
    return unknownEvent(rawBody, 'Evento "JoinedGroup" sem campo "event".', instanceId);
  }
  const groupId = asString(data.JID);
  if (!groupId) {
    return unknownEvent(rawBody, 'Evento "JoinedGroup" sem "event.JID".', instanceId);
  }
  return groupUpdateEvent(instanceId, groupId, "participants.add", void 0, rawBody);
}
function groupUpdateEvent(instanceId, groupId, action, participants, rawBody) {
  return {
    type: "group.update",
    provider: PROVIDER,
    instanceId,
    groupId,
    action,
    participants,
    raw: rawBody
  };
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
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function secondsToEpochMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  return value * 1e3;
}
function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1e3;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  return void 0;
}

exports.wuzapi = wuzapi;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map