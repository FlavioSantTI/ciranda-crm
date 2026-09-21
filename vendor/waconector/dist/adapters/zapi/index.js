import { HttpClient } from '../../chunk-SYMHJK3P.js';
import { isJid, digitsOnly, normalizeInviteLink } from '../../chunk-SWRBCMQ6.js';
import { WaConnectorError } from '../../chunk-JIDVFSO6.js';

// src/adapters/zapi/index.ts
var PROVIDER = "zapi";
var DEFAULT_BASE_URL = "https://api.z-api.io";
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
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    headers: options.clientToken ? { "Client-Token": options.clientToken } : {},
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets,
    provider: PROVIDER,
    fetch: options.fetch
  });
  const prefix = `/instances/${options.instanceId}/token/${options.token}`;
  const instance = {
    connect: () => connectInstance(http, prefix),
    status: () => statusInstance(http, prefix),
    logout: () => logoutInstance(http, prefix)
  };
  const messages = {
    sendText: (input) => sendText(http, prefix, input),
    sendMedia: (input) => sendMedia(http, prefix, input),
    sendReaction: (input) => sendReaction(http, prefix, input),
    edit: (input) => editMessage(http, prefix, input),
    delete: (input) => deleteMessage(http, prefix, input),
    forward: (input) => forwardMessage(http, prefix, input),
    pin: (input) => setMessagePinned(http, prefix, input, "pin"),
    unpin: (input) => setMessagePinned(http, prefix, input, "unpin"),
    markRead: (input) => markMessageRead(http, prefix, input),
    sendLocation: (input) => sendLocation(http, prefix, input),
    sendContactCard: (input) => sendContactCard(http, prefix, input),
    sendPoll: (input) => sendPoll(http, prefix, input)
  };
  const groups = {
    create: (input) => createGroup(http, prefix, input),
    getInfo: (groupId) => getGroupInfo(http, prefix, groupId),
    list: () => listGroups(http, prefix),
    addParticipants: (input) => addGroupParticipants(http, prefix, input),
    removeParticipants: (input) => removeGroupParticipants(http, prefix, input),
    promoteParticipants: (input) => promoteGroupParticipants(http, prefix, input),
    demoteParticipants: (input) => demoteGroupParticipants(http, prefix, input),
    updateSubject: (input) => updateGroupSubject(http, prefix, input),
    updateDescription: (input) => updateGroupDescription(http, prefix, input),
    updatePicture: (input) => updateGroupPicture(http, prefix, input),
    getInviteLink: (groupId) => getGroupInviteLink(http, prefix, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink(http, prefix, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, prefix, input),
    leaveGroup: (groupId) => leaveGroupCall(http, prefix, groupId)
  };
  const contacts = {
    list: () => listContacts(http, prefix),
    get: (chatId) => getContact(http, prefix, chatId),
    checkExists: (phone) => checkContactExists(http, prefix, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, prefix, chatId),
    getAbout: (chatId) => getContactAbout(http, prefix, chatId),
    block: (chatId) => blockContact(http, prefix, chatId),
    unblock: (chatId) => unblockContact(http, prefix, chatId)
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
    list: () => listLabels(http, prefix)
  };
  const channels = {
    create: (input) => createChannel(http, prefix, input)
  };
  const calls = {
    make: (input) => makeCall(http, prefix, input)
  };
  return {
    provider: PROVIDER,
    capabilities: ZAPI_CAPABILITIES,
    instance,
    messages,
    groups,
    contacts,
    chats,
    labels,
    channels,
    calls,
    parseWebhook: (input) => parseWebhook(input)
  };
}
function toZapiPhone(chatId) {
  if (isJid(chatId)) return chatId;
  return digitsOnly(chatId);
}
async function connectInstance(http, prefix) {
  const body = await http.request({ method: "GET", path: `${prefix}/qr-code/image` });
  return { qr: extractQr(body), raw: body };
}
function extractQr(body) {
  const record = asRecord(body);
  if (record) {
    return asString(record.value) ?? asString(record.qrcode) ?? asString(record.base64);
  }
  return asString(body);
}
async function statusInstance(http, prefix) {
  const body = await http.request({ method: "GET", path: `${prefix}/status` });
  return { state: mapInstanceState(body), raw: body };
}
function mapInstanceState(body) {
  const record = asRecord(body);
  if (!record) return "unknown";
  const connected = asBoolean(record.connected);
  if (connected === void 0) return "unknown";
  return connected ? "connected" : "disconnected";
}
async function logoutInstance(http, prefix) {
  await http.request({ method: "GET", path: `${prefix}/disconnect` });
}
async function sendText(http, prefix, input) {
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
  return mapSentMessage(response, phone);
}
function resolveMediaEndpoint(media) {
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
    { provider: PROVIDER }
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
var DEFAULT_MIME_BY_KIND = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/mpeg",
  document: "application/octet-stream"
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
    'Z-API: sendMedia exige "media.url" ou "media.base64".',
    { provider: PROVIDER }
  );
}
async function sendMedia(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const endpoint = resolveMediaEndpoint(input.media);
  const value = resolveMediaValue(input.media);
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
  return mapSentMessage(response, phone);
}
async function sendReaction(http, prefix, input) {
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
  return mapSentMessage(response, phone);
}
async function editMessage(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: `${prefix}/send-text`,
    body: { phone, message: input.text, editMessageId: input.messageId }
  });
  return mapSentMessage(response, phone);
}
async function deleteMessage(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  await http.request({
    method: "DELETE",
    path: `${prefix}/messages`,
    query: { messageId: input.messageId, phone, owner: true }
  });
}
async function forwardMessage(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const messagePhone = input.fromChatId ? toZapiPhone(input.fromChatId) : phone;
  const response = await http.request({
    method: "POST",
    path: `${prefix}/forward-message`,
    body: { phone, messageId: input.messageId, messagePhone }
  });
  return mapSentMessage(response, phone);
}
async function setMessagePinned(http, prefix, input, action) {
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
async function markMessageRead(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  await http.request({
    method: "POST",
    path: `${prefix}/read-message`,
    body: { phone, messageId: input.messageId }
  });
}
async function sendLocation(http, prefix, input) {
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
  return mapSentMessage(response, phone);
}
async function sendContactCard(http, prefix, input) {
  const phone = toZapiPhone(input.to);
  const response = await http.request({
    method: "POST",
    path: `${prefix}/send-contact`,
    body: { phone, contactName: input.contactName, contactPhone: input.contactPhone }
  });
  return mapSentMessage(response, phone);
}
async function sendPoll(http, prefix, input) {
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
  return mapSentMessage(response, phone);
}
function mapSentMessage(body, requestedPhone) {
  const record = asRecord(body);
  const id = (record ? asString(record.messageId) ?? asString(record.id) : void 0) ?? `zapi-${Date.now()}`;
  return { id, chatId: requestedPhone, raw: body };
}
async function createGroup(http, prefix, input) {
  const phones = input.participants.map(toZapiPhone);
  const response = await http.request({
    method: "POST",
    path: `${prefix}/create-group`,
    body: { autoInvite: false, groupName: input.subject, phones }
  });
  const record = asRecord(response);
  const id = (record ? asString(record.phone) : void 0) ?? `zapi-group-${Date.now()}`;
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
async function getGroupInfo(http, prefix, groupId) {
  const response = await http.request({
    method: "GET",
    path: `${prefix}/group-metadata/${groupId}`
  });
  return mapGroupInfo(response, groupId);
}
function mapGroupInfo(body, requestedGroupId) {
  const record = asRecord(body);
  return {
    id: (record ? asString(record.phone) : void 0) ?? requestedGroupId,
    subject: (record ? asString(record.subject) : void 0) ?? "",
    description: record ? asString(record.description) : void 0,
    owner: record ? asString(record.owner) : void 0,
    participants: (record ? asRecordArray(record.participants) : []).map(mapGroupParticipant),
    raw: body
  };
}
function mapGroupParticipant(record) {
  return {
    id: asString(record.phone) ?? "",
    isAdmin: asBoolean(record.isAdmin) ?? false,
    isSuperAdmin: asBoolean(record.isSuperAdmin) ?? false
  };
}
async function listGroups(http, prefix) {
  const response = await http.request({
    method: "GET",
    path: `${prefix}/groups`,
    query: { page: 1, pageSize: 100 }
  });
  return asRecordArray(response).map((item) => ({
    id: asString(item.phone) ?? "",
    subject: asString(item.name) ?? "",
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
async function updateGroupSubject(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/update-group-name`,
    body: { groupId: input.groupId, groupName: input.subject }
  });
}
async function updateGroupDescription(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/update-group-description`,
    body: { groupId: input.groupId, groupDescription: input.description }
  });
}
async function updateGroupPicture(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/update-group-photo`,
    body: { groupId: input.groupId, groupPhoto: resolveMediaValue(input.media) }
  });
}
async function getGroupInviteLink(http, prefix, groupId) {
  const response = await http.request({
    method: "GET",
    path: `${prefix}/group-invitation-link/${groupId}`
  });
  return mapGroupInviteLink(response);
}
async function revokeGroupInviteLink(http, prefix, groupId) {
  const response = await http.request({
    method: "POST",
    path: `${prefix}/redefine-invitation-link/${groupId}`
  });
  return mapGroupInviteLink(response);
}
function mapGroupInviteLink(body) {
  const record = asRecord(body);
  const invitationLink = (record ? asString(record.invitationLink) : void 0) ?? "";
  return { link: normalizeInviteLink(invitationLink), raw: body };
}
async function joinGroupViaInviteLink(http, prefix, input) {
  await http.request({
    method: "GET",
    path: `${prefix}/accept-invite-group`,
    query: { url: input.invite }
  });
}
async function leaveGroupCall(http, prefix, groupId) {
  await http.request({
    method: "POST",
    path: `${prefix}/leave-group`,
    body: { groupId }
  });
}
async function listContacts(http, prefix) {
  const response = await http.request({
    method: "GET",
    path: `${prefix}/contacts`,
    query: { page: 1, pageSize: 100 }
  });
  return asRecordArray(response).map(mapContactListItem);
}
function mapContactListItem(record) {
  const phone = asString(record.phone) ?? "";
  return {
    id: toZapiPhone(phone),
    name: asString(record.name) ?? asString(record.notify) ?? asString(record.short),
    raw: record
  };
}
async function fetchContactDetail(http, prefix, chatId) {
  const phone = toZapiPhone(chatId);
  return http.request({ method: "GET", path: `${prefix}/contacts/${phone}` });
}
async function getContact(http, prefix, chatId) {
  const response = await fetchContactDetail(http, prefix, chatId);
  return mapContact(response, chatId);
}
function mapContact(body, requestedChatId) {
  const record = asRecord(body);
  const responsePhone = record ? asString(record.phone) : void 0;
  return {
    id: responsePhone ? toZapiPhone(responsePhone) : requestedChatId,
    name: (record ? asString(record.name) : void 0) ?? (record ? asString(record.notify) : void 0),
    about: record ? asString(record.about) : void 0,
    profilePictureUrl: record ? asString(record.imgUrl) : void 0,
    raw: body
  };
}
async function checkContactExists(http, prefix, phone) {
  const zapiPhone = toZapiPhone(phone);
  const response = await http.request({
    method: "GET",
    path: `${prefix}/phone-exists/${zapiPhone}`
  });
  const items = asRecordArray(response);
  const item = items[0];
  if (!item) {
    return { exists: false, raw: response };
  }
  const resolvedId = asString(item.lid) ?? asString(item.phone);
  return {
    exists: asBoolean(item.exists) ?? false,
    chatId: resolvedId ? toZapiPhone(resolvedId) : void 0,
    raw: response
  };
}
async function getContactProfilePicture(http, prefix, chatId) {
  const phone = toZapiPhone(chatId);
  const response = await http.request({
    method: "GET",
    path: `${prefix}/profile-picture`,
    query: { phone }
  });
  const record = asRecord(response);
  return { url: record ? asString(record.link) : void 0, raw: response };
}
async function getContactAbout(http, prefix, chatId) {
  const response = await fetchContactDetail(http, prefix, chatId);
  const record = asRecord(response);
  return { about: record ? asString(record.about) : void 0, raw: response };
}
async function setContactBlocked(http, prefix, chatId, action) {
  const phone = toZapiPhone(chatId);
  await http.request({
    method: "POST",
    path: `${prefix}/contacts/modify-blocked`,
    body: { phone, action }
  });
}
async function blockContact(http, prefix, chatId) {
  await setContactBlocked(http, prefix, chatId, "block");
}
async function unblockContact(http, prefix, chatId) {
  await setContactBlocked(http, prefix, chatId, "unblock");
}
async function modifyChat(http, prefix, chatId, action) {
  const phone = toZapiPhone(chatId);
  await http.request({
    method: "POST",
    path: `${prefix}/modify-chat`,
    body: { phone, action }
  });
}
async function listLabels(http, prefix) {
  const body = await http.request({ method: "GET", path: `${prefix}/tags` });
  const items = Array.isArray(body) ? body : [];
  return items.map((item) => mapZapiLabel(item));
}
function mapZapiLabel(body) {
  const record = asRecord(body);
  const colorRaw = record?.color;
  const color = typeof colorRaw === "string" ? colorRaw : typeof colorRaw === "number" ? String(colorRaw) : void 0;
  return {
    id: (record ? asString(record.id) : void 0) ?? "",
    name: (record ? asString(record.name) : void 0) ?? "",
    color,
    raw: body
  };
}
async function createChannel(http, prefix, input) {
  const body = await http.request({
    method: "POST",
    path: `${prefix}/create-newsletter`,
    body: { name: input.name, description: input.description }
  });
  const record = asRecord(body);
  return {
    id: (record ? asString(record.id) : void 0) ?? "",
    name: input.name,
    description: input.description,
    raw: body
  };
}
async function makeCall(http, prefix, input) {
  await http.request({
    method: "POST",
    path: `${prefix}/send-call`,
    body: { phone: toZapiPhone(input.to), callDuration: input.durationSeconds }
  });
}
function parseWebhook(input) {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook Z-API: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe(input) {
  const body = input.body;
  const record = asRecord(body);
  if (!record) {
    return [unknownEvent(body, "Corpo do webhook Z-API n\xE3o \xE9 um objeto JSON.")];
  }
  const type = asString(record.type);
  if (!type) {
    return [unknownEvent(body, 'Payload de webhook Z-API sem campo "type".')];
  }
  const instanceId = asString(record.instanceId);
  switch (type) {
    case "ReceivedCallback": {
      const groupEvents = mapGroupNotification(record, body, instanceId);
      if (groupEvents) return groupEvents;
      const message = mapZapiMessage(record, body);
      return [
        {
          type: message.fromMe ? "message.sent" : "message.received",
          provider: PROVIDER,
          instanceId,
          message,
          raw: body
        }
      ];
    }
    case "DeliveryCallback": {
      const messageId = asString(record.messageId) ?? asString(record.zaapId) ?? "unknown";
      const errorText = asString(record.error);
      return [
        {
          type: "message.ack",
          provider: PROVIDER,
          instanceId,
          messageId,
          chatId: asString(record.phone),
          ack: errorText ? "error" : "sent",
          raw: body
        }
      ];
    }
    case "MessageStatusCallback": {
      const ids = asStringArray(record.ids);
      if (ids.length === 0) {
        return [
          unknownEvent(body, 'Evento "MessageStatusCallback" do Z-API sem "ids".', instanceId)
        ];
      }
      const chatId = asString(record.phone);
      const ack = mapZapiAckStatus(asString(record.status));
      return ids.map((messageId) => ({
        type: "message.ack",
        provider: PROVIDER,
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
          provider: PROVIDER,
          instanceId,
          state: "connected",
          raw: body
        }
      ];
    case "DisconnectedCallback":
      return [
        {
          type: "connection.update",
          provider: PROVIDER,
          instanceId,
          state: "disconnected",
          raw: body
        }
      ];
    default:
      return [unknownEvent(body, `Evento Z-API n\xE3o mapeado nesta fase: "${type}".`, instanceId)];
  }
}
function mapGroupNotification(record, rawBody, instanceId) {
  const action = mapGroupNotificationAction(asString(record.notification));
  if (!action) return void 0;
  return [
    {
      type: "group.update",
      provider: PROVIDER,
      instanceId,
      groupId: asString(record.phone) ?? "unknown",
      action,
      participants: asStringArray(record.notificationParameters),
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
  const fromMe = asBoolean(record.fromMe) ?? false;
  const content = mapMessageContent(record);
  const chatId = asString(record.phone) ?? "unknown";
  return {
    id: asString(record.messageId) ?? `zapi-unknown-${Date.now()}`,
    chatId,
    from: asString(record.participantPhone) ?? asString(record.phone),
    fromMe,
    timestamp: asNumber(record.momment) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media: content.media,
    raw: rawBody
  };
}
function mapMessageContent(record) {
  const text = asRecord(record.text);
  if (text) {
    return { kind: "text", text: asString(text.message) };
  }
  const image = asRecord(record.image);
  if (image) {
    return {
      kind: "image",
      text: asString(image.caption),
      media: buildMediaRef("image", image, "imageUrl")
    };
  }
  const video = asRecord(record.video);
  if (video) {
    return {
      kind: "video",
      text: asString(video.caption),
      media: buildMediaRef("video", video, "videoUrl")
    };
  }
  const audio = asRecord(record.audio);
  if (audio) {
    return { kind: "audio", media: buildMediaRef("audio", audio, "audioUrl") };
  }
  const document = asRecord(record.document);
  if (document) {
    return {
      kind: "document",
      text: asString(document.caption),
      media: buildMediaRef("document", document, "documentUrl")
    };
  }
  const sticker = asRecord(record.sticker);
  if (sticker) {
    return { kind: "sticker", media: buildMediaRef("sticker", sticker, "stickerUrl") };
  }
  return { kind: "unknown" };
}
function buildMediaRef(kind, record, urlField) {
  const url = asString(record[urlField]);
  if (!url) return void 0;
  return {
    kind,
    url,
    mimeType: asString(record.mimeType),
    filename: asString(record.fileName)
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
function unknownEvent(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER, instanceId, raw, reason };
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString(value) {
  return typeof value === "string" ? value : void 0;
}
function asNumber(value) {
  return typeof value === "number" ? value : void 0;
}
function asBoolean(value) {
  return typeof value === "boolean" ? value : void 0;
}
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function asRecordArray(value) {
  return Array.isArray(value) ? value.map((item) => asRecord(item)).filter((item) => item !== void 0) : [];
}

export { zapi };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map