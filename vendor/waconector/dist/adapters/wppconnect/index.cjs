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
function digitsOnly(value) {
  return value.replace(/\D+/g, "");
}
function isJid(value) {
  return value.includes("@");
}
function isGroupChatId(value) {
  return value.endsWith("@g.us");
}
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

// src/adapters/wppconnect/index.ts
var PROVIDER = "wppconnect";
var WPPCONNECT_CAPABILITIES = [
  "instance.connect",
  "instance.status",
  "instance.logout",
  "messages.sendText",
  "messages.sendMedia",
  "messages.sendReaction",
  "messages.edit",
  "messages.delete",
  "messages.forward",
  "messages.star",
  "messages.unstar",
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
  "chats.mute",
  "chats.unmute",
  "chats.pin",
  "chats.unpin",
  "chats.markRead",
  "chats.markUnread",
  "presence.setTyping",
  "presence.set",
  "presence.subscribe",
  "labels.list",
  "labels.create",
  "labels.delete",
  "labels.addToChat",
  "labels.removeFromChat",
  "channels.create",
  "channels.delete",
  "business.updateProfile",
  "calls.reject",
  "webhooks.parse"
];
function wppconnect(options) {
  const session = options.session;
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { Authorization: `Bearer ${options.token}` },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.token],
    provider: PROVIDER,
    fetch: options.fetch
  });
  const instance = {
    connect: () => connectInstance(http, session, options),
    status: () => statusInstance(http, session),
    logout: () => logoutInstance(http, session)
  };
  const messages = {
    sendText: (input) => sendText(http, session, input),
    sendMedia: (input) => sendMedia(http, session, input),
    sendReaction: (input) => sendReaction(http, session, input),
    edit: (input) => editMessage(http, session, input),
    delete: (input) => deleteMessage(http, session, input),
    forward: (input) => forwardMessage(http, session, input),
    star: (input) => setMessageStarred(http, session, input, true),
    unstar: (input) => setMessageStarred(http, session, input, false),
    sendLocation: (input) => sendLocation(http, session, input),
    sendContactCard: (input) => sendContactCard(http, session, input),
    sendPoll: (input) => sendPoll(http, session, input)
  };
  const groups = {
    create: (input) => createGroup(http, session, input),
    getInfo: (groupId) => getGroupInfo(http, session, groupId),
    list: () => listGroups(http, session),
    addParticipants: (input) => updateGroupParticipants(http, session, input, "add"),
    removeParticipants: (input) => updateGroupParticipants(http, session, input, "remove"),
    promoteParticipants: (input) => updateGroupParticipants(http, session, input, "promote"),
    demoteParticipants: (input) => updateGroupParticipants(http, session, input, "demote"),
    updateSubject: (input) => updateGroupSubject(http, session, input),
    updateDescription: (input) => updateGroupDescription(http, session, input),
    updatePicture: (input) => updateGroupPicture(http, session, input),
    getInviteLink: (groupId) => fetchGroupInviteLink(http, session, groupId, false),
    revokeInviteLink: (groupId) => fetchGroupInviteLink(http, session, groupId, true),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, session, input),
    leaveGroup: (groupId) => leaveGroupCall(http, session, groupId)
  };
  const contacts = {
    list: () => listContacts(http, session),
    get: (chatId) => getContact(http, session, chatId),
    checkExists: (phone) => checkContactExists(http, session, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, session, chatId),
    getAbout: (chatId) => getContactAbout(http, session, chatId),
    block: (chatId) => blockContact(http, session, chatId),
    unblock: (chatId) => unblockContact(http, session, chatId),
    listBlocked: () => listBlockedContacts(http, session)
  };
  const chats = {
    archive: (chatId) => setChatArchived(http, session, chatId, true),
    unarchive: (chatId) => setChatArchived(http, session, chatId, false),
    mute: (chatId) => setChatMuted(http, session, chatId, true),
    unmute: (chatId) => setChatMuted(http, session, chatId, false),
    pin: (chatId) => setChatPinned(http, session, chatId, true),
    unpin: (chatId) => setChatPinned(http, session, chatId, false),
    markRead: (chatId) => markChatRead(http, session, chatId),
    markUnread: (chatId) => markChatUnread(http, session, chatId)
  };
  const presence = {
    setTyping: (input) => setTyping(http, session, input),
    set: (state) => setOnlinePresence(http, session, state),
    subscribe: (chatId) => subscribePresence(http, session, chatId)
  };
  const labels = {
    list: () => listLabels(http, session),
    create: (input) => createLabel(http, session, input),
    delete: (labelId) => deleteLabel(http, session, labelId),
    addToChat: (input) => setChatLabel(http, session, input, "add"),
    removeFromChat: (input) => setChatLabel(http, session, input, "remove")
  };
  const channels = {
    create: (input) => createChannel(http, session, input),
    delete: (channelId) => deleteChannel(http, session, channelId)
  };
  const business = {
    updateProfile: (input) => updateBusinessProfile(http, session, input)
  };
  const calls = {
    reject: (input) => rejectCall(http, session, input)
  };
  return {
    provider: PROVIDER,
    capabilities: WPPCONNECT_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    labels,
    channels,
    business,
    calls,
    parseWebhook: (input) => parseWebhook(input)
  };
}
function sessionPath(session, suffix) {
  return `/api/${encodeURIComponent(session)}${suffix}`;
}
function toWppconnectRecipient(chatId) {
  if (!isJid(chatId)) {
    return { phone: chatId, isGroup: false, isNewsletter: false, isLid: false };
  }
  const atIndex = chatId.indexOf("@");
  const user = atIndex >= 0 ? chatId.slice(0, atIndex) : chatId;
  const server = atIndex >= 0 ? chatId.slice(atIndex + 1) : "";
  return {
    phone: user,
    isGroup: isGroupChatId(chatId),
    isNewsletter: server === "newsletter",
    isLid: server === "lid"
  };
}
function toWppconnectMentionJid(mention) {
  return isJid(mention) ? mention : `${digitsOnly(mention)}@c.us`;
}
var MEDIA_ENDPOINTS = {
  image: { path: "/send-file-base64", field: "base64", supportsCaption: true },
  video: { path: "/send-file-base64", field: "base64", supportsCaption: true },
  document: { path: "/send-file-base64", field: "base64", supportsCaption: true },
  audio: { path: "/send-voice-base64", field: "base64", supportsCaption: false },
  sticker: { path: "/send-sticker", field: "path", supportsCaption: false }
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
    'WPPConnect: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER }
  );
}
async function connectInstance(http, session, options) {
  const body = { waitQrCode: options.waitQrCode ?? true };
  if (options.webhook) {
    body.webhook = options.webhook;
  }
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/start-session"),
    body
  });
  const record = asRecord(response);
  const status = record ? asString(record.status) : void 0;
  const qr = status === "qrcode" ? asString(record?.qrcode) : void 0;
  return { qr, raw: response };
}
async function statusInstance(http, session) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, "/status-session")
  });
  const record = asRecord(response);
  return { state: mapInstanceState(record?.status), raw: response };
}
function mapInstanceState(status) {
  if (status === null) return "disconnected";
  const value = asString(status);
  if (value === void 0) return "unknown";
  switch (value) {
    case "CLOSED":
      return "disconnected";
    case "INITIALIZING":
      return "connecting";
    case "QRCODE":
      return "qr";
    case "PHONECODE":
      return "qr";
    case "CONNECTED":
      return "connected";
    default:
      return "unknown";
  }
}
async function logoutInstance(http, session) {
  await http.request({ method: "POST", path: sessionPath(session, "/logout-session") });
}
function unwrapResponse(body) {
  const record = asRecord(body);
  return record && "response" in record ? record.response : body;
}
function unwrapArrayResponse(body) {
  const unwrapped = unwrapResponse(body);
  return Array.isArray(unwrapped) ? unwrapped[0] : unwrapped;
}
async function sendText(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  if (input.mentions && input.mentions.length > 0) {
    const body2 = {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      message: input.text,
      mentioned: input.mentions.map(toWppconnectMentionJid)
    };
    const response2 = await http.request({
      method: "POST",
      path: sessionPath(session, "/send-mentioned"),
      body: body2
    });
    return mapSentMessageFromMessage(response2, recipient.phone);
  }
  const body = {
    phone: recipient.phone,
    isGroup: recipient.isGroup,
    isNewsletter: recipient.isNewsletter,
    isLid: recipient.isLid,
    message: input.text
  };
  if (input.quotedId) {
    body.options = { quotedMsg: input.quotedId };
  }
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/send-message"),
    body
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}
async function sendMedia(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  const endpoint = MEDIA_ENDPOINTS[input.media.kind];
  const value = resolveMediaValue(input.media);
  const body = {
    phone: recipient.phone,
    isGroup: recipient.isGroup,
    [endpoint.field]: value
  };
  if (endpoint.supportsCaption && input.caption) {
    body.caption = input.caption;
  }
  if (input.media.kind === "document" && input.media.filename) {
    body.filename = input.media.filename;
  }
  if (input.quotedId) {
    body.quotedMessageId = input.quotedId;
  }
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, endpoint.path),
    body
  });
  return mapSentMessageFromAckId(response, recipient.phone);
}
async function sendReaction(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  const reaction = input.emoji === "" ? false : input.emoji;
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/react-message"),
    body: { msgId: input.messageId, reaction }
  });
  return { id: input.messageId, chatId: recipient.phone, raw: response };
}
async function editMessage(http, session, input) {
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/edit-message"),
    body: { id: input.messageId, newText: input.text }
  });
  const message = asRecord(unwrapResponse(response));
  const id = asString(message?.id) ?? input.messageId;
  const chatId = extractChatId(message?.chatId) ?? toWppconnectRecipient(input.to).phone;
  const timestamp = secondsToEpochMs(message?.timestamp ?? message?.t);
  return { id, chatId, timestamp, raw: response };
}
async function deleteMessage(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/delete-message"),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      messageId: input.messageId,
      onlyLocal: false
    }
  });
}
async function forwardMessage(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/forward-messages"),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      messageId: input.messageId
    }
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}
async function setMessageStarred(http, session, input, star) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/star-message"),
    body: { messageId: input.messageId, star }
  });
}
async function sendLocation(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  const body = {
    phone: recipient.phone,
    isGroup: recipient.isGroup,
    lat: String(input.latitude),
    lng: String(input.longitude)
  };
  if (input.name) body.title = input.name;
  if (input.address) body.address = input.address;
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/send-location"),
    body
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}
async function sendContactCard(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/contact-vcard"),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      name: input.contactName,
      contactsId: [input.contactPhone]
    }
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}
async function sendPoll(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/send-poll-message"),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      name: input.question,
      choices: input.options,
      options: { selectableCount: input.allowMultipleAnswers ? input.options.length : 1 }
    }
  });
  return mapSentMessageFromMessage(response, recipient.phone);
}
function mapSentMessageFromMessage(body, requestedPhone) {
  const message = asRecord(unwrapArrayResponse(body));
  const id = asString(message?.id) ?? `wppconnect-${Date.now()}`;
  const chatId = extractChatId(message?.chatId) ?? requestedPhone;
  const timestamp = secondsToEpochMs(message?.timestamp ?? message?.t);
  return { id, chatId, timestamp, raw: body };
}
function mapSentMessageFromAckId(body, requestedPhone) {
  const data = asRecord(unwrapArrayResponse(body));
  const id = asString(data?.id) ?? `wppconnect-${Date.now()}`;
  return { id, chatId: requestedPhone, raw: body };
}
function extractChatId(value) {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return record ? asString(record._serialized) : void 0;
}
async function createGroup(http, session, input) {
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/create-group"),
    body: { name: input.subject, participants: input.participants }
  });
  const data = asRecord(unwrapResponse(response));
  const groupInfoList = Array.isArray(data?.groupInfo) ? data.groupInfo : void 0;
  const info = asRecord(groupInfoList?.[0]);
  const id = toWppconnectGroupId(asString(info?.id));
  const subject = asString(info?.name) ?? input.subject;
  return {
    id,
    subject,
    participants: input.participants.map(toFallbackParticipant),
    raw: response
  };
}
function toWppconnectGroupId(rawId) {
  if (!rawId) return "";
  return rawId.includes("@") ? rawId : `${rawId}@g.us`;
}
function toFallbackParticipant(id) {
  return { id, isAdmin: false, isSuperAdmin: false };
}
async function getGroupInfo(http, session, groupId) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/group-info/${encodeURIComponent(groupId)}`)
  });
  const data = asRecord(unwrapResponse(response));
  return {
    id: asString(data?.id) ?? groupId,
    subject: asString(data?.name) ?? asString(data?.subject) ?? "",
    description: asString(data?.description),
    participants: mapGroupParticipants(data?.participants) ?? [],
    raw: response
  };
}
function mapGroupParticipants(value) {
  if (!Array.isArray(value)) return void 0;
  return value.map((item) => {
    const record = asRecord(item);
    return {
      id: asString(record?.id) ?? "",
      isAdmin: asBoolean(record?.isAdmin) ?? false,
      // isSuperAdmin não confirmado nesta resposta (ver docs/providers/wppconnect.md) — sempre false.
      isSuperAdmin: false
    };
  });
}
var PARTICIPANT_ENDPOINTS = {
  add: "/add-participant-group",
  remove: "/remove-participant-group",
  promote: "/promote-participant-group",
  demote: "/demote-participant-group"
};
async function updateGroupParticipants(http, session, input, action) {
  const path = sessionPath(session, PARTICIPANT_ENDPOINTS[action]);
  await Promise.all(
    input.participants.map(
      (phone) => http.request({ method: "POST", path, body: { groupId: input.groupId, phone } })
    )
  );
}
async function updateGroupSubject(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/group-subject"),
    body: { groupId: input.groupId, title: input.subject }
  });
}
async function updateGroupDescription(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/group-description"),
    body: { groupId: input.groupId, description: input.description }
  });
}
async function updateGroupPicture(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/group-pic"),
    body: { groupId: input.groupId, path: resolveMediaValue(input.media) }
  });
}
async function fetchGroupInviteLink(http, session, groupId, revoke) {
  const routeSuffix = revoke ? "/group-revoke-link/" : "/group-invite-link/";
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `${routeSuffix}${encodeURIComponent(groupId)}`)
  });
  const link = extractInviteLinkValue(unwrapResponse(response)) ?? "";
  return { link: normalizeInviteLink(link), raw: response };
}
function extractInviteLinkValue(value) {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return void 0;
  return asString(record.link) ?? asString(record.inviteLink) ?? asString(record.url);
}
async function joinGroupViaInviteLink(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/join-code"),
    body: { inviteCode: input.invite }
  });
}
async function leaveGroupCall(http, session, groupId) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/leave-group"),
    body: { groupId }
  });
}
async function listGroups(http, session) {
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/list-chats"),
    body: { onlyGroups: true }
  });
  const items = unwrapResponse(response);
  const array = Array.isArray(items) ? items : [];
  return array.map((item) => mapChatToGroupInfo(item));
}
function mapChatToGroupInfo(item) {
  const data = asRecord(item);
  return {
    id: extractChatId(data?.id) ?? "",
    subject: asString(data?.name) ?? "",
    // `Chat` não expõe participantes (ver docstring de `listGroups`) — vazio de propósito, nunca
    // inventado a partir de outro campo.
    participants: [],
    raw: item
  };
}
async function listContacts(http, session) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, "/all-contacts")
  });
  const items = unwrapResponse(response);
  const array = Array.isArray(items) ? items : [];
  return array.map((item) => mapContact(item));
}
async function getContact(http, session, chatId) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/contact/${encodeURIComponent(chatId)}`)
  });
  return mapContact(unwrapResponse(response));
}
function mapContact(value) {
  const data = asRecord(value);
  const thumb = asRecord(data?.profilePicThumbObj);
  return {
    id: extractChatId(data?.id) ?? "",
    name: asString(data?.name) ?? asString(data?.pushname) ?? asString(data?.formattedName) ?? asString(data?.shortName),
    hasWhatsApp: asBoolean(data?.isWAContact),
    profilePictureUrl: thumb ? asString(thumb.imgFull) ?? asString(thumb.img) : void 0,
    raw: value
  };
}
async function checkContactExists(http, session, phone) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/check-number-status/${encodeURIComponent(phone)}`)
  });
  const data = asRecord(unwrapResponse(response));
  const idRecord = asRecord(data?.id);
  return {
    exists: asBoolean(data?.numberExists) ?? false,
    chatId: idRecord ? asString(idRecord._serialized) : void 0,
    raw: response
  };
}
async function getContactProfilePicture(http, session, chatId) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/profile-pic/${encodeURIComponent(chatId)}`)
  });
  const data = asRecord(unwrapResponse(response));
  return { url: asString(data?.imgFull) ?? asString(data?.img), raw: response };
}
async function getContactAbout(http, session, chatId) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/profile-status/${encodeURIComponent(chatId)}`)
  });
  const data = asRecord(unwrapResponse(response));
  const about = asString(data?.status);
  return { about: about === "" ? void 0 : about, raw: response };
}
async function blockContact(http, session, chatId) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/block-contact"),
    body: { phone: chatId }
  });
}
async function unblockContact(http, session, chatId) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/unblock-contact"),
    body: { phone: chatId }
  });
}
async function listBlockedContacts(http, session) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, "/blocklist")
  });
  const items = unwrapResponse(response);
  const array = Array.isArray(items) ? items : [];
  const phones = [];
  for (const item of array) {
    const phone = asString(asRecord(item)?.phone);
    if (phone !== void 0) phones.push(phone);
  }
  return phones;
}
async function setChatArchived(http, session, chatId, value) {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/archive-chat"),
    body: { phone: recipient.phone, isGroup: recipient.isGroup, value }
  });
}
var MUTE_DURATION = { time: 24 * 365 * 10, type: "hours" };
async function setChatMuted(http, session, chatId, muted) {
  const recipient = toWppconnectRecipient(chatId);
  const body = { phone: recipient.phone, isGroup: recipient.isGroup };
  if (muted) {
    body.time = MUTE_DURATION.time;
    body.type = MUTE_DURATION.type;
  }
  await http.request({
    method: "POST",
    path: sessionPath(session, "/send-mute"),
    body
  });
}
async function setChatPinned(http, session, chatId, pinned) {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/pin-chat"),
    body: {
      phone: recipient.phone,
      isGroup: recipient.isGroup,
      state: pinned ? "true" : "false"
    }
  });
}
async function markChatUnread(http, session, chatId) {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/mark-unseen"),
    body: { phone: recipient.phone, isGroup: recipient.isGroup }
  });
}
async function markChatRead(http, session, chatId) {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/send-seen"),
    body: { phone: recipient.phone, isGroup: recipient.isGroup }
  });
}
async function setTyping(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  const path = input.state === "recording" ? "/recording" : "/typing";
  const value = input.state !== "paused";
  await http.request({
    method: "POST",
    path: sessionPath(session, path),
    body: { phone: recipient.phone, isGroup: recipient.isGroup, value }
  });
}
async function setOnlinePresence(http, session, state) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/set-online-presence"),
    body: { isOnline: state === "online" }
  });
}
async function subscribePresence(http, session, chatId) {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/subscribe-presence"),
    body: { phone: recipient.phone, isGroup: recipient.isGroup, all: false }
  });
}
async function listLabels(http, session) {
  const body = await http.request({
    method: "GET",
    path: sessionPath(session, "/get-all-labels")
  });
  const record = asRecord(body);
  const items = record && Array.isArray(record.response) ? record.response : [];
  return items.map((item) => mapWppconnectLabel(item));
}
async function createLabel(http, session, input) {
  const before = new Set((await listLabels(http, session)).map((label) => label.id));
  const body = { name: input.name };
  if (input.color !== void 0) {
    body.options = { labelColor: input.color };
  }
  await http.request({ method: "POST", path: sessionPath(session, "/add-new-label"), body });
  const after = await listLabels(http, session);
  const created = after.find((label) => !before.has(label.id));
  if (!created) {
    throw new WaConnectorError(
      "PROVIDER_ERROR",
      "WPPConnect: n\xE3o foi poss\xEDvel determinar o id do label criado por /add-new-label \u2014 GET /get-all-labels n\xE3o trouxe nenhum id novo em rela\xE7\xE3o \xE0 listagem anterior.",
      { provider: PROVIDER }
    );
  }
  return created;
}
async function deleteLabel(http, session, labelId) {
  await http.request({
    method: "PUT",
    path: sessionPath(session, `/delete-label/${encodeURIComponent(labelId)}`)
  });
}
async function setChatLabel(http, session, input, type) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/add-or-remove-label"),
    body: {
      chatIds: [toWppconnectMentionJid(input.chatId)],
      options: [{ labelId: input.labelId, type }]
    }
  });
}
function mapWppconnectLabel(body) {
  const record = asRecord(body);
  const color = record ? asNumber(record.color) : void 0;
  return {
    id: (record ? asString(record.id) : void 0) ?? "",
    name: (record ? asString(record.name) : void 0) ?? "",
    color: color === void 0 ? void 0 : String(color),
    raw: body
  };
}
async function createChannel(http, session, input) {
  const body = await http.request({
    method: "POST",
    path: sessionPath(session, "/newsletter"),
    body: { name: input.name, options: { description: input.description } }
  });
  return mapWppconnectChannel(body, input);
}
async function deleteChannel(http, session, channelId) {
  await http.request({
    method: "DELETE",
    path: sessionPath(session, `/newsletter/${encodeURIComponent(channelId)}`)
  });
}
function mapWppconnectChannel(body, fallback = {}) {
  const record = asRecord(body);
  return {
    id: (record ? asString(record.idJid) : void 0) ?? "",
    name: (record ? asString(record.name) : void 0) ?? fallback.name ?? "",
    description: (record ? asString(record.description) : void 0) ?? fallback.description,
    subscribersCount: record ? asNumber(record.subscribersCount) : void 0,
    raw: body
  };
}
async function updateBusinessProfile(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/edit-business-profile"),
    body: { adress: input.address, email: input.email }
  });
}
async function rejectCall(http, session, input) {
  if (!input.callId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'calls.reject no WPPConnect exige "callId" (body {callId}).',
      { provider: PROVIDER }
    );
  }
  await http.request({
    method: "POST",
    path: sessionPath(session, "/reject-call"),
    body: { callId: input.callId }
  });
}
function parseWebhook(input) {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook WPPConnect: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe(input) {
  const body = input.body;
  const record = asRecord(body);
  if (!record) {
    return [unknownEvent(body, "Corpo do webhook WPPConnect n\xE3o \xE9 um objeto JSON.")];
  }
  const instanceId = asString(record.session);
  const event = asString(record.event);
  if (!event) {
    return [unknownEvent(body, 'Payload de webhook WPPConnect sem campo "event".', instanceId)];
  }
  switch (event) {
    case "onmessage":
    case "unreadmessages":
    case "onselfmessage":
      return [mapMessageEvent(record, instanceId, body)];
    case "onack":
      return [mapAckEvent(record, instanceId, body)];
    case "status-find":
      return [mapStatusFindEvent(record, instanceId, body)];
    case "qrcode":
      return [connectionEvent(instanceId, "qr", asString(record.qrcode), body)];
    case "phoneCode":
      return [connectionEvent(instanceId, "qr", void 0, body)];
    case "onparticipantschanged":
      return [mapParticipantsChangedEvent(record, instanceId, body)];
    case "onpresencechanged":
    case "location":
    case "incomingcall":
      return [
        unknownEvent(
          body,
          `Evento WPPConnect "${event}" reconhecido, mas sem equivalente can\xF4nico nesta fase (core n\xE3o modela presen\xE7a/localiza\xE7\xE3o ao vivo/chamada recebida).`,
          instanceId
        )
      ];
    case "onreactionmessage":
    case "onrevokedmessage":
    case "onpollresponse":
    case "onupdatelabel":
      return [
        unknownEvent(
          body,
          `Evento WPPConnect "${event}" reconhecido, mas sem shape de payload confirmado nesta fase (a lib subjacente tipa esses callbacks como "any") \u2014 ver docs/providers/wppconnect.md.`,
          instanceId
        )
      ];
    default:
      return [unknownEvent(body, `Evento WPPConnect n\xE3o reconhecido: "${event}".`, instanceId)];
  }
}
var MESSAGE_KIND_BY_TYPE = {
  chat: "text",
  image: "image",
  video: "video",
  audio: "audio",
  ptt: "audio",
  document: "document",
  sticker: "sticker",
  location: "location",
  vcard: "contact"
};
var MEDIA_MESSAGE_KINDS = /* @__PURE__ */ new Set([
  "image",
  "video",
  "audio",
  "document",
  "sticker"
]);
function mapMessageEvent(record, instanceId, rawBody) {
  const id = asString(record.id) ?? `wppconnect-unknown-${Date.now()}`;
  const chatId = extractChatId(record.chatId) ?? "";
  const fromMe = asBoolean(record.fromMe) ?? false;
  const from = asString(record.author) ?? asString(record.from);
  const timestamp = secondsToEpochMs(record.timestamp ?? record.t) ?? Date.now();
  const typeValue = asString(record.type);
  const kind = typeValue && MESSAGE_KIND_BY_TYPE[typeValue] || "unknown";
  const text = kind === "text" ? asString(record.body) : asString(record.caption);
  const media = MEDIA_MESSAGE_KINDS.has(kind) ? buildMediaRef(kind, record) : void 0;
  const message = {
    id,
    chatId,
    from,
    fromMe,
    timestamp,
    kind,
    text,
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
function buildMediaRef(kind, record) {
  return { kind, mimeType: asString(record.mimetype) };
}
function mapAckEvent(record, instanceId, rawBody) {
  const idRecord = asRecord(record.id);
  const messageId = idRecord ? asString(idRecord._serialized) ?? asString(idRecord.id) : void 0;
  if (!messageId) {
    return unknownEvent(
      rawBody,
      'Evento "onack" do WPPConnect sem "id._serialized"/"id.id" reconhec\xEDvel.',
      instanceId
    );
  }
  const ack = mapAckType(record.ack);
  if (!ack) {
    return unknownEvent(
      rawBody,
      `Evento "onack" com valor de "ack" n\xE3o mape\xE1vel para MessageAck: ${String(record.ack)}.`,
      instanceId
    );
  }
  const event = {
    type: "message.ack",
    provider: PROVIDER,
    instanceId,
    messageId,
    chatId: asString(record.to),
    ack,
    raw: rawBody
  };
  return event;
}
function mapAckType(value) {
  const code = asNumber(value);
  if (code === void 0) return void 0;
  if (code < 0) return "error";
  switch (code) {
    case 0:
      return "pending";
    case 1:
      return "sent";
    case 2:
      return "delivered";
    case 3:
      return "read";
    case 4:
      return "played";
    default:
      return void 0;
  }
}
var STATUS_FIND_STATE = {
  inChat: "connected",
  isLogged: "connected",
  notLogged: "qr",
  qrReadSuccess: "connecting",
  autocloseCalled: "disconnected",
  browserClose: "disconnected",
  disconnectedMobile: "disconnected",
  phoneNotConnected: "disconnected",
  serverClose: "disconnected",
  qrReadError: "unknown",
  qrReadFail: "unknown"
};
function mapStatusFindEvent(record, instanceId, rawBody) {
  const status = asString(record.status);
  const state = status && STATUS_FIND_STATE[status] || "unknown";
  return connectionEvent(instanceId, state, void 0, rawBody);
}
var PARTICIPANT_OPERATION_ACTION = {
  add: "participants.add",
  remove: "participants.remove",
  promote: "participants.promote",
  demote: "participants.demote"
};
function mapParticipantsChangedEvent(record, instanceId, rawBody) {
  const groupId = asString(record.groupId);
  if (!groupId) {
    return unknownEvent(rawBody, 'Evento "onparticipantschanged" sem "groupId".', instanceId);
  }
  const operation = asString(record.operation);
  const action = operation ? PARTICIPANT_OPERATION_ACTION[operation] : void 0;
  const participants = asStringArray(record.who);
  const event = {
    type: "group.update",
    provider: PROVIDER,
    instanceId,
    groupId,
    action,
    participants: participants.length > 0 ? participants : void 0,
    raw: rawBody
  };
  return event;
}
function connectionEvent(instanceId, state, qr, rawBody) {
  return { type: "connection.update", provider: PROVIDER, instanceId, state, qr, raw: rawBody };
}
function unknownEvent(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER, instanceId, raw, reason };
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
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function secondsToEpochMs(value) {
  const seconds = asNumber(value);
  return seconds === void 0 ? void 0 : seconds * 1e3;
}

exports.wppconnect = wppconnect;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map