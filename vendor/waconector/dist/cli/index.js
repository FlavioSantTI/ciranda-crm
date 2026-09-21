#!/usr/bin/env node
import { parseArgs } from 'util';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';

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
function isWaConnectorError(value) {
  if (value instanceof WaConnectorError) return true;
  return typeof value === "object" && value !== null && value.isWaConnectorError === true;
}
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

// src/adapters/evolution/index.ts
var PROVIDER = "evolution";
var EVOLUTION_CAPABILITIES = [
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
  "messages.download",
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
  "chats.mute",
  "chats.pin",
  "chats.unpin",
  "presence.setTyping",
  "labels.list",
  "labels.create",
  "labels.update",
  "labels.delete",
  "labels.addToChat",
  "labels.removeFromChat",
  "channels.list",
  "channels.create",
  "channels.getInfo",
  "channels.follow",
  "channels.getMessages",
  "calls.reject",
  "webhooks.parse"
];
function evolution(options) {
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { apikey: options.apiKey },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.apiKey],
    provider: PROVIDER,
    fetch: options.fetch
  });
  const inst = options.instance;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const msgPath = (action) => inst ? `/message/send${cap(action)}/${inst}` : `/send/${action}`;
  const instance = {
    connect: () => connectInstance(http, options),
    status: () => statusInstance(http, inst),
    logout: () => logoutInstance(http, inst)
  };
  const messages = {
    sendText: (input) => sendText(http, input, msgPath("text")),
    sendMedia: (input) => sendMedia(http, input, msgPath("media")),
    sendReaction: (input) => sendReaction(http, input),
    edit: (input) => editMessage(http, input),
    delete: (input) => deleteMessage(http, input),
    markRead: (input) => markMessageRead(http, input),
    sendLocation: (input) => sendLocation(http, input, msgPath("location")),
    sendContactCard: (input) => sendContactCard(http, input, msgPath("contact")),
    sendPoll: (input) => sendPoll(http, input, msgPath("poll")),
    download: (input) => downloadMedia(http, input)
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
    getInviteLink: (groupId) => getGroupInviteLink(http, groupId, false),
    revokeInviteLink: (groupId) => getGroupInviteLink(http, groupId, true),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, input),
    leaveGroup: (groupId) => leaveGroupById(http, groupId)
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
    archive: (chatId) => archiveChat(http, chatId),
    mute: (chatId) => muteChat(http, chatId),
    pin: (chatId) => pinChat(http, chatId),
    unpin: (chatId) => unpinChat(http, chatId)
  };
  const presence = {
    setTyping: (input) => setChatPresence(http, input, inst)
  };
  const labels = {
    list: () => listLabels(http),
    create: (input) => createLabel(http, input),
    update: (input) => updateLabel(http, input),
    delete: (labelId) => deleteLabel(http, labelId),
    addToChat: (input) => labelChat(http, input, true),
    removeFromChat: (input) => labelChat(http, input, false)
  };
  const channels = {
    list: () => listChannels(http),
    create: (input) => createChannel(http, input),
    getInfo: (channelId) => getChannelInfo(http, channelId),
    follow: (channelId) => followChannel(http, channelId),
    getMessages: (input) => getChannelMessages(http, input)
  };
  const calls = {
    reject: (input) => rejectCall(http, input)
  };
  return {
    provider: PROVIDER,
    capabilities: EVOLUTION_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    labels,
    channels,
    calls,
    parseWebhook: (input) => parseWebhook(input)
  };
}
function toProviderNumber(chatId) {
  return chatId;
}
function toMentionJid(chatId) {
  if (isJid(chatId)) return chatId;
  return `${digitsOnly(chatId)}@s.whatsapp.net`;
}
function toProviderGroupJid(groupId) {
  return groupId;
}
async function connectInstance(http, options) {
  const body = {};
  if (options.webhookUrl) body.webhookUrl = options.webhookUrl;
  if (options.subscribe) body.subscribe = options.subscribe;
  const path = options.instance ? `/instance/connect/${options.instance}` : "/instance/connect";
  const connectResponse = await http.request({
    method: "POST",
    path,
    body
  });
  let qrResponse;
  try {
    qrResponse = await http.request({ method: "GET", path: "/instance/qr" });
  } catch {
    qrResponse = void 0;
  }
  const qrData = asRecord(qrResponse?.data);
  const qr = asString(qrData?.qrcode) ?? asString(qrData?.code);
  return {
    qr,
    raw: { connect: connectResponse, qr: qrResponse }
  };
}
async function statusInstance(http, instance) {
  const path = instance ? `/instance/connect/${instance}` : "/instance/status";
  const response = await http.request({
    method: "GET",
    path
  });
  const data = asRecord(response.data) ?? asRecord(response);
  return { state: mapInstanceState(data), raw: response };
}
async function logoutInstance(http, instance) {
  const path = instance ? `/instance/logout/${instance}` : "/instance/logout";
  await http.request({ method: "DELETE", path });
}
function mapInstanceState(data) {
  if (!data) return "unknown";
  const instanceObj = asRecord(data.instance);
  if (instanceObj) {
    const state = asString(instanceObj.state);
    if (state === "open") return "connected";
    if (state === "close" || state === "closed") return "disconnected";
    if (state === "connecting") return "connecting";
    if (state === "qr") return "qr";
  }
  const connected = asBoolean(data.Connected);
  const loggedIn = asBoolean(data.LoggedIn);
  if (connected === void 0 || loggedIn === void 0) return "unknown";
  if (!connected && !loggedIn) return "disconnected";
  if (connected && !loggedIn) return "qr";
  if (connected && loggedIn) return "connected";
  return "connecting";
}
async function sendText(http, input, path) {
  const body = {
    number: toProviderNumber(input.to),
    text: input.text
  };
  if (input.quotedId) {
    body.quoted = { messageId: input.quotedId };
  }
  if (input.mentions && input.mentions.length > 0) {
    body.mentionedJid = input.mentions.map(toMentionJid);
  }
  const response = await http.request({
    method: "POST",
    path,
    body
  });
  return toSentMessage(input.to, response);
}
async function sendMedia(http, input, path) {
  const url = input.media.url ?? input.media.base64;
  if (!url) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'Evolution GO (adapter F1): sendMedia requer "media.url" ou "media.base64".',
      { provider: PROVIDER }
    );
  }
  const body = {
    number: toProviderNumber(input.to),
    type: input.media.kind,
    url
  };
  if (input.caption) body.caption = input.caption;
  if (input.media.filename) body.filename = input.media.filename;
  if (input.quotedId) body.quoted = { messageId: input.quotedId };
  const response = await http.request({
    method: "POST",
    path,
    body
  });
  return toSentMessage(input.to, response);
}
async function sendReaction(http, input) {
  const body = {
    number: toProviderNumber(input.to),
    // O provider rejeita `reaction: ""` com 400 ("message reaction is required") — a remoção usa o
    // sentinel literal "remove" (que o serviço traduz internamente para texto vazio no protocolo
    // whatsmeow). O modelo canônico usa `emoji: ''` para remoção (ADR-0008); traduzimos aqui.
    reaction: input.emoji === "" ? "remove" : input.emoji,
    id: input.messageId,
    // `SendReactionInput` (contrato canônico) não carrega se a mensagem-alvo foi enviada pela
    // própria instância nem o `participant` (autor, em grupos) — mesma limitação já documentada
    // para `quotedId` em sendText/sendMedia. `false` é o valor seguro para o caso mais comum
    // (reagir a uma mensagem recebida); ver "Limites e particularidades" no dossiê.
    fromMe: false
  };
  const response = await http.request({
    method: "POST",
    path: "/message/react",
    body
  });
  return toSentMessage(input.to, response);
}
async function editMessage(http, input) {
  const response = await http.request({
    method: "POST",
    path: "/message/edit",
    body: {
      chat: toProviderNumber(input.to),
      message: input.text,
      messageId: input.messageId
    }
  });
  const data = asRecord(response.data);
  return {
    id: asString(data?.messageId) ?? input.messageId,
    chatId: input.to,
    timestamp: toEpochMs(data?.timestamp),
    raw: response
  };
}
async function deleteMessage(http, input) {
  await http.request({
    method: "POST",
    path: "/message/delete",
    body: {
      chat: toProviderNumber(input.to),
      messageId: input.messageId
    }
  });
}
async function markMessageRead(http, input) {
  await http.request({
    method: "POST",
    path: "/message/markread",
    body: { id: [input.messageId], number: toProviderNumber(input.to) }
  });
}
async function sendLocation(http, input, path) {
  const body = {
    number: toProviderNumber(input.to),
    latitude: input.latitude,
    longitude: input.longitude
  };
  if (input.name) body.name = input.name;
  if (input.address) body.address = input.address;
  const response = await http.request({
    method: "POST",
    path,
    body
  });
  return toSentMessage(input.to, response);
}
async function sendContactCard(http, input, path) {
  const response = await http.request({
    method: "POST",
    path,
    body: {
      number: toProviderNumber(input.to),
      vcard: { fullName: input.contactName, phone: input.contactPhone }
    }
  });
  return toSentMessage(input.to, response);
}
async function sendPoll(http, input, path) {
  const response = await http.request({
    method: "POST",
    path,
    body: {
      number: toProviderNumber(input.to),
      question: input.question,
      options: input.options,
      maxAnswer: input.allowMultipleAnswers ? input.options.length : 0
    }
  });
  return toSentMessage(input.to, response);
}
function toSentMessage(to, response) {
  const key = asRecord(response.key);
  if (key) {
    return {
      id: asString(key.id) ?? asString(key.ID) ?? "",
      chatId: to,
      timestamp: toEpochMs(response.messageTimestamp) ?? Date.now(),
      raw: response
    };
  }
  const data = asRecord(response.data);
  const info = asRecord(data?.Info);
  return {
    // `Info.ID` é sempre populado pelo provider com o id de mensagem real (string) na construção
    // da resposta de envio (send_service.go) — o fallback para `ServerID` é só defensivo.
    // `types.MessageServerID` é `int` no whatsmeow (serializa como número JSON), então o fallback
    // faz a coerção número→string explicitamente (senão `asString` nunca aceitaria o valor).
    id: asString(info?.ID) ?? asIdString(info?.ServerID) ?? "",
    chatId: to,
    timestamp: toEpochMs(info?.Timestamp),
    raw: response
  };
}
async function downloadMedia(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/message/downloadimage",
    body: extractMediaDescriptor(input.raw)
  });
  const record = asRecord(body);
  return {
    base64: (record ? asString(record.image) : void 0) ?? "",
    raw: body
  };
}
function extractMediaDescriptor(raw) {
  const body = asRecord(raw);
  const data = body ? asRecord(body.data) : void 0;
  const message = data ? asRecord(data.Message) : void 0;
  const mediaObject = message ? asRecord(message.imageMessage) ?? asRecord(message.videoMessage) ?? asRecord(message.audioMessage) ?? asRecord(message.documentMessage) ?? asRecord(message.stickerMessage) : void 0;
  if (!mediaObject) return {};
  const fileLengthRaw = mediaObject.fileLength;
  const fileLength = typeof fileLengthRaw === "number" ? fileLengthRaw : typeof fileLengthRaw === "string" ? Number(fileLengthRaw) : void 0;
  return {
    url: asString(mediaObject.URL) ?? asString(mediaObject.url),
    mimetype: asString(mediaObject.mimetype),
    directPath: asString(mediaObject.directPath),
    mediaKey: mediaObject.mediaKey,
    fileEncSHA256: mediaObject.fileEncSHA256,
    fileSHA256: mediaObject.fileSHA256,
    fileLength
  };
}
async function createGroup(http, input) {
  const body = {
    groupName: input.subject,
    participants: input.participants.map(toProviderNumber)
  };
  const response = await http.request({
    method: "POST",
    path: "/group/create",
    body
  });
  const data = asRecord(response.data);
  const added = asStringArray(data?.added);
  const participants = (added.length > 0 ? added : input.participants).map(
    (id) => ({ id, isAdmin: false, isSuperAdmin: false })
  );
  return {
    id: asString(data?.jid) ?? "",
    subject: asString(data?.name) ?? input.subject,
    owner: asString(data?.owner),
    participants,
    raw: response
  };
}
async function getGroupInfo(http, groupId) {
  const response = await http.request({
    method: "POST",
    path: "/group/info",
    body: { groupJid: toProviderGroupJid(groupId) }
  });
  return mapGroupInfo(asRecord(response.data), { id: groupId }, response);
}
async function listGroups(http) {
  const response = await http.request({ method: "GET", path: "/group/list" });
  const items = Array.isArray(response.data) ? response.data : [];
  return items.map((item) => asRecord(item)).filter((item) => item !== void 0).map((data) => mapGroupInfo(data, {}, data));
}
async function updateGroupParticipants(http, input, action) {
  await http.request({
    method: "POST",
    path: "/group/participant",
    body: {
      groupJid: toProviderGroupJid(input.groupId),
      participants: input.participants.map(toProviderNumber),
      action
    }
  });
}
async function updateGroupSubject(http, input) {
  await http.request({
    method: "POST",
    path: "/group/name",
    body: {
      groupJid: toProviderGroupJid(input.groupId),
      name: input.subject
    }
  });
}
async function updateGroupDescription(http, input) {
  await http.request({
    method: "POST",
    path: "/group/description",
    body: {
      groupJid: toProviderGroupJid(input.groupId),
      description: input.description
    }
  });
}
async function updateGroupPicture(http, input) {
  await http.request({
    method: "POST",
    path: "/group/photo",
    body: {
      groupJid: toProviderGroupJid(input.groupId),
      image: toGroupPictureImage(input.media)
    }
  });
}
function toGroupPictureImage(media) {
  if (media.url) return media.url;
  if (media.base64) {
    const prefix = media.mimeType === "image/png" ? "data:image/png;base64," : "data:image/jpeg;base64,";
    return `${prefix}${media.base64}`;
  }
  throw new WaConnectorError(
    "INVALID_INPUT",
    'Evolution GO (adapter F2): groups.updatePicture requer "media.url" ou "media.base64".',
    { provider: PROVIDER }
  );
}
async function getGroupInviteLink(http, groupId, reset) {
  const response = await http.request({
    method: "POST",
    path: "/group/invitelink",
    body: {
      groupJid: toProviderGroupJid(groupId),
      reset
    }
  });
  const link = normalizeInviteLink(asString(response.data) ?? "");
  return { link, raw: response };
}
async function joinGroupViaInviteLink(http, input) {
  await http.request({
    method: "POST",
    path: "/group/join",
    body: { code: input.invite }
  });
}
async function leaveGroupById(http, groupId) {
  await http.request({
    method: "POST",
    path: "/group/leave",
    body: { groupJid: toProviderGroupJid(groupId) }
  });
}
function mapGroupParticipant(record) {
  return {
    id: asString(record.JID) ?? asString(record.PhoneNumber) ?? "",
    isAdmin: asBoolean(record.IsAdmin) ?? false,
    isSuperAdmin: asBoolean(record.IsSuperAdmin) ?? false
  };
}
function mapGroupParticipants(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asRecord(item)).filter((item) => item !== void 0).map(mapGroupParticipant);
}
function mapGroupInfo(data, fallback, raw) {
  return {
    id: asString(data?.JID) ?? fallback.id ?? "",
    subject: asString(data?.Name) ?? fallback.subject ?? "",
    description: asString(data?.Topic),
    owner: asString(data?.OwnerJID),
    participants: mapGroupParticipants(data?.Participants),
    raw
  };
}
async function listContacts(http) {
  const response = await http.request({
    method: "GET",
    path: "/user/contacts"
  });
  const items = Array.isArray(response.data) ? response.data : [];
  return items.map((item) => asRecord(item)).filter((item) => item !== void 0).map((data) => mapContactInfo(data));
}
function mapContactInfo(data) {
  return {
    id: asString(data.Jid) ?? "",
    // `FirstName`/`FullName`/`PushName` são campos string simples no struct Go do whatsmeow (sem
    // ponteiro) — o zero value `""` significa "não preenchido", não "nome vazio válido". Por isso
    // usamos `asNonEmptyString` (que trata `""` como ausente) em vez de `asString` puro: com
    // `asString`, um `FullName:""` "venceria" o `??` e nunca cairia no fallback para
    // `FirstName`/`PushName`, mesmo estando de fato vazio.
    name: asNonEmptyString(data.FullName) ?? asNonEmptyString(data.FirstName) ?? asNonEmptyString(data.PushName),
    raw: data
  };
}
async function fetchUserInfo(http, chatId) {
  const response = await http.request({
    method: "POST",
    path: "/user/info",
    body: { number: [toProviderNumber(chatId)], formatJid: true }
  });
  const data = asRecord(response.data);
  const users = asRecord(data?.Users);
  const [jid, rawUser] = users ? Object.entries(users)[0] ?? [] : [];
  return { response, jid, user: asRecord(rawUser) };
}
async function getContact(http, chatId) {
  const { response, jid, user } = await fetchUserInfo(http, chatId);
  return {
    id: jid ?? chatId,
    name: void 0,
    about: asString(user?.Status),
    profilePictureUrl: void 0,
    raw: response
  };
}
async function getContactAbout(http, chatId) {
  const { response, user } = await fetchUserInfo(http, chatId);
  return { about: asString(user?.Status), raw: response };
}
async function checkContactExists(http, phone) {
  const response = await http.request({
    method: "POST",
    path: "/user/check",
    body: { number: [toProviderNumber(phone)], formatJid: true }
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
  const response = await http.request({
    method: "POST",
    path: "/user/avatar",
    body: { number: toProviderNumber(chatId), preview: false }
  });
  const data = asRecord(response.data);
  return { url: asString(data?.URL), raw: response };
}
async function blockContact(http, chatId) {
  await http.request({
    method: "POST",
    path: "/user/block",
    body: { number: toProviderNumber(chatId) }
  });
}
async function unblockContact(http, chatId) {
  await http.request({
    method: "POST",
    path: "/user/unblock",
    body: { number: toProviderNumber(chatId) }
  });
}
async function listBlockedContacts(http) {
  const response = await http.request({
    method: "GET",
    path: "/user/blocklist"
  });
  const data = asRecord(response.data);
  return asStringArray(data?.JIDs);
}
function chatBody(chatId) {
  return { number: toProviderNumber(chatId) };
}
async function archiveChat(http, chatId) {
  await http.request({ method: "POST", path: "/chat/archive", body: chatBody(chatId) });
}
async function muteChat(http, chatId) {
  await http.request({ method: "POST", path: "/chat/mute", body: chatBody(chatId) });
}
async function pinChat(http, chatId) {
  await http.request({ method: "POST", path: "/chat/pin", body: chatBody(chatId) });
}
async function unpinChat(http, chatId) {
  await http.request({ method: "POST", path: "/chat/unpin", body: chatBody(chatId) });
}
async function setChatPresence(http, input, instance) {
  const path = instance ? `/message/presence/${instance}` : "/message/presence";
  await http.request({
    method: "POST",
    path,
    body: {
      number: toProviderNumber(input.to),
      state: input.state,
      isAudio: input.state === "recording"
    }
  });
}
async function listLabels(http) {
  const body = await http.request({ method: "GET", path: "/label/list" });
  const items = Array.isArray(body) ? body : [];
  return items.map((item) => mapEvolutionLabel(item));
}
async function editLabel(http, labelId, name, color, deleted) {
  await http.request({
    method: "POST",
    path: "/label/edit",
    body: { labelId, name, color: toLabelColor(color), deleted }
  });
}
async function createLabel(http, input) {
  const labelId = randomUUID();
  await editLabel(http, labelId, input.name, input.color, false);
  return { id: labelId, name: input.name, color: input.color, raw: { labelId, ...input } };
}
async function updateLabel(http, input) {
  await editLabel(http, input.labelId, input.name, input.color, false);
}
async function deleteLabel(http, labelId) {
  const labels = await listLabels(http);
  const current = labels.find((label) => label.id === labelId);
  if (!current) {
    throw new WaConnectorError(
      "PROVIDER_ERROR",
      `Evolution GO: label "${labelId}" n\xE3o encontrado em /label/list \u2014 n\xE3o \xE9 poss\xEDvel apagar sem o "name" atual (exigido pelo pr\xF3prio endpoint /label/edit).`,
      { provider: PROVIDER }
    );
  }
  await editLabel(http, labelId, current.name, current.color, true);
}
async function labelChat(http, input, add) {
  await http.request({
    method: "POST",
    path: add ? "/label/chat" : "/unlabel/chat",
    body: { jid: toMentionJid(input.chatId), labelId: input.labelId }
  });
}
function toLabelColor(color) {
  if (color === void 0) return 0;
  const parsed = Number(color);
  return Number.isFinite(parsed) ? parsed : 0;
}
function mapEvolutionLabel(body) {
  const record = asRecord(body);
  return {
    id: (record ? asString(record.label_id) : void 0) ?? "",
    name: (record ? asString(record.label_name) : void 0) ?? "",
    color: record ? asString(record.label_color) : void 0,
    raw: body
  };
}
function toEvolutionChannelId(channelId) {
  return channelId;
}
async function listChannels(http) {
  const body = await http.request({ method: "GET", path: "/newsletter/list" });
  const record = asRecord(body);
  const items = record && Array.isArray(record.data) ? record.data : [];
  return items.map((item) => mapEvolutionChannel(item));
}
async function createChannel(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/newsletter/create",
    body: { name: input.name, description: input.description }
  });
  const record = asRecord(body);
  const data = record ? asRecord(record.data) : void 0;
  return mapEvolutionChannel(data ?? body, input);
}
async function getChannelInfo(http, channelId) {
  const body = await http.request({
    method: "POST",
    path: "/newsletter/info",
    body: { jid: toEvolutionChannelId(channelId) }
  });
  const record = asRecord(body);
  const data = record ? asRecord(record.data) : void 0;
  return mapEvolutionChannel(data ?? body, {});
}
async function followChannel(http, channelId) {
  await http.request({
    method: "POST",
    path: "/newsletter/subscribe",
    body: { jid: toEvolutionChannelId(channelId) }
  });
}
function mapEvolutionChannel(body, fallback = {}) {
  const record = asRecord(body);
  const id = (record ? asString(record.id) : void 0) ?? "";
  const threadMeta = record ? asRecord(record.thread_metadata) : void 0;
  const nameObj = threadMeta ? asRecord(threadMeta.name) : void 0;
  const descriptionObj = threadMeta ? asRecord(threadMeta.description) : void 0;
  const name = (nameObj ? asString(nameObj.text) : void 0) ?? fallback.name ?? "";
  const description = (descriptionObj ? asString(descriptionObj.text) : void 0) ?? fallback.description;
  const subscribersCountRaw = threadMeta ? asString(threadMeta.subscribers_count) : void 0;
  const subscribersCount = subscribersCountRaw === void 0 ? void 0 : Number(subscribersCountRaw);
  return { id, name, description, subscribersCount, raw: body };
}
async function getChannelMessages(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/newsletter/messages",
    body: {
      jid: toEvolutionChannelId(input.channelId),
      count: input.count,
      ...input.before !== void 0 ? { before_id: Number(input.before) } : {}
    }
  });
  const record = asRecord(body);
  const items = Array.isArray(record?.messages) ? record.messages : [];
  return items.map((item) => mapEvolutionChannelPost(item));
}
function mapEvolutionChannelPost(body) {
  const record = asRecord(body);
  const serverId = (record ? asIdString(record.MessageServerID) : void 0) ?? (record ? asIdString(record.serverId) : void 0);
  const timestamp = (record ? toEpochMs(record.Timestamp) : void 0) ?? (record ? toEpochMs(record.timestamp) : void 0) ?? 0;
  const reactionCountsRaw = (record ? asRecord(record.ReactionCounts) : void 0) ?? (record ? asRecord(record.reactionCounts) : void 0);
  const reactionCounts = reactionCountsRaw ? Object.fromEntries(
    Object.entries(reactionCountsRaw).map(([emoji, count]) => [emoji, asNumber(count)]).filter((entry) => entry[1] !== void 0)
  ) : void 0;
  const messageContent = record ? mapMessageContent(asRecord(record.Message) ?? asRecord(record.message)) : void 0;
  return {
    id: serverId ?? "",
    timestamp,
    text: messageContent?.text,
    viewsCount: (record ? asNumber(record.ViewsCount) : void 0) ?? (record ? asNumber(record.viewsCount) : void 0),
    reactionCounts,
    raw: body
  };
}
async function rejectCall(http, input) {
  if (!input.callerId || !input.callId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'calls.reject no Evolution GO exige "callerId" e "callId" (body {callCreator, callId}).',
      { provider: PROVIDER }
    );
  }
  await http.request({
    method: "POST",
    path: "/call/reject",
    body: { callCreator: toEvolutionChannelId(input.callerId), callId: input.callId }
  });
}
function parseWebhook(input) {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook Evolution GO: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe(input) {
  const body = asRecord(input.body);
  if (!body) {
    return [unknownEvent(input.body, "Payload de webhook n\xE3o \xE9 um objeto JSON.")];
  }
  const eventName = asString(body.event);
  if (!eventName) {
    return [unknownEvent(input.body, 'Payload de webhook sem campo "event".')];
  }
  const instanceId = asString(body.instanceId);
  const data = asRecord(body.data);
  switch (eventName) {
    case "Message":
      return [mapMessageEvent(instanceId, data, body)];
    case "Receipt":
      return mapReceiptEvent(instanceId, asString(body.state), data, body);
    case "Connected":
      return [connectionEvent(instanceId, "connected", void 0, body)];
    case "Disconnected":
    case "LoggedOut":
    case "ConnectFailure":
    case "TemporaryBan":
      return [connectionEvent(instanceId, "disconnected", void 0, body)];
    case "PairSuccess":
      return [connectionEvent(instanceId, "connected", void 0, body)];
    case "QRCode":
      return [
        connectionEvent(instanceId, "qr", asString(data?.qrcode) ?? asString(data?.code), body)
      ];
    case "GroupInfo":
      return mapGroupInfoEvent(instanceId, data, body);
    case "JoinedGroup":
      return [mapJoinedGroupEvent(instanceId, data, body)];
    default:
      return [
        unknownEvent(body, `Evento Evolution GO n\xE3o reconhecido: "${eventName}".`, instanceId)
      ];
  }
}
function mapMessageEvent(instanceId, data, rawBody) {
  if (!data) {
    return unknownEvent(rawBody, 'Evento "Message" sem campo "data".', instanceId);
  }
  const info = asRecord(data.Info);
  if (!info) {
    return unknownEvent(rawBody, 'Evento "Message" sem "data.Info".', instanceId);
  }
  const fromMe = asBoolean(info.IsFromMe) ?? false;
  const content = mapMessageContent(asRecord(data.Message));
  const message = {
    id: asString(info.ID) ?? "",
    chatId: asString(info.Chat) ?? "",
    from: asString(info.Sender),
    fromMe,
    timestamp: toEpochMs(info.Timestamp) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media: content.media,
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
  const documentWithCaption = asRecord(message.documentWithCaptionMessage);
  if (documentWithCaption) {
    const inner = asRecord(asRecord(documentWithCaption.message)?.documentMessage);
    return inner ? { kind: "document", text: asString(inner.caption), media: buildMediaRef("document", inner) } : { kind: "document" };
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
function mapReceiptEvent(instanceId, state, data, rawBody) {
  if (!data) {
    return [unknownEvent(rawBody, 'Evento "Receipt" sem campo "data".', instanceId)];
  }
  const messageIds = asStringArray(data.MessageIDs);
  if (messageIds.length === 0) {
    return [unknownEvent(rawBody, 'Evento "Receipt" sem "data.MessageIDs".', instanceId)];
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
function mapGroupInfoEvent(instanceId, data, rawBody) {
  if (!data) {
    return [unknownEvent(rawBody, 'Evento "GroupInfo" sem campo "data".', instanceId)];
  }
  const groupId = asString(data.JID);
  if (!groupId) {
    return [unknownEvent(rawBody, 'Evento "GroupInfo" sem "data.JID".', instanceId)];
  }
  const events = [];
  const join = asStringArray(data.Join);
  if (join.length > 0) {
    events.push(groupUpdateEvent(instanceId, groupId, "participants.add", join, rawBody));
  }
  const leave = asStringArray(data.Leave);
  if (leave.length > 0) {
    events.push(groupUpdateEvent(instanceId, groupId, "participants.remove", leave, rawBody));
  }
  const promote = asStringArray(data.Promote);
  if (promote.length > 0) {
    events.push(groupUpdateEvent(instanceId, groupId, "participants.promote", promote, rawBody));
  }
  const demote = asStringArray(data.Demote);
  if (demote.length > 0) {
    events.push(groupUpdateEvent(instanceId, groupId, "participants.demote", demote, rawBody));
  }
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
        'Evento "GroupInfo" sem nenhuma mudan\xE7a reconhecida (Join/Leave/Promote/Demote/Name/Topic).',
        instanceId
      )
    ];
  }
  return events;
}
function mapJoinedGroupEvent(instanceId, data, rawBody) {
  if (!data) {
    return unknownEvent(rawBody, 'Evento "JoinedGroup" sem campo "data".', instanceId);
  }
  const groupId = asString(data.JID);
  if (!groupId) {
    return unknownEvent(rawBody, 'Evento "JoinedGroup" sem "data.JID".', instanceId);
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
function unknownEvent(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER, instanceId, raw, reason };
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString(value) {
  return typeof value === "string" ? value : void 0;
}
function asNonEmptyString(value) {
  const str = asString(value);
  return str && str.length > 0 ? str : void 0;
}
function asIdString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return void 0;
}
function asBoolean(value) {
  return typeof value === "boolean" ? value : void 0;
}
function asNumber(value) {
  return typeof value === "number" ? value : void 0;
}
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
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

// src/adapters/quepasa/index.ts
var PROVIDER2 = "quepasa";
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
    provider: PROVIDER2,
    fetch: options.fetch
  });
  const instance = {
    connect: () => connectInstance2(http),
    status: () => statusInstance2(http),
    logout: () => logoutInstance2(http)
  };
  const messages = {
    sendText: (input) => sendText2(http, options.token, input),
    sendMedia: (input) => sendMedia2(http, options.token, input),
    edit: (input) => editMessage2(http, input),
    delete: (input) => deleteMessage2(http, input),
    markRead: (input) => markMessageRead2(http, input),
    sendLocation: (input) => sendLocation2(http, options.token, input),
    sendContactCard: (input) => sendContactCard2(http, options.token, input),
    sendPoll: (input) => sendPoll2(http, options.token, input)
  };
  const groups = {
    getInviteLink: (groupId) => getGroupInviteLink2(http, options.token, groupId)
  };
  const contacts = {
    getProfilePicture: (chatId) => getContactProfilePicture2(http, options.token, chatId)
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
    list: () => listLabels2(http),
    create: (input) => createLabel2(http, input),
    update: (input) => updateLabel2(http, input),
    delete: (labelId) => deleteLabel2(http, labelId),
    addToChat: (input) => setChatLabel(http, input, true),
    removeFromChat: (input) => setChatLabel(http, input, false)
  };
  return {
    provider: PROVIDER2,
    capabilities: QUEPASA_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    labels,
    parseWebhook: (input) => parseWebhook2(input)
  };
}
function toQuepasaChatId(chatId) {
  return chatId;
}
function botPath(token, suffix) {
  return `/v3/bot/${encodeURIComponent(token)}${suffix}`;
}
async function connectInstance2(http) {
  const body = await http.request({ method: "GET", path: "/scan" });
  return { qr: void 0, raw: body };
}
async function statusInstance2(http) {
  const body = await http.request({
    method: "GET",
    path: "/command",
    query: { action: "status" }
  });
  const record = asRecord2(body);
  return { state: mapConnectionState(record ? asString2(record.status) : void 0), raw: body };
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
async function logoutInstance2(http) {
  await http.request({ method: "GET", path: "/command", query: { action: "stop" } });
}
async function sendText2(http, token, input) {
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
async function sendMedia2(http, token, input) {
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
      { provider: PROVIDER2 }
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
      { provider: PROVIDER2 }
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
  const record = asRecord2(body);
  const message = record ? asRecord2(record.message) : void 0;
  const id = (message ? asString2(message.id) : void 0) ?? fallbackId;
  const chatId = (message ? asString2(message.chatId) : void 0) ?? fallbackChatId;
  return { id, chatId, timestamp: void 0, raw: body };
}
async function editMessage2(http, input) {
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
async function deleteMessage2(http, input) {
  await http.request({
    method: "DELETE",
    path: `/message/${encodeURIComponent(input.messageId)}`
  });
}
async function markMessageRead2(http, input) {
  await http.request({ method: "POST", path: "/read", body: [input.messageId] });
}
async function sendLocation2(http, token, input) {
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
async function sendContactCard2(http, token, input) {
  const chatId = toQuepasaChatId(input.to);
  const response = await http.request({
    method: "POST",
    path: botPath(token, "/send"),
    body: { chatId, contact: { phone: input.contactPhone, name: input.contactName } }
  });
  return mapSendResponse(response, chatId);
}
async function sendPoll2(http, token, input) {
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
async function getGroupInviteLink2(http, token, groupId) {
  const response = await http.request({
    method: "GET",
    path: botPath(token, `/invite/${encodeURIComponent(groupId)}`)
  });
  const record = asRecord2(response);
  const url = record ? asString2(record.url) : void 0;
  return { link: normalizeInviteLink(url ?? ""), raw: response };
}
async function getContactProfilePicture2(http, token, chatId) {
  const response = await http.request({
    method: "GET",
    path: botPath(token, `/picinfo/${encodeURIComponent(chatId)}`)
  });
  const record = asRecord2(response);
  const info = record ? asRecord2(record.info) : void 0;
  return { url: info ? asString2(info.url) : void 0, raw: response };
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
async function listLabels2(http) {
  const body = await http.request({ method: "GET", path: "/labels" });
  const record = asRecord2(body);
  const items = record && Array.isArray(record.labels) ? record.labels : [];
  return items.map((item) => mapQuepasaLabel(item));
}
async function createLabel2(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/labels",
    body: { name: input.name, color: input.color }
  });
  const record = asRecord2(body);
  const label = record ? asRecord2(record.label) : void 0;
  return mapQuepasaLabel(label ?? { name: input.name, color: input.color });
}
async function updateLabel2(http, input) {
  await http.request({
    method: "PUT",
    path: "/labels",
    body: { id: toQuepasaLabelId(input.labelId), name: input.name, color: input.color }
  });
}
async function deleteLabel2(http, labelId) {
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
  const record = asRecord2(body);
  const idRaw = record?.id;
  const id = typeof idRaw === "number" ? String(idRaw) : "";
  return {
    id,
    name: (record ? asString2(record.name) : void 0) ?? "",
    color: record ? asString2(record.color) : void 0,
    raw: body
  };
}
function parseWebhook2(input) {
  try {
    return parseWebhookUnsafe2(input);
  } catch (error) {
    return [
      unknownEvent2(
        input.body,
        `Erro inesperado ao parsear webhook QuePasa: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe2(input) {
  const body = input.body;
  const record = asRecord2(body);
  if (!record) {
    return [unknownEvent2(body, "Corpo do webhook QuePasa n\xE3o \xE9 um objeto JSON.")];
  }
  const instanceId = asString2(record.wid) || firstHeaderValue(input.headers, "x-quepasa-wid");
  const type = asString2(record.type);
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
      return [mapMessageEvent2(record, type, instanceId, body)];
    case "view_once":
      return [mapMessageEvent2(record, type, instanceId, body)];
    case "system":
      return [mapSystemEvent(record, instanceId, body)];
    case "group":
      return [mapGroupEvent(record, instanceId, body)];
    case "call":
      return [
        unknownEvent2(
          body,
          'Evento "call" do QuePasa n\xE3o tem CanonicalEvent equivalente nesta fase (o contrato central n\xE3o modela chamadas de voz/v\xEDdeo).',
          instanceId
        )
      ];
    case "revoke":
      return [
        unknownEvent2(
          body,
          'Evento "revoke" do QuePasa (mensagem apagada) n\xE3o tem CanonicalEvent equivalente nesta fase.',
          instanceId
        )
      ];
    case "unhandled":
      return [
        unknownEvent2(
          body,
          'QuePasa reportou "unhandled" para este evento (n\xE3o classificado nem pelo pr\xF3prio provider).',
          instanceId
        )
      ];
    default:
      return [
        unknownEvent2(
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
function mapMessageEvent2(record, type, instanceId, rawBody) {
  const fromMe = asBoolean2(record.fromme) ?? false;
  const chat = asRecord2(record.chat);
  const participant = asRecord2(record.participant);
  const kind = KIND_BY_TYPE[type] ?? "unknown";
  const attachment = asRecord2(record.attachment);
  const message = {
    id: asString2(record.id) ?? `quepasa-unknown-${Date.now()}`,
    chatId: (chat ? asString2(chat.id) : void 0) ?? "unknown",
    from: participant ? asString2(participant.id) : void 0,
    fromMe,
    // `timestamp` é RFC3339 (time.Time nativo do Go, sem MarshalJSON customizado no próprio campo)
    // — diferente da maioria dos providers deste pacote, que usam epoch em segundos ou ms.
    timestamp: parseIsoTimestamp(record.timestamp),
    kind,
    text: asString2(record.text),
    media: attachment && isMediaKind(kind) ? buildMediaRef2(kind, attachment) : void 0,
    quotedId: asString2(record.inreply),
    raw: rawBody
  };
  return {
    type: fromMe ? "message.sent" : "message.received",
    provider: PROVIDER2,
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
function buildMediaRef2(kind, attachment) {
  return {
    kind,
    url: asString2(attachment.url),
    mimeType: asString2(attachment.mime),
    filename: asString2(attachment.filename)
  };
}
function mapSystemEvent(record, instanceId, rawBody) {
  const id = asString2(record.id);
  if (id === "deliveryreceipt" || id === "readreceipt") {
    const chat = asRecord2(record.chat);
    const messageId = asString2(record.text);
    if (!messageId) {
      return unknownEvent2(
        rawBody,
        `Recibo QuePasa ("${id}") sem o id real da mensagem no campo "text".`,
        instanceId
      );
    }
    const ack = id === "readreceipt" ? "read" : "delivered";
    return {
      type: "message.ack",
      provider: PROVIDER2,
      instanceId,
      messageId,
      chatId: chat ? asString2(chat.id) : void 0,
      ack,
      raw: rawBody
    };
  }
  const info = asRecord2(record.info);
  const event = info ? asString2(info.event) : void 0;
  const state = mapSystemEventToState(event);
  if (!state) {
    return unknownEvent2(
      rawBody,
      `Evento "system" do QuePasa com info.event="${event ?? "ausente"}" sem InstanceState equivalente nesta fase.`,
      instanceId
    );
  }
  return { type: "connection.update", provider: PROVIDER2, instanceId, state, raw: rawBody };
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
  const chat = asRecord2(record.chat);
  const groupId = chat ? asString2(chat.id) : void 0;
  if (!groupId) {
    return unknownEvent2(rawBody, 'Evento "group" do QuePasa sem "chat.id".', instanceId);
  }
  return { type: "group.update", provider: PROVIDER2, instanceId, groupId, raw: rawBody };
}
function unknownEvent2(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER2, instanceId, raw, reason };
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
function asRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString2(value) {
  return typeof value === "string" ? value : void 0;
}
function asBoolean2(value) {
  return typeof value === "boolean" ? value : void 0;
}

// src/adapters/uazapi/index.ts
var PROVIDER3 = "uazapi";
var UAZAPI_CAPABILITIES = [
  "instance.connect",
  "instance.status",
  "instance.logout",
  "messages.sendText",
  "messages.sendMedia",
  "messages.sendReaction",
  "messages.edit",
  "messages.delete",
  "messages.pin",
  "messages.unpin",
  "messages.markRead",
  "messages.sendLocation",
  "messages.sendContactCard",
  "messages.sendPoll",
  "messages.download",
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
  "contacts.block",
  "contacts.unblock",
  "contacts.listBlocked",
  "labels.list",
  "labels.create",
  "labels.update",
  "labels.delete",
  "labels.addToChat",
  "labels.removeFromChat",
  "channels.list",
  "channels.create",
  "channels.getInfo",
  "channels.delete",
  "channels.follow",
  "channels.unfollow",
  "channels.getMessages",
  "channels.markViewed",
  "channels.reactToPost",
  "business.getProfile",
  "business.updateProfile",
  "calls.make",
  "calls.reject",
  "webhooks.parse"
];
function uazapi(options) {
  const secrets = [options.token, ...options.adminToken ? [options.adminToken] : []];
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { token: options.token },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets,
    provider: PROVIDER3,
    fetch: options.fetch
  });
  const instance = {
    connect: () => connectInstance3(http),
    status: () => statusInstance3(http),
    logout: () => logoutInstance3(http)
  };
  const messages = {
    sendText: (input) => sendText3(http, input),
    sendMedia: (input) => sendMedia3(http, input),
    sendReaction: (input) => sendReaction2(http, input),
    edit: (input) => editMessage3(http, input),
    delete: (input) => deleteMessage3(http, input),
    pin: (input) => setMessagePinned(http, input, true),
    unpin: (input) => setMessagePinned(http, input, false),
    markRead: (input) => markMessageRead3(http, input),
    sendLocation: (input) => sendLocation3(http, input),
    sendContactCard: (input) => sendContactCard3(http, input),
    sendPoll: (input) => sendPoll3(http, input),
    download: (input) => downloadMedia2(http, input)
  };
  const chats = {
    archive: (chatId) => archiveChat2(http, chatId),
    unarchive: (chatId) => unarchiveChat(http, chatId),
    mute: (chatId) => muteChat2(http, chatId),
    unmute: (chatId) => unmuteChat(http, chatId),
    pin: (chatId) => pinChat2(http, chatId),
    unpin: (chatId) => unpinChat2(http, chatId),
    markRead: (chatId) => markChatRead(http, chatId),
    markUnread: (chatId) => markChatUnread(http, chatId)
  };
  const presence = {
    setTyping: (input) => setTyping2(http, input),
    set: (state) => setPresence(http, state)
  };
  const groups = {
    create: (input) => createGroup2(http, input),
    getInfo: (groupId) => getGroupInfo2(http, groupId),
    list: () => listGroups2(http),
    addParticipants: (input) => updateGroupParticipants2(http, input, "add"),
    removeParticipants: (input) => updateGroupParticipants2(http, input, "remove"),
    promoteParticipants: (input) => updateGroupParticipants2(http, input, "promote"),
    demoteParticipants: (input) => updateGroupParticipants2(http, input, "demote"),
    updateSubject: (input) => updateGroupSubject2(http, input),
    updateDescription: (input) => updateGroupDescription2(http, input),
    updatePicture: (input) => updateGroupPicture2(http, input),
    getInviteLink: (groupId) => getGroupInviteLink3(http, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink(http, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink2(http, input),
    leaveGroup: (groupId) => leaveGroup(http, groupId)
  };
  const contacts = {
    list: () => listContacts2(http),
    get: (chatId) => getContact2(http, chatId),
    checkExists: (phone) => checkContactExists2(http, phone),
    getProfilePicture: (chatId) => getContactProfilePicture3(http, chatId),
    block: (chatId) => blockContact2(http, chatId),
    unblock: (chatId) => unblockContact2(http, chatId),
    listBlocked: () => listBlockedContacts2(http)
    // `getAbout` deliberadamente NÃO implementado nem declarado em capabilities: busca exaustiva
    // nas ~132 rotas do OpenAPI bundled não achou nenhum campo/endpoint para o recado pessoal de
    // um contato na uazapi. Ver docs/providers/uazapi.md#contatos.
  };
  const labels = {
    list: () => listLabels3(http),
    create: (input) => createLabel3(http, input),
    update: (input) => updateLabel3(http, input),
    delete: (labelId) => deleteLabel3(http, labelId),
    addToChat: (input) => setChatLabel2(http, input, "add"),
    removeFromChat: (input) => setChatLabel2(http, input, "remove")
  };
  const channels = {
    list: () => listChannels2(http),
    create: (input) => createChannel2(http, input),
    getInfo: (channelId) => getChannelInfo2(http, channelId),
    delete: (channelId) => deleteChannel(http, channelId),
    follow: (channelId) => setChannelFollowed(http, channelId, true),
    unfollow: (channelId) => setChannelFollowed(http, channelId, false),
    getMessages: (input) => getChannelMessages2(http, input),
    markViewed: (input) => markChannelMessagesViewed(http, input),
    reactToPost: (input) => reactToChannelPost(http, input)
  };
  const business = {
    getProfile: () => getBusinessProfile(http),
    updateProfile: (input) => updateBusinessProfile(http, input)
  };
  const calls = {
    make: (input) => makeCall(http, input),
    reject: (input) => rejectCall2(http, input)
  };
  return {
    provider: PROVIDER3,
    capabilities: UAZAPI_CAPABILITIES,
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
    parseWebhook: (input) => parseWebhook3(input)
  };
}
function toUazapiNumber(chatId) {
  return chatId;
}
function toUazapiMentions(mentions) {
  return mentions.map(toMentionDigits).join(",");
}
function toMentionDigits(entry) {
  if (entry === "all") return entry;
  if (isJid(entry)) return digitsOnly(entry.slice(0, entry.indexOf("@")));
  return digitsOnly(entry);
}
function toUazapiGroupJid(groupId) {
  return groupId;
}
function toCreateGroupParticipant(participant) {
  return isJid(participant) ? digitsOnly(participant.slice(0, participant.indexOf("@"))) : digitsOnly(participant);
}
function mapMediaKindToUazapiType(kind) {
  switch (kind) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "document":
      return "document";
    case "sticker":
      return "sticker";
  }
}
async function connectInstance3(http) {
  const body = await http.request({ method: "POST", path: "/instance/connect", body: {} });
  return { qr: extractQr(body), raw: body };
}
async function statusInstance3(http) {
  const body = await http.request({ method: "GET", path: "/instance/status" });
  const record = asRecord3(body);
  const instanceRecord = record ? asRecord3(record.instance) : void 0;
  const providerStatus = instanceRecord ? asString3(instanceRecord.status) : void 0;
  const hasQr = instanceRecord !== void 0 && hasNonEmptyQr(instanceRecord);
  return { state: mapInstanceState2(providerStatus, hasQr), raw: body };
}
async function logoutInstance3(http) {
  await http.request({ method: "POST", path: "/instance/disconnect" });
}
function extractQr(body) {
  const record = asRecord3(body);
  if (!record) return void 0;
  const instanceRecord = asRecord3(record.instance);
  return (instanceRecord ? asString3(instanceRecord.qrcode) : void 0) ?? asString3(record.qrcode);
}
function hasNonEmptyQr(instanceRecord) {
  const qr = asString3(instanceRecord.qrcode);
  return qr !== void 0 && qr.length > 0;
}
function mapInstanceState2(status, hasQr) {
  switch (status) {
    case "disconnected":
      return "disconnected";
    case "connecting":
      return hasQr ? "qr" : "connecting";
    case "connected":
      return "connected";
    case "hibernated":
      return "disconnected";
    default:
      return "unknown";
  }
}
async function sendText3(http, input) {
  const number = toUazapiNumber(input.to);
  const body = { number, text: input.text };
  if (input.quotedId) {
    body.replyid = input.quotedId;
  }
  if (input.mentions && input.mentions.length > 0) {
    body.mentions = toUazapiMentions(input.mentions);
  }
  const response = await http.request({ method: "POST", path: "/send/text", body });
  return mapSentMessage(response, number);
}
async function sendMedia3(http, input) {
  const number = toUazapiNumber(input.to);
  const file = input.media.url ?? input.media.base64;
  if (!file) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'uazapi: sendMedia exige "media.url" ou "media.base64".',
      { provider: PROVIDER3 }
    );
  }
  const body = {
    number,
    type: mapMediaKindToUazapiType(input.media.kind),
    file
  };
  if (input.caption) body.text = input.caption;
  if (input.media.kind === "document" && input.media.filename) {
    body.docName = input.media.filename;
  }
  if (input.media.mimeType) body.mimetype = input.media.mimeType;
  if (input.quotedId) body.replyid = input.quotedId;
  const response = await http.request({ method: "POST", path: "/send/media", body });
  return mapSentMessage(response, number);
}
async function sendReaction2(http, input) {
  const number = toUazapiNumber(input.to);
  const body = { number, text: input.emoji, id: input.messageId };
  const response = await http.request({ method: "POST", path: "/message/react", body });
  return mapSentMessage(response, number);
}
function mapSentMessage(body, requestedNumber) {
  const record = asRecord3(body);
  const id = (record ? asString3(record.messageid) ?? asString3(record.id) : void 0) ?? `uazapi-${Date.now()}`;
  const chatId = (record ? asString3(record.chatid) : void 0) ?? requestedNumber;
  const timestamp = record ? asNumber2(record.messageTimestamp) : void 0;
  return { id, chatId, timestamp, raw: body };
}
async function editMessage3(http, input) {
  const body = { id: input.messageId, text: input.text };
  const response = await http.request({ method: "POST", path: "/message/edit", body });
  return mapSentMessage(response, toUazapiNumber(input.to));
}
async function deleteMessage3(http, input) {
  await http.request({ method: "POST", path: "/message/delete", body: { id: input.messageId } });
}
async function setMessagePinned(http, input, pin) {
  await http.request({ method: "POST", path: "/message/pin", body: { id: input.messageId, pin } });
}
async function markMessageRead3(http, input) {
  await http.request({
    method: "POST",
    path: "/message/markread",
    body: { id: [input.messageId] }
  });
}
async function sendLocation3(http, input) {
  const number = toUazapiNumber(input.to);
  const body = {
    number,
    latitude: input.latitude,
    longitude: input.longitude
  };
  if (input.name) body.name = input.name;
  if (input.address) body.address = input.address;
  const response = await http.request({ method: "POST", path: "/send/location", body });
  return mapSentMessage(response, number);
}
async function sendContactCard3(http, input) {
  const number = toUazapiNumber(input.to);
  const response = await http.request({
    method: "POST",
    path: "/send/contact",
    body: { number, fullName: input.contactName, phoneNumber: input.contactPhone }
  });
  return mapSentMessage(response, number);
}
async function sendPoll3(http, input) {
  const number = toUazapiNumber(input.to);
  const response = await http.request({
    method: "POST",
    path: "/send/menu",
    body: {
      number,
      type: "poll",
      text: input.question,
      choices: input.options,
      selectableCount: input.allowMultipleAnswers ? input.options.length : 1
    }
  });
  return mapSentMessage(response, number);
}
async function downloadMedia2(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/message/download",
    body: { id: input.messageId, return_base64: true }
  });
  const record = asRecord3(body);
  return {
    base64: (record ? asString3(record.base64Data) : void 0) ?? "",
    mimeType: record ? asString3(record.mimetype) : void 0,
    raw: body
  };
}
async function createGroup2(http, input) {
  const body = {
    name: input.subject,
    participants: input.participants.map(toCreateGroupParticipant)
  };
  const response = await http.request({ method: "POST", path: "/group/create", body });
  return mapGroupInfo2(response, { subject: input.subject, participants: input.participants });
}
async function getGroupInfo2(http, groupId) {
  const response = await requestGroupInfo(http, groupId);
  return mapGroupInfo2(response, { id: groupId });
}
async function requestGroupInfo(http, groupId, extra) {
  const groupjid = toUazapiGroupJid(groupId);
  return http.request({
    method: "POST",
    path: "/group/info",
    body: { groupjid, ...extra }
  });
}
async function getGroupInviteLink3(http, groupId) {
  const response = await requestGroupInfo(http, groupId, { getInviteLink: true });
  const record = asRecord3(response);
  const link = (record ? asString3(record.invite_link) : void 0) ?? "";
  return { link: normalizeInviteLink(link), raw: response };
}
async function revokeGroupInviteLink(http, groupId) {
  const groupjid = toUazapiGroupJid(groupId);
  const response = await http.request({
    method: "POST",
    path: "/group/resetInviteCode",
    body: { groupjid }
  });
  const record = asRecord3(response);
  const link = (record ? asString3(record.InviteLink) : void 0) ?? "";
  return { link: normalizeInviteLink(link), raw: response };
}
async function joinGroupViaInviteLink2(http, input) {
  await http.request({
    method: "POST",
    path: "/group/join",
    body: { invitecode: input.invite }
  });
}
async function leaveGroup(http, groupId) {
  const groupjid = toUazapiGroupJid(groupId);
  await http.request({ method: "POST", path: "/group/leave", body: { groupjid } });
}
async function listGroups2(http) {
  const response = await http.request({ method: "GET", path: "/group/list" });
  const record = asRecord3(response);
  const groups = record?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => mapGroupInfo2(group));
}
async function updateGroupParticipants2(http, input, action) {
  const body = {
    groupjid: toUazapiGroupJid(input.groupId),
    action,
    participants: input.participants.map(toUazapiNumber)
  };
  await http.request({ method: "POST", path: "/group/updateParticipants", body });
}
async function updateGroupSubject2(http, input) {
  const body = { groupjid: toUazapiGroupJid(input.groupId), name: input.subject };
  await http.request({ method: "POST", path: "/group/updateName", body });
}
async function updateGroupDescription2(http, input) {
  const body = { groupjid: toUazapiGroupJid(input.groupId), description: input.description };
  await http.request({ method: "POST", path: "/group/updateDescription", body });
}
async function updateGroupPicture2(http, input) {
  const body = {
    groupjid: toUazapiGroupJid(input.groupId),
    image: toUazapiGroupImage(input.media)
  };
  await http.request({ method: "POST", path: "/group/updateImage", body });
}
function toUazapiGroupImage(media) {
  if (media.url) return media.url;
  const mimeType = media.mimeType ?? "image/jpeg";
  return `data:${mimeType};base64,${media.base64}`;
}
function mapGroupInfo2(body, fallback = {}) {
  const record = asRecord3(body);
  const id = (record ? asString3(record.JID) : void 0) ?? fallback.id ?? "";
  const subject = (record ? asString3(record.Name) : void 0) ?? fallback.subject ?? "";
  const description = record ? asString3(record.Topic) : void 0;
  const owner = record ? asString3(record.OwnerJID) ?? asString3(record.OwnerPN) : void 0;
  const participantsRaw = record?.Participants;
  const participants = Array.isArray(participantsRaw) ? participantsRaw.map(mapGroupParticipant2) : (fallback.participants ?? []).map(toFallbackParticipant);
  return { id, subject, description, owner, participants, raw: body };
}
function mapGroupParticipant2(value) {
  const record = asRecord3(value);
  return {
    id: (record ? asString3(record.JID) : void 0) ?? "unknown",
    isAdmin: (record ? asBoolean3(record.IsAdmin) : void 0) ?? false,
    isSuperAdmin: (record ? asBoolean3(record.IsSuperAdmin) : void 0) ?? false
  };
}
function toFallbackParticipant(id) {
  return { id, isAdmin: false, isSuperAdmin: false };
}
async function listContacts2(http) {
  const response = await http.request({
    method: "GET",
    path: "/contacts",
    query: { contactScope: "all" }
  });
  if (!Array.isArray(response)) return [];
  return response.map(mapContactListItem);
}
function mapContactListItem(value) {
  const record = asRecord3(value);
  const id = (record ? asString3(record.jid) : void 0) ?? "";
  const name = record ? asString3(record.contact_name) ?? asString3(record.contact_FirstName) : void 0;
  return { id, name, raw: value };
}
async function requestChatDetails(http, chatId) {
  const number = toUazapiNumber(chatId);
  return http.request({
    method: "POST",
    path: "/chat/details",
    body: { number, preview: false }
  });
}
function mapContactFromChatDetails(body, requestedChatId) {
  const record = asRecord3(body);
  const id = (record ? asString3(record.wa_chatid) : void 0) ?? requestedChatId;
  const name = record ? asString3(record.wa_contactName) ?? asString3(record.wa_name) ?? asString3(record.name) : void 0;
  const isBlocked = record ? asBoolean3(record.wa_isBlocked) : void 0;
  const profilePictureUrl = record ? asString3(record.image) : void 0;
  return { id, name, isBlocked, profilePictureUrl, raw: body };
}
async function getContact2(http, chatId) {
  const response = await requestChatDetails(http, chatId);
  return mapContactFromChatDetails(response, chatId);
}
async function getContactProfilePicture3(http, chatId) {
  const response = await requestChatDetails(http, chatId);
  const record = asRecord3(response);
  return { url: record ? asString3(record.image) : void 0, raw: response };
}
async function checkContactExists2(http, phone) {
  const number = toUazapiNumber(phone);
  const response = await http.request({
    method: "POST",
    path: "/chat/check",
    body: { numbers: [number] }
  });
  return mapCheckExistsResult(response);
}
function mapCheckExistsResult(body) {
  const first = Array.isArray(body) ? asRecord3(body[0]) : void 0;
  const exists = (first ? asBoolean3(first.isInWhatsapp) : void 0) ?? false;
  const chatId = first ? asString3(first.jid) : void 0;
  return { exists, chatId, raw: body };
}
async function setContactBlocked(http, chatId, block) {
  const number = toUazapiNumber(chatId);
  await http.request({ method: "POST", path: "/chat/block", body: { number, block } });
}
async function blockContact2(http, chatId) {
  await setContactBlocked(http, chatId, true);
}
async function unblockContact2(http, chatId) {
  await setContactBlocked(http, chatId, false);
}
async function listBlockedContacts2(http) {
  const response = await http.request({ method: "GET", path: "/chat/blocklist" });
  const record = asRecord3(response);
  const blockList = record?.blockList;
  if (!Array.isArray(blockList)) return [];
  return blockList.map(asString3).filter((id) => id !== void 0);
}
async function setChatArchived2(http, chatId, archive) {
  const number = toUazapiNumber(chatId);
  await http.request({ method: "POST", path: "/chat/archive", body: { number, archive } });
}
async function archiveChat2(http, chatId) {
  await setChatArchived2(http, chatId, true);
}
async function unarchiveChat(http, chatId) {
  await setChatArchived2(http, chatId, false);
}
async function setChatMuted(http, chatId, muted) {
  const number = toUazapiNumber(chatId);
  const muteEndTime = muted ? -1 : 0;
  await http.request({ method: "POST", path: "/chat/mute", body: { number, muteEndTime } });
}
async function muteChat2(http, chatId) {
  await setChatMuted(http, chatId, true);
}
async function unmuteChat(http, chatId) {
  await setChatMuted(http, chatId, false);
}
async function setChatPinned(http, chatId, pin) {
  const number = toUazapiNumber(chatId);
  await http.request({ method: "POST", path: "/chat/pin", body: { number, pin } });
}
async function pinChat2(http, chatId) {
  await setChatPinned(http, chatId, true);
}
async function unpinChat2(http, chatId) {
  await setChatPinned(http, chatId, false);
}
async function setChatRead2(http, chatId, read) {
  const number = toUazapiNumber(chatId);
  await http.request({ method: "POST", path: "/chat/read", body: { number, read } });
}
async function markChatRead(http, chatId) {
  await setChatRead2(http, chatId, true);
}
async function markChatUnread(http, chatId) {
  await setChatRead2(http, chatId, false);
}
async function setTyping2(http, input) {
  await http.request({
    method: "POST",
    path: "/message/presence",
    body: { number: toUazapiNumber(input.to), presence: input.state }
  });
}
async function setPresence(http, state) {
  await http.request({
    method: "POST",
    path: "/instance/presence",
    body: { presence: state === "online" ? "available" : "unavailable" }
  });
}
async function listLabels3(http) {
  const body = await http.request({ method: "GET", path: "/labels" });
  const items = Array.isArray(body) ? body : [];
  return items.map((item) => mapUazapiLabel(item));
}
async function editLabel2(http, labelId, name, color, deleted) {
  await http.request({
    method: "POST",
    path: "/label/edit",
    body: { labelid: labelId, name, color: toUazapiLabelColor(color), delete: deleted }
  });
}
async function createLabel3(http, input) {
  const before = new Set((await listLabels3(http)).map((label) => label.id));
  await editLabel2(http, "new", input.name, input.color, false);
  const after = await listLabels3(http);
  const created = after.find((label) => !before.has(label.id));
  if (!created) {
    throw new WaConnectorError(
      "PROVIDER_ERROR",
      'uazapi: n\xE3o foi poss\xEDvel determinar o labelid criado por /label/edit (labelid:"new") \u2014 GET /labels n\xE3o trouxe nenhum id novo em rela\xE7\xE3o \xE0 listagem anterior.',
      { provider: PROVIDER3 }
    );
  }
  return created;
}
async function updateLabel3(http, input) {
  await editLabel2(http, input.labelId, input.name, input.color, false);
}
async function deleteLabel3(http, labelId) {
  await http.request({
    method: "POST",
    path: "/label/edit",
    body: { labelid: labelId, delete: true }
  });
}
async function setChatLabel2(http, input, direction) {
  const field = direction === "add" ? "add_labelid" : "remove_labelid";
  await http.request({
    method: "POST",
    path: "/chat/labels",
    body: { number: toUazapiNumber(input.chatId), [field]: input.labelId }
  });
}
function toUazapiLabelColor(color) {
  if (color === void 0) return 0;
  const parsed = Number(color);
  return Number.isFinite(parsed) ? parsed : 0;
}
function mapUazapiLabel(body) {
  const record = asRecord3(body);
  const id = (record ? asString3(record.labelid) : void 0) ?? (record ? asString3(record.id) : void 0);
  const color = record ? asNumber2(record.color) : void 0;
  return {
    id: id ?? "",
    name: (record ? asString3(record.name) : void 0) ?? "",
    color: color === void 0 ? void 0 : String(color),
    raw: body
  };
}
async function listChannels2(http) {
  const body = await http.request({ method: "GET", path: "/newsletter/list" });
  const record = asRecord3(body);
  const items = record && Array.isArray(record.response) ? record.response : [];
  return items.map((item) => mapUazapiChannel(item));
}
async function createChannel2(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/newsletter/create",
    body: { name: input.name, description: input.description }
  });
  const record = asRecord3(body);
  const data = record ? asRecord3(record.response) : void 0;
  return mapUazapiChannel(data ?? body, input);
}
async function getChannelInfo2(http, channelId) {
  const body = await http.request({
    method: "POST",
    path: "/newsletter/info",
    body: { jid: channelId }
  });
  const record = asRecord3(body);
  const data = record ? asRecord3(record.response) : void 0;
  return mapUazapiChannel(data ?? body, {});
}
async function deleteChannel(http, channelId) {
  await http.request({ method: "POST", path: "/newsletter/delete", body: { jid: channelId } });
}
async function setChannelFollowed(http, channelId, follow) {
  await http.request({
    method: "POST",
    path: follow ? "/newsletter/follow" : "/newsletter/unfollow",
    body: { jid: channelId }
  });
}
function mapUazapiChannel(body, fallback = {}) {
  const record = asRecord3(body);
  const id = (record ? asString3(record.id) : void 0) ?? "";
  const threadMeta = record ? asRecord3(record.thread_metadata) : void 0;
  const nameObj = threadMeta ? asRecord3(threadMeta.name) : void 0;
  const descriptionObj = threadMeta ? asRecord3(threadMeta.description) : void 0;
  const name = (nameObj ? asString3(nameObj.text) : void 0) ?? (record ? asString3(record.name) : void 0) ?? fallback.name ?? "";
  const description = (descriptionObj ? asString3(descriptionObj.text) : void 0) ?? (record ? asString3(record.description) : void 0) ?? fallback.description;
  const subscribersCountText = threadMeta ? asString3(threadMeta.subscribers_count) : void 0;
  const subscribersCount = subscribersCountText !== void 0 ? Number(subscribersCountText) : record ? asNumber2(record.subscribersCount) : void 0;
  return { id, name, description, subscribersCount, raw: body };
}
async function getChannelMessages2(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/newsletter/messages",
    body: {
      jid: input.channelId,
      count: input.count,
      ...input.before !== void 0 ? { beforeid: Number(input.before) } : {}
    }
  });
  const record = asRecord3(body);
  const items = record && Array.isArray(record.response) ? record.response : [];
  return items.map((item) => mapUazapiChannelPost(item));
}
function mapUazapiChannelPost(body) {
  const record = asRecord3(body);
  const serverId = record ? asNumber2(record.serverid) : void 0;
  const timestampRaw = record ? asString3(record.timestamp) : void 0;
  const timestamp = timestampRaw !== void 0 ? new Date(timestampRaw).getTime() : 0;
  const reactionCountsRaw = record ? asRecord3(record.reactionCounts) : void 0;
  const reactionCounts = reactionCountsRaw ? Object.fromEntries(
    Object.entries(reactionCountsRaw).map(([emoji, count]) => [emoji, asNumber2(count)]).filter((entry) => entry[1] !== void 0)
  ) : void 0;
  return {
    id: serverId !== void 0 ? String(serverId) : "",
    timestamp,
    text: extractUazapiChannelPostText(record?.message),
    viewsCount: record ? asNumber2(record.viewsCount) : void 0,
    reactionCounts,
    raw: body
  };
}
function extractUazapiChannelPostText(message) {
  const record = asRecord3(message);
  if (!record) return void 0;
  const conversation = asString3(record.conversation);
  if (conversation !== void 0) return conversation;
  const extendedText = asRecord3(record.extendedTextMessage);
  return extendedText ? asString3(extendedText.text) : void 0;
}
async function markChannelMessagesViewed(http, input) {
  await http.request({
    method: "POST",
    path: "/newsletter/viewed",
    body: { jid: input.channelId, serverids: input.messageIds.map(Number) }
  });
}
async function reactToChannelPost(http, input) {
  await http.request({
    method: "POST",
    path: "/newsletter/reaction",
    body: { jid: input.channelId, serverid: Number(input.messageId), reaction: input.emoji }
  });
}
async function getBusinessProfile(http) {
  const body = await http.request({
    method: "POST",
    path: "/business/get/profile",
    body: {}
  });
  const record = asRecord3(body);
  const data = record ? asRecord3(record.response) : void 0;
  return mapUazapiBusinessProfile(data ?? body);
}
async function updateBusinessProfile(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/business/update/profile",
    body: { description: input.description, address: input.address, email: input.email }
  });
  const record = asRecord3(body);
  const scope = (record ? asRecord3(record.response) : void 0) ?? record;
  if (scope && hasUazapiPartialFailure(scope)) {
    throw new WaConnectorError(
      "PROVIDER_ERROR",
      "uazapi: business.updateProfile retornou sucesso parcial (207 Multi-Status) \u2014 ao menos 1 campo falhou; verifique o corpo bruto da resposta para o detalhe por campo.",
      { provider: PROVIDER3 }
    );
  }
}
function hasUazapiPartialFailure(scope) {
  return Object.values(scope).some((value) => {
    const fieldRecord = asRecord3(value);
    return fieldRecord !== void 0 && fieldRecord.error !== void 0 && fieldRecord.error !== null;
  });
}
function mapUazapiBusinessProfile(body) {
  const record = asRecord3(body);
  const categoriesRaw = record && Array.isArray(record.categories) ? record.categories : [];
  const categories = categoriesRaw.map((item) => asRecord3(item)).map((item) => item ? asString3(item.localized_display_name) : void 0).filter((name) => name !== void 0);
  const websitesRaw = record && Array.isArray(record.websites) ? record.websites : [];
  const websites = websitesRaw.filter((item) => typeof item === "string");
  return {
    description: record ? asString3(record.description) : void 0,
    address: record ? asString3(record.address) : void 0,
    email: record ? asString3(record.email) : void 0,
    websites: websites.length > 0 ? websites : void 0,
    categories: categories.length > 0 ? categories : void 0,
    raw: body
  };
}
async function makeCall(http, input) {
  await http.request({
    method: "POST",
    path: "/call/make",
    body: { number: toUazapiNumber(input.to), call_duration: input.durationSeconds }
  });
}
async function rejectCall2(http, input) {
  await http.request({
    method: "POST",
    path: "/call/reject",
    body: { number: input.callerId, id: input.callId }
  });
}
function parseWebhook3(input) {
  try {
    return parseWebhookUnsafe3(input);
  } catch (error) {
    return [
      unknownEvent3(
        input.body,
        `Erro inesperado ao parsear webhook uazapi: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe3(input) {
  const body = input.body;
  const envelope = asRecord3(body);
  if (!envelope) {
    return [unknownEvent3(body, "Corpo do webhook uazapi n\xE3o \xE9 um objeto JSON.")];
  }
  const eventNameRaw = asString3(envelope.event) ?? asString3(envelope.EventType);
  if (!eventNameRaw) {
    return [unknownEvent3(body, 'Payload de webhook uazapi sem campo "event"/"EventType".')];
  }
  const instanceId = asString3(envelope.instance);
  const data = asRecord3(envelope.data);
  const eventName = eventNameRaw.toLowerCase();
  if (eventName === "message" || eventName === "messages") {
    if (!data) {
      return [
        unknownEvent3(body, `Evento "${eventNameRaw}" do uazapi sem campo "data".`, instanceId)
      ];
    }
    const message = mapUazapiMessage(data, body);
    return [
      {
        type: message.fromMe ? "message.sent" : "message.received",
        provider: PROVIDER3,
        instanceId,
        message,
        raw: body
      }
    ];
  }
  if (eventName === "status" || eventName === "messages_update" || eventName === "message.ack") {
    if (!data) {
      return [
        unknownEvent3(body, `Evento "${eventNameRaw}" do uazapi sem campo "data".`, instanceId)
      ];
    }
    return [
      {
        type: "message.ack",
        provider: PROVIDER3,
        instanceId,
        messageId: asString3(data.messageid) ?? asString3(data.id) ?? "unknown",
        chatId: asString3(data.chatid),
        ack: mapUazapiAck(asString3(data.status)),
        raw: body
      }
    ];
  }
  if (eventName === "connection" || eventName === "connection.update") {
    if (!data) {
      return [
        unknownEvent3(body, `Evento "${eventNameRaw}" do uazapi sem campo "data".`, instanceId)
      ];
    }
    const instanceRecord = asRecord3(data.instance);
    const providerStatus = instanceRecord ? asString3(instanceRecord.status) : void 0;
    const hasQr = instanceRecord !== void 0 && hasNonEmptyQr(instanceRecord);
    const connectionUpdate = {
      type: "connection.update",
      provider: PROVIDER3,
      instanceId,
      state: mapInstanceState2(providerStatus, hasQr),
      qr: instanceRecord ? asString3(instanceRecord.qrcode) : void 0,
      raw: body
    };
    return [connectionUpdate];
  }
  return [
    unknownEvent3(body, `Evento uazapi n\xE3o mapeado nesta fase: "${eventNameRaw}".`, instanceId)
  ];
}
function mapMessageKind(messageType) {
  if (messageType === "conversation" || messageType === "text") return "text";
  return "unknown";
}
function mapUazapiMessage(data, rawBody) {
  const fromMe = asBoolean3(data.fromMe) ?? false;
  const timestamp = asNumber2(data.messageTimestamp) ?? Date.now();
  return {
    id: asString3(data.messageid) ?? asString3(data.id) ?? `uazapi-unknown-${Date.now()}`,
    chatId: asString3(data.chatid) ?? "unknown",
    from: asString3(data.sender),
    fromMe,
    timestamp,
    kind: mapMessageKind(asString3(data.messageType)),
    text: asString3(data.text),
    quotedId: asString3(data.quoted),
    raw: rawBody
  };
}
function mapUazapiAck(status) {
  switch (status) {
    case "Queued":
      return "pending";
    case "Sent":
      return "sent";
    case "Delivered":
      return "delivered";
    case "Read":
      return "read";
    case "Failed":
      return "error";
    case "Canceled":
      return "error";
    default:
      return "sent";
  }
}
function unknownEvent3(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER3, instanceId, raw, reason };
}
function asRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString3(value) {
  return typeof value === "string" ? value : void 0;
}
function asNumber2(value) {
  return typeof value === "number" ? value : void 0;
}
function asBoolean3(value) {
  return typeof value === "boolean" ? value : void 0;
}
var PROVIDER4 = "waha";
var WAHA_CAPABILITIES = [
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
  "messages.pin",
  "messages.unpin",
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
  "chats.archive",
  "chats.unarchive",
  "chats.markRead",
  "chats.markUnread",
  "presence.setTyping",
  "presence.set",
  "presence.subscribe",
  "labels.list",
  "labels.create",
  "labels.update",
  "labels.delete",
  "channels.list",
  "channels.create",
  "channels.getInfo",
  "channels.delete",
  "channels.follow",
  "channels.unfollow",
  "calls.reject",
  "webhooks.parse"
];
function waha(options) {
  const session = options.session ?? "default";
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { "X-Api-Key": options.apiKey },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.apiKey],
    provider: PROVIDER4,
    fetch: options.fetch
  });
  const instance = {
    connect: async () => {
      await http.request({
        method: "POST",
        path: `/api/sessions/${encodeURIComponent(session)}/start`
      });
      const qrBody = await http.request({
        method: "GET",
        path: `/api/${encodeURIComponent(session)}/auth/qr`,
        query: { format: "raw" }
      });
      return { qr: extractQr2(qrBody), raw: qrBody };
    },
    status: async () => {
      const body = await http.request({
        method: "GET",
        path: `/api/sessions/${encodeURIComponent(session)}`
      });
      const record = asRecord4(body);
      return {
        state: mapWahaStatus(record ? asString4(record.status) : void 0),
        raw: body
      };
    },
    logout: async () => {
      await http.request({
        method: "POST",
        path: `/api/sessions/${encodeURIComponent(session)}/logout`
      });
    }
  };
  const messages = {
    sendText: async (input) => {
      const chatId = toWahaChatId(input.to);
      const requestBody = {
        chatId,
        text: input.text,
        session,
        reply_to: input.quotedId
      };
      if (input.mentions && input.mentions.length > 0) {
        requestBody.mentions = input.mentions.map(toWahaMention);
      }
      const body = await http.request({
        method: "POST",
        path: "/api/sendText",
        body: requestBody
      });
      return mapSentMessage2(body, chatId);
    },
    sendMedia: async (input) => {
      const chatId = toWahaChatId(input.to);
      const file = buildWahaFile(input.media);
      const requestBody = {
        chatId,
        file,
        session,
        reply_to: input.quotedId
      };
      if (input.media.kind !== "audio") {
        requestBody.caption = input.caption;
      }
      if (input.media.kind === "video" || input.media.kind === "audio") {
        requestBody.convert = false;
      }
      const body = await http.request({
        method: "POST",
        path: mediaEndpoint(input.media.kind),
        body: requestBody
      });
      return mapSentMessage2(body, chatId);
    },
    sendReaction: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request({
        method: "PUT",
        path: "/api/reaction",
        body: {
          session,
          messageId: input.messageId,
          reaction: input.emoji
        }
      });
      return mapSentMessage2(body, chatId);
    },
    /**
     * `PUT /api/{session}/chats/{chatId}/messages/{messageId}` (retrofit ADR-0012; confirmado no
     * `openapi.json` oficial, operationId `ChatsController_editMessage`, schema
     * `EditMessageRequest` — confiança Alta, com exemplo curl completo em
     * `docs/how-to/send-messages/` e `docs/how-to/chats/`). Body: `{ text }` — o schema também
     * aceita `linkPreview`/`linkPreviewHighQuality` opcionais (mesma semântica de `sendText`), mas
     * `EditMessageInput` não expõe esses campos ao chamador, então não são enviados (mesma regra
     * de "não inventar campo fora do contrato canônico" já seguida em `sendMedia`/`convert`). A doc
     * confirma explicitamente: "You can edit text messages or 'caption' in media messages". Sem
     * janela de tempo validada pelo WAHA (nenhuma das duas fontes documenta um prazo de edição,
     * diferente do limite real de ~15min do WhatsApp) — a confirmar contra instância real. Resposta
     * `200` sem schema de conteúdo — `mapSentMessage` cai no mesmo fallback já usado por
     * `sendReaction`. Ver docs/providers/waha.md#edição-e-exclusão-de-mensagem.
     */
    edit: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request({
        method: "PUT",
        path: messagePath(session, input.to, input.messageId),
        body: { text: input.text }
      });
      return mapSentMessage2(body, chatId);
    },
    /**
     * `DELETE /api/{session}/chats/{chatId}/messages/{messageId}` (retrofit ADR-0012; confirmado
     * no `openapi.json` oficial, operationId `ChatsController_deleteMessage` — confiança Alta,
     * mesmo exemplo em `docs/how-to/send-messages/` e `docs/how-to/chats/`). Sem body, sem schema
     * de resposta relevante — contrato retorna `void`. Nenhuma das duas fontes documenta uma
     * distinção "apagar só localmente" vs. "apagar para todos" (revoke) — `DeleteMessageInput` não
     * carrega campo de escopo (ver ADR-0012), o adapter apenas dispara a chamada. Ver
     * docs/providers/waha.md#edição-e-exclusão-de-mensagem.
     */
    delete: async (input) => {
      await http.request({
        method: "DELETE",
        path: messagePath(session, input.to, input.messageId)
      });
    },
    /**
     * `POST /api/forwardMessage` (ADR-0013; `operationId ChattingController_forwardMessage`,
     * schema `MessageForwardRequest` — confiança Alta, página dedicada com exemplo completo).
     * Body: `{chatId, messageId, session}` — `chatId` aqui é o DESTINO (`input.to`); a origem da
     * mensagem é resolvida pelo próprio `messageId` (formato `{fromMe}_{chat}_{id}` já
     * autoidentifica o chat de origem), então `input.fromChatId` (opcional no contrato canônico,
     * ADR-0013) nunca é necessário para este provider e é ignorado se enviado. Resposta `201`:
     * `WAMessage` completo, mesmo shape de `mapSentMessage`. **Nuance documentada verbatim**: "You
     * can forward a message to another chat (that you chatted before, otherwise it may fail)" —
     * encaminhar para um chat nunca contatado pode falhar (limitação do protocolo, não bug do
     * adapter).
     */
    forward: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request({
        method: "POST",
        path: "/api/forwardMessage",
        body: { chatId, messageId: input.messageId, session }
      });
      return mapSentMessage2(body, chatId);
    },
    /**
     * `PUT /api/star` (ADR-0013; `operationId ChattingController_setStar`, schema
     * `MessageStarRequest` — confiança Alta, página dedicada "Star and unstar message"). Body:
     * `{messageId, chatId, star, session}` — diferente de `sendReaction` (que resolve o chat só
     * pelo `messageId`), aqui `chatId` é campo obrigatório separado. Um único endpoint com flag
     * booleana cobre as duas direções; `star`/`unstar` do contrato canônico (ADR-0013, capabilities
     * separadas) mapeiam para `star: true`/`star: false` no mesmo endpoint. Resposta `200` sem
     * schema — ignorada, contrato retorna `void`.
     */
    star: async (input) => {
      await setStarred(http, session, input, true);
    },
    unstar: async (input) => {
      await setStarred(http, session, input, false);
    },
    /**
     * `POST .../messages/{messageId}/pin` / `.../unpin` (ADR-0013; schema `PinMessageRequest`,
     * confiança Alta para request, Média para o schema de resposta — doc e `openapi.json`
     * divergem, mesma classe de gap já documentada em `groups.updatePicture`). `pin` exige
     * `duration` em SEGUNDOS — só 3 valores são aceitos nativamente pelo WhatsApp: `86400` (24h),
     * `604800` (7 dias), `2592000` (30 dias). `PinMessageInput` do contrato canônico não expõe
     * duração (ADR-0013 — nenhum formato converge entre providers); este adapter usa `86400` (24h)
     * como default, decisão própria documentada aqui, não um default do provider. `unpin` não tem
     * body. Resposta (segundo a doc, não o schema): `{success: true}` — ignorada, `Promise<void>`.
     */
    pin: async (input) => {
      await http.request({
        method: "POST",
        path: messagePath(session, input.to, input.messageId, "pin"),
        body: { duration: WAHA_PIN_DURATION_SECONDS }
      });
    },
    unpin: async (input) => {
      await http.request({
        method: "POST",
        path: messagePath(session, input.to, input.messageId, "unpin")
      });
    },
    /**
     * `POST /api/sendSeen` (ADR-0013; `operationId ChattingController_sendSeen`, schema
     * `SendSeenRequest` — confiança Alta). Nível de MENSAGEM (`messageIds`), distinto de
     * `chats.markRead` (nível de conversa, `POST .../chats/{chatId}/messages/read`, ADR-0012).
     * Body: `{chatId, messageIds: [messageId], session}` — `messageId` (singular) existe no schema
     * mas está `deprecated: true`; este adapter sempre usa o array `messageIds` com um elemento.
     * `participant` (obrigatório só para grupos em engines NOWEB/GOWS) não é enviado — não exposto
     * pelo contrato canônico (`MarkMessageReadInput` não carrega esse campo); pode ser necessário
     * para marcar mensagens de terceiros em grupo, não confirmado contra instância real.
     */
    markRead: async (input) => {
      const chatId = toWahaChatId(input.to);
      await http.request({
        method: "POST",
        path: "/api/sendSeen",
        body: { chatId, messageIds: [input.messageId], session }
      });
    },
    /**
     * `POST /api/sendLocation` (ADR-0014; `operationId ChattingController_sendLocation`, schema
     * `MessageLocationRequest` — confiança Alta, página dedicada com exemplo curl idêntico). Body:
     * `{chatId, latitude, longitude, title, session}` — **`title` é campo obrigatório no schema,
     * não há `address`** (o `WALocation` de RECEPÇÃO tem `address`/`url`/`description`, mas o
     * request de ENVIO só aceita `title`); `input.address` do contrato canônico não tem para onde
     * ir neste provider e é ignorado. `input.name` mapeia para `title`; se ausente, envia string
     * vazia (o schema exige o campo presente, não necessariamente não-vazio).
     */
    sendLocation: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request({
        method: "POST",
        path: "/api/sendLocation",
        body: {
          chatId,
          latitude: input.latitude,
          longitude: input.longitude,
          title: input.name ?? "",
          session
        }
      });
      return mapSentMessage2(body, chatId);
    },
    /**
     * `POST /api/sendContactVcard` (ADR-0014; `operationId ChattingController_sendContactVcard`,
     * schema `MessageContactVcardRequest` — confiança Média, formatos alternativos do schema
     * `oneOf` não totalmente capturados). Body: `{session, chatId, contacts: [{fullName,
     * phoneNumber}]}` — array de contatos no schema (`VCardContact`), mas `SendContactCardInput`
     * do contrato canônico só modela um único contato; este adapter sempre envia um array de 1
     * elemento. `whatsappId`/`organization` (campos opcionais do schema) não têm de onde vir no
     * contrato canônico e são omitidos.
     */
    sendContactCard: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request({
        method: "POST",
        path: "/api/sendContactVcard",
        body: {
          session,
          chatId,
          contacts: [{ fullName: input.contactName, phoneNumber: input.contactPhone }]
        }
      });
      return mapSentMessage2(body, chatId);
    },
    /**
     * `POST /api/sendPoll` (ADR-0014; `operationId ChattingController_sendPoll`, schema
     * `MessagePollRequest` — confiança Alta). Body: `{session, chatId, poll: {name, options,
     * multipleAnswers}}` — `question`/`options`/`allowMultipleAnswers` do contrato canônico mapeiam
     * direto para `name`/`options`/`multipleAnswers` (booleano, sem tradução de escala). A doc
     * recomenda salvar o `id` da resposta para casar com votos recebidos via webhook
     * (`poll.vote`/`poll.vote.failed`) — não modelado nesta fase (fora do escopo de ENVIO).
     */
    sendPoll: async (input) => {
      const chatId = toWahaChatId(input.to);
      const body = await http.request({
        method: "POST",
        path: "/api/sendPoll",
        body: {
          session,
          chatId,
          poll: {
            name: input.question,
            options: input.options,
            multipleAnswers: !!input.allowMultipleAnswers
          }
        }
      });
      return mapSentMessage2(body, chatId);
    }
  };
  const groups = {
    create: async (input) => {
      const body = await http.request({
        method: "POST",
        path: `/api/${encodeURIComponent(session)}/groups`,
        body: {
          name: input.subject,
          participants: toWahaParticipants(input.participants)
        }
      });
      return mapGroupInfo3(body, { subject: input.subject, participants: input.participants });
    },
    getInfo: async (groupId) => {
      const body = await http.request({
        method: "GET",
        path: `/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(toWahaGroupId(groupId))}`
      });
      return mapGroupInfo3(body, { id: groupId });
    },
    list: async () => {
      const body = await http.request({
        method: "GET",
        path: `/api/${encodeURIComponent(session)}/groups`
      });
      const items = Array.isArray(body) ? body : [];
      return items.map((item) => mapGroupInfo3(item));
    },
    addParticipants: async (input) => {
      await http.request({
        method: "POST",
        path: groupParticipantsPath(session, input.groupId, "participants/add"),
        body: { participants: toWahaParticipants(input.participants) }
      });
    },
    removeParticipants: async (input) => {
      await http.request({
        method: "POST",
        path: groupParticipantsPath(session, input.groupId, "participants/remove"),
        body: { participants: toWahaParticipants(input.participants) }
      });
    },
    promoteParticipants: async (input) => {
      await http.request({
        method: "POST",
        path: groupParticipantsPath(session, input.groupId, "admin/promote"),
        body: { participants: toWahaParticipants(input.participants) }
      });
    },
    demoteParticipants: async (input) => {
      await http.request({
        method: "POST",
        path: groupParticipantsPath(session, input.groupId, "admin/demote"),
        body: { participants: toWahaParticipants(input.participants) }
      });
    },
    updateSubject: async (input) => {
      await http.request({
        method: "PUT",
        path: groupParticipantsPath(session, input.groupId, "subject"),
        body: { subject: input.subject }
      });
    },
    updateDescription: async (input) => {
      await http.request({
        method: "PUT",
        path: groupParticipantsPath(session, input.groupId, "description"),
        body: { description: input.description }
      });
    },
    updatePicture: async (input) => {
      const file = buildWahaFile(input.media, "image/jpeg");
      await http.request({
        method: "PUT",
        path: groupParticipantsPath(session, input.groupId, "picture"),
        body: { file }
      });
    },
    getInviteLink: async (groupId) => {
      const body = await http.request({
        method: "GET",
        path: groupParticipantsPath(session, groupId, "invite-code")
      });
      return mapGroupInviteLink(body);
    },
    revokeInviteLink: async (groupId) => {
      const body = await http.request({
        method: "POST",
        path: groupParticipantsPath(session, groupId, "invite-code/revoke")
      });
      return mapGroupInviteLink(body);
    },
    joinViaInviteLink: async (input) => {
      await http.request({
        method: "POST",
        path: `/api/${encodeURIComponent(session)}/groups/join`,
        body: { code: input.invite }
      });
    },
    leaveGroup: async (groupId) => {
      await http.request({
        method: "POST",
        path: groupParticipantsPath(session, groupId, "leave")
      });
    }
  };
  const contacts = {
    list: async () => {
      const body = await http.request({
        method: "GET",
        path: "/api/contacts/all",
        query: { session }
      });
      const items = Array.isArray(body) ? body : [];
      return items.map((item) => mapContact(item));
    },
    get: async (chatId) => {
      const contactId = toWahaChatId(chatId);
      const body = await http.request({
        method: "GET",
        path: "/api/contacts",
        query: { contactId, session }
      });
      return mapContact(body);
    },
    checkExists: async (phone) => {
      const phoneDigits = toWahaPhoneDigits(phone);
      const body = await http.request({
        method: "GET",
        path: "/api/contacts/check-exists",
        query: { phone: phoneDigits, session }
      });
      return mapCheckExistsResult2(body);
    },
    getProfilePicture: async (chatId) => {
      const contactId = toWahaChatId(chatId);
      const body = await http.request({
        method: "GET",
        path: "/api/contacts/profile-picture",
        query: { contactId, session }
      });
      return mapContactProfilePicture(body);
    },
    getAbout: async (chatId) => {
      const contactId = toWahaChatId(chatId);
      const body = await http.request({
        method: "GET",
        path: "/api/contacts/about",
        query: { contactId, session }
      });
      return mapContactAbout(body);
    },
    block: async (chatId) => {
      const contactId = toWahaChatId(chatId);
      await http.request({
        method: "POST",
        path: "/api/contacts/block",
        body: { contactId, session }
      });
    },
    unblock: async (chatId) => {
      const contactId = toWahaChatId(chatId);
      await http.request({
        method: "POST",
        path: "/api/contacts/unblock",
        body: { contactId, session }
      });
    }
    // listBlocked NÃO é implementado: o WAHA não tem endpoint nativo de listagem de bloqueados
    // (busca exaustiva confirmou ausência de rota "blocklist"/"blocked" nos 18 tags do
    // openapi.json, e a doc oficial de features não lista essa operação entre as 7 de contato).
    // `isBlocked` existe por contato individual em GET /api/contacts/all (poderia ser
    // reconstruído client-side filtrando), mas isso não conta como endpoint nativo — mesma regra
    // já seguida para uazapi/contacts.getAbout: capability NÃO declarada, método NÃO implementado
    // (ver docs/providers/waha.md#contatos).
  };
  const chats = {
    /**
     * `POST /api/{session}/chats/{chatId}/archive` (operationId `ChatsController_archiveChat` —
     * confiança Alta). Sem body; resposta `201` com objeto genérico — ignorada, contrato retorna
     * `void`.
     */
    archive: async (chatId) => {
      await http.request({ method: "POST", path: chatPath(session, chatId, "archive") });
    },
    /**
     * `POST /api/{session}/chats/{chatId}/unarchive` (operationId `ChatsController_unarchiveChat`
     * — confiança Alta, par simétrico de `archive`). Mesmo tratamento de resposta.
     */
    unarchive: async (chatId) => {
      await http.request({ method: "POST", path: chatPath(session, chatId, "unarchive") });
    },
    /**
     * `POST /api/{session}/chats/{chatId}/messages/read` (operationId
     * `ChatsController_readChatMessages` — confiança Alta). Endpoint CONCORRENTE a
     * `POST /api/sendSeen` (nível de mensagem, exige `messageIds` explícito) — este é o único dos
     * dois que opera por `chatId` sozinho, coerente com a semântica de chat INTEIRO de
     * `ChatsApi.markRead` (ADR-0012, distinto de um eventual `messages.markRead` por id). Sem
     * query params: o adapter usa os defaults documentados do provider (marca como lidas as
     * mensagens não lidas dos últimos 7 dias, até 30 no DM / 100 em grupo) — o contrato canônico
     * não expõe `count`/`days` para esta operação. Resposta (schema `ReadChatMessagesResponse`):
     * `{ ids: string[] }` com os ids marcados — ignorada, contrato retorna `void`.
     */
    markRead: async (chatId) => {
      await http.request({ method: "POST", path: chatPath(session, chatId, "messages/read") });
    },
    /**
     * `POST /api/{session}/chats/{chatId}/unread` (operationId `ChatsController_unreadChat` —
     * confiança Alta). Sem body; resposta sem schema declarado — ignorada, contrato retorna
     * `void`.
     */
    markUnread: async (chatId) => {
      await http.request({ method: "POST", path: chatPath(session, chatId, "unread") });
    }
  };
  const presence = {
    /**
     * `POST /api/{session}/presence` (ADR-0015; `operationId PresenceController_setPresence`,
     * schema `WAHASessionPresence` — confiança Alta). Body: `{chatId, presence}` — **`session` vai
     * no PATH aqui, não no body** (diferente de `sendText`/`sendMedia`/etc., que usam `/api/<op>`
     * com `session` no body — `presence` é um controller distinto, `PresenceController`, com
     * convenção de path própria). `chatId` OBRIGATÓRIO para `typing`/`recording`/`paused`, mas deve
     * ser OMITIDO para `online`/`offline` (presença global da conta) — confirmado na descrição do
     * campo: "Required for chat-related presence statuses; omit for ONLINE/OFFLINE".
     * `TypingState.composing` mapeia para o literal `typing` do provider (único desalinhamento de
     * nome).
     */
    setTyping: async (input) => {
      const chatId = toWahaChatId(input.to);
      await http.request({
        method: "POST",
        path: `/api/${encodeURIComponent(session)}/presence`,
        body: { chatId, presence: input.state === "composing" ? "typing" : input.state }
      });
    },
    set: async (state) => {
      await http.request({
        method: "POST",
        path: `/api/${encodeURIComponent(session)}/presence`,
        body: { presence: state }
      });
    },
    /**
     * `POST /api/{session}/presence/{chatId}/subscribe` (ADR-0015; `operationId
     * PresenceController_subscribe` — confiança Alta). Sem body. Necessário chamar antes de
     * receber `presence.update` de um contato específico via webhook.
     */
    subscribe: async (chatId) => {
      await http.request({
        method: "POST",
        path: `/api/${encodeURIComponent(session)}/presence/${encodeURIComponent(toWahaChatId(chatId))}/subscribe`
      });
    }
  };
  const labels = {
    /** `GET /api/{session}/labels` — resposta `[{id, name, color, colorHex}]`. */
    list: async () => {
      const body = await http.request({
        method: "GET",
        path: `/api/${encodeURIComponent(session)}/labels`
      });
      const items = Array.isArray(body) ? body : [];
      return items.map((item) => mapWahaLabel(item));
    },
    /**
     * `POST /api/{session}/labels` (schema `LabelBody`: `name` obrigatório, `color` OU `colorHex`
     * — a doc recomenda preferir `color`, cujo mapa `color`↔`colorHex` "pode mudar no futuro").
     * `LabelInfo.color` é opaco (ver ADR-0016): repassado direto como `color`.
     */
    create: async (input) => {
      const body = await http.request({
        method: "POST",
        path: `/api/${encodeURIComponent(session)}/labels`,
        body: { name: input.name, color: input.color }
      });
      return mapWahaLabel(body, input);
    },
    /** `PUT /api/{session}/labels/{labelId}` — mesmo body de `create`. */
    update: async (input) => {
      await http.request({
        method: "PUT",
        path: `/api/${encodeURIComponent(session)}/labels/${encodeURIComponent(input.labelId)}`,
        body: { name: input.name, color: input.color }
      });
    },
    /** `DELETE /api/{session}/labels/{labelId}`. */
    delete: async (labelId) => {
      await http.request({
        method: "DELETE",
        path: `/api/${encodeURIComponent(session)}/labels/${encodeURIComponent(labelId)}`
      });
    }
  };
  const channels = {
    /** `GET /api/{session}/channels` — `role` (query, filtro OWNER/ADMIN/SUBSCRIBER) não exposto pelo contrato canônico, omitido (lista todos). */
    list: async () => {
      const body = await http.request({
        method: "GET",
        path: `/api/${encodeURIComponent(session)}/channels`
      });
      const items = Array.isArray(body) ? body : [];
      return items.map((item) => mapWahaChannel(item));
    },
    /** `POST /api/{session}/channels` (schema `CreateChannelRequest {name, description?, picture?}`) — `picture` não exposto pelo contrato canônico (ver ADR-0017). */
    create: async (input) => {
      const body = await http.request({
        method: "POST",
        path: `/api/${encodeURIComponent(session)}/channels`,
        body: { name: input.name, description: input.description }
      });
      return mapWahaChannel(body, input);
    },
    /** `GET /api/{session}/channels/{id}` — aceita tanto o id (`@newsletter`) quanto o código de convite puro. */
    getInfo: async (channelId) => {
      const body = await http.request({
        method: "GET",
        path: `/api/${encodeURIComponent(session)}/channels/${encodeURIComponent(channelId)}`
      });
      return mapWahaChannel(body, { id: channelId });
    },
    /** `DELETE /api/{session}/channels/{id}` — só permite deletar canais onde o chamador é OWNER (restrição do provider). */
    delete: async (channelId) => {
      await http.request({
        method: "DELETE",
        path: `/api/${encodeURIComponent(session)}/channels/${encodeURIComponent(channelId)}`
      });
    },
    /** `POST /api/{session}/channels/{id}/follow` — sem body. */
    follow: async (channelId) => {
      await http.request({
        method: "POST",
        path: `/api/${encodeURIComponent(session)}/channels/${encodeURIComponent(channelId)}/follow`
      });
    },
    /** `POST /api/{session}/channels/{id}/unfollow` — sem body. */
    unfollow: async (channelId) => {
      await http.request({
        method: "POST",
        path: `/api/${encodeURIComponent(session)}/channels/${encodeURIComponent(channelId)}/unfollow`
      });
    }
  };
  const calls = {
    reject: async (input) => rejectCall3(http, session, input)
  };
  return {
    provider: PROVIDER4,
    capabilities: WAHA_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    labels,
    channels,
    calls,
    parseWebhook: (input) => parseWahaWebhook(input, session, options.webhookHmacKey)
  };
}
async function rejectCall3(http, session, input) {
  if (!input.callerId || !input.callId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'calls.reject no WAHA exige "callerId" e "callId" (schema RejectCallRequest {from, id}).',
      { provider: PROVIDER4 }
    );
  }
  await http.request({
    method: "POST",
    path: `/api/${encodeURIComponent(session)}/calls/reject`,
    body: { from: input.callerId, id: input.callId }
  });
}
function toWahaChatId(canonical) {
  if (canonical.includes("@")) {
    if (canonical.endsWith("@s.whatsapp.net")) {
      const number = canonical.slice(0, canonical.indexOf("@"));
      return `${number}@c.us`;
    }
    return canonical;
  }
  return `${canonical}@c.us`;
}
function toWahaPhoneDigits(canonical) {
  const chatId = toWahaChatId(canonical);
  const atIndex = chatId.indexOf("@");
  return atIndex === -1 ? chatId : chatId.slice(0, atIndex);
}
function toWahaMention(entry) {
  if (entry === "all") return entry;
  return toWahaChatId(entry);
}
function toWahaGroupId(groupId) {
  return groupId.includes("@") ? groupId : `${groupId}@g.us`;
}
function toWahaParticipants(participants) {
  return participants.map((participant) => ({ id: toWahaChatId(participant) }));
}
function groupParticipantsPath(session, groupId, suffix) {
  return `/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(toWahaGroupId(groupId))}/${suffix}`;
}
function chatPath(session, chatId, suffix) {
  return `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(toWahaChatId(chatId))}/${suffix}`;
}
function messagePath(session, chatId, messageId, suffix) {
  const base = `messages/${encodeURIComponent(messageId)}`;
  return chatPath(session, chatId, suffix ? `${base}/${suffix}` : base);
}
var WAHA_PIN_DURATION_SECONDS = 86400;
async function setStarred(http, session, input, star) {
  const chatId = toWahaChatId(input.to);
  await http.request({
    method: "PUT",
    path: "/api/star",
    body: { messageId: input.messageId, chatId, star, session }
  });
}
function buildWahaFile(media, defaultMimetype = "application/octet-stream") {
  const mimetype = media.mimeType ?? defaultMimetype;
  if (media.url !== void 0) {
    return { mimetype, filename: media.filename, url: media.url };
  }
  if (media.base64 !== void 0) {
    return { mimetype, filename: media.filename, data: media.base64 };
  }
  throw new WaConnectorError("INVALID_INPUT", 'sendMedia exige "media.url" ou "media.base64".', {
    provider: PROVIDER4
  });
}
function mediaEndpoint(kind) {
  switch (kind) {
    case "image":
      return "/api/sendImage";
    case "video":
      return "/api/sendVideo";
    case "audio":
      return "/api/sendVoice";
    case "document":
      return "/api/sendFile";
    case "sticker":
      return "/api/sendFile";
  }
}
function extractQr2(body) {
  const record = asRecord4(body);
  if (!record) return void 0;
  return asString4(record.value) ?? asString4(record.data);
}
function mapSentMessage2(body, requestedChatId) {
  const record = asRecord4(body);
  const id = (record ? asString4(record.id) : void 0) ?? `waha-${Date.now()}`;
  const chatId = (record ? asString4(record.chatId) ?? asString4(record.to) : void 0) ?? requestedChatId;
  const timestampRaw = record ? asNumber3(record.timestamp) : void 0;
  return {
    id,
    chatId,
    timestamp: timestampRaw === void 0 ? void 0 : normalizeTimestamp(timestampRaw),
    raw: body
  };
}
function mapGroupParticipant3(entry) {
  const record = asRecord4(entry);
  if (!record) return void 0;
  const id = asString4(record.pn) ?? asString4(record.id);
  if (id === void 0) return void 0;
  const role = asString4(record.role);
  return {
    id,
    isAdmin: role === "admin" || role === "superadmin",
    isSuperAdmin: role === "superadmin"
  };
}
function mapGroupParticipants2(value) {
  if (!Array.isArray(value)) return void 0;
  const mapped = [];
  for (const entry of value) {
    const participant = mapGroupParticipant3(entry);
    if (participant) mapped.push(participant);
  }
  return mapped;
}
function mapGroupParticipantsAction(type) {
  switch (type) {
    case "join":
      return "participants.add";
    case "leave":
      return "participants.remove";
    case "promote":
      return "participants.promote";
    case "demote":
      return "participants.demote";
    default:
      return void 0;
  }
}
function mapGroupUpdateParticipantIds(value) {
  const participants = mapGroupParticipants2(value);
  if (!participants || participants.length === 0) return void 0;
  return participants.map((participant) => participant.id);
}
function mapGroupInfo3(body, fallback = {}) {
  const record = asRecord4(body);
  const id = (record ? asString4(record.id) : void 0) ?? fallback.id ?? `waha-group-${Date.now()}`;
  const subject = (record ? asString4(record.subject) : void 0) ?? fallback.subject ?? "";
  const description = record ? asString4(record.description) : void 0;
  const participants = (record ? mapGroupParticipants2(record.participants) : void 0) ?? (fallback.participants ?? []).map((participantId) => ({
    id: participantId,
    isAdmin: false,
    isSuperAdmin: false
  }));
  return {
    id,
    subject,
    description,
    // O WAHA não expõe um campo de "dono" explícito no schema inferido de GroupInfo — ver
    // docs/providers/waha.md#grupos-núcleo.
    owner: void 0,
    participants,
    raw: body
  };
}
function mapGroupInviteLink(body) {
  const code = typeof body === "string" ? body : "";
  return { link: normalizeInviteLink(code), raw: body };
}
function mapContact(body) {
  const record = asRecord4(body);
  const idSource = (record ? asString4(record.id) : void 0) ?? (record ? asString4(record.number) : void 0);
  const id = idSource === void 0 ? "unknown" : toWahaChatId(idSource);
  const name = (record ? asString4(record.name) : void 0) ?? (record ? asString4(record.pushname) : void 0);
  return {
    id,
    name,
    hasWhatsApp: record ? asBoolean4(record.isWAContact) : void 0,
    isBlocked: record ? asBoolean4(record.isBlocked) : void 0,
    raw: body
  };
}
function mapCheckExistsResult2(body) {
  const record = asRecord4(body);
  const chatIdRaw = record ? asString4(record.chatId) : void 0;
  return {
    exists: (record ? asBoolean4(record.numberExists) : void 0) ?? false,
    chatId: chatIdRaw === void 0 ? void 0 : toWahaChatId(chatIdRaw),
    raw: body
  };
}
function mapContactProfilePicture(body) {
  const record = asRecord4(body);
  return {
    url: record ? asString4(record.profilePictureURL) : void 0,
    raw: body
  };
}
function mapContactAbout(body) {
  const record = asRecord4(body);
  return {
    about: record ? asString4(record.about) : void 0,
    raw: body
  };
}
function mapWahaLabel(body, fallback = {}) {
  const record = asRecord4(body);
  const id = (record ? asString4(record.id) : void 0) ?? `waha-label-${Date.now()}`;
  const name = (record ? asString4(record.name) : void 0) ?? fallback.name ?? "";
  const colorRaw = record?.color;
  const color = typeof colorRaw === "string" ? colorRaw : typeof colorRaw === "number" ? String(colorRaw) : fallback.color;
  return { id, name, color, raw: body };
}
function mapWahaChannel(body, fallback = {}) {
  const record = asRecord4(body);
  const id = (record ? asString4(record.id) : void 0) ?? fallback.id ?? `waha-channel-${Date.now()}`;
  const name = (record ? asString4(record.name) : void 0) ?? fallback.name ?? "";
  const description = (record ? asString4(record.description) : void 0) ?? fallback.description;
  const subscribersCount = record ? asNumber3(record.subscribersCount) : void 0;
  return { id, name, description, subscribersCount, raw: body };
}
function mapWahaStatus(status) {
  switch (status) {
    case "STOPPED":
      return "disconnected";
    case "STARTING":
      return "connecting";
    case "SCAN_QR_CODE":
      return "qr";
    case "WORKING":
      return "connected";
    case "FAILED":
      return "disconnected";
    default:
      return "unknown";
  }
}
function mapWahaAck(ackName, ackNumber) {
  switch (ackName?.toUpperCase()) {
    case "ERROR":
      return "error";
    case "PENDING":
      return "pending";
    case "SERVER":
    case "SENT":
      return "sent";
    case "DEVICE":
    case "DELIVERED":
      return "delivered";
    case "READ":
      return "read";
    case "PLAYED":
      return "played";
  }
  switch (ackNumber) {
    case -1:
      return "error";
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
      return "sent";
  }
}
function normalizeTimestamp(value) {
  return value < 1e12 ? value * 1e3 : value;
}
function mapMediaKindFromMime(mimetype) {
  if (mimetype?.startsWith("image/")) return "image";
  if (mimetype?.startsWith("video/")) return "video";
  if (mimetype?.startsWith("audio/")) return "audio";
  return "document";
}
function mapMessageKind2(hasMedia, mimetype) {
  if (!hasMedia) return "text";
  if (mimetype === void 0) return "unknown";
  return mapMediaKindFromMime(mimetype);
}
function mapWahaMessage(payload) {
  const fromMe = asBoolean4(payload.fromMe) ?? false;
  const from = asString4(payload.from);
  const to = asString4(payload.to);
  const chatId = (fromMe ? to : from) ?? from ?? to ?? "unknown";
  const hasMedia = asBoolean4(payload.hasMedia) ?? false;
  const mediaRecord = asRecord4(payload.media);
  const mediaUrl = mediaRecord ? asString4(mediaRecord.url) : void 0;
  const mediaMimetype = mediaRecord ? asString4(mediaRecord.mimetype) : void 0;
  const media = hasMedia && mediaUrl !== void 0 ? {
    kind: mapMediaKindFromMime(mediaMimetype),
    url: mediaUrl,
    mimeType: mediaMimetype,
    filename: mediaRecord ? asString4(mediaRecord.filename) : void 0
  } : void 0;
  const timestampRaw = asNumber3(payload.timestamp) ?? Math.floor(Date.now() / 1e3);
  const replyTo = asRecord4(payload.replyTo);
  const quotedId = replyTo ? asString4(replyTo.id) : void 0;
  return {
    id: asString4(payload.id) ?? `waha-unknown-${Date.now()}`,
    chatId,
    from,
    fromMe,
    timestamp: normalizeTimestamp(timestampRaw),
    kind: mapMessageKind2(hasMedia, mediaMimetype),
    text: asString4(payload.body),
    media,
    quotedId,
    raw: payload
  };
}
function parseWahaWebhook(input, defaultSession, webhookHmacKey) {
  const body = input.body;
  if (webhookHmacKey !== void 0) {
    const verification = verifyWahaHmac(input, webhookHmacKey);
    if (!verification.valid) {
      return [unknownEvent4(body, verification.reason)];
    }
  }
  const envelope = asRecord4(body);
  if (!envelope) {
    return [unknownEvent4(body, "Corpo do webhook WAHA n\xE3o \xE9 um objeto JSON.")];
  }
  const eventName = asString4(envelope.event);
  const session = asString4(envelope.session) ?? defaultSession;
  const payload = asRecord4(envelope.payload);
  if (eventName === "message") {
    if (!payload) {
      return [unknownEvent4(body, 'Evento "message" do WAHA sem "payload".')];
    }
    const message = mapWahaMessage(payload);
    return [
      {
        type: message.fromMe ? "message.sent" : "message.received",
        provider: PROVIDER4,
        instanceId: session,
        message,
        raw: body
      }
    ];
  }
  if (eventName === "message.ack") {
    if (!payload) {
      return [unknownEvent4(body, 'Evento "message.ack" do WAHA sem "payload".')];
    }
    return [
      {
        type: "message.ack",
        provider: PROVIDER4,
        instanceId: session,
        messageId: asString4(payload.id) ?? "unknown",
        chatId: asString4(payload.from),
        ack: mapWahaAck(asString4(payload.ackName), asNumber3(payload.ack)),
        raw: body
      }
    ];
  }
  if (eventName === "session.status") {
    if (!payload) {
      return [unknownEvent4(body, 'Evento "session.status" do WAHA sem "payload".')];
    }
    const connectionUpdate = {
      type: "connection.update",
      provider: PROVIDER4,
      instanceId: session,
      state: mapWahaStatus(asString4(payload.status)),
      raw: body
    };
    return [connectionUpdate];
  }
  if (eventName === "group.v2.participants") {
    if (!payload) {
      return [unknownEvent4(body, 'Evento "group.v2.participants" do WAHA sem "payload".')];
    }
    const group = asRecord4(payload.group);
    const groupId = group ? asString4(group.id) : void 0;
    const action = mapGroupParticipantsAction(asString4(payload.type));
    if (groupId === void 0 || action === void 0) {
      return [
        unknownEvent4(
          body,
          `Evento "group.v2.participants" do WAHA sem "group.id" ou "type" reconhecido ("${asString4(payload.type) ?? "(ausente)"}").`
        )
      ];
    }
    const groupUpdate = {
      type: "group.update",
      provider: PROVIDER4,
      instanceId: session,
      groupId,
      action,
      participants: mapGroupUpdateParticipantIds(payload.participants),
      raw: body
    };
    return [groupUpdate];
  }
  if (eventName === "group.v2.update") {
    if (!payload) {
      return [unknownEvent4(body, 'Evento "group.v2.update" do WAHA sem "payload".')];
    }
    const group = asRecord4(payload.group);
    const groupId = group ? asString4(group.id) : void 0;
    if (groupId === void 0) {
      return [unknownEvent4(body, 'Evento "group.v2.update" do WAHA sem "group.id".')];
    }
    const groupUpdates = [];
    const subject = group ? asString4(group.subject) : void 0;
    if (subject !== void 0) {
      groupUpdates.push({
        type: "group.update",
        provider: PROVIDER4,
        instanceId: session,
        groupId,
        action: "subject",
        raw: body
      });
    }
    const description = group ? asString4(group.description) : void 0;
    if (description !== void 0) {
      groupUpdates.push({
        type: "group.update",
        provider: PROVIDER4,
        instanceId: session,
        groupId,
        action: "description",
        raw: body
      });
    }
    if (groupUpdates.length === 0) {
      return [
        unknownEvent4(
          body,
          'Evento "group.v2.update" do WAHA sem "subject"/"description" reconhec\xEDveis em "group".'
        )
      ];
    }
    return groupUpdates;
  }
  if (eventName === "group.v2.join") {
    if (!payload) {
      return [unknownEvent4(body, 'Evento "group.v2.join" do WAHA sem "payload".')];
    }
    const group = asRecord4(payload.group);
    const groupId = group ? asString4(group.id) : void 0;
    if (groupId === void 0) {
      return [unknownEvent4(body, 'Evento "group.v2.join" do WAHA sem "group.id".')];
    }
    const groupUpdate = {
      type: "group.update",
      provider: PROVIDER4,
      instanceId: session,
      groupId,
      action: "participants.add",
      raw: body
    };
    return [groupUpdate];
  }
  if (eventName === "group.v2.leave") {
    if (!payload) {
      return [unknownEvent4(body, 'Evento "group.v2.leave" do WAHA sem "payload".')];
    }
    const group = asRecord4(payload.group);
    const groupId = group ? asString4(group.id) : void 0;
    if (groupId === void 0) {
      return [unknownEvent4(body, 'Evento "group.v2.leave" do WAHA sem "group.id".')];
    }
    const groupUpdate = {
      type: "group.update",
      provider: PROVIDER4,
      instanceId: session,
      groupId,
      action: "participants.remove",
      raw: body
    };
    return [groupUpdate];
  }
  return [
    unknownEvent4(
      body,
      `Evento WAHA n\xE3o mapeado nesta fase: "${eventName ?? '(sem campo "event")'}".`
    )
  ];
}
function unknownEvent4(raw, reason) {
  return { type: "unknown", provider: PROVIDER4, raw, reason };
}
function verifyWahaHmac(input, webhookHmacKey) {
  if (input.rawBody === void 0) {
    return {
      valid: false,
      reason: "webhookHmacKey est\xE1 configurada, mas WebhookInput.rawBody n\xE3o foi fornecido \u2014 a verifica\xE7\xE3o HMAC exige o corpo bruto do request (ver docs/providers/waha.md#verifica\xE7\xE3o-hmac-de-webhooks). Falhando fechado: webhook tratado como n\xE3o verific\xE1vel, n\xE3o processado."
    };
  }
  const receivedSignature = firstHeaderValue2(input.headers, "x-webhook-hmac");
  if (receivedSignature === void 0) {
    return {
      valid: false,
      reason: 'webhookHmacKey est\xE1 configurada, mas o header "X-Webhook-Hmac" n\xE3o veio no webhook.'
    };
  }
  const expectedSignature = createHmac("sha512", webhookHmacKey).update(input.rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return {
      valid: false,
      reason: 'Assinatura HMAC do webhook WAHA inv\xE1lida ("X-Webhook-Hmac" n\xE3o confere).'
    };
  }
  return { valid: true, reason: "" };
}
function firstHeaderValue2(headers, name) {
  if (!headers) return void 0;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return void 0;
}
function asRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString4(value) {
  return typeof value === "string" ? value : void 0;
}
function asNumber3(value) {
  return typeof value === "number" ? value : void 0;
}
function asBoolean4(value) {
  return typeof value === "boolean" ? value : void 0;
}

// src/adapters/whapi/index.ts
var PROVIDER5 = "whapi";
var DEFAULT_BASE_URL = "https://gate.whapi.cloud";
var WHAPI_CAPABILITIES = [
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
  "messages.pin",
  "messages.unpin",
  "messages.markRead",
  "messages.sendLocation",
  "messages.sendContactCard",
  "messages.sendPoll",
  "messages.download",
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
  "labels.update",
  "labels.delete",
  "labels.addToChat",
  "labels.removeFromChat",
  "channels.list",
  "channels.create",
  "channels.getInfo",
  "channels.delete",
  "channels.follow",
  "channels.unfollow",
  "channels.getMessages",
  "business.getProfile",
  "business.updateProfile",
  "calls.reject",
  "webhooks.parse"
];
function whapi(options) {
  const http = new HttpClient({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    headers: { Authorization: `Bearer ${options.token}` },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.token],
    provider: PROVIDER5,
    fetch: options.fetch
  });
  const instance = {
    connect: () => connectInstance4(http),
    status: () => statusInstance4(http),
    logout: () => logoutInstance4(http)
  };
  const messages = {
    sendText: (input) => sendText4(http, input),
    sendMedia: (input) => sendMedia4(http, input),
    sendReaction: (input) => sendReaction3(http, input),
    edit: (input) => editMessage4(http, input),
    delete: (input) => deleteMessage4(http, input),
    forward: (input) => forwardMessage(http, input),
    star: (input) => setMessageStarred(http, input, true),
    unstar: (input) => setMessageStarred(http, input, false),
    pin: (input) => setMessagePinned2(http, input, true),
    unpin: (input) => setMessagePinned2(http, input, false),
    markRead: (input) => markMessageRead4(http, input),
    sendLocation: (input) => sendLocation4(http, input),
    sendContactCard: (input) => sendContactCard4(http, input),
    sendPoll: (input) => sendPoll4(http, input),
    download: (input) => downloadMedia3(http, input)
  };
  const groups = {
    create: (input) => createGroup3(http, input),
    getInfo: (groupId) => getGroupInfo3(http, groupId),
    list: () => listGroups3(http),
    addParticipants: (input) => updateGroupParticipants3(http, input, "add"),
    removeParticipants: (input) => updateGroupParticipants3(http, input, "remove"),
    promoteParticipants: (input) => updateGroupParticipants3(http, input, "promote"),
    demoteParticipants: (input) => updateGroupParticipants3(http, input, "demote"),
    updateSubject: (input) => updateGroupSubject3(http, input),
    updateDescription: (input) => updateGroupDescription3(http, input),
    updatePicture: (input) => updateGroupPicture3(http, input),
    getInviteLink: (groupId) => getGroupInviteLink4(http, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink2(http, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink3(http, input),
    leaveGroup: (groupId) => leaveGroupCall(http, groupId)
  };
  const contacts = {
    list: () => listContacts3(http),
    get: (chatId) => getContact3(http, chatId),
    checkExists: (chatId) => checkContactExists3(http, chatId),
    getProfilePicture: (chatId) => getContactProfilePicture4(http, chatId),
    getAbout: (chatId) => getContactAbout2(http, chatId),
    block: (chatId) => blockContact3(http, chatId),
    unblock: (chatId) => unblockContact3(http, chatId),
    listBlocked: () => listBlockedContacts3(http)
  };
  const chats = {
    archive: (chatId) => archiveChat3(http, chatId),
    unarchive: (chatId) => unarchiveChat2(http, chatId),
    mute: (chatId) => muteChat3(http, chatId),
    unmute: (chatId) => unmuteChat2(http, chatId),
    pin: (chatId) => pinChat3(http, chatId),
    unpin: (chatId) => unpinChat3(http, chatId),
    markRead: (chatId) => markChatRead2(http, chatId),
    markUnread: (chatId) => markChatUnread2(http, chatId)
  };
  const presence = {
    setTyping: (input) => setTyping3(http, input),
    set: (state) => setPresence2(http, state),
    subscribe: (chatId) => subscribePresence(http, chatId)
  };
  const labels = {
    list: () => listLabels4(http),
    create: (input) => createLabel4(http, input),
    update: (input) => renameLabel(http, input),
    delete: (labelId) => deleteLabel4(http, labelId),
    addToChat: (input) => setLabelAssociation(http, input, true),
    removeFromChat: (input) => setLabelAssociation(http, input, false)
  };
  const channels = {
    list: () => listChannels3(http),
    create: (input) => createChannel3(http, input),
    getInfo: (channelId) => getChannelInfo3(http, channelId),
    delete: (channelId) => deleteChannel2(http, channelId),
    follow: (channelId) => setChannelSubscribed(http, channelId, true),
    unfollow: (channelId) => setChannelSubscribed(http, channelId, false),
    getMessages: (input) => getChannelMessages3(http, input)
  };
  const business = {
    getProfile: () => getBusinessProfile2(http),
    updateProfile: (input) => updateBusinessProfile2(http, input)
  };
  const calls = {
    reject: (input) => rejectCall4(http, input)
  };
  return {
    provider: PROVIDER5,
    capabilities: WHAPI_CAPABILITIES,
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
    parseWebhook: (input) => parseWebhook4(input)
  };
}
function toWhapiChatId(chatId) {
  return chatId;
}
async function connectInstance4(http) {
  const body = await http.request({
    method: "GET",
    path: "/users/login",
    query: { wakeup: true }
  });
  return { qr: extractQr3(body), raw: body };
}
function extractQr3(body) {
  const record = asRecord5(body);
  return record ? asString5(record.base64) : void 0;
}
async function statusInstance4(http) {
  const body = await http.request({
    method: "GET",
    path: "/health",
    query: { wakeup: false }
  });
  return { state: mapInstanceState3(body), raw: body };
}
function mapInstanceState3(body) {
  const record = asRecord5(body);
  const status = record ? asRecord5(record.status) : void 0;
  const text = status ? asString5(status.text) : void 0;
  return mapChannelState(text);
}
function mapChannelState(text) {
  switch (text) {
    case "NOT_INIT":
      return "disconnected";
    case "INIT":
    case "LAUNCH":
      return "connecting";
    case "QR":
      return "qr";
    case "AUTH":
      return "connected";
    case "ERROR":
    case "SYNC_ERROR":
      return "unknown";
    default:
      return "unknown";
  }
}
async function logoutInstance4(http) {
  await http.request({ method: "POST", path: "/users/logout" });
}
async function sendText4(http, input) {
  const to = toWhapiChatId(input.to);
  const body = { to, body: input.text };
  if (input.quotedId) {
    body.quoted = input.quotedId;
  }
  if (input.mentions && input.mentions.length > 0) {
    body.mentions = input.mentions;
  }
  const response = await http.request({
    method: "POST",
    path: "/messages/text",
    body
  });
  return mapSentMessage3(response, to);
}
function resolveMediaEndpoint(kind) {
  switch (kind) {
    case "image":
      return { path: "/messages/image", supportsCaption: true };
    case "video":
      return { path: "/messages/video", supportsCaption: true };
    case "audio":
      return { path: "/messages/audio", supportsCaption: false };
    case "document":
      return { path: "/messages/document", supportsCaption: true };
    case "sticker":
      return { path: "/messages/sticker", supportsCaption: false };
  }
}
var DEFAULT_MIME_BY_KIND = {
  image: "image/png",
  video: "video/mp4",
  // WhatsApp/Whapi exigem OGG+opus para áudio (confirmado no Help Desk) — usado só como fallback
  // quando nem media.mimeType nem media.base64 (já em data URI) esclarecem o formato real.
  audio: "audio/ogg; codecs=opus",
  document: "application/octet-stream",
  sticker: "image/webp"
};
function resolveMediaValue(media) {
  if (media.url) return media.url;
  if (media.base64) {
    if (media.base64.startsWith("data:")) return media.base64;
    const mime = media.mimeType ?? DEFAULT_MIME_BY_KIND[media.kind] ?? "application/octet-stream";
    return `data:${mime};base64,${media.base64}`;
  }
  throw new WaConnectorError(
    "INVALID_INPUT",
    'Whapi: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER5 }
  );
}
async function sendMedia4(http, input) {
  const to = toWhapiChatId(input.to);
  const endpoint = resolveMediaEndpoint(input.media.kind);
  const value = resolveMediaValue(input.media);
  const body = { to, media: value };
  if (endpoint.supportsCaption && input.caption) {
    body.caption = input.caption;
  }
  if (input.media.kind === "document" && input.media.filename) {
    body.filename = input.media.filename;
  }
  if (input.quotedId) {
    body.quoted = input.quotedId;
  }
  const response = await http.request({
    method: "POST",
    path: endpoint.path,
    body
  });
  return mapSentMessage3(response, to);
}
function mapSentMessage3(body, requestedTo) {
  const record = asRecord5(body);
  const message = record ? asRecord5(record.message) : void 0;
  const id = (message ? asString5(message.id) : void 0) ?? `whapi-${Date.now()}`;
  const chatId = (message ? asString5(message.chat_id) : void 0) ?? requestedTo;
  const timestamp = message ? toEpochMs2(message.timestamp) : void 0;
  return { id, chatId, timestamp, raw: body };
}
async function sendReaction3(http, input) {
  const to = toWhapiChatId(input.to);
  const path = `/messages/${encodeURIComponent(input.messageId)}/reaction`;
  const response = input.emoji === "" ? await http.request({ method: "DELETE", path }) : await http.request({ method: "PUT", path, body: { emoji: input.emoji } });
  return { id: input.messageId, chatId: to, raw: response };
}
async function editMessage4(http, input) {
  const to = toWhapiChatId(input.to);
  const body = { to, body: input.text, edit: input.messageId };
  const response = await http.request({
    method: "POST",
    path: "/messages/text",
    body
  });
  return mapSentMessage3(response, to);
}
async function deleteMessage4(http, input) {
  await http.request({
    method: "DELETE",
    path: `/messages/${encodeURIComponent(input.messageId)}`
  });
}
async function forwardMessage(http, input) {
  const to = toWhapiChatId(input.to);
  const response = await http.request({
    method: "POST",
    path: `/messages/${encodeURIComponent(input.messageId)}`,
    body: { to }
  });
  return mapSentMessage3(response, to);
}
async function setMessageStarred(http, input, starred) {
  await http.request({
    method: "PUT",
    path: `/messages/${encodeURIComponent(input.messageId)}/star`,
    body: { starred }
  });
}
async function setMessagePinned2(http, input, pinned) {
  const path = `/messages/${encodeURIComponent(input.messageId)}/pin`;
  if (pinned) {
    await http.request({ method: "POST", path, body: { time: "day" } });
    return;
  }
  await http.request({ method: "DELETE", path });
}
async function markMessageRead4(http, input) {
  await http.request({
    method: "PUT",
    path: `/messages/${encodeURIComponent(input.messageId)}`
  });
}
async function sendLocation4(http, input) {
  const to = toWhapiChatId(input.to);
  const body = {
    to,
    latitude: input.latitude,
    longitude: input.longitude
  };
  if (input.name) body.name = input.name;
  if (input.address) body.address = input.address;
  const response = await http.request({
    method: "POST",
    path: "/messages/location",
    body
  });
  return mapSentMessage3(response, to);
}
async function sendContactCard4(http, input) {
  const to = toWhapiChatId(input.to);
  const response = await http.request({
    method: "POST",
    path: "/messages/contact",
    body: { to, name: input.contactName, vcard: buildVcard(input.contactName, input.contactPhone) }
  });
  return mapSentMessage3(response, to);
}
function buildVcard(name, phone) {
  return `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}
END:VCARD`;
}
async function sendPoll4(http, input) {
  const to = toWhapiChatId(input.to);
  const response = await http.request({
    method: "POST",
    path: "/messages/poll",
    body: {
      to,
      title: input.question,
      options: input.options,
      count: input.allowMultipleAnswers ? 0 : 1
    }
  });
  return mapSentMessage3(response, to);
}
async function downloadMedia3(http, input) {
  const mediaId = extractWhapiMediaId(input) ?? input.messageId;
  const base64 = await http.request({
    method: "GET",
    path: `/media/${encodeURIComponent(mediaId)}`,
    responseType: "base64"
  });
  return { base64, raw: { mediaId } };
}
function extractWhapiMediaId(input) {
  const rawRecord = asRecord5(input.raw);
  const items = rawRecord ? asRecordArray(rawRecord.messages) : [];
  const item = items.find((candidate) => asString5(candidate.id) === input.messageId);
  if (!item) return void 0;
  const type = asString5(item.type);
  const mediaObject = type ? asRecord5(item[type]) : void 0;
  return mediaObject ? asString5(mediaObject.id) : void 0;
}
function groupPath(groupId, suffix = "") {
  return `/groups/${encodeURIComponent(groupId)}${suffix}`;
}
async function createGroup3(http, input) {
  const response = await http.request({
    method: "POST",
    path: "/groups",
    body: { subject: input.subject, participants: input.participants }
  });
  return mapGroupInfo4(response);
}
async function getGroupInfo3(http, groupId) {
  const response = await http.request({ method: "GET", path: groupPath(groupId) });
  return mapGroupInfo4(response, groupId);
}
async function listGroups3(http) {
  const response = await http.request({ method: "GET", path: "/groups" });
  const record = asRecord5(response);
  return asRecordArray(record?.groups).map((item) => mapGroupInfo4(item));
}
var PARTICIPANT_ENDPOINTS = {
  add: { method: "POST", suffix: "/participants" },
  remove: { method: "DELETE", suffix: "/participants" },
  promote: { method: "PATCH", suffix: "/admins" },
  demote: { method: "DELETE", suffix: "/admins" }
};
async function updateGroupParticipants3(http, input, action) {
  const endpoint = PARTICIPANT_ENDPOINTS[action];
  await http.request({
    method: endpoint.method,
    path: groupPath(input.groupId, endpoint.suffix),
    body: { participants: input.participants }
  });
}
async function updateGroupSubject3(http, input) {
  await http.request({
    method: "PUT",
    path: groupPath(input.groupId),
    body: { subject: input.subject }
  });
}
async function updateGroupDescription3(http, input) {
  await http.request({
    method: "PUT",
    path: groupPath(input.groupId),
    body: { description: input.description }
  });
}
async function updateGroupPicture3(http, input) {
  await http.request({
    method: "PUT",
    path: groupPath(input.groupId, "/icon"),
    body: { media: resolveMediaValue(input.media) }
  });
}
async function getGroupInviteLink4(http, groupId) {
  const response = await http.request({
    method: "GET",
    path: groupPath(groupId, "/invite")
  });
  const record = asRecord5(response);
  const code = record ? asString5(record.invite_code) : void 0;
  return { link: normalizeInviteLink(code ?? ""), raw: response };
}
async function revokeGroupInviteLink2(http, groupId) {
  await http.request({ method: "DELETE", path: groupPath(groupId, "/invite") });
  return getGroupInviteLink4(http, groupId);
}
async function joinGroupViaInviteLink3(http, input) {
  await http.request({
    method: "PUT",
    path: "/groups",
    body: { invite_code: extractInviteCode(input.invite) }
  });
}
async function leaveGroupCall(http, groupId) {
  await http.request({ method: "DELETE", path: groupPath(groupId) });
}
function mapGroupInfo4(body, fallbackId) {
  const record = asRecord5(body);
  const participants = asRecordArray(record?.participants).map(mapGroupParticipant4);
  return {
    id: (record ? asString5(record.id) : void 0) ?? fallbackId ?? "",
    subject: (record ? asString5(record.name) : void 0) ?? "",
    description: record ? asString5(record.description) : void 0,
    owner: record ? asString5(record.created_by) : void 0,
    participants,
    raw: body
  };
}
function mapGroupParticipant4(record) {
  const rank = asString5(record.rank);
  return {
    id: asString5(record.id) ?? "",
    isAdmin: rank === "admin" || rank === "creator",
    isSuperAdmin: rank === "creator"
  };
}
async function listContacts3(http) {
  const response = await http.request({ method: "GET", path: "/contacts" });
  const record = asRecord5(response);
  return asRecordArray(record?.contacts).map(mapContact2);
}
async function getContact3(http, chatId) {
  const response = await http.request({
    method: "GET",
    path: `/contacts/${encodeURIComponent(toWhapiChatId(chatId))}`
  });
  return mapContact2(response);
}
function mapContact2(body) {
  const record = asRecord5(body);
  const name = record ? asString5(record.name) ?? asString5(record.pushname) : void 0;
  const profilePictureUrl = record ? asString5(record.profile_pic_full) ?? asString5(record.profile_pic) : void 0;
  return {
    id: (record ? asString5(record.id) : void 0) ?? "",
    name,
    profilePictureUrl,
    raw: body
  };
}
async function checkContactExists3(http, chatId) {
  const contactId = toWhapiChatId(chatId);
  try {
    const response = await http.request({
      method: "HEAD",
      path: `/contacts/${encodeURIComponent(contactId)}`
    });
    return { exists: true, chatId: contactId, raw: response };
  } catch (error) {
    if (isWaConnectorError(error) && error.status === 404) {
      return { exists: false, raw: error };
    }
    throw error;
  }
}
async function getContactProfilePicture4(http, chatId) {
  const response = await http.request({
    method: "GET",
    path: `/contacts/${encodeURIComponent(toWhapiChatId(chatId))}/profile`
  });
  const record = asRecord5(response);
  const url = record ? asString5(record.icon_full) ?? asString5(record.icon) : void 0;
  return { url, raw: response };
}
async function getContactAbout2(http, chatId) {
  const response = await http.request({
    method: "GET",
    path: `/contacts/${encodeURIComponent(toWhapiChatId(chatId))}/about`
  });
  const record = asRecord5(response);
  return { about: record ? asString5(record.about) : void 0, raw: response };
}
var WHATSAPP_JID_SUFFIX = "@s.whatsapp.net";
function toWhapiBlacklistId(chatId) {
  return chatId.endsWith(WHATSAPP_JID_SUFFIX) ? chatId.slice(0, chatId.length - WHATSAPP_JID_SUFFIX.length) : chatId;
}
async function blockContact3(http, chatId) {
  await http.request({
    method: "PUT",
    path: `/blacklist/${encodeURIComponent(toWhapiBlacklistId(chatId))}`
  });
}
async function unblockContact3(http, chatId) {
  await http.request({
    method: "DELETE",
    path: `/blacklist/${encodeURIComponent(toWhapiBlacklistId(chatId))}`
  });
}
async function listBlockedContacts3(http) {
  const response = await http.request({ method: "GET", path: "/blacklist" });
  return asStringArray2(response);
}
function chatPath2(chatId) {
  return `/chats/${encodeURIComponent(toWhapiChatId(chatId))}`;
}
async function setChatArchived3(http, chatId, archive) {
  await http.request({ method: "POST", path: chatPath2(chatId), body: { archive } });
}
async function archiveChat3(http, chatId) {
  await setChatArchived3(http, chatId, true);
}
async function unarchiveChat2(http, chatId) {
  await setChatArchived3(http, chatId, false);
}
async function patchChat(http, chatId, body) {
  await http.request({ method: "PATCH", path: chatPath2(chatId), body });
}
async function pinChat3(http, chatId) {
  await patchChat(http, chatId, { pin: true });
}
async function unpinChat3(http, chatId) {
  await patchChat(http, chatId, { pin: false });
}
async function markChatRead2(http, chatId) {
  await patchChat(http, chatId, { mark_unread: false });
}
async function markChatUnread2(http, chatId) {
  await patchChat(http, chatId, { mark_unread: true });
}
var WHAPI_MUTE_FOREVER_MS = Date.UTC(2099, 0, 1);
async function muteChat3(http, chatId) {
  await patchChat(http, chatId, { mute_until: WHAPI_MUTE_FOREVER_MS });
}
async function unmuteChat2(http, chatId) {
  await patchChat(http, chatId, { mute_until: 0 });
}
async function setTyping3(http, input) {
  await http.request({
    method: "PUT",
    path: `/presences/${encodeURIComponent(toWhapiChatId(input.to))}`,
    body: { presence: input.state === "paused" ? "pause" : input.state }
  });
}
async function setPresence2(http, state) {
  await http.request({ method: "PUT", path: "/presences/me", body: { presence: state } });
}
async function subscribePresence(http, chatId) {
  await http.request({
    method: "POST",
    path: `/presences/${encodeURIComponent(toWhapiChatId(chatId))}`
  });
}
var WHAPI_DEFAULT_LABEL_COLOR = "salmon";
async function listLabels4(http) {
  const body = await http.request({ method: "GET", path: "/labels" });
  const items = Array.isArray(body) ? body : [];
  return items.map((item) => mapWhapiLabel(item));
}
async function createLabel4(http, input) {
  const existing = await listLabels4(http);
  const usedIds = new Set(existing.map((label) => label.id));
  let id;
  for (let candidate = 0; candidate <= 19; candidate++) {
    if (!usedIds.has(String(candidate))) {
      id = String(candidate);
      break;
    }
  }
  if (id === void 0) {
    throw new WaConnectorError(
      "PROVIDER_ERROR",
      "Whapi: n\xE3o h\xE1 labelId num\xE9rico livre entre 0 e 19 (limite de labels do WhatsApp Business atingido).",
      { provider: PROVIDER5 }
    );
  }
  const color = input.color ?? WHAPI_DEFAULT_LABEL_COLOR;
  await http.request({ method: "POST", path: "/labels", body: { id, name: input.name, color } });
  return { id, name: input.name, color, raw: { id, name: input.name, color } };
}
async function renameLabel(http, input) {
  await http.request({
    method: "PATCH",
    path: `/labels/${encodeURIComponent(input.labelId)}`,
    body: { name: input.name }
  });
}
async function deleteLabel4(http, labelId) {
  await http.request({ method: "DELETE", path: `/labels/${encodeURIComponent(labelId)}` });
}
async function setLabelAssociation(http, input, add) {
  await http.request({
    method: add ? "POST" : "DELETE",
    path: `/labels/${encodeURIComponent(input.labelId)}/${encodeURIComponent(toWhapiChatId(input.chatId))}`
  });
}
function mapWhapiLabel(body) {
  const record = asRecord5(body);
  return {
    id: (record ? asString5(record.id) : void 0) ?? "",
    name: (record ? asString5(record.name) : void 0) ?? "",
    color: record ? asString5(record.color) : void 0,
    raw: body
  };
}
async function listChannels3(http) {
  const body = await http.request({ method: "GET", path: "/newsletters" });
  const record = asRecord5(body);
  const items = record && Array.isArray(record.newsletters) ? record.newsletters : [];
  return items.map((item) => mapWhapiChannel(item));
}
async function createChannel3(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/newsletters",
    body: { name: input.name, description: input.description }
  });
  return mapWhapiChannel(body, input);
}
async function getChannelInfo3(http, channelId) {
  const body = await http.request({
    method: "GET",
    path: `/newsletters/${encodeURIComponent(channelId)}`
  });
  return mapWhapiChannel(body, {});
}
async function deleteChannel2(http, channelId) {
  await http.request({
    method: "DELETE",
    path: `/newsletters/${encodeURIComponent(channelId)}`
  });
}
async function setChannelSubscribed(http, channelId, subscribe) {
  await http.request({
    method: subscribe ? "POST" : "DELETE",
    path: `/newsletters/${encodeURIComponent(channelId)}/subscription`
  });
}
function mapWhapiChannel(body, fallback = {}) {
  const record = asRecord5(body);
  return {
    id: (record ? asString5(record.id) : void 0) ?? "",
    name: (record ? asString5(record.name) : void 0) ?? fallback.name ?? "",
    description: (record ? asString5(record.description) : void 0) ?? fallback.description,
    subscribersCount: record ? asNumber4(record.subscribers_count) : void 0,
    raw: body
  };
}
async function getChannelMessages3(http, input) {
  const body = await http.request({
    method: "GET",
    path: `/newsletters/${encodeURIComponent(input.channelId)}/messages`,
    query: {
      count: input.count,
      before: input.before !== void 0 ? Number(input.before) : void 0
    }
  });
  const record = asRecord5(body);
  const items = record ? asRecordArray(record.messages) : [];
  return items.map((item) => mapWhapiChannelPost(item));
}
function mapWhapiChannelPost(item) {
  const content = mapMessageContent2(item);
  const reactions = asRecordArray(item.reactions);
  const reactionCounts = reactions.reduce((acc, reaction) => {
    const emoji = asString5(reaction.emoji);
    const count = asNumber4(reaction.count);
    if (emoji !== void 0 && count !== void 0) {
      acc[emoji] = count;
    }
    return acc;
  }, {});
  return {
    id: asString5(item.id) ?? "",
    timestamp: toEpochMs2(item.timestamp) ?? 0,
    text: content.text,
    reactionCounts: Object.keys(reactionCounts).length > 0 ? reactionCounts : void 0,
    raw: item
  };
}
async function getBusinessProfile2(http) {
  const body = await http.request({ method: "GET", path: "/business" });
  return mapWhapiBusinessProfile(body);
}
async function updateBusinessProfile2(http, input) {
  await http.request({
    method: "POST",
    path: "/business",
    body: { description: input.description, address: input.address, email: input.email }
  });
}
function mapWhapiBusinessProfile(body) {
  const record = asRecord5(body);
  const websitesRaw = record && Array.isArray(record.websites) ? record.websites : [];
  const websites = websitesRaw.filter((item) => typeof item === "string");
  return {
    description: record ? asString5(record.description) : void 0,
    address: record ? asString5(record.address) : void 0,
    email: record ? asString5(record.email) : void 0,
    websites: websites.length > 0 ? websites : void 0,
    categories: void 0,
    raw: body
  };
}
async function rejectCall4(http, input) {
  if (!input.callId || !input.callerId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'calls.reject no Whapi exige "callId" e "callerId" (DELETE /calls/{CallID}, body {callFrom}).',
      { provider: PROVIDER5 }
    );
  }
  await http.request({
    method: "DELETE",
    path: `/calls/${encodeURIComponent(input.callId)}`,
    body: { callFrom: input.callerId }
  });
}
function parseWebhook4(input) {
  try {
    return parseWebhookUnsafe4(input);
  } catch (error) {
    return [
      unknownEvent5(
        input.body,
        `Erro inesperado ao parsear webhook Whapi: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe4(input) {
  const body = input.body;
  const record = asRecord5(body);
  if (!record) {
    return [unknownEvent5(body, "Corpo do webhook Whapi n\xE3o \xE9 um objeto JSON.")];
  }
  const instanceId = asString5(record.channel_id);
  const eventMeta = asRecord5(record.event);
  const eventType = eventMeta ? asString5(eventMeta.type) : void 0;
  const eventVerb = eventMeta ? asString5(eventMeta.event) : void 0;
  switch (eventType) {
    case "messages":
      return mapMessagesEvent(record, instanceId, body);
    case "statuses":
      return mapStatusesEvent(record, instanceId, body);
    case "channel":
      return [mapChannelEvent(record, instanceId, body)];
    case "users":
      return [mapUsersEvent(eventVerb, instanceId, body)];
    default:
      if (Array.isArray(record.messages)) return mapMessagesEvent(record, instanceId, body);
      if (Array.isArray(record.statuses)) return mapStatusesEvent(record, instanceId, body);
      if (record.health !== void 0) return [mapChannelEvent(record, instanceId, body)];
      return [
        unknownEvent5(
          body,
          `Payload de webhook Whapi n\xE3o reconhecido nesta fase (event.type="${eventType ?? "ausente"}").`,
          instanceId
        )
      ];
  }
}
function mapMessagesEvent(record, instanceId, rawBody) {
  const items = asRecordArray(record.messages);
  if (items.length === 0) {
    return [unknownEvent5(rawBody, 'Evento "messages" do Whapi sem itens no array.', instanceId)];
  }
  return items.map((item) => mapMessageItem(item, instanceId, rawBody));
}
function mapMessageItem(item, instanceId, rawBody) {
  const fromMe = asBoolean5(item.from_me) ?? false;
  const content = mapMessageContent2(item);
  const context = asRecord5(item.context);
  const message = {
    id: asString5(item.id) ?? `whapi-unknown-${Date.now()}`,
    chatId: asString5(item.chat_id) ?? "unknown",
    from: asString5(item.from),
    fromMe,
    // Confirmado no dossiê: `timestamp` de `messages` é epoch em SEGUNDOS (diferente de
    // `WaMessage.timestamp`, que é ms) — convertido via `toEpochMs`.
    timestamp: toEpochMs2(item.timestamp) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media: content.media,
    quotedId: context ? asString5(context.quoted_id) : void 0,
    raw: rawBody
  };
  return {
    type: fromMe ? "message.sent" : "message.received",
    provider: PROVIDER5,
    instanceId,
    message,
    raw: rawBody
  };
}
function mapMessageContent2(record) {
  const type = asString5(record.type);
  switch (type) {
    case "text": {
      const text = asRecord5(record.text);
      return { kind: "text", text: text ? asString5(text.body) : void 0 };
    }
    case "image": {
      const image = asRecord5(record.image);
      return {
        kind: "image",
        text: image ? asString5(image.caption) : void 0,
        media: image ? buildMediaRef3("image", image) : void 0
      };
    }
    case "video": {
      const video = asRecord5(record.video);
      return {
        kind: "video",
        text: video ? asString5(video.caption) : void 0,
        media: video ? buildMediaRef3("video", video) : void 0
      };
    }
    case "audio":
    case "voice": {
      const audio = asRecord5(record.audio) ?? asRecord5(record.voice);
      return { kind: "audio", media: audio ? buildMediaRef3("audio", audio) : void 0 };
    }
    case "document": {
      const document = asRecord5(record.document);
      return {
        kind: "document",
        text: document ? asString5(document.caption) : void 0,
        media: document ? buildMediaRef3("document", document) : void 0
      };
    }
    case "sticker": {
      const sticker = asRecord5(record.sticker);
      return { kind: "sticker", media: sticker ? buildMediaRef3("sticker", sticker) : void 0 };
    }
    case "location":
      return { kind: "location" };
    case "contact":
      return { kind: "contact" };
    case "poll":
      return { kind: "poll" };
    default:
      return { kind: "unknown" };
  }
}
function buildMediaRef3(kind, record) {
  const url = asString5(record.link);
  const id = asString5(record.id);
  if (!url && !id) return void 0;
  return {
    kind,
    url,
    mimeType: asString5(record.mime_type),
    filename: asString5(record.file_name),
    id
  };
}
function mapStatusesEvent(record, instanceId, rawBody) {
  const items = asRecordArray(record.statuses);
  if (items.length === 0) {
    return [unknownEvent5(rawBody, 'Evento "statuses" do Whapi sem itens no array.', instanceId)];
  }
  return items.map((item) => mapStatusItem(item, instanceId, rawBody));
}
function mapStatusItem(item, instanceId, rawBody) {
  const messageId = asString5(item.id);
  if (!messageId) {
    return unknownEvent5(rawBody, 'Item de "statuses" do Whapi sem "id".', instanceId);
  }
  const statusText = asString5(item.status);
  const ack = mapWhapiAckStatus(statusText);
  if (!ack) {
    return unknownEvent5(
      rawBody,
      `Status Whapi n\xE3o mape\xE1vel para MessageAck: "${statusText ?? "ausente"}".`,
      instanceId
    );
  }
  return {
    type: "message.ack",
    provider: PROVIDER5,
    instanceId,
    messageId,
    chatId: asString5(item.recipient_id),
    ack,
    raw: rawBody
  };
}
function mapWhapiAckStatus(status) {
  switch (status) {
    case "pending":
      return "pending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "read":
      return "read";
    case "played":
      return "played";
    case "failed":
      return "error";
    default:
      return void 0;
  }
}
function mapChannelEvent(record, instanceId, rawBody) {
  const health = asRecord5(record.health);
  const status = health ? asRecord5(health.status) : void 0;
  const state = mapChannelState(status ? asString5(status.text) : void 0);
  const qr = asRecord5(record.qr);
  return {
    type: "connection.update",
    provider: PROVIDER5,
    instanceId,
    state,
    qr: qr ? asString5(qr.base64) : void 0,
    raw: rawBody
  };
}
function mapUsersEvent(eventVerb, instanceId, rawBody) {
  if (eventVerb === "post") {
    return {
      type: "connection.update",
      provider: PROVIDER5,
      instanceId,
      state: "connected",
      raw: rawBody
    };
  }
  if (eventVerb === "delete") {
    return {
      type: "connection.update",
      provider: PROVIDER5,
      instanceId,
      state: "disconnected",
      raw: rawBody
    };
  }
  return unknownEvent5(
    rawBody,
    `Evento "users" com verbo desconhecido: "${eventVerb}".`,
    instanceId
  );
}
function unknownEvent5(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER5, instanceId, raw, reason };
}
function toEpochMs2(value) {
  const seconds = asNumber4(value);
  if (seconds === void 0 || Number.isNaN(seconds)) return void 0;
  return seconds * 1e3;
}
function asRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString5(value) {
  return typeof value === "string" ? value : void 0;
}
function asNumber4(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  return void 0;
}
function asBoolean5(value) {
  return typeof value === "boolean" ? value : void 0;
}
function asRecordArray(value) {
  return Array.isArray(value) ? value.map((item) => asRecord5(item)).filter((item) => item !== void 0) : [];
}
function asStringArray2(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

// src/adapters/wppconnect/index.ts
var PROVIDER6 = "wppconnect";
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
    provider: PROVIDER6,
    fetch: options.fetch
  });
  const instance = {
    connect: () => connectInstance5(http, session, options),
    status: () => statusInstance5(http, session),
    logout: () => logoutInstance5(http, session)
  };
  const messages = {
    sendText: (input) => sendText5(http, session, input),
    sendMedia: (input) => sendMedia5(http, session, input),
    sendReaction: (input) => sendReaction4(http, session, input),
    edit: (input) => editMessage5(http, session, input),
    delete: (input) => deleteMessage5(http, session, input),
    forward: (input) => forwardMessage2(http, session, input),
    star: (input) => setMessageStarred2(http, session, input, true),
    unstar: (input) => setMessageStarred2(http, session, input, false),
    sendLocation: (input) => sendLocation5(http, session, input),
    sendContactCard: (input) => sendContactCard5(http, session, input),
    sendPoll: (input) => sendPoll5(http, session, input)
  };
  const groups = {
    create: (input) => createGroup4(http, session, input),
    getInfo: (groupId) => getGroupInfo4(http, session, groupId),
    list: () => listGroups4(http, session),
    addParticipants: (input) => updateGroupParticipants4(http, session, input, "add"),
    removeParticipants: (input) => updateGroupParticipants4(http, session, input, "remove"),
    promoteParticipants: (input) => updateGroupParticipants4(http, session, input, "promote"),
    demoteParticipants: (input) => updateGroupParticipants4(http, session, input, "demote"),
    updateSubject: (input) => updateGroupSubject4(http, session, input),
    updateDescription: (input) => updateGroupDescription4(http, session, input),
    updatePicture: (input) => updateGroupPicture4(http, session, input),
    getInviteLink: (groupId) => fetchGroupInviteLink(http, session, groupId, false),
    revokeInviteLink: (groupId) => fetchGroupInviteLink(http, session, groupId, true),
    joinViaInviteLink: (input) => joinGroupViaInviteLink4(http, session, input),
    leaveGroup: (groupId) => leaveGroupCall2(http, session, groupId)
  };
  const contacts = {
    list: () => listContacts4(http, session),
    get: (chatId) => getContact4(http, session, chatId),
    checkExists: (phone) => checkContactExists4(http, session, phone),
    getProfilePicture: (chatId) => getContactProfilePicture5(http, session, chatId),
    getAbout: (chatId) => getContactAbout3(http, session, chatId),
    block: (chatId) => blockContact4(http, session, chatId),
    unblock: (chatId) => unblockContact4(http, session, chatId),
    listBlocked: () => listBlockedContacts4(http, session)
  };
  const chats = {
    archive: (chatId) => setChatArchived4(http, session, chatId, true),
    unarchive: (chatId) => setChatArchived4(http, session, chatId, false),
    mute: (chatId) => setChatMuted2(http, session, chatId, true),
    unmute: (chatId) => setChatMuted2(http, session, chatId, false),
    pin: (chatId) => setChatPinned2(http, session, chatId, true),
    unpin: (chatId) => setChatPinned2(http, session, chatId, false),
    markRead: (chatId) => markChatRead3(http, session, chatId),
    markUnread: (chatId) => markChatUnread3(http, session, chatId)
  };
  const presence = {
    setTyping: (input) => setTyping4(http, session, input),
    set: (state) => setOnlinePresence(http, session, state),
    subscribe: (chatId) => subscribePresence2(http, session, chatId)
  };
  const labels = {
    list: () => listLabels5(http, session),
    create: (input) => createLabel5(http, session, input),
    delete: (labelId) => deleteLabel5(http, session, labelId),
    addToChat: (input) => setChatLabel3(http, session, input, "add"),
    removeFromChat: (input) => setChatLabel3(http, session, input, "remove")
  };
  const channels = {
    create: (input) => createChannel4(http, session, input),
    delete: (channelId) => deleteChannel3(http, session, channelId)
  };
  const business = {
    updateProfile: (input) => updateBusinessProfile3(http, session, input)
  };
  const calls = {
    reject: (input) => rejectCall5(http, session, input)
  };
  return {
    provider: PROVIDER6,
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
    parseWebhook: (input) => parseWebhook5(input)
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
var DEFAULT_MIME_BY_KIND2 = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/ogg",
  document: "application/octet-stream",
  sticker: "image/webp"
};
function resolveMediaValue2(media) {
  if (media.url) return media.url;
  if (media.base64) {
    if (media.base64.startsWith("data:")) return media.base64;
    const mime = media.mimeType ?? DEFAULT_MIME_BY_KIND2[media.kind];
    return `data:${mime};base64,${media.base64}`;
  }
  throw new WaConnectorError(
    "INVALID_INPUT",
    'WPPConnect: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER6 }
  );
}
async function connectInstance5(http, session, options) {
  const body = { waitQrCode: options.waitQrCode ?? true };
  if (options.webhook) {
    body.webhook = options.webhook;
  }
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/start-session"),
    body
  });
  const record = asRecord6(response);
  const status = record ? asString6(record.status) : void 0;
  const qr = status === "qrcode" ? asString6(record?.qrcode) : void 0;
  return { qr, raw: response };
}
async function statusInstance5(http, session) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, "/status-session")
  });
  const record = asRecord6(response);
  return { state: mapInstanceState4(record?.status), raw: response };
}
function mapInstanceState4(status) {
  if (status === null) return "disconnected";
  const value = asString6(status);
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
async function logoutInstance5(http, session) {
  await http.request({ method: "POST", path: sessionPath(session, "/logout-session") });
}
function unwrapResponse(body) {
  const record = asRecord6(body);
  return record && "response" in record ? record.response : body;
}
function unwrapArrayResponse(body) {
  const unwrapped = unwrapResponse(body);
  return Array.isArray(unwrapped) ? unwrapped[0] : unwrapped;
}
async function sendText5(http, session, input) {
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
async function sendMedia5(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  const endpoint = MEDIA_ENDPOINTS[input.media.kind];
  const value = resolveMediaValue2(input.media);
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
async function sendReaction4(http, session, input) {
  const recipient = toWppconnectRecipient(input.to);
  const reaction = input.emoji === "" ? false : input.emoji;
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/react-message"),
    body: { msgId: input.messageId, reaction }
  });
  return { id: input.messageId, chatId: recipient.phone, raw: response };
}
async function editMessage5(http, session, input) {
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/edit-message"),
    body: { id: input.messageId, newText: input.text }
  });
  const message = asRecord6(unwrapResponse(response));
  const id = asString6(message?.id) ?? input.messageId;
  const chatId = extractChatId(message?.chatId) ?? toWppconnectRecipient(input.to).phone;
  const timestamp = secondsToEpochMs(message?.timestamp ?? message?.t);
  return { id, chatId, timestamp, raw: response };
}
async function deleteMessage5(http, session, input) {
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
async function forwardMessage2(http, session, input) {
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
async function setMessageStarred2(http, session, input, star) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/star-message"),
    body: { messageId: input.messageId, star }
  });
}
async function sendLocation5(http, session, input) {
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
async function sendContactCard5(http, session, input) {
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
async function sendPoll5(http, session, input) {
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
  const message = asRecord6(unwrapArrayResponse(body));
  const id = asString6(message?.id) ?? `wppconnect-${Date.now()}`;
  const chatId = extractChatId(message?.chatId) ?? requestedPhone;
  const timestamp = secondsToEpochMs(message?.timestamp ?? message?.t);
  return { id, chatId, timestamp, raw: body };
}
function mapSentMessageFromAckId(body, requestedPhone) {
  const data = asRecord6(unwrapArrayResponse(body));
  const id = asString6(data?.id) ?? `wppconnect-${Date.now()}`;
  return { id, chatId: requestedPhone, raw: body };
}
function extractChatId(value) {
  if (typeof value === "string") return value;
  const record = asRecord6(value);
  return record ? asString6(record._serialized) : void 0;
}
async function createGroup4(http, session, input) {
  const response = await http.request({
    method: "POST",
    path: sessionPath(session, "/create-group"),
    body: { name: input.subject, participants: input.participants }
  });
  const data = asRecord6(unwrapResponse(response));
  const groupInfoList = Array.isArray(data?.groupInfo) ? data.groupInfo : void 0;
  const info = asRecord6(groupInfoList?.[0]);
  const id = toWppconnectGroupId(asString6(info?.id));
  const subject = asString6(info?.name) ?? input.subject;
  return {
    id,
    subject,
    participants: input.participants.map(toFallbackParticipant2),
    raw: response
  };
}
function toWppconnectGroupId(rawId) {
  if (!rawId) return "";
  return rawId.includes("@") ? rawId : `${rawId}@g.us`;
}
function toFallbackParticipant2(id) {
  return { id, isAdmin: false, isSuperAdmin: false };
}
async function getGroupInfo4(http, session, groupId) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/group-info/${encodeURIComponent(groupId)}`)
  });
  const data = asRecord6(unwrapResponse(response));
  return {
    id: asString6(data?.id) ?? groupId,
    subject: asString6(data?.name) ?? asString6(data?.subject) ?? "",
    description: asString6(data?.description),
    participants: mapGroupParticipants3(data?.participants) ?? [],
    raw: response
  };
}
function mapGroupParticipants3(value) {
  if (!Array.isArray(value)) return void 0;
  return value.map((item) => {
    const record = asRecord6(item);
    return {
      id: asString6(record?.id) ?? "",
      isAdmin: asBoolean6(record?.isAdmin) ?? false,
      // isSuperAdmin não confirmado nesta resposta (ver docs/providers/wppconnect.md) — sempre false.
      isSuperAdmin: false
    };
  });
}
var PARTICIPANT_ENDPOINTS2 = {
  add: "/add-participant-group",
  remove: "/remove-participant-group",
  promote: "/promote-participant-group",
  demote: "/demote-participant-group"
};
async function updateGroupParticipants4(http, session, input, action) {
  const path = sessionPath(session, PARTICIPANT_ENDPOINTS2[action]);
  await Promise.all(
    input.participants.map(
      (phone) => http.request({ method: "POST", path, body: { groupId: input.groupId, phone } })
    )
  );
}
async function updateGroupSubject4(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/group-subject"),
    body: { groupId: input.groupId, title: input.subject }
  });
}
async function updateGroupDescription4(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/group-description"),
    body: { groupId: input.groupId, description: input.description }
  });
}
async function updateGroupPicture4(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/group-pic"),
    body: { groupId: input.groupId, path: resolveMediaValue2(input.media) }
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
  const record = asRecord6(value);
  if (!record) return void 0;
  return asString6(record.link) ?? asString6(record.inviteLink) ?? asString6(record.url);
}
async function joinGroupViaInviteLink4(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/join-code"),
    body: { inviteCode: input.invite }
  });
}
async function leaveGroupCall2(http, session, groupId) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/leave-group"),
    body: { groupId }
  });
}
async function listGroups4(http, session) {
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
  const data = asRecord6(item);
  return {
    id: extractChatId(data?.id) ?? "",
    subject: asString6(data?.name) ?? "",
    // `Chat` não expõe participantes (ver docstring de `listGroups`) — vazio de propósito, nunca
    // inventado a partir de outro campo.
    participants: [],
    raw: item
  };
}
async function listContacts4(http, session) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, "/all-contacts")
  });
  const items = unwrapResponse(response);
  const array = Array.isArray(items) ? items : [];
  return array.map((item) => mapContact3(item));
}
async function getContact4(http, session, chatId) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/contact/${encodeURIComponent(chatId)}`)
  });
  return mapContact3(unwrapResponse(response));
}
function mapContact3(value) {
  const data = asRecord6(value);
  const thumb = asRecord6(data?.profilePicThumbObj);
  return {
    id: extractChatId(data?.id) ?? "",
    name: asString6(data?.name) ?? asString6(data?.pushname) ?? asString6(data?.formattedName) ?? asString6(data?.shortName),
    hasWhatsApp: asBoolean6(data?.isWAContact),
    profilePictureUrl: thumb ? asString6(thumb.imgFull) ?? asString6(thumb.img) : void 0,
    raw: value
  };
}
async function checkContactExists4(http, session, phone) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/check-number-status/${encodeURIComponent(phone)}`)
  });
  const data = asRecord6(unwrapResponse(response));
  const idRecord = asRecord6(data?.id);
  return {
    exists: asBoolean6(data?.numberExists) ?? false,
    chatId: idRecord ? asString6(idRecord._serialized) : void 0,
    raw: response
  };
}
async function getContactProfilePicture5(http, session, chatId) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/profile-pic/${encodeURIComponent(chatId)}`)
  });
  const data = asRecord6(unwrapResponse(response));
  return { url: asString6(data?.imgFull) ?? asString6(data?.img), raw: response };
}
async function getContactAbout3(http, session, chatId) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, `/profile-status/${encodeURIComponent(chatId)}`)
  });
  const data = asRecord6(unwrapResponse(response));
  const about = asString6(data?.status);
  return { about: about === "" ? void 0 : about, raw: response };
}
async function blockContact4(http, session, chatId) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/block-contact"),
    body: { phone: chatId }
  });
}
async function unblockContact4(http, session, chatId) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/unblock-contact"),
    body: { phone: chatId }
  });
}
async function listBlockedContacts4(http, session) {
  const response = await http.request({
    method: "GET",
    path: sessionPath(session, "/blocklist")
  });
  const items = unwrapResponse(response);
  const array = Array.isArray(items) ? items : [];
  const phones = [];
  for (const item of array) {
    const phone = asString6(asRecord6(item)?.phone);
    if (phone !== void 0) phones.push(phone);
  }
  return phones;
}
async function setChatArchived4(http, session, chatId, value) {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/archive-chat"),
    body: { phone: recipient.phone, isGroup: recipient.isGroup, value }
  });
}
var MUTE_DURATION = { time: 24 * 365 * 10, type: "hours" };
async function setChatMuted2(http, session, chatId, muted) {
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
async function setChatPinned2(http, session, chatId, pinned) {
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
async function markChatUnread3(http, session, chatId) {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/mark-unseen"),
    body: { phone: recipient.phone, isGroup: recipient.isGroup }
  });
}
async function markChatRead3(http, session, chatId) {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/send-seen"),
    body: { phone: recipient.phone, isGroup: recipient.isGroup }
  });
}
async function setTyping4(http, session, input) {
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
async function subscribePresence2(http, session, chatId) {
  const recipient = toWppconnectRecipient(chatId);
  await http.request({
    method: "POST",
    path: sessionPath(session, "/subscribe-presence"),
    body: { phone: recipient.phone, isGroup: recipient.isGroup, all: false }
  });
}
async function listLabels5(http, session) {
  const body = await http.request({
    method: "GET",
    path: sessionPath(session, "/get-all-labels")
  });
  const record = asRecord6(body);
  const items = record && Array.isArray(record.response) ? record.response : [];
  return items.map((item) => mapWppconnectLabel(item));
}
async function createLabel5(http, session, input) {
  const before = new Set((await listLabels5(http, session)).map((label) => label.id));
  const body = { name: input.name };
  if (input.color !== void 0) {
    body.options = { labelColor: input.color };
  }
  await http.request({ method: "POST", path: sessionPath(session, "/add-new-label"), body });
  const after = await listLabels5(http, session);
  const created = after.find((label) => !before.has(label.id));
  if (!created) {
    throw new WaConnectorError(
      "PROVIDER_ERROR",
      "WPPConnect: n\xE3o foi poss\xEDvel determinar o id do label criado por /add-new-label \u2014 GET /get-all-labels n\xE3o trouxe nenhum id novo em rela\xE7\xE3o \xE0 listagem anterior.",
      { provider: PROVIDER6 }
    );
  }
  return created;
}
async function deleteLabel5(http, session, labelId) {
  await http.request({
    method: "PUT",
    path: sessionPath(session, `/delete-label/${encodeURIComponent(labelId)}`)
  });
}
async function setChatLabel3(http, session, input, type) {
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
  const record = asRecord6(body);
  const color = record ? asNumber5(record.color) : void 0;
  return {
    id: (record ? asString6(record.id) : void 0) ?? "",
    name: (record ? asString6(record.name) : void 0) ?? "",
    color: color === void 0 ? void 0 : String(color),
    raw: body
  };
}
async function createChannel4(http, session, input) {
  const body = await http.request({
    method: "POST",
    path: sessionPath(session, "/newsletter"),
    body: { name: input.name, options: { description: input.description } }
  });
  return mapWppconnectChannel(body, input);
}
async function deleteChannel3(http, session, channelId) {
  await http.request({
    method: "DELETE",
    path: sessionPath(session, `/newsletter/${encodeURIComponent(channelId)}`)
  });
}
function mapWppconnectChannel(body, fallback = {}) {
  const record = asRecord6(body);
  return {
    id: (record ? asString6(record.idJid) : void 0) ?? "",
    name: (record ? asString6(record.name) : void 0) ?? fallback.name ?? "",
    description: (record ? asString6(record.description) : void 0) ?? fallback.description,
    subscribersCount: record ? asNumber5(record.subscribersCount) : void 0,
    raw: body
  };
}
async function updateBusinessProfile3(http, session, input) {
  await http.request({
    method: "POST",
    path: sessionPath(session, "/edit-business-profile"),
    body: { adress: input.address, email: input.email }
  });
}
async function rejectCall5(http, session, input) {
  if (!input.callId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'calls.reject no WPPConnect exige "callId" (body {callId}).',
      { provider: PROVIDER6 }
    );
  }
  await http.request({
    method: "POST",
    path: sessionPath(session, "/reject-call"),
    body: { callId: input.callId }
  });
}
function parseWebhook5(input) {
  try {
    return parseWebhookUnsafe5(input);
  } catch (error) {
    return [
      unknownEvent6(
        input.body,
        `Erro inesperado ao parsear webhook WPPConnect: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe5(input) {
  const body = input.body;
  const record = asRecord6(body);
  if (!record) {
    return [unknownEvent6(body, "Corpo do webhook WPPConnect n\xE3o \xE9 um objeto JSON.")];
  }
  const instanceId = asString6(record.session);
  const event = asString6(record.event);
  if (!event) {
    return [unknownEvent6(body, 'Payload de webhook WPPConnect sem campo "event".', instanceId)];
  }
  switch (event) {
    case "onmessage":
    case "unreadmessages":
    case "onselfmessage":
      return [mapMessageEvent3(record, instanceId, body)];
    case "onack":
      return [mapAckEvent(record, instanceId, body)];
    case "status-find":
      return [mapStatusFindEvent(record, instanceId, body)];
    case "qrcode":
      return [connectionEvent2(instanceId, "qr", asString6(record.qrcode), body)];
    case "phoneCode":
      return [connectionEvent2(instanceId, "qr", void 0, body)];
    case "onparticipantschanged":
      return [mapParticipantsChangedEvent(record, instanceId, body)];
    case "onpresencechanged":
    case "location":
    case "incomingcall":
      return [
        unknownEvent6(
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
        unknownEvent6(
          body,
          `Evento WPPConnect "${event}" reconhecido, mas sem shape de payload confirmado nesta fase (a lib subjacente tipa esses callbacks como "any") \u2014 ver docs/providers/wppconnect.md.`,
          instanceId
        )
      ];
    default:
      return [unknownEvent6(body, `Evento WPPConnect n\xE3o reconhecido: "${event}".`, instanceId)];
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
function mapMessageEvent3(record, instanceId, rawBody) {
  const id = asString6(record.id) ?? `wppconnect-unknown-${Date.now()}`;
  const chatId = extractChatId(record.chatId) ?? "";
  const fromMe = asBoolean6(record.fromMe) ?? false;
  const from = asString6(record.author) ?? asString6(record.from);
  const timestamp = secondsToEpochMs(record.timestamp ?? record.t) ?? Date.now();
  const typeValue = asString6(record.type);
  const kind = typeValue && MESSAGE_KIND_BY_TYPE[typeValue] || "unknown";
  const text = kind === "text" ? asString6(record.body) : asString6(record.caption);
  const media = MEDIA_MESSAGE_KINDS.has(kind) ? buildMediaRef4(kind, record) : void 0;
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
    provider: PROVIDER6,
    instanceId,
    message,
    raw: rawBody
  };
}
function buildMediaRef4(kind, record) {
  return { kind, mimeType: asString6(record.mimetype) };
}
function mapAckEvent(record, instanceId, rawBody) {
  const idRecord = asRecord6(record.id);
  const messageId = idRecord ? asString6(idRecord._serialized) ?? asString6(idRecord.id) : void 0;
  if (!messageId) {
    return unknownEvent6(
      rawBody,
      'Evento "onack" do WPPConnect sem "id._serialized"/"id.id" reconhec\xEDvel.',
      instanceId
    );
  }
  const ack = mapAckType(record.ack);
  if (!ack) {
    return unknownEvent6(
      rawBody,
      `Evento "onack" com valor de "ack" n\xE3o mape\xE1vel para MessageAck: ${String(record.ack)}.`,
      instanceId
    );
  }
  const event = {
    type: "message.ack",
    provider: PROVIDER6,
    instanceId,
    messageId,
    chatId: asString6(record.to),
    ack,
    raw: rawBody
  };
  return event;
}
function mapAckType(value) {
  const code = asNumber5(value);
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
  const status = asString6(record.status);
  const state = status && STATUS_FIND_STATE[status] || "unknown";
  return connectionEvent2(instanceId, state, void 0, rawBody);
}
var PARTICIPANT_OPERATION_ACTION = {
  add: "participants.add",
  remove: "participants.remove",
  promote: "participants.promote",
  demote: "participants.demote"
};
function mapParticipantsChangedEvent(record, instanceId, rawBody) {
  const groupId = asString6(record.groupId);
  if (!groupId) {
    return unknownEvent6(rawBody, 'Evento "onparticipantschanged" sem "groupId".', instanceId);
  }
  const operation = asString6(record.operation);
  const action = operation ? PARTICIPANT_OPERATION_ACTION[operation] : void 0;
  const participants = asStringArray3(record.who);
  const event = {
    type: "group.update",
    provider: PROVIDER6,
    instanceId,
    groupId,
    action,
    participants: participants.length > 0 ? participants : void 0,
    raw: rawBody
  };
  return event;
}
function connectionEvent2(instanceId, state, qr, rawBody) {
  return { type: "connection.update", provider: PROVIDER6, instanceId, state, qr, raw: rawBody };
}
function unknownEvent6(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER6, instanceId, raw, reason };
}
function asRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString6(value) {
  return typeof value === "string" ? value : void 0;
}
function asBoolean6(value) {
  return typeof value === "boolean" ? value : void 0;
}
function asNumber5(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function asStringArray3(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function secondsToEpochMs(value) {
  const seconds = asNumber5(value);
  return seconds === void 0 ? void 0 : seconds * 1e3;
}

// src/adapters/wuzapi/index.ts
var PROVIDER7 = "wuzapi";
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
    provider: PROVIDER7,
    fetch: options.fetch
  });
  const instance = {
    connect: () => connectInstance6(http, options),
    status: () => statusInstance6(http),
    logout: () => logoutInstance6(http)
  };
  const messages = {
    sendText: (input) => sendText6(http, input),
    sendMedia: (input) => sendMedia6(http, input),
    sendReaction: (input) => sendReaction5(http, input),
    edit: (input) => editMessage6(http, input),
    delete: (input) => deleteMessage6(http, input),
    markRead: (input) => markMessageRead5(http, input),
    sendLocation: (input) => sendLocation6(http, input),
    sendContactCard: (input) => sendContactCard6(http, input),
    sendPoll: (input) => sendPoll6(http, input)
  };
  const groups = {
    create: (input) => createGroup5(http, input),
    getInfo: (groupId) => getGroupInfo5(http, groupId),
    list: () => listGroups5(http),
    addParticipants: (input) => updateGroupParticipants5(http, input, "add"),
    removeParticipants: (input) => updateGroupParticipants5(http, input, "remove"),
    promoteParticipants: (input) => updateGroupParticipants5(http, input, "promote"),
    demoteParticipants: (input) => updateGroupParticipants5(http, input, "demote"),
    updateSubject: (input) => updateGroupSubject5(http, input),
    updateDescription: (input) => updateGroupDescription5(http, input),
    updatePicture: (input) => updateGroupPicture5(http, input),
    getInviteLink: (groupId) => fetchGroupInviteLink2(http, groupId, false),
    revokeInviteLink: (groupId) => fetchGroupInviteLink2(http, groupId, true),
    joinViaInviteLink: (input) => joinGroupViaInviteLink5(http, input),
    leaveGroup: (groupId) => leaveGroupCall3(http, groupId)
  };
  const contacts = {
    list: () => listContacts5(http),
    get: (chatId) => getContact5(http, chatId),
    checkExists: (phone) => checkContactExists5(http, phone),
    getProfilePicture: (chatId) => getContactProfilePicture6(http, chatId),
    getAbout: (chatId) => getContactAbout4(http, chatId),
    block: (chatId) => blockContact5(http, chatId),
    unblock: (chatId) => unblockContact5(http, chatId),
    listBlocked: () => listBlockedContacts5(http)
  };
  const chats = {
    archive: (chatId) => setChatArchived5(http, chatId, true),
    unarchive: (chatId) => setChatArchived5(http, chatId, false)
  };
  const presence = {
    setTyping: (input) => setTyping5(http, input),
    set: (state) => setPresence3(http, state),
    subscribe: (chatId) => subscribePresence3(http, chatId)
  };
  const channels = {
    list: () => listChannels4(http)
  };
  const calls = {
    reject: (input) => rejectCall6(http, input)
  };
  return {
    provider: PROVIDER7,
    capabilities: WUZAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    presence,
    channels,
    calls,
    parseWebhook: (input) => parseWebhook6(input)
  };
}
function toWuzapiPhone(chatId) {
  return chatId;
}
var MEDIA_ENDPOINTS2 = {
  image: { path: "/chat/send/image", field: "Image" },
  video: { path: "/chat/send/video", field: "Video" },
  audio: { path: "/chat/send/audio", field: "Audio" },
  document: { path: "/chat/send/document", field: "Document" },
  sticker: { path: "/chat/send/sticker", field: "Sticker" }
};
var DEFAULT_MIME_BY_KIND3 = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/ogg",
  document: "application/octet-stream",
  sticker: "image/webp"
};
function resolveMediaValue3(media) {
  if (media.url) return media.url;
  if (media.base64) {
    if (media.base64.startsWith("data:")) return media.base64;
    const mime = media.mimeType ?? DEFAULT_MIME_BY_KIND3[media.kind];
    return `data:${mime};base64,${media.base64}`;
  }
  throw new WaConnectorError(
    "INVALID_INPUT",
    'Wuzapi: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER7 }
  );
}
async function connectInstance6(http, options) {
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
  const qrData = asRecord7(qrResponse?.data);
  const qr = asString7(qrData?.QRCode) ?? asString7(qrData?.qrcode);
  return {
    qr,
    raw: { connect: connectResponse, qr: qrResponse }
  };
}
async function statusInstance6(http) {
  const response = await http.request({ method: "GET", path: "/session/status" });
  const data = asRecord7(response.data);
  return { state: mapInstanceState5(data), raw: response };
}
async function logoutInstance6(http) {
  await http.request({ method: "POST", path: "/session/logout" });
}
function mapInstanceState5(data) {
  if (!data) return "unknown";
  const connected = asBoolean7(data.connected) ?? asBoolean7(data.Connected);
  const loggedIn = asBoolean7(data.loggedIn) ?? asBoolean7(data.LoggedIn);
  if (connected === void 0 || loggedIn === void 0) return "unknown";
  if (!connected && !loggedIn) return "disconnected";
  if (connected && !loggedIn) return "qr";
  if (connected && loggedIn) return "connected";
  return "connecting";
}
async function sendText6(http, input) {
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
  return mapSentMessage4(response, phone);
}
async function sendMedia6(http, input) {
  const phone = toWuzapiPhone(input.to);
  const endpoint = MEDIA_ENDPOINTS2[input.media.kind];
  const value = resolveMediaValue3(input.media);
  const body = { Phone: phone, [endpoint.field]: value };
  if (input.caption) body.Caption = input.caption;
  if (input.media.mimeType) body.MimeType = input.media.mimeType;
  if (input.media.kind === "document") {
    if (!input.media.filename) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'Wuzapi: sendMedia para "document" exige "media.filename" (campo "FileName" obrigat\xF3rio).',
        { provider: PROVIDER7 }
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
  return mapSentMessage4(response, phone);
}
async function sendReaction5(http, input) {
  const phone = toWuzapiPhone(input.to);
  const reactionBody = input.emoji === "" ? "remove" : input.emoji;
  const body = { Phone: phone, Body: reactionBody, Id: input.messageId };
  const response = await http.request({
    method: "POST",
    path: "/chat/react",
    body
  });
  return mapSentMessage4(response, phone);
}
function mapSentMessage4(response, requestedPhone) {
  const data = asRecord7(response.data);
  const id = asString7(data?.Id) ?? `wuzapi-${Date.now()}`;
  const timestamp = secondsToEpochMs2(data?.Timestamp);
  return { id, chatId: requestedPhone, timestamp, raw: response };
}
async function editMessage6(http, input) {
  const phone = toWuzapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: "/chat/send/edit",
    body: { Phone: phone, Body: input.text, Id: input.messageId }
  });
  return mapSentMessage4(response, phone);
}
async function deleteMessage6(http, input) {
  await http.request({
    method: "POST",
    path: "/chat/delete",
    body: { Phone: toWuzapiPhone(input.to), Id: input.messageId }
  });
}
async function markMessageRead5(http, input) {
  await http.request({
    method: "POST",
    path: "/chat/markread",
    body: { Id: [input.messageId], ChatPhone: toWuzapiPhone(input.to) }
  });
}
async function sendLocation6(http, input) {
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
  return mapSentMessage4(response, phone);
}
async function sendContactCard6(http, input) {
  const phone = toWuzapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: "/chat/send/contact",
    body: {
      Phone: phone,
      Name: input.contactName,
      Vcard: buildVcard2(input.contactName, input.contactPhone)
    }
  });
  return mapSentMessage4(response, phone);
}
async function sendPoll6(http, input) {
  const recipient = toWuzapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: "/chat/send/poll",
    body: { group: recipient, header: input.question, options: input.options }
  });
  return mapSentMessage4(response, recipient);
}
function buildVcard2(name, phone) {
  return `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}
END:VCARD`;
}
async function createGroup5(http, input) {
  const participants = input.participants.map(toWuzapiPhone);
  const response = await http.request({
    method: "POST",
    path: "/group/create",
    body: { name: input.subject, participants }
  });
  const data = asRecord7(response.data);
  return mapGroupInfo5(data, response, {
    subject: input.subject,
    participants: participants.map(toFallbackParticipant3)
  });
}
async function getGroupInfo5(http, groupId) {
  const response = await http.request({
    method: "GET",
    path: "/group/info",
    query: { groupJID: groupId }
  });
  const data = asRecord7(response.data);
  return mapGroupInfo5(data, response, { id: groupId });
}
async function listGroups5(http) {
  const response = await http.request({ method: "GET", path: "/group/list" });
  const data = asRecord7(response.data);
  const groups = Array.isArray(data?.Groups) ? data.Groups : [];
  return groups.map((group) => mapGroupInfo5(asRecord7(group), group));
}
async function updateGroupParticipants5(http, input, action) {
  const phones = input.participants.map(toWuzapiPhone);
  await http.request({
    method: "POST",
    path: "/group/updateparticipants",
    body: { GroupJID: input.groupId, Phone: phones, Action: action }
  });
}
async function updateGroupSubject5(http, input) {
  await http.request({
    method: "POST",
    path: "/group/name",
    body: { GroupJID: input.groupId, Name: input.subject }
  });
}
async function updateGroupDescription5(http, input) {
  await http.request({
    method: "POST",
    path: "/group/topic",
    body: { GroupJID: input.groupId, Topic: input.description }
  });
}
async function updateGroupPicture5(http, input) {
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
    { provider: PROVIDER7 }
  );
}
async function fetchGroupInviteLink2(http, groupId, reset) {
  const response = await http.request({
    method: "GET",
    path: "/group/invitelink",
    query: { groupJID: groupId, reset }
  });
  const data = asRecord7(response.data);
  const link = asString7(data?.InviteLink) ?? "";
  return { link: normalizeInviteLink(link), raw: response };
}
async function joinGroupViaInviteLink5(http, input) {
  await http.request({
    method: "POST",
    path: "/group/join",
    body: { Code: extractInviteCode(input.invite) }
  });
}
async function leaveGroupCall3(http, groupId) {
  await http.request({
    method: "POST",
    path: "/group/leave",
    body: { GroupJID: groupId }
  });
}
function mapGroupInfo5(data, raw, fallback = {}) {
  const id = asString7(data?.JID) ?? fallback.id ?? "";
  const subject = asString7(data?.Name) ?? fallback.subject ?? "";
  const description = asString7(data?.Topic);
  const owner = asString7(data?.OwnerJID);
  const participants = mapGroupParticipants4(data?.Participants) ?? fallback.participants ?? [];
  return { id, subject, description, owner, participants, raw };
}
function mapGroupParticipants4(value) {
  if (!Array.isArray(value)) return void 0;
  return value.map((item) => {
    const record = asRecord7(item);
    return {
      id: asString7(record?.JID) ?? "",
      isAdmin: asBoolean7(record?.IsAdmin) ?? false,
      isSuperAdmin: asBoolean7(record?.IsSuperAdmin) ?? false
    };
  });
}
function toFallbackParticipant3(id) {
  return { id, isAdmin: false, isSuperAdmin: false };
}
async function listContacts5(http) {
  const response = await http.request({ method: "GET", path: "/user/contacts" });
  const data = asRecord7(response.data);
  if (!data) return [];
  return Object.entries(data).map(([jid, value]) => {
    const record = asRecord7(value);
    const name = asString7(record?.FullName) ?? asString7(record?.FirstName) ?? asString7(record?.PushName);
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
  const data = asRecord7(response.data);
  const usersMap = asRecord7(data?.Users);
  const entry = usersMap ? firstRecordValue(usersMap) : void 0;
  return { entry, response };
}
async function getContact5(http, chatId) {
  const { entry, response } = await fetchUserInfoEntry(http, chatId);
  return { id: chatId, about: asString7(entry?.Status), raw: response };
}
async function checkContactExists5(http, phone) {
  const target = toWuzapiPhone(phone);
  const response = await http.request({
    method: "POST",
    path: "/user/check",
    body: { Phone: [target] }
  });
  const data = asRecord7(response.data);
  const users = Array.isArray(data?.Users) ? data.Users : [];
  const first = asRecord7(users[0]);
  return {
    exists: asBoolean7(first?.IsInWhatsapp) ?? false,
    chatId: asString7(first?.JID),
    raw: response
  };
}
async function getContactProfilePicture6(http, chatId) {
  const phone = toWuzapiPhone(chatId);
  const response = await http.request({
    method: "POST",
    path: "/user/avatar",
    body: { Phone: phone, Preview: false }
  });
  const data = asRecord7(response.data);
  return { url: asString7(data?.url), raw: response };
}
async function getContactAbout4(http, chatId) {
  const { entry, response } = await fetchUserInfoEntry(http, chatId);
  return { about: asString7(entry?.Status), raw: response };
}
async function blockContact5(http, chatId) {
  await http.request({
    method: "POST",
    path: "/user/block",
    body: { Phone: toWuzapiPhone(chatId) }
  });
}
async function unblockContact5(http, chatId) {
  await http.request({
    method: "POST",
    path: "/user/unblock",
    body: { Phone: toWuzapiPhone(chatId) }
  });
}
async function listBlockedContacts5(http) {
  const response = await http.request({ method: "GET", path: "/user/blocklist" });
  const data = asRecord7(response.data);
  return asStringArray4(data?.Blocklist);
}
function firstRecordValue(record) {
  for (const value of Object.values(record)) {
    return asRecord7(value);
  }
  return void 0;
}
function toWuzapiChatJid(chatId) {
  return chatId.includes("@") ? chatId : `${chatId}@s.whatsapp.net`;
}
async function setChatArchived5(http, chatId, archive) {
  await http.request({
    method: "POST",
    path: "/chat/archive",
    body: { jid: toWuzapiChatJid(chatId), archive }
  });
}
async function setTyping5(http, input) {
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
async function setPresence3(http, state) {
  await http.request({
    method: "POST",
    path: "/user/presence",
    body: { type: state === "online" ? "available" : "unavailable" }
  });
}
async function subscribePresence3(http, chatId) {
  await http.request({
    method: "POST",
    path: "/user/presence/subscribe",
    body: { Phone: toWuzapiPhone(chatId) }
  });
}
async function listChannels4(http) {
  const response = await http.request({ method: "GET", path: "/newsletter/list" });
  const data = asRecord7(response.data);
  const items = data && Array.isArray(data.Newsletter) ? data.Newsletter : [];
  return items.map((item) => mapWuzapiChannel(item));
}
function mapWuzapiChannel(body) {
  const record = asRecord7(body);
  const id = (record ? asString7(record.id) : void 0) ?? "";
  const threadMeta = record ? asRecord7(record.thread_metadata) : void 0;
  const nameObj = threadMeta ? asRecord7(threadMeta.name) : void 0;
  const descriptionObj = threadMeta ? asRecord7(threadMeta.description) : void 0;
  const name = (nameObj ? asString7(nameObj.text) : void 0) ?? "";
  const description = descriptionObj ? asString7(descriptionObj.text) : void 0;
  const subscribersCountText = threadMeta ? asString7(threadMeta.subscribers_count) : void 0;
  const subscribersCount = subscribersCountText === void 0 ? void 0 : Number(subscribersCountText);
  return { id, name, description, subscribersCount, raw: body };
}
async function rejectCall6(http, input) {
  if (!input.callerId || !input.callId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'calls.reject no Wuzapi exige "callerId" e "callId" (body {call_from, call_id}).',
      { provider: PROVIDER7 }
    );
  }
  await http.request({
    method: "POST",
    path: "/call/reject",
    body: { call_from: input.callerId, call_id: input.callId }
  });
}
function parseWebhook6(input) {
  try {
    return parseWebhookUnsafe6(input);
  } catch (error) {
    return [
      unknownEvent7(
        input.body,
        `Erro inesperado ao parsear webhook Wuzapi: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe6(input) {
  const body = input.body;
  const record = asRecord7(body);
  if (!record) {
    return [unknownEvent7(body, "Corpo do webhook Wuzapi n\xE3o \xE9 um objeto JSON.")];
  }
  let eventRecord = record;
  const jsonData = asString7(record.jsonData);
  if (jsonData !== void 0) {
    const parsedRecord = asRecord7(safeJsonParse(jsonData));
    if (!parsedRecord) {
      return [
        unknownEvent7(
          body,
          'Webhook Wuzapi em modo "form": campo "jsonData" n\xE3o cont\xE9m um objeto JSON v\xE1lido.'
        )
      ];
    }
    eventRecord = parsedRecord;
  }
  const instanceId = asString7(record.instanceName) ?? asString7(eventRecord.instanceName);
  const type = asString7(eventRecord.type);
  if (!type) {
    return [unknownEvent7(body, 'Payload de webhook Wuzapi sem campo "type".', instanceId)];
  }
  const data = asRecord7(eventRecord.event);
  switch (type) {
    case "Message":
      return [mapMessageEvent4(instanceId, data, eventRecord, body)];
    case "ReadReceipt":
      return mapReceiptEvent2(instanceId, asString7(eventRecord.state), data, body);
    case "Connected":
      return [connectionEvent3(instanceId, "connected", void 0, body)];
    case "PairSuccess":
      return [connectionEvent3(instanceId, "connected", void 0, body)];
    case "Disconnected":
    case "LoggedOut":
    case "ConnectFailure":
      return [connectionEvent3(instanceId, "disconnected", void 0, body)];
    case "QR":
      return [connectionEvent3(instanceId, "qr", asString7(eventRecord.qrCodeBase64), body)];
    case "QRTimeout":
      return [connectionEvent3(instanceId, "disconnected", void 0, body)];
    case "GroupInfo":
      return mapGroupInfoEvent2(instanceId, data, body);
    case "JoinedGroup":
      return [mapJoinedGroupEvent2(instanceId, data, body)];
    default:
      return [unknownEvent7(body, `Evento Wuzapi n\xE3o reconhecido: "${type}".`, instanceId)];
  }
}
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function mapMessageEvent4(instanceId, data, eventRecord, rawBody) {
  if (!data) {
    return unknownEvent7(rawBody, 'Evento "Message" sem campo "event".', instanceId);
  }
  const info = asRecord7(data.Info);
  if (!info) {
    return unknownEvent7(rawBody, 'Evento "Message" sem "event.Info".', instanceId);
  }
  const fromMe = asBoolean7(info.IsFromMe) ?? false;
  const content = mapMessageContent3(asRecord7(data.Message));
  const media = attachRootMedia(content, eventRecord);
  const message = {
    id: asString7(info.ID) ?? "",
    chatId: asString7(info.Chat) ?? "",
    from: asString7(info.Sender),
    fromMe,
    timestamp: toEpochMs3(info.Timestamp) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media,
    raw: rawBody
  };
  return {
    type: fromMe ? "message.sent" : "message.received",
    provider: PROVIDER7,
    instanceId,
    message,
    raw: rawBody
  };
}
function mapMessageContent3(message) {
  if (!message) return { kind: "unknown" };
  if (typeof message.conversation === "string") {
    return { kind: "text", text: message.conversation };
  }
  const extendedText = asRecord7(message.extendedTextMessage);
  if (extendedText) {
    return { kind: "text", text: asString7(extendedText.text) };
  }
  const image = asRecord7(message.imageMessage);
  if (image) {
    return { kind: "image", text: asString7(image.caption), media: buildMediaRef5("image", image) };
  }
  const video = asRecord7(message.videoMessage);
  if (video) {
    return { kind: "video", text: asString7(video.caption), media: buildMediaRef5("video", video) };
  }
  const audio = asRecord7(message.audioMessage);
  if (audio) {
    return { kind: "audio", media: buildMediaRef5("audio", audio) };
  }
  const document = asRecord7(message.documentMessage);
  if (document) {
    return {
      kind: "document",
      text: asString7(document.caption),
      media: buildMediaRef5("document", document)
    };
  }
  const sticker = asRecord7(message.stickerMessage);
  if (sticker) {
    return { kind: "sticker", media: buildMediaRef5("sticker", sticker) };
  }
  if (message.locationMessage) return { kind: "location" };
  if (message.contactMessage) return { kind: "contact" };
  if (message.reactionMessage) return { kind: "reaction" };
  if (message.pollCreationMessage || message.pollUpdateMessage) return { kind: "poll" };
  return { kind: "unknown" };
}
function buildMediaRef5(kind, record) {
  const url = asString7(record.URL) ?? asString7(record.url);
  if (!url) return void 0;
  return {
    kind,
    url,
    mimeType: asString7(record.mimetype),
    filename: asString7(record.fileName)
  };
}
function attachRootMedia(content, eventRecord) {
  if (content.kind === "text" || content.kind === "unknown") return content.media;
  const rootBase64 = asString7(eventRecord.base64);
  if (!rootBase64) return content.media;
  const kind = content.kind;
  return {
    kind,
    url: content.media?.url,
    base64: rootBase64,
    mimeType: content.media?.mimeType ?? asString7(eventRecord.mimeType),
    filename: content.media?.filename ?? asString7(eventRecord.fileName)
  };
}
function mapReceiptEvent2(instanceId, state, data, rawBody) {
  if (!data) {
    return [unknownEvent7(rawBody, 'Evento "ReadReceipt" sem campo "event".', instanceId)];
  }
  const messageIds = asStringArray4(data.MessageIDs);
  if (messageIds.length === 0) {
    return [unknownEvent7(rawBody, 'Evento "ReadReceipt" sem "event.MessageIDs".', instanceId)];
  }
  const chatId = asString7(data.Chat);
  const ack = mapAckState2(state);
  return messageIds.map((messageId) => {
    return {
      type: "message.ack",
      provider: PROVIDER7,
      instanceId,
      messageId,
      chatId,
      ack,
      raw: rawBody
    };
  });
}
function mapAckState2(state) {
  if (state === "Delivered") return "delivered";
  if (state === "Read" || state === "ReadSelf") return "read";
  return "sent";
}
function connectionEvent3(instanceId, state, qr, rawBody) {
  return { type: "connection.update", provider: PROVIDER7, instanceId, state, qr, raw: rawBody };
}
function unknownEvent7(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER7, instanceId, raw, reason };
}
function mapGroupInfoEvent2(instanceId, data, rawBody) {
  if (!data) {
    return [unknownEvent7(rawBody, 'Evento "GroupInfo" sem campo "event".', instanceId)];
  }
  const groupId = asString7(data.JID);
  if (!groupId) {
    return [unknownEvent7(rawBody, 'Evento "GroupInfo" sem "event.JID".', instanceId)];
  }
  const events = [];
  const pushParticipantChange = (action, value) => {
    const participants = asStringArray4(value);
    if (participants.length > 0) {
      events.push(groupUpdateEvent2(instanceId, groupId, action, participants, rawBody));
    }
  };
  pushParticipantChange("participants.add", data.Join);
  pushParticipantChange("participants.remove", data.Leave);
  pushParticipantChange("participants.promote", data.Promote);
  pushParticipantChange("participants.demote", data.Demote);
  if (asRecord7(data.Name)) {
    events.push(groupUpdateEvent2(instanceId, groupId, "subject", void 0, rawBody));
  }
  if (asRecord7(data.Topic)) {
    events.push(groupUpdateEvent2(instanceId, groupId, "description", void 0, rawBody));
  }
  if (events.length === 0) {
    return [
      unknownEvent7(
        rawBody,
        'Evento "GroupInfo" sem mudan\xE7a reconhecida (Join/Leave/Promote/Demote/Name/Topic ausentes ou n\xE3o populados).',
        instanceId
      )
    ];
  }
  return events;
}
function mapJoinedGroupEvent2(instanceId, data, rawBody) {
  if (!data) {
    return unknownEvent7(rawBody, 'Evento "JoinedGroup" sem campo "event".', instanceId);
  }
  const groupId = asString7(data.JID);
  if (!groupId) {
    return unknownEvent7(rawBody, 'Evento "JoinedGroup" sem "event.JID".', instanceId);
  }
  return groupUpdateEvent2(instanceId, groupId, "participants.add", void 0, rawBody);
}
function groupUpdateEvent2(instanceId, groupId, action, participants, rawBody) {
  return {
    type: "group.update",
    provider: PROVIDER7,
    instanceId,
    groupId,
    action,
    participants,
    raw: rawBody
  };
}
function asRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString7(value) {
  return typeof value === "string" ? value : void 0;
}
function asBoolean7(value) {
  return typeof value === "boolean" ? value : void 0;
}
function asStringArray4(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function secondsToEpochMs2(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
  return value * 1e3;
}
function toEpochMs3(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1e3;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  return void 0;
}

// src/adapters/zapi/index.ts
var PROVIDER8 = "zapi";
var DEFAULT_BASE_URL2 = "https://api.z-api.io";
var ZAPI_CAPABILITIES = [
  "instance.connect",
  "instance.status",
  "instance.logout",
  "messages.sendText",
  "messages.sendMedia",
  "messages.sendReaction",
  "messages.edit",
  "messages.delete",
  "messages.forward",
  "messages.pin",
  "messages.unpin",
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
  "chats.archive",
  "chats.unarchive",
  "chats.mute",
  "chats.unmute",
  "chats.pin",
  "chats.unpin",
  "chats.markRead",
  "chats.markUnread",
  "labels.list",
  "channels.create",
  "calls.make",
  "webhooks.parse"
];
function zapi(options) {
  const secrets = [
    options.instanceId,
    options.token,
    ...options.clientToken ? [options.clientToken] : []
  ];
  const http = new HttpClient({
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL2,
    headers: options.clientToken ? { "Client-Token": options.clientToken } : {},
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets,
    provider: PROVIDER8,
    fetch: options.fetch
  });
  const prefix = `/instances/${options.instanceId}/token/${options.token}`;
  const instance = {
    connect: () => connectInstance7(http, prefix),
    status: () => statusInstance7(http, prefix),
    logout: () => logoutInstance7(http, prefix)
  };
  const messages = {
    sendText: (input) => sendText7(http, prefix, input),
    sendMedia: (input) => sendMedia7(http, prefix, input),
    sendReaction: (input) => sendReaction6(http, prefix, input),
    edit: (input) => editMessage7(http, prefix, input),
    delete: (input) => deleteMessage7(http, prefix, input),
    forward: (input) => forwardMessage3(http, prefix, input),
    pin: (input) => setMessagePinned3(http, prefix, input, "pin"),
    unpin: (input) => setMessagePinned3(http, prefix, input, "unpin"),
    markRead: (input) => markMessageRead6(http, prefix, input),
    sendLocation: (input) => sendLocation7(http, prefix, input),
    sendContactCard: (input) => sendContactCard7(http, prefix, input),
    sendPoll: (input) => sendPoll7(http, prefix, input)
  };
  const groups = {
    create: (input) => createGroup6(http, prefix, input),
    getInfo: (groupId) => getGroupInfo6(http, prefix, groupId),
    list: () => listGroups6(http, prefix),
    addParticipants: (input) => addGroupParticipants(http, prefix, input),
    removeParticipants: (input) => removeGroupParticipants(http, prefix, input),
    promoteParticipants: (input) => promoteGroupParticipants(http, prefix, input),
    demoteParticipants: (input) => demoteGroupParticipants(http, prefix, input),
    updateSubject: (input) => updateGroupSubject6(http, prefix, input),
    updateDescription: (input) => updateGroupDescription6(http, prefix, input),
    updatePicture: (input) => updateGroupPicture6(http, prefix, input),
    getInviteLink: (groupId) => getGroupInviteLink5(http, prefix, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink3(http, prefix, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink6(http, prefix, input),
    leaveGroup: (groupId) => leaveGroupCall4(http, prefix, groupId)
  };
  const contacts = {
    list: () => listContacts6(http, prefix),
    get: (chatId) => getContact6(http, prefix, chatId),
    checkExists: (phone) => checkContactExists6(http, prefix, phone),
    getProfilePicture: (chatId) => getContactProfilePicture7(http, prefix, chatId),
    getAbout: (chatId) => getContactAbout5(http, prefix, chatId),
    block: (chatId) => blockContact6(http, prefix, chatId),
    unblock: (chatId) => unblockContact6(http, prefix, chatId)
    // `listBlocked` deliberadamente NÃO implementado nem declarado em capabilities: busca
    // exaustiva nas 273 páginas do índice completo da doc oficial (contacts/*, chats/*,
    // privacy/*, etc.) não achou endpoint de listagem de contatos bloqueados. NÃO confundir com
    // `GET /privacy/get-disallowed-contacts` — essa é uma blacklist de PRIVACIDADE por capability
    // (quem fica de fora de "visto por último"/foto/descrição), uma feature adjacente porém
    // diferente da lista de contatos efetivamente bloqueados. Ver docs/providers/zapi.md#contatos.
  };
  const chats = {
    archive: (chatId) => modifyChat(http, prefix, chatId, "archive"),
    unarchive: (chatId) => modifyChat(http, prefix, chatId, "unarchive"),
    mute: (chatId) => modifyChat(http, prefix, chatId, "mute"),
    unmute: (chatId) => modifyChat(http, prefix, chatId, "unmute"),
    pin: (chatId) => modifyChat(http, prefix, chatId, "pin"),
    unpin: (chatId) => modifyChat(http, prefix, chatId, "unpin"),
    // `markRead`/`markUnread`: mesmo endpoint `/modify-chat`, ação `read`/`unread` — confirmado na
    // doc oficial (`developer.z-api.io/chats/read-chat`, "Ler chats": "responsável por realizar a
    // ação de ler um chat como um todo, ou também marcar um chat como não lido"), mesmo shape
    // `{ phone, action }` -> `{ value: true }` dos outros 6 verbos deste endpoint. Achado corrigido
    // na verificação adversarial de 2026-07-12 (o relatório de pesquisa original não tinha
    // encontrado esta página, que fica no mesmo diretório `docs/chats/` já citado acima).
    markRead: (chatId) => modifyChat(http, prefix, chatId, "read"),
    markUnread: (chatId) => modifyChat(http, prefix, chatId, "unread")
  };
  const labels = {
    list: () => listLabels6(http, prefix)
  };
  const channels = {
    create: (input) => createChannel5(http, prefix, input)
  };
  const calls = {
    make: (input) => makeCall2(http, prefix, input)
  };
  return {
    provider: PROVIDER8,
    capabilities: ZAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    labels,
    channels,
    calls,
    parseWebhook: (input) => parseWebhook7(input)
  };
}
function toZapiPhone(chatId) {
  if (isJid(chatId)) return chatId;
  return digitsOnly(chatId);
}
async function connectInstance7(http, prefix) {
  const body = await http.request({ method: "GET", path: `${prefix}/qr-code/image` });
  return { qr: extractQr4(body), raw: body };
}
function extractQr4(body) {
  const record = asRecord8(body);
  if (record) {
    return asString8(record.value) ?? asString8(record.qrcode) ?? asString8(record.base64);
  }
  return asString8(body);
}
async function statusInstance7(http, prefix) {
  const body = await http.request({ method: "GET", path: `${prefix}/status` });
  return { state: mapInstanceState6(body), raw: body };
}
function mapInstanceState6(body) {
  const record = asRecord8(body);
  if (!record) return "unknown";
  const connected = asBoolean8(record.connected);
  if (connected === void 0) return "unknown";
  return connected ? "connected" : "disconnected";
}
async function logoutInstance7(http, prefix) {
  await http.request({ method: "GET", path: `${prefix}/disconnect` });
}
async function sendText7(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const body = { phone, message: input.text };
  if (input.quotedId) {
    body.messageId = input.quotedId;
  }
  const response = await http.request({
    method: "POST",
    path: `${prefix}/send-text`,
    body
  });
  return mapSentMessage5(response, phone);
}
function resolveMediaEndpoint2(media) {
  switch (media.kind) {
    case "image":
      return { path: "/send-image", field: "image", supportsCaption: true, supportsQuotedId: true };
    case "video":
      return { path: "/send-video", field: "video", supportsCaption: true, supportsQuotedId: true };
    case "audio":
      return {
        path: "/send-audio",
        field: "audio",
        supportsCaption: false,
        supportsQuotedId: false
      };
    case "document":
      return {
        path: `/send-document/${resolveDocumentExtension(media)}`,
        field: "document",
        supportsCaption: true,
        supportsQuotedId: true
      };
    case "sticker":
      return {
        path: "/send-sticker",
        field: "sticker",
        supportsCaption: false,
        supportsQuotedId: true
      };
  }
}
function resolveDocumentExtension(media) {
  const fromFilename = extensionFromFilename(media.filename);
  if (fromFilename) return fromFilename;
  const fromMime = extensionFromMimeType(media.mimeType);
  if (fromMime) return fromMime;
  throw new WaConnectorError(
    "INVALID_INPUT",
    'Z-API: sendMedia para "document" exige "media.filename" (com extens\xE3o) ou um "media.mimeType" reconhecido, para compor o segmento /send-document/{extension} da URL.',
    { provider: PROVIDER8 }
  );
}
function extensionFromFilename(filename) {
  if (!filename) return void 0;
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === filename.length - 1) return void 0;
  return filename.slice(dotIndex + 1).toLowerCase();
}
var MIME_TO_EXTENSION = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip"
};
function extensionFromMimeType(mimeType) {
  if (!mimeType) return void 0;
  return MIME_TO_EXTENSION[mimeType.toLowerCase()];
}
var DEFAULT_MIME_BY_KIND4 = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/mpeg",
  document: "application/octet-stream"
};
function resolveMediaValue4(media) {
  if (media.url) return media.url;
  if (media.base64) {
    if (media.base64.startsWith("data:")) return media.base64;
    const mime = media.mimeType ?? DEFAULT_MIME_BY_KIND4[media.kind] ?? "application/octet-stream";
    return `data:${mime};base64,${media.base64}`;
  }
  throw new WaConnectorError(
    "INVALID_INPUT",
    'Z-API: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER8 }
  );
}
async function sendMedia7(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const endpoint = resolveMediaEndpoint2(input.media);
  const value = resolveMediaValue4(input.media);
  const body = { phone, [endpoint.field]: value };
  if (endpoint.supportsCaption && input.caption) {
    body.caption = input.caption;
  }
  if (endpoint.field === "document" && input.media.filename) {
    body.fileName = input.media.filename;
  }
  if (endpoint.supportsQuotedId && input.quotedId) {
    body.messageId = input.quotedId;
  }
  const response = await http.request({
    method: "POST",
    path: `${prefix}${endpoint.path}`,
    body
  });
  return mapSentMessage5(response, phone);
}
async function sendReaction6(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const isRemoval = input.emoji === "";
  const body = { phone, messageId: input.messageId };
  if (!isRemoval) {
    body.reaction = input.emoji;
  }
  const response = await http.request({
    method: "POST",
    path: `${prefix}${isRemoval ? "/send-remove-reaction" : "/send-reaction"}`,
    body
  });
  return mapSentMessage5(response, phone);
}
async function editMessage7(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: `${prefix}/send-text`,
    body: { phone, message: input.text, editMessageId: input.messageId }
  });
  return mapSentMessage5(response, phone);
}
async function deleteMessage7(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  await http.request({
    method: "DELETE",
    path: `${prefix}/messages`,
    query: { messageId: input.messageId, phone, owner: true }
  });
}
async function forwardMessage3(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const messagePhone = input.fromChatId ? toZapiPhone(input.fromChatId) : phone;
  const response = await http.request({
    method: "POST",
    path: `${prefix}/forward-message`,
    body: { phone, messageId: input.messageId, messagePhone }
  });
  return mapSentMessage5(response, phone);
}
async function setMessagePinned3(http, prefix, input, action) {
  const phone = toZapiPhone(input.to);
  await http.request({
    method: "POST",
    path: `${prefix}/pin-message`,
    body: {
      phone,
      messageId: input.messageId,
      messageAction: action,
      pinMessageDuration: "24_hours"
    }
  });
}
async function markMessageRead6(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  await http.request({
    method: "POST",
    path: `${prefix}/read-message`,
    body: { phone, messageId: input.messageId }
  });
}
async function sendLocation7(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const body = {
    phone,
    latitude: input.latitude,
    longitude: input.longitude
  };
  if (input.name) body.title = input.name;
  if (input.address) body.address = input.address;
  const response = await http.request({
    method: "POST",
    path: `${prefix}/send-location`,
    body
  });
  return mapSentMessage5(response, phone);
}
async function sendContactCard7(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: `${prefix}/send-contact`,
    body: { phone, contactName: input.contactName, contactPhone: input.contactPhone }
  });
  return mapSentMessage5(response, phone);
}
async function sendPoll7(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: `${prefix}/send-poll`,
    body: {
      phone,
      message: input.question,
      poll: input.options.map((name) => ({ name })),
      pollMaxOptions: input.allowMultipleAnswers ? input.options.length : 1
    }
  });
  return mapSentMessage5(response, phone);
}
function mapSentMessage5(body, requestedPhone) {
  const record = asRecord8(body);
  const id = (record ? asString8(record.messageId) ?? asString8(record.id) : void 0) ?? `zapi-${Date.now()}`;
  return { id, chatId: requestedPhone, raw: body };
}
async function createGroup6(http, prefix, input) {
  const phones = input.participants.map(toZapiPhone);
  const response = await http.request({
    method: "POST",
    path: `${prefix}/create-group`,
    body: { autoInvite: false, groupName: input.subject, phones }
  });
  const record = asRecord8(response);
  const id = (record ? asString8(record.phone) : void 0) ?? `zapi-group-${Date.now()}`;
  return {
    id,
    subject: input.subject,
    participants: input.participants.map((participant) => ({
      id: participant,
      isAdmin: false,
      isSuperAdmin: false
    })),
    raw: response
  };
}
async function getGroupInfo6(http, prefix, groupId) {
  const response = await http.request({
    method: "GET",
    path: `${prefix}/group-metadata/${groupId}`
  });
  return mapGroupInfo6(response, groupId);
}
function mapGroupInfo6(body, requestedGroupId) {
  const record = asRecord8(body);
  return {
    id: (record ? asString8(record.phone) : void 0) ?? requestedGroupId,
    subject: (record ? asString8(record.subject) : void 0) ?? "",
    description: record ? asString8(record.description) : void 0,
    owner: record ? asString8(record.owner) : void 0,
    participants: (record ? asRecordArray2(record.participants) : []).map(mapGroupParticipant5),
    raw: body
  };
}
function mapGroupParticipant5(record) {
  return {
    id: asString8(record.phone) ?? "",
    isAdmin: asBoolean8(record.isAdmin) ?? false,
    isSuperAdmin: asBoolean8(record.isSuperAdmin) ?? false
  };
}
async function listGroups6(http, prefix) {
  const response = await http.request({
    method: "GET",
    path: `${prefix}/groups`,
    query: { page: 1, pageSize: 100 }
  });
  return asRecordArray2(response).map((item) => ({
    id: asString8(item.phone) ?? "",
    subject: asString8(item.name) ?? "",
    participants: [],
    raw: item
  }));
}
async function addGroupParticipants(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/add-participant`,
    body: {
      autoInvite: false,
      groupId: input.groupId,
      phones: input.participants.map(toZapiPhone)
    }
  });
}
async function removeGroupParticipants(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/remove-participant`,
    body: { groupId: input.groupId, phones: input.participants.map(toZapiPhone) }
  });
}
async function promoteGroupParticipants(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/add-admin`,
    body: { groupId: input.groupId, phones: input.participants.map(toZapiPhone) }
  });
}
async function demoteGroupParticipants(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/remove-admin`,
    body: { groupId: input.groupId, phones: input.participants.map(toZapiPhone) }
  });
}
async function updateGroupSubject6(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/update-group-name`,
    body: { groupId: input.groupId, groupName: input.subject }
  });
}
async function updateGroupDescription6(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/update-group-description`,
    body: { groupId: input.groupId, groupDescription: input.description }
  });
}
async function updateGroupPicture6(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/update-group-photo`,
    body: { groupId: input.groupId, groupPhoto: resolveMediaValue4(input.media) }
  });
}
async function getGroupInviteLink5(http, prefix, groupId) {
  const response = await http.request({
    method: "GET",
    path: `${prefix}/group-invitation-link/${groupId}`
  });
  return mapGroupInviteLink2(response);
}
async function revokeGroupInviteLink3(http, prefix, groupId) {
  const response = await http.request({
    method: "POST",
    path: `${prefix}/redefine-invitation-link/${groupId}`
  });
  return mapGroupInviteLink2(response);
}
function mapGroupInviteLink2(body) {
  const record = asRecord8(body);
  const invitationLink = (record ? asString8(record.invitationLink) : void 0) ?? "";
  return { link: normalizeInviteLink(invitationLink), raw: body };
}
async function joinGroupViaInviteLink6(http, prefix, input) {
  await http.request({
    method: "GET",
    path: `${prefix}/accept-invite-group`,
    query: { url: input.invite }
  });
}
async function leaveGroupCall4(http, prefix, groupId) {
  await http.request({
    method: "POST",
    path: `${prefix}/leave-group`,
    body: { groupId }
  });
}
async function listContacts6(http, prefix) {
  const response = await http.request({
    method: "GET",
    path: `${prefix}/contacts`,
    query: { page: 1, pageSize: 100 }
  });
  return asRecordArray2(response).map(mapContactListItem2);
}
function mapContactListItem2(record) {
  const phone = asString8(record.phone) ?? "";
  return {
    id: toZapiPhone(phone),
    name: asString8(record.name) ?? asString8(record.notify) ?? asString8(record.short),
    raw: record
  };
}
async function fetchContactDetail(http, prefix, chatId) {
  const phone = toZapiPhone(chatId);
  return http.request({ method: "GET", path: `${prefix}/contacts/${phone}` });
}
async function getContact6(http, prefix, chatId) {
  const response = await fetchContactDetail(http, prefix, chatId);
  return mapContact4(response, chatId);
}
function mapContact4(body, requestedChatId) {
  const record = asRecord8(body);
  const responsePhone = record ? asString8(record.phone) : void 0;
  return {
    id: responsePhone ? toZapiPhone(responsePhone) : requestedChatId,
    name: (record ? asString8(record.name) : void 0) ?? (record ? asString8(record.notify) : void 0),
    about: record ? asString8(record.about) : void 0,
    profilePictureUrl: record ? asString8(record.imgUrl) : void 0,
    raw: body
  };
}
async function checkContactExists6(http, prefix, phone) {
  const zapiPhone = toZapiPhone(phone);
  const response = await http.request({
    method: "GET",
    path: `${prefix}/phone-exists/${zapiPhone}`
  });
  const items = asRecordArray2(response);
  const item = items[0];
  if (!item) {
    return { exists: false, raw: response };
  }
  const resolvedId = asString8(item.lid) ?? asString8(item.phone);
  return {
    exists: asBoolean8(item.exists) ?? false,
    chatId: resolvedId ? toZapiPhone(resolvedId) : void 0,
    raw: response
  };
}
async function getContactProfilePicture7(http, prefix, chatId) {
  const phone = toZapiPhone(chatId);
  const response = await http.request({
    method: "GET",
    path: `${prefix}/profile-picture`,
    query: { phone }
  });
  const record = asRecord8(response);
  return { url: record ? asString8(record.link) : void 0, raw: response };
}
async function getContactAbout5(http, prefix, chatId) {
  const response = await fetchContactDetail(http, prefix, chatId);
  const record = asRecord8(response);
  return { about: record ? asString8(record.about) : void 0, raw: response };
}
async function setContactBlocked2(http, prefix, chatId, action) {
  const phone = toZapiPhone(chatId);
  await http.request({
    method: "POST",
    path: `${prefix}/contacts/modify-blocked`,
    body: { phone, action }
  });
}
async function blockContact6(http, prefix, chatId) {
  await setContactBlocked2(http, prefix, chatId, "block");
}
async function unblockContact6(http, prefix, chatId) {
  await setContactBlocked2(http, prefix, chatId, "unblock");
}
async function modifyChat(http, prefix, chatId, action) {
  const phone = toZapiPhone(chatId);
  await http.request({
    method: "POST",
    path: `${prefix}/modify-chat`,
    body: { phone, action }
  });
}
async function listLabels6(http, prefix) {
  const body = await http.request({ method: "GET", path: `${prefix}/tags` });
  const items = Array.isArray(body) ? body : [];
  return items.map((item) => mapZapiLabel(item));
}
function mapZapiLabel(body) {
  const record = asRecord8(body);
  const colorRaw = record?.color;
  const color = typeof colorRaw === "string" ? colorRaw : typeof colorRaw === "number" ? String(colorRaw) : void 0;
  return {
    id: (record ? asString8(record.id) : void 0) ?? "",
    name: (record ? asString8(record.name) : void 0) ?? "",
    color,
    raw: body
  };
}
async function createChannel5(http, prefix, input) {
  const body = await http.request({
    method: "POST",
    path: `${prefix}/create-newsletter`,
    body: { name: input.name, description: input.description }
  });
  const record = asRecord8(body);
  return {
    id: (record ? asString8(record.id) : void 0) ?? "",
    name: input.name,
    description: input.description,
    raw: body
  };
}
async function makeCall2(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/send-call`,
    body: { phone: toZapiPhone(input.to), callDuration: input.durationSeconds }
  });
}
function parseWebhook7(input) {
  try {
    return parseWebhookUnsafe7(input);
  } catch (error) {
    return [
      unknownEvent8(
        input.body,
        `Erro inesperado ao parsear webhook Z-API: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe7(input) {
  const body = input.body;
  const record = asRecord8(body);
  if (!record) {
    return [unknownEvent8(body, "Corpo do webhook Z-API n\xE3o \xE9 um objeto JSON.")];
  }
  const type = asString8(record.type);
  if (!type) {
    return [unknownEvent8(body, 'Payload de webhook Z-API sem campo "type".')];
  }
  const instanceId = asString8(record.instanceId);
  switch (type) {
    case "ReceivedCallback": {
      const groupEvents = mapGroupNotification(record, body, instanceId);
      if (groupEvents) return groupEvents;
      const message = mapZapiMessage(record, body);
      return [
        {
          type: message.fromMe ? "message.sent" : "message.received",
          provider: PROVIDER8,
          instanceId,
          message,
          raw: body
        }
      ];
    }
    case "DeliveryCallback": {
      const messageId = asString8(record.messageId) ?? asString8(record.zaapId) ?? "unknown";
      const errorText = asString8(record.error);
      return [
        {
          type: "message.ack",
          provider: PROVIDER8,
          instanceId,
          messageId,
          chatId: asString8(record.phone),
          ack: errorText ? "error" : "sent",
          raw: body
        }
      ];
    }
    case "MessageStatusCallback": {
      const ids = asStringArray5(record.ids);
      if (ids.length === 0) {
        return [
          unknownEvent8(body, 'Evento "MessageStatusCallback" do Z-API sem "ids".', instanceId)
        ];
      }
      const chatId = asString8(record.phone);
      const ack = mapZapiAckStatus(asString8(record.status));
      return ids.map((messageId) => ({
        type: "message.ack",
        provider: PROVIDER8,
        instanceId,
        messageId,
        chatId,
        ack,
        raw: body
      }));
    }
    case "ConnectedCallback":
      return [
        {
          type: "connection.update",
          provider: PROVIDER8,
          instanceId,
          state: "connected",
          raw: body
        }
      ];
    case "DisconnectedCallback":
      return [
        {
          type: "connection.update",
          provider: PROVIDER8,
          instanceId,
          state: "disconnected",
          raw: body
        }
      ];
    default:
      return [unknownEvent8(body, `Evento Z-API n\xE3o mapeado nesta fase: "${type}".`, instanceId)];
  }
}
function mapGroupNotification(record, rawBody, instanceId) {
  const action = mapGroupNotificationAction(asString8(record.notification));
  if (!action) return void 0;
  return [
    {
      type: "group.update",
      provider: PROVIDER8,
      instanceId,
      groupId: asString8(record.phone) ?? "unknown",
      action,
      participants: asStringArray5(record.notificationParameters),
      raw: rawBody
    }
  ];
}
function mapGroupNotificationAction(notification) {
  switch (notification) {
    case "GROUP_PARTICIPANT_ADD":
      return "participants.add";
    case "GROUP_PARTICIPANT_REMOVE":
    case "GROUP_PARTICIPANT_LEAVE":
      return "participants.remove";
    case "GROUP_PARTICIPANT_PROMOTE":
      return "participants.promote";
    case "GROUP_PARTICIPANT_DEMOTE":
      return "participants.demote";
    default:
      return void 0;
  }
}
function mapZapiMessage(record, rawBody) {
  const fromMe = asBoolean8(record.fromMe) ?? false;
  const content = mapMessageContent4(record);
  const chatId = asString8(record.phone) ?? "unknown";
  return {
    id: asString8(record.messageId) ?? `zapi-unknown-${Date.now()}`,
    chatId,
    from: asString8(record.participantPhone) ?? asString8(record.phone),
    fromMe,
    timestamp: asNumber6(record.momment) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media: content.media,
    raw: rawBody
  };
}
function mapMessageContent4(record) {
  const text = asRecord8(record.text);
  if (text) {
    return { kind: "text", text: asString8(text.message) };
  }
  const image = asRecord8(record.image);
  if (image) {
    return {
      kind: "image",
      text: asString8(image.caption),
      media: buildMediaRef6("image", image, "imageUrl")
    };
  }
  const video = asRecord8(record.video);
  if (video) {
    return {
      kind: "video",
      text: asString8(video.caption),
      media: buildMediaRef6("video", video, "videoUrl")
    };
  }
  const audio = asRecord8(record.audio);
  if (audio) {
    return { kind: "audio", media: buildMediaRef6("audio", audio, "audioUrl") };
  }
  const document = asRecord8(record.document);
  if (document) {
    return {
      kind: "document",
      text: asString8(document.caption),
      media: buildMediaRef6("document", document, "documentUrl")
    };
  }
  const sticker = asRecord8(record.sticker);
  if (sticker) {
    return { kind: "sticker", media: buildMediaRef6("sticker", sticker, "stickerUrl") };
  }
  return { kind: "unknown" };
}
function buildMediaRef6(kind, record, urlField) {
  const url = asString8(record[urlField]);
  if (!url) return void 0;
  return {
    kind,
    url,
    mimeType: asString8(record.mimeType),
    filename: asString8(record.fileName)
  };
}
function mapZapiAckStatus(status) {
  switch (status) {
    case "SENT":
      return "sent";
    case "RECEIVED":
      return "delivered";
    case "READ":
    case "READ_BY_ME":
      return "read";
    case "PLAYED":
      return "played";
    default:
      return "sent";
  }
}
function unknownEvent8(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER8, instanceId, raw, reason };
}
function asRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString8(value) {
  return typeof value === "string" ? value : void 0;
}
function asNumber6(value) {
  return typeof value === "number" ? value : void 0;
}
function asBoolean8(value) {
  return typeof value === "boolean" ? value : void 0;
}
function asStringArray5(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function asRecordArray2(value) {
  return Array.isArray(value) ? value.map((item) => asRecord8(item)).filter((item) => item !== void 0) : [];
}

// src/cli/doctor.ts
var PROVIDER_NAMES = [
  "waha",
  "evolution",
  "uazapi",
  "zapi",
  "wuzapi",
  "whapi",
  "quepasa",
  "wppconnect"
];
function isProviderName(value) {
  return PROVIDER_NAMES.includes(value);
}
var PROVIDER_FIELDS = {
  waha: [
    { field: "baseUrl", envVar: "WACONECTOR_BASE_URL", required: true },
    { field: "apiKey", envVar: "WACONECTOR_API_KEY", required: true },
    { field: "session", envVar: "WACONECTOR_SESSION", required: false },
    { field: "webhookHmacKey", envVar: "WACONECTOR_WEBHOOK_HMAC_KEY", required: false }
  ],
  evolution: [
    { field: "baseUrl", envVar: "WACONECTOR_BASE_URL", required: true },
    { field: "apiKey", envVar: "WACONECTOR_API_KEY", required: true },
    { field: "instance", envVar: "WACONECTOR_INSTANCE", required: false },
    { field: "webhookUrl", envVar: "WACONECTOR_WEBHOOK_URL", required: false }
  ],
  uazapi: [
    { field: "baseUrl", envVar: "WACONECTOR_BASE_URL", required: true },
    { field: "token", envVar: "WACONECTOR_TOKEN", required: true },
    { field: "adminToken", envVar: "WACONECTOR_ADMIN_TOKEN", required: false },
    { field: "instance", envVar: "WACONECTOR_INSTANCE", required: false }
  ],
  zapi: [
    { field: "instanceId", envVar: "WACONECTOR_INSTANCE_ID", required: true },
    { field: "token", envVar: "WACONECTOR_TOKEN", required: true },
    { field: "baseUrl", envVar: "WACONECTOR_BASE_URL", required: false },
    { field: "clientToken", envVar: "WACONECTOR_CLIENT_TOKEN", required: false }
  ],
  wuzapi: [
    { field: "baseUrl", envVar: "WACONECTOR_BASE_URL", required: true },
    { field: "token", envVar: "WACONECTOR_TOKEN", required: true },
    { field: "adminToken", envVar: "WACONECTOR_ADMIN_TOKEN", required: false },
    { field: "instance", envVar: "WACONECTOR_INSTANCE", required: false }
  ],
  whapi: [
    { field: "token", envVar: "WACONECTOR_TOKEN", required: true },
    { field: "baseUrl", envVar: "WACONECTOR_BASE_URL", required: false }
  ],
  quepasa: [
    { field: "baseUrl", envVar: "WACONECTOR_BASE_URL", required: true },
    { field: "token", envVar: "WACONECTOR_TOKEN", required: true }
  ],
  wppconnect: [
    { field: "baseUrl", envVar: "WACONECTOR_BASE_URL", required: true },
    { field: "session", envVar: "WACONECTOR_SESSION", required: true },
    { field: "token", envVar: "WACONECTOR_TOKEN", required: true },
    { field: "webhook", envVar: "WACONECTOR_WEBHOOK", required: false }
  ]
};
function resolveProviderOptions(provider, env) {
  if (!isProviderName(provider)) {
    return {
      ok: false,
      error: `Provider desconhecido: "${provider}". Providers v\xE1lidos: ${PROVIDER_NAMES.join(", ")}.`
    };
  }
  const options = {};
  const missing = [];
  for (const spec of PROVIDER_FIELDS[provider]) {
    const value = env[spec.envVar];
    if (value) {
      options[spec.field] = value;
    } else if (spec.required) {
      missing.push(spec.envVar);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Vari\xE1veis de ambiente obrigat\xF3rias ausentes para "${provider}": ${missing.join(", ")}.`
    };
  }
  return { ok: true, options };
}
function buildAdapterForDoctor(provider, options, fetchOverride) {
  const withFetch = options;
  switch (provider) {
    case "waha":
      return waha(withFetch);
    case "evolution":
      return evolution(withFetch);
    case "uazapi":
      return uazapi(withFetch);
    case "zapi":
      return zapi(withFetch);
    case "wuzapi":
      return wuzapi(withFetch);
    case "whapi":
      return whapi(withFetch);
    case "quepasa":
      return quepasa(withFetch);
    case "wppconnect":
      return wppconnect(withFetch);
  }
}
async function runDoctor(provider, env, fetchOverride) {
  const resolved = resolveProviderOptions(provider, env);
  if (!resolved.ok) {
    return { ok: false, reason: "config", provider, message: resolved.error };
  }
  const providerName = provider;
  const adapter = buildAdapterForDoctor(providerName, resolved.options);
  try {
    const status = await adapter.instance.status();
    return {
      ok: true,
      provider: providerName,
      state: status.state,
      capabilities: adapter.capabilities
    };
  } catch (error) {
    if (isWaConnectorError(error)) {
      return {
        ok: false,
        reason: "runtime",
        provider: providerName,
        code: error.code,
        message: error.message
      };
    }
    return {
      ok: false,
      reason: "runtime",
      provider: providerName,
      code: "UNKNOWN",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
var ANSI = { red: "\x1B[31m", green: "\x1B[32m", reset: "\x1B[0m" };
function paint(text, color, enabled) {
  return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}
function formatDoctorReport(report, format = { color: false }) {
  if (report.ok) {
    return [
      `${paint("OK", "green", format.color)} provider "${report.provider}" \u2014 estado: ${report.state}`,
      `Capabilities declaradas (${report.capabilities.length}): ${report.capabilities.join(", ")}`
    ].join("\n");
  }
  if (report.reason === "config") {
    return `${paint("ERRO", "red", format.color)} configura\xE7\xE3o inv\xE1lida: ${report.message}`;
  }
  return [
    `${paint("ERRO", "red", format.color)} provider "${report.provider}" \u2014 falha ao consultar status`,
    `C\xF3digo: ${report.code}`,
    `Mensagem: ${report.message}`
  ].join("\n");
}

// src/cli/index.ts
var HELP_TEXT = `waconector \u2014 CLI de diagn\xF3stico

Uso:
  waconector doctor --provider <nome>   Testa a conex\xE3o com um provider configurado via env vars
  waconector --help                     Mostra esta ajuda

Providers suportados: ${PROVIDER_NAMES.join(", ")}

O provider pode vir de --provider (ou -p) ou da vari\xE1vel WACONECTOR_PROVIDER \u2014 --provider tem
preced\xEAncia. As demais op\xE7\xF5es (URL base, token, sess\xE3o, etc.) v\xEAm sempre de vari\xE1veis
WACONECTOR_* espec\xEDficas do provider escolhido; rode "waconector doctor --provider <nome>" sem
essas vari\xE1veis definidas para ver exatamente quais s\xE3o exigidas.

"doctor" s\xF3 faz uma checagem de leitura (instance.status()) \u2014 nunca chama connect() nem altera
o estado da inst\xE2ncia no provider.`;
function parseCliArgs(argv) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      provider: { type: "string", short: "p" },
      help: { type: "boolean", short: "h" }
    }
  });
}
async function run() {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
    return 1;
  }
  if (values.help) {
    process.stdout.write(`${HELP_TEXT}
`);
    return 0;
  }
  const [command] = positionals;
  if (command !== "doctor") {
    process.stderr.write(
      `Comando desconhecido: "${command ?? ""}". Use "waconector --help" para ver o uso.
`
    );
    return 1;
  }
  const provider = values.provider ?? process.env.WACONECTOR_PROVIDER;
  if (!provider) {
    process.stderr.write(
      'Faltou --provider (ou defina WACONECTOR_PROVIDER). Use "waconector --help".\n'
    );
    return 1;
  }
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const report = await runDoctor(provider, process.env);
  process.stdout.write(`${formatDoctorReport(report, { color })}
`);
  return report.ok ? 0 : 1;
}
var exitCode = await run();
process.exit(exitCode);
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map