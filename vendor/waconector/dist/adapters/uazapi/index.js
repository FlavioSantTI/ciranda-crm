import { HttpClient } from '../../chunk-SYMHJK3P.js';
import { normalizeInviteLink, isJid, digitsOnly } from '../../chunk-SWRBCMQ6.js';
import { WaConnectorError } from '../../chunk-JIDVFSO6.js';

// src/adapters/uazapi/index.ts
var PROVIDER = "uazapi";
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
    provider: PROVIDER,
    fetch: options.fetch
  });
  const instance = {
    connect: () => connectInstance(http),
    status: () => statusInstance(http),
    logout: () => logoutInstance(http)
  };
  const messages = {
    sendText: (input) => sendText(http, input),
    sendMedia: (input) => sendMedia(http, input),
    sendReaction: (input) => sendReaction(http, input),
    edit: (input) => editMessage(http, input),
    delete: (input) => deleteMessage(http, input),
    pin: (input) => setMessagePinned(http, input, true),
    unpin: (input) => setMessagePinned(http, input, false),
    markRead: (input) => markMessageRead(http, input),
    sendLocation: (input) => sendLocation(http, input),
    sendContactCard: (input) => sendContactCard(http, input),
    sendPoll: (input) => sendPoll(http, input),
    download: (input) => downloadMedia(http, input)
  };
  const chats = {
    archive: (chatId) => archiveChat(http, chatId),
    unarchive: (chatId) => unarchiveChat(http, chatId),
    mute: (chatId) => muteChat(http, chatId),
    unmute: (chatId) => unmuteChat(http, chatId),
    pin: (chatId) => pinChat(http, chatId),
    unpin: (chatId) => unpinChat(http, chatId),
    markRead: (chatId) => markChatRead(http, chatId),
    markUnread: (chatId) => markChatUnread(http, chatId)
  };
  const presence = {
    setTyping: (input) => setTyping(http, input),
    set: (state) => setPresence(http, state)
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
    getInviteLink: (groupId) => getGroupInviteLink(http, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink(http, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, input),
    leaveGroup: (groupId) => leaveGroup(http, groupId)
  };
  const contacts = {
    list: () => listContacts(http),
    get: (chatId) => getContact(http, chatId),
    checkExists: (phone) => checkContactExists(http, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, chatId),
    block: (chatId) => blockContact(http, chatId),
    unblock: (chatId) => unblockContact(http, chatId),
    listBlocked: () => listBlockedContacts(http)
    // `getAbout` deliberadamente NÃO implementado nem declarado em capabilities: busca exaustiva
    // nas ~132 rotas do OpenAPI bundled não achou nenhum campo/endpoint para o recado pessoal de
    // um contato na uazapi. Ver docs/providers/uazapi.md#contatos.
  };
  const labels = {
    list: () => listLabels(http),
    create: (input) => createLabel(http, input),
    update: (input) => updateLabel(http, input),
    delete: (labelId) => deleteLabel(http, labelId),
    addToChat: (input) => setChatLabel(http, input, "add"),
    removeFromChat: (input) => setChatLabel(http, input, "remove")
  };
  const channels = {
    list: () => listChannels(http),
    create: (input) => createChannel(http, input),
    getInfo: (channelId) => getChannelInfo(http, channelId),
    delete: (channelId) => deleteChannel(http, channelId),
    follow: (channelId) => setChannelFollowed(http, channelId, true),
    unfollow: (channelId) => setChannelFollowed(http, channelId, false),
    getMessages: (input) => getChannelMessages(http, input),
    markViewed: (input) => markChannelMessagesViewed(http, input),
    reactToPost: (input) => reactToChannelPost(http, input)
  };
  const business = {
    getProfile: () => getBusinessProfile(http),
    updateProfile: (input) => updateBusinessProfile(http, input)
  };
  const calls = {
    make: (input) => makeCall(http, input),
    reject: (input) => rejectCall(http, input)
  };
  return {
    provider: PROVIDER,
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
    parseWebhook: (input) => parseWebhook(input)
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
async function connectInstance(http) {
  const body = await http.request({ method: "POST", path: "/instance/connect", body: {} });
  return { qr: extractQr(body), raw: body };
}
async function statusInstance(http) {
  const body = await http.request({ method: "GET", path: "/instance/status" });
  const record = asRecord(body);
  const instanceRecord = record ? asRecord(record.instance) : void 0;
  const providerStatus = instanceRecord ? asString(instanceRecord.status) : void 0;
  const hasQr = instanceRecord !== void 0 && hasNonEmptyQr(instanceRecord);
  return { state: mapInstanceState(providerStatus, hasQr), raw: body };
}
async function logoutInstance(http) {
  await http.request({ method: "POST", path: "/instance/disconnect" });
}
function extractQr(body) {
  const record = asRecord(body);
  if (!record) return void 0;
  const instanceRecord = asRecord(record.instance);
  return (instanceRecord ? asString(instanceRecord.qrcode) : void 0) ?? asString(record.qrcode);
}
function hasNonEmptyQr(instanceRecord) {
  const qr = asString(instanceRecord.qrcode);
  return qr !== void 0 && qr.length > 0;
}
function mapInstanceState(status, hasQr) {
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
async function sendText(http, input) {
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
async function sendMedia(http, input) {
  const number = toUazapiNumber(input.to);
  const file = input.media.url ?? input.media.base64;
  if (!file) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'uazapi: sendMedia exige "media.url" ou "media.base64".',
      { provider: PROVIDER }
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
async function sendReaction(http, input) {
  const number = toUazapiNumber(input.to);
  const body = { number, text: input.emoji, id: input.messageId };
  const response = await http.request({ method: "POST", path: "/message/react", body });
  return mapSentMessage(response, number);
}
function mapSentMessage(body, requestedNumber) {
  const record = asRecord(body);
  const id = (record ? asString(record.messageid) ?? asString(record.id) : void 0) ?? `uazapi-${Date.now()}`;
  const chatId = (record ? asString(record.chatid) : void 0) ?? requestedNumber;
  const timestamp = record ? asNumber(record.messageTimestamp) : void 0;
  return { id, chatId, timestamp, raw: body };
}
async function editMessage(http, input) {
  const body = { id: input.messageId, text: input.text };
  const response = await http.request({ method: "POST", path: "/message/edit", body });
  return mapSentMessage(response, toUazapiNumber(input.to));
}
async function deleteMessage(http, input) {
  await http.request({ method: "POST", path: "/message/delete", body: { id: input.messageId } });
}
async function setMessagePinned(http, input, pin) {
  await http.request({ method: "POST", path: "/message/pin", body: { id: input.messageId, pin } });
}
async function markMessageRead(http, input) {
  await http.request({
    method: "POST",
    path: "/message/markread",
    body: { id: [input.messageId] }
  });
}
async function sendLocation(http, input) {
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
async function sendContactCard(http, input) {
  const number = toUazapiNumber(input.to);
  const response = await http.request({
    method: "POST",
    path: "/send/contact",
    body: { number, fullName: input.contactName, phoneNumber: input.contactPhone }
  });
  return mapSentMessage(response, number);
}
async function sendPoll(http, input) {
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
async function downloadMedia(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/message/download",
    body: { id: input.messageId, return_base64: true }
  });
  const record = asRecord(body);
  return {
    base64: (record ? asString(record.base64Data) : void 0) ?? "",
    mimeType: record ? asString(record.mimetype) : void 0,
    raw: body
  };
}
async function createGroup(http, input) {
  const body = {
    name: input.subject,
    participants: input.participants.map(toCreateGroupParticipant)
  };
  const response = await http.request({ method: "POST", path: "/group/create", body });
  return mapGroupInfo(response, { subject: input.subject, participants: input.participants });
}
async function getGroupInfo(http, groupId) {
  const response = await requestGroupInfo(http, groupId);
  return mapGroupInfo(response, { id: groupId });
}
async function requestGroupInfo(http, groupId, extra) {
  const groupjid = toUazapiGroupJid(groupId);
  return http.request({
    method: "POST",
    path: "/group/info",
    body: { groupjid, ...extra }
  });
}
async function getGroupInviteLink(http, groupId) {
  const response = await requestGroupInfo(http, groupId, { getInviteLink: true });
  const record = asRecord(response);
  const link = (record ? asString(record.invite_link) : void 0) ?? "";
  return { link: normalizeInviteLink(link), raw: response };
}
async function revokeGroupInviteLink(http, groupId) {
  const groupjid = toUazapiGroupJid(groupId);
  const response = await http.request({
    method: "POST",
    path: "/group/resetInviteCode",
    body: { groupjid }
  });
  const record = asRecord(response);
  const link = (record ? asString(record.InviteLink) : void 0) ?? "";
  return { link: normalizeInviteLink(link), raw: response };
}
async function joinGroupViaInviteLink(http, input) {
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
async function listGroups(http) {
  const response = await http.request({ method: "GET", path: "/group/list" });
  const record = asRecord(response);
  const groups = record?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => mapGroupInfo(group));
}
async function updateGroupParticipants(http, input, action) {
  const body = {
    groupjid: toUazapiGroupJid(input.groupId),
    action,
    participants: input.participants.map(toUazapiNumber)
  };
  await http.request({ method: "POST", path: "/group/updateParticipants", body });
}
async function updateGroupSubject(http, input) {
  const body = { groupjid: toUazapiGroupJid(input.groupId), name: input.subject };
  await http.request({ method: "POST", path: "/group/updateName", body });
}
async function updateGroupDescription(http, input) {
  const body = { groupjid: toUazapiGroupJid(input.groupId), description: input.description };
  await http.request({ method: "POST", path: "/group/updateDescription", body });
}
async function updateGroupPicture(http, input) {
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
function mapGroupInfo(body, fallback = {}) {
  const record = asRecord(body);
  const id = (record ? asString(record.JID) : void 0) ?? fallback.id ?? "";
  const subject = (record ? asString(record.Name) : void 0) ?? fallback.subject ?? "";
  const description = record ? asString(record.Topic) : void 0;
  const owner = record ? asString(record.OwnerJID) ?? asString(record.OwnerPN) : void 0;
  const participantsRaw = record?.Participants;
  const participants = Array.isArray(participantsRaw) ? participantsRaw.map(mapGroupParticipant) : (fallback.participants ?? []).map(toFallbackParticipant);
  return { id, subject, description, owner, participants, raw: body };
}
function mapGroupParticipant(value) {
  const record = asRecord(value);
  return {
    id: (record ? asString(record.JID) : void 0) ?? "unknown",
    isAdmin: (record ? asBoolean(record.IsAdmin) : void 0) ?? false,
    isSuperAdmin: (record ? asBoolean(record.IsSuperAdmin) : void 0) ?? false
  };
}
function toFallbackParticipant(id) {
  return { id, isAdmin: false, isSuperAdmin: false };
}
async function listContacts(http) {
  const response = await http.request({
    method: "GET",
    path: "/contacts",
    query: { contactScope: "all" }
  });
  if (!Array.isArray(response)) return [];
  return response.map(mapContactListItem);
}
function mapContactListItem(value) {
  const record = asRecord(value);
  const id = (record ? asString(record.jid) : void 0) ?? "";
  const name = record ? asString(record.contact_name) ?? asString(record.contact_FirstName) : void 0;
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
  const record = asRecord(body);
  const id = (record ? asString(record.wa_chatid) : void 0) ?? requestedChatId;
  const name = record ? asString(record.wa_contactName) ?? asString(record.wa_name) ?? asString(record.name) : void 0;
  const isBlocked = record ? asBoolean(record.wa_isBlocked) : void 0;
  const profilePictureUrl = record ? asString(record.image) : void 0;
  return { id, name, isBlocked, profilePictureUrl, raw: body };
}
async function getContact(http, chatId) {
  const response = await requestChatDetails(http, chatId);
  return mapContactFromChatDetails(response, chatId);
}
async function getContactProfilePicture(http, chatId) {
  const response = await requestChatDetails(http, chatId);
  const record = asRecord(response);
  return { url: record ? asString(record.image) : void 0, raw: response };
}
async function checkContactExists(http, phone) {
  const number = toUazapiNumber(phone);
  const response = await http.request({
    method: "POST",
    path: "/chat/check",
    body: { numbers: [number] }
  });
  return mapCheckExistsResult(response);
}
function mapCheckExistsResult(body) {
  const first = Array.isArray(body) ? asRecord(body[0]) : void 0;
  const exists = (first ? asBoolean(first.isInWhatsapp) : void 0) ?? false;
  const chatId = first ? asString(first.jid) : void 0;
  return { exists, chatId, raw: body };
}
async function setContactBlocked(http, chatId, block) {
  const number = toUazapiNumber(chatId);
  await http.request({ method: "POST", path: "/chat/block", body: { number, block } });
}
async function blockContact(http, chatId) {
  await setContactBlocked(http, chatId, true);
}
async function unblockContact(http, chatId) {
  await setContactBlocked(http, chatId, false);
}
async function listBlockedContacts(http) {
  const response = await http.request({ method: "GET", path: "/chat/blocklist" });
  const record = asRecord(response);
  const blockList = record?.blockList;
  if (!Array.isArray(blockList)) return [];
  return blockList.map(asString).filter((id) => id !== void 0);
}
async function setChatArchived(http, chatId, archive) {
  const number = toUazapiNumber(chatId);
  await http.request({ method: "POST", path: "/chat/archive", body: { number, archive } });
}
async function archiveChat(http, chatId) {
  await setChatArchived(http, chatId, true);
}
async function unarchiveChat(http, chatId) {
  await setChatArchived(http, chatId, false);
}
async function setChatMuted(http, chatId, muted) {
  const number = toUazapiNumber(chatId);
  const muteEndTime = muted ? -1 : 0;
  await http.request({ method: "POST", path: "/chat/mute", body: { number, muteEndTime } });
}
async function muteChat(http, chatId) {
  await setChatMuted(http, chatId, true);
}
async function unmuteChat(http, chatId) {
  await setChatMuted(http, chatId, false);
}
async function setChatPinned(http, chatId, pin) {
  const number = toUazapiNumber(chatId);
  await http.request({ method: "POST", path: "/chat/pin", body: { number, pin } });
}
async function pinChat(http, chatId) {
  await setChatPinned(http, chatId, true);
}
async function unpinChat(http, chatId) {
  await setChatPinned(http, chatId, false);
}
async function setChatRead(http, chatId, read) {
  const number = toUazapiNumber(chatId);
  await http.request({ method: "POST", path: "/chat/read", body: { number, read } });
}
async function markChatRead(http, chatId) {
  await setChatRead(http, chatId, true);
}
async function markChatUnread(http, chatId) {
  await setChatRead(http, chatId, false);
}
async function setTyping(http, input) {
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
async function listLabels(http) {
  const body = await http.request({ method: "GET", path: "/labels" });
  const items = Array.isArray(body) ? body : [];
  return items.map((item) => mapUazapiLabel(item));
}
async function editLabel(http, labelId, name, color, deleted) {
  await http.request({
    method: "POST",
    path: "/label/edit",
    body: { labelid: labelId, name, color: toUazapiLabelColor(color), delete: deleted }
  });
}
async function createLabel(http, input) {
  const before = new Set((await listLabels(http)).map((label) => label.id));
  await editLabel(http, "new", input.name, input.color, false);
  const after = await listLabels(http);
  const created = after.find((label) => !before.has(label.id));
  if (!created) {
    throw new WaConnectorError(
      "PROVIDER_ERROR",
      'uazapi: n\xE3o foi poss\xEDvel determinar o labelid criado por /label/edit (labelid:"new") \u2014 GET /labels n\xE3o trouxe nenhum id novo em rela\xE7\xE3o \xE0 listagem anterior.',
      { provider: PROVIDER }
    );
  }
  return created;
}
async function updateLabel(http, input) {
  await editLabel(http, input.labelId, input.name, input.color, false);
}
async function deleteLabel(http, labelId) {
  await http.request({
    method: "POST",
    path: "/label/edit",
    body: { labelid: labelId, delete: true }
  });
}
async function setChatLabel(http, input, direction) {
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
  const record = asRecord(body);
  const id = (record ? asString(record.labelid) : void 0) ?? (record ? asString(record.id) : void 0);
  const color = record ? asNumber(record.color) : void 0;
  return {
    id: id ?? "",
    name: (record ? asString(record.name) : void 0) ?? "",
    color: color === void 0 ? void 0 : String(color),
    raw: body
  };
}
async function listChannels(http) {
  const body = await http.request({ method: "GET", path: "/newsletter/list" });
  const record = asRecord(body);
  const items = record && Array.isArray(record.response) ? record.response : [];
  return items.map((item) => mapUazapiChannel(item));
}
async function createChannel(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/newsletter/create",
    body: { name: input.name, description: input.description }
  });
  const record = asRecord(body);
  const data = record ? asRecord(record.response) : void 0;
  return mapUazapiChannel(data ?? body, input);
}
async function getChannelInfo(http, channelId) {
  const body = await http.request({
    method: "POST",
    path: "/newsletter/info",
    body: { jid: channelId }
  });
  const record = asRecord(body);
  const data = record ? asRecord(record.response) : void 0;
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
  const record = asRecord(body);
  const id = (record ? asString(record.id) : void 0) ?? "";
  const threadMeta = record ? asRecord(record.thread_metadata) : void 0;
  const nameObj = threadMeta ? asRecord(threadMeta.name) : void 0;
  const descriptionObj = threadMeta ? asRecord(threadMeta.description) : void 0;
  const name = (nameObj ? asString(nameObj.text) : void 0) ?? (record ? asString(record.name) : void 0) ?? fallback.name ?? "";
  const description = (descriptionObj ? asString(descriptionObj.text) : void 0) ?? (record ? asString(record.description) : void 0) ?? fallback.description;
  const subscribersCountText = threadMeta ? asString(threadMeta.subscribers_count) : void 0;
  const subscribersCount = subscribersCountText !== void 0 ? Number(subscribersCountText) : record ? asNumber(record.subscribersCount) : void 0;
  return { id, name, description, subscribersCount, raw: body };
}
async function getChannelMessages(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/newsletter/messages",
    body: {
      jid: input.channelId,
      count: input.count,
      ...input.before !== void 0 ? { beforeid: Number(input.before) } : {}
    }
  });
  const record = asRecord(body);
  const items = record && Array.isArray(record.response) ? record.response : [];
  return items.map((item) => mapUazapiChannelPost(item));
}
function mapUazapiChannelPost(body) {
  const record = asRecord(body);
  const serverId = record ? asNumber(record.serverid) : void 0;
  const timestampRaw = record ? asString(record.timestamp) : void 0;
  const timestamp = timestampRaw !== void 0 ? new Date(timestampRaw).getTime() : 0;
  const reactionCountsRaw = record ? asRecord(record.reactionCounts) : void 0;
  const reactionCounts = reactionCountsRaw ? Object.fromEntries(
    Object.entries(reactionCountsRaw).map(([emoji, count]) => [emoji, asNumber(count)]).filter((entry) => entry[1] !== void 0)
  ) : void 0;
  return {
    id: serverId !== void 0 ? String(serverId) : "",
    timestamp,
    text: extractUazapiChannelPostText(record?.message),
    viewsCount: record ? asNumber(record.viewsCount) : void 0,
    reactionCounts,
    raw: body
  };
}
function extractUazapiChannelPostText(message) {
  const record = asRecord(message);
  if (!record) return void 0;
  const conversation = asString(record.conversation);
  if (conversation !== void 0) return conversation;
  const extendedText = asRecord(record.extendedTextMessage);
  return extendedText ? asString(extendedText.text) : void 0;
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
  const record = asRecord(body);
  const data = record ? asRecord(record.response) : void 0;
  return mapUazapiBusinessProfile(data ?? body);
}
async function updateBusinessProfile(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/business/update/profile",
    body: { description: input.description, address: input.address, email: input.email }
  });
  const record = asRecord(body);
  const scope = (record ? asRecord(record.response) : void 0) ?? record;
  if (scope && hasUazapiPartialFailure(scope)) {
    throw new WaConnectorError(
      "PROVIDER_ERROR",
      "uazapi: business.updateProfile retornou sucesso parcial (207 Multi-Status) \u2014 ao menos 1 campo falhou; verifique o corpo bruto da resposta para o detalhe por campo.",
      { provider: PROVIDER }
    );
  }
}
function hasUazapiPartialFailure(scope) {
  return Object.values(scope).some((value) => {
    const fieldRecord = asRecord(value);
    return fieldRecord !== void 0 && fieldRecord.error !== void 0 && fieldRecord.error !== null;
  });
}
function mapUazapiBusinessProfile(body) {
  const record = asRecord(body);
  const categoriesRaw = record && Array.isArray(record.categories) ? record.categories : [];
  const categories = categoriesRaw.map((item) => asRecord(item)).map((item) => item ? asString(item.localized_display_name) : void 0).filter((name) => name !== void 0);
  const websitesRaw = record && Array.isArray(record.websites) ? record.websites : [];
  const websites = websitesRaw.filter((item) => typeof item === "string");
  return {
    description: record ? asString(record.description) : void 0,
    address: record ? asString(record.address) : void 0,
    email: record ? asString(record.email) : void 0,
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
async function rejectCall(http, input) {
  await http.request({
    method: "POST",
    path: "/call/reject",
    body: { number: input.callerId, id: input.callId }
  });
}
function parseWebhook(input) {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook uazapi: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe(input) {
  const body = input.body;
  const envelope = asRecord(body);
  if (!envelope) {
    return [unknownEvent(body, "Corpo do webhook uazapi n\xE3o \xE9 um objeto JSON.")];
  }
  const eventNameRaw = asString(envelope.event) ?? asString(envelope.EventType);
  if (!eventNameRaw) {
    return [unknownEvent(body, 'Payload de webhook uazapi sem campo "event"/"EventType".')];
  }
  const instanceId = asString(envelope.instance);
  const data = asRecord(envelope.data);
  const eventName = eventNameRaw.toLowerCase();
  if (eventName === "message" || eventName === "messages") {
    if (!data) {
      return [
        unknownEvent(body, `Evento "${eventNameRaw}" do uazapi sem campo "data".`, instanceId)
      ];
    }
    const message = mapUazapiMessage(data, body);
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
  if (eventName === "status" || eventName === "messages_update" || eventName === "message.ack") {
    if (!data) {
      return [
        unknownEvent(body, `Evento "${eventNameRaw}" do uazapi sem campo "data".`, instanceId)
      ];
    }
    return [
      {
        type: "message.ack",
        provider: PROVIDER,
        instanceId,
        messageId: asString(data.messageid) ?? asString(data.id) ?? "unknown",
        chatId: asString(data.chatid),
        ack: mapUazapiAck(asString(data.status)),
        raw: body
      }
    ];
  }
  if (eventName === "connection" || eventName === "connection.update") {
    if (!data) {
      return [
        unknownEvent(body, `Evento "${eventNameRaw}" do uazapi sem campo "data".`, instanceId)
      ];
    }
    const instanceRecord = asRecord(data.instance);
    const providerStatus = instanceRecord ? asString(instanceRecord.status) : void 0;
    const hasQr = instanceRecord !== void 0 && hasNonEmptyQr(instanceRecord);
    const connectionUpdate = {
      type: "connection.update",
      provider: PROVIDER,
      instanceId,
      state: mapInstanceState(providerStatus, hasQr),
      qr: instanceRecord ? asString(instanceRecord.qrcode) : void 0,
      raw: body
    };
    return [connectionUpdate];
  }
  return [
    unknownEvent(body, `Evento uazapi n\xE3o mapeado nesta fase: "${eventNameRaw}".`, instanceId)
  ];
}
function mapMessageKind(messageType) {
  if (messageType === "conversation" || messageType === "text") return "text";
  return "unknown";
}
function mapUazapiMessage(data, rawBody) {
  const fromMe = asBoolean(data.fromMe) ?? false;
  const timestamp = asNumber(data.messageTimestamp) ?? Date.now();
  return {
    id: asString(data.messageid) ?? asString(data.id) ?? `uazapi-unknown-${Date.now()}`,
    chatId: asString(data.chatid) ?? "unknown",
    from: asString(data.sender),
    fromMe,
    timestamp,
    kind: mapMessageKind(asString(data.messageType)),
    text: asString(data.text),
    quotedId: asString(data.quoted),
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

export { uazapi };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map