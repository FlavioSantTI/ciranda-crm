import { HttpClient } from '../../chunk-SYMHJK3P.js';
import { extractInviteCode, normalizeInviteLink } from '../../chunk-SWRBCMQ6.js';
import { isWaConnectorError, WaConnectorError } from '../../chunk-JIDVFSO6.js';

// src/adapters/whapi/index.ts
var PROVIDER = "whapi";
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
    forward: (input) => forwardMessage(http, input),
    star: (input) => setMessageStarred(http, input, true),
    unstar: (input) => setMessageStarred(http, input, false),
    pin: (input) => setMessagePinned(http, input, true),
    unpin: (input) => setMessagePinned(http, input, false),
    markRead: (input) => markMessageRead(http, input),
    sendLocation: (input) => sendLocation(http, input),
    sendContactCard: (input) => sendContactCard(http, input),
    sendPoll: (input) => sendPoll(http, input),
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
    getInviteLink: (groupId) => getGroupInviteLink(http, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink(http, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, input),
    leaveGroup: (groupId) => leaveGroupCall(http, groupId)
  };
  const contacts = {
    list: () => listContacts(http),
    get: (chatId) => getContact(http, chatId),
    checkExists: (chatId) => checkContactExists(http, chatId),
    getProfilePicture: (chatId) => getContactProfilePicture(http, chatId),
    getAbout: (chatId) => getContactAbout(http, chatId),
    block: (chatId) => blockContact(http, chatId),
    unblock: (chatId) => unblockContact(http, chatId),
    listBlocked: () => listBlockedContacts(http)
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
    set: (state) => setPresence(http, state),
    subscribe: (chatId) => subscribePresence(http, chatId)
  };
  const labels = {
    list: () => listLabels(http),
    create: (input) => createLabel(http, input),
    update: (input) => renameLabel(http, input),
    delete: (labelId) => deleteLabel(http, labelId),
    addToChat: (input) => setLabelAssociation(http, input, true),
    removeFromChat: (input) => setLabelAssociation(http, input, false)
  };
  const channels = {
    list: () => listChannels(http),
    create: (input) => createChannel(http, input),
    getInfo: (channelId) => getChannelInfo(http, channelId),
    delete: (channelId) => deleteChannel(http, channelId),
    follow: (channelId) => setChannelSubscribed(http, channelId, true),
    unfollow: (channelId) => setChannelSubscribed(http, channelId, false),
    getMessages: (input) => getChannelMessages(http, input)
  };
  const business = {
    getProfile: () => getBusinessProfile(http),
    updateProfile: (input) => updateBusinessProfile(http, input)
  };
  const calls = {
    reject: (input) => rejectCall(http, input)
  };
  return {
    provider: PROVIDER,
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
    parseWebhook: (input) => parseWebhook(input)
  };
}
function toWhapiChatId(chatId) {
  return chatId;
}
async function connectInstance(http) {
  const body = await http.request({
    method: "GET",
    path: "/users/login",
    query: { wakeup: true }
  });
  return { qr: extractQr(body), raw: body };
}
function extractQr(body) {
  const record = asRecord(body);
  return record ? asString(record.base64) : void 0;
}
async function statusInstance(http) {
  const body = await http.request({
    method: "GET",
    path: "/health",
    query: { wakeup: false }
  });
  return { state: mapInstanceState(body), raw: body };
}
function mapInstanceState(body) {
  const record = asRecord(body);
  const status = record ? asRecord(record.status) : void 0;
  const text = status ? asString(status.text) : void 0;
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
async function logoutInstance(http) {
  await http.request({ method: "POST", path: "/users/logout" });
}
async function sendText(http, input) {
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
  return mapSentMessage(response, to);
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
    { provider: PROVIDER }
  );
}
async function sendMedia(http, input) {
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
  return mapSentMessage(response, to);
}
function mapSentMessage(body, requestedTo) {
  const record = asRecord(body);
  const message = record ? asRecord(record.message) : void 0;
  const id = (message ? asString(message.id) : void 0) ?? `whapi-${Date.now()}`;
  const chatId = (message ? asString(message.chat_id) : void 0) ?? requestedTo;
  const timestamp = message ? toEpochMs(message.timestamp) : void 0;
  return { id, chatId, timestamp, raw: body };
}
async function sendReaction(http, input) {
  const to = toWhapiChatId(input.to);
  const path = `/messages/${encodeURIComponent(input.messageId)}/reaction`;
  const response = input.emoji === "" ? await http.request({ method: "DELETE", path }) : await http.request({ method: "PUT", path, body: { emoji: input.emoji } });
  return { id: input.messageId, chatId: to, raw: response };
}
async function editMessage(http, input) {
  const to = toWhapiChatId(input.to);
  const body = { to, body: input.text, edit: input.messageId };
  const response = await http.request({
    method: "POST",
    path: "/messages/text",
    body
  });
  return mapSentMessage(response, to);
}
async function deleteMessage(http, input) {
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
  return mapSentMessage(response, to);
}
async function setMessageStarred(http, input, starred) {
  await http.request({
    method: "PUT",
    path: `/messages/${encodeURIComponent(input.messageId)}/star`,
    body: { starred }
  });
}
async function setMessagePinned(http, input, pinned) {
  const path = `/messages/${encodeURIComponent(input.messageId)}/pin`;
  if (pinned) {
    await http.request({ method: "POST", path, body: { time: "day" } });
    return;
  }
  await http.request({ method: "DELETE", path });
}
async function markMessageRead(http, input) {
  await http.request({
    method: "PUT",
    path: `/messages/${encodeURIComponent(input.messageId)}`
  });
}
async function sendLocation(http, input) {
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
  return mapSentMessage(response, to);
}
async function sendContactCard(http, input) {
  const to = toWhapiChatId(input.to);
  const response = await http.request({
    method: "POST",
    path: "/messages/contact",
    body: { to, name: input.contactName, vcard: buildVcard(input.contactName, input.contactPhone) }
  });
  return mapSentMessage(response, to);
}
function buildVcard(name, phone) {
  return `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}
END:VCARD`;
}
async function sendPoll(http, input) {
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
  return mapSentMessage(response, to);
}
async function downloadMedia(http, input) {
  const mediaId = extractWhapiMediaId(input) ?? input.messageId;
  const base64 = await http.request({
    method: "GET",
    path: `/media/${encodeURIComponent(mediaId)}`,
    responseType: "base64"
  });
  return { base64, raw: { mediaId } };
}
function extractWhapiMediaId(input) {
  const rawRecord = asRecord(input.raw);
  const items = rawRecord ? asRecordArray(rawRecord.messages) : [];
  const item = items.find((candidate) => asString(candidate.id) === input.messageId);
  if (!item) return void 0;
  const type = asString(item.type);
  const mediaObject = type ? asRecord(item[type]) : void 0;
  return mediaObject ? asString(mediaObject.id) : void 0;
}
function groupPath(groupId, suffix = "") {
  return `/groups/${encodeURIComponent(groupId)}${suffix}`;
}
async function createGroup(http, input) {
  const response = await http.request({
    method: "POST",
    path: "/groups",
    body: { subject: input.subject, participants: input.participants }
  });
  return mapGroupInfo(response);
}
async function getGroupInfo(http, groupId) {
  const response = await http.request({ method: "GET", path: groupPath(groupId) });
  return mapGroupInfo(response, groupId);
}
async function listGroups(http) {
  const response = await http.request({ method: "GET", path: "/groups" });
  const record = asRecord(response);
  return asRecordArray(record?.groups).map((item) => mapGroupInfo(item));
}
var PARTICIPANT_ENDPOINTS = {
  add: { method: "POST", suffix: "/participants" },
  remove: { method: "DELETE", suffix: "/participants" },
  promote: { method: "PATCH", suffix: "/admins" },
  demote: { method: "DELETE", suffix: "/admins" }
};
async function updateGroupParticipants(http, input, action) {
  const endpoint = PARTICIPANT_ENDPOINTS[action];
  await http.request({
    method: endpoint.method,
    path: groupPath(input.groupId, endpoint.suffix),
    body: { participants: input.participants }
  });
}
async function updateGroupSubject(http, input) {
  await http.request({
    method: "PUT",
    path: groupPath(input.groupId),
    body: { subject: input.subject }
  });
}
async function updateGroupDescription(http, input) {
  await http.request({
    method: "PUT",
    path: groupPath(input.groupId),
    body: { description: input.description }
  });
}
async function updateGroupPicture(http, input) {
  await http.request({
    method: "PUT",
    path: groupPath(input.groupId, "/icon"),
    body: { media: resolveMediaValue(input.media) }
  });
}
async function getGroupInviteLink(http, groupId) {
  const response = await http.request({
    method: "GET",
    path: groupPath(groupId, "/invite")
  });
  const record = asRecord(response);
  const code = record ? asString(record.invite_code) : void 0;
  return { link: normalizeInviteLink(code ?? ""), raw: response };
}
async function revokeGroupInviteLink(http, groupId) {
  await http.request({ method: "DELETE", path: groupPath(groupId, "/invite") });
  return getGroupInviteLink(http, groupId);
}
async function joinGroupViaInviteLink(http, input) {
  await http.request({
    method: "PUT",
    path: "/groups",
    body: { invite_code: extractInviteCode(input.invite) }
  });
}
async function leaveGroupCall(http, groupId) {
  await http.request({ method: "DELETE", path: groupPath(groupId) });
}
function mapGroupInfo(body, fallbackId) {
  const record = asRecord(body);
  const participants = asRecordArray(record?.participants).map(mapGroupParticipant);
  return {
    id: (record ? asString(record.id) : void 0) ?? fallbackId ?? "",
    subject: (record ? asString(record.name) : void 0) ?? "",
    description: record ? asString(record.description) : void 0,
    owner: record ? asString(record.created_by) : void 0,
    participants,
    raw: body
  };
}
function mapGroupParticipant(record) {
  const rank = asString(record.rank);
  return {
    id: asString(record.id) ?? "",
    isAdmin: rank === "admin" || rank === "creator",
    isSuperAdmin: rank === "creator"
  };
}
async function listContacts(http) {
  const response = await http.request({ method: "GET", path: "/contacts" });
  const record = asRecord(response);
  return asRecordArray(record?.contacts).map(mapContact);
}
async function getContact(http, chatId) {
  const response = await http.request({
    method: "GET",
    path: `/contacts/${encodeURIComponent(toWhapiChatId(chatId))}`
  });
  return mapContact(response);
}
function mapContact(body) {
  const record = asRecord(body);
  const name = record ? asString(record.name) ?? asString(record.pushname) : void 0;
  const profilePictureUrl = record ? asString(record.profile_pic_full) ?? asString(record.profile_pic) : void 0;
  return {
    id: (record ? asString(record.id) : void 0) ?? "",
    name,
    profilePictureUrl,
    raw: body
  };
}
async function checkContactExists(http, chatId) {
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
async function getContactProfilePicture(http, chatId) {
  const response = await http.request({
    method: "GET",
    path: `/contacts/${encodeURIComponent(toWhapiChatId(chatId))}/profile`
  });
  const record = asRecord(response);
  const url = record ? asString(record.icon_full) ?? asString(record.icon) : void 0;
  return { url, raw: response };
}
async function getContactAbout(http, chatId) {
  const response = await http.request({
    method: "GET",
    path: `/contacts/${encodeURIComponent(toWhapiChatId(chatId))}/about`
  });
  const record = asRecord(response);
  return { about: record ? asString(record.about) : void 0, raw: response };
}
var WHATSAPP_JID_SUFFIX = "@s.whatsapp.net";
function toWhapiBlacklistId(chatId) {
  return chatId.endsWith(WHATSAPP_JID_SUFFIX) ? chatId.slice(0, chatId.length - WHATSAPP_JID_SUFFIX.length) : chatId;
}
async function blockContact(http, chatId) {
  await http.request({
    method: "PUT",
    path: `/blacklist/${encodeURIComponent(toWhapiBlacklistId(chatId))}`
  });
}
async function unblockContact(http, chatId) {
  await http.request({
    method: "DELETE",
    path: `/blacklist/${encodeURIComponent(toWhapiBlacklistId(chatId))}`
  });
}
async function listBlockedContacts(http) {
  const response = await http.request({ method: "GET", path: "/blacklist" });
  return asStringArray(response);
}
function chatPath(chatId) {
  return `/chats/${encodeURIComponent(toWhapiChatId(chatId))}`;
}
async function setChatArchived(http, chatId, archive) {
  await http.request({ method: "POST", path: chatPath(chatId), body: { archive } });
}
async function archiveChat(http, chatId) {
  await setChatArchived(http, chatId, true);
}
async function unarchiveChat(http, chatId) {
  await setChatArchived(http, chatId, false);
}
async function patchChat(http, chatId, body) {
  await http.request({ method: "PATCH", path: chatPath(chatId), body });
}
async function pinChat(http, chatId) {
  await patchChat(http, chatId, { pin: true });
}
async function unpinChat(http, chatId) {
  await patchChat(http, chatId, { pin: false });
}
async function markChatRead(http, chatId) {
  await patchChat(http, chatId, { mark_unread: false });
}
async function markChatUnread(http, chatId) {
  await patchChat(http, chatId, { mark_unread: true });
}
var WHAPI_MUTE_FOREVER_MS = Date.UTC(2099, 0, 1);
async function muteChat(http, chatId) {
  await patchChat(http, chatId, { mute_until: WHAPI_MUTE_FOREVER_MS });
}
async function unmuteChat(http, chatId) {
  await patchChat(http, chatId, { mute_until: 0 });
}
async function setTyping(http, input) {
  await http.request({
    method: "PUT",
    path: `/presences/${encodeURIComponent(toWhapiChatId(input.to))}`,
    body: { presence: input.state === "paused" ? "pause" : input.state }
  });
}
async function setPresence(http, state) {
  await http.request({ method: "PUT", path: "/presences/me", body: { presence: state } });
}
async function subscribePresence(http, chatId) {
  await http.request({
    method: "POST",
    path: `/presences/${encodeURIComponent(toWhapiChatId(chatId))}`
  });
}
var WHAPI_DEFAULT_LABEL_COLOR = "salmon";
async function listLabels(http) {
  const body = await http.request({ method: "GET", path: "/labels" });
  const items = Array.isArray(body) ? body : [];
  return items.map((item) => mapWhapiLabel(item));
}
async function createLabel(http, input) {
  const existing = await listLabels(http);
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
      { provider: PROVIDER }
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
async function deleteLabel(http, labelId) {
  await http.request({ method: "DELETE", path: `/labels/${encodeURIComponent(labelId)}` });
}
async function setLabelAssociation(http, input, add) {
  await http.request({
    method: add ? "POST" : "DELETE",
    path: `/labels/${encodeURIComponent(input.labelId)}/${encodeURIComponent(toWhapiChatId(input.chatId))}`
  });
}
function mapWhapiLabel(body) {
  const record = asRecord(body);
  return {
    id: (record ? asString(record.id) : void 0) ?? "",
    name: (record ? asString(record.name) : void 0) ?? "",
    color: record ? asString(record.color) : void 0,
    raw: body
  };
}
async function listChannels(http) {
  const body = await http.request({ method: "GET", path: "/newsletters" });
  const record = asRecord(body);
  const items = record && Array.isArray(record.newsletters) ? record.newsletters : [];
  return items.map((item) => mapWhapiChannel(item));
}
async function createChannel(http, input) {
  const body = await http.request({
    method: "POST",
    path: "/newsletters",
    body: { name: input.name, description: input.description }
  });
  return mapWhapiChannel(body, input);
}
async function getChannelInfo(http, channelId) {
  const body = await http.request({
    method: "GET",
    path: `/newsletters/${encodeURIComponent(channelId)}`
  });
  return mapWhapiChannel(body, {});
}
async function deleteChannel(http, channelId) {
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
  const record = asRecord(body);
  return {
    id: (record ? asString(record.id) : void 0) ?? "",
    name: (record ? asString(record.name) : void 0) ?? fallback.name ?? "",
    description: (record ? asString(record.description) : void 0) ?? fallback.description,
    subscribersCount: record ? asNumber(record.subscribers_count) : void 0,
    raw: body
  };
}
async function getChannelMessages(http, input) {
  const body = await http.request({
    method: "GET",
    path: `/newsletters/${encodeURIComponent(input.channelId)}/messages`,
    query: {
      count: input.count,
      before: input.before !== void 0 ? Number(input.before) : void 0
    }
  });
  const record = asRecord(body);
  const items = record ? asRecordArray(record.messages) : [];
  return items.map((item) => mapWhapiChannelPost(item));
}
function mapWhapiChannelPost(item) {
  const content = mapMessageContent(item);
  const reactions = asRecordArray(item.reactions);
  const reactionCounts = reactions.reduce((acc, reaction) => {
    const emoji = asString(reaction.emoji);
    const count = asNumber(reaction.count);
    if (emoji !== void 0 && count !== void 0) {
      acc[emoji] = count;
    }
    return acc;
  }, {});
  return {
    id: asString(item.id) ?? "",
    timestamp: toEpochMs(item.timestamp) ?? 0,
    text: content.text,
    reactionCounts: Object.keys(reactionCounts).length > 0 ? reactionCounts : void 0,
    raw: item
  };
}
async function getBusinessProfile(http) {
  const body = await http.request({ method: "GET", path: "/business" });
  return mapWhapiBusinessProfile(body);
}
async function updateBusinessProfile(http, input) {
  await http.request({
    method: "POST",
    path: "/business",
    body: { description: input.description, address: input.address, email: input.email }
  });
}
function mapWhapiBusinessProfile(body) {
  const record = asRecord(body);
  const websitesRaw = record && Array.isArray(record.websites) ? record.websites : [];
  const websites = websitesRaw.filter((item) => typeof item === "string");
  return {
    description: record ? asString(record.description) : void 0,
    address: record ? asString(record.address) : void 0,
    email: record ? asString(record.email) : void 0,
    websites: websites.length > 0 ? websites : void 0,
    categories: void 0,
    raw: body
  };
}
async function rejectCall(http, input) {
  if (!input.callId || !input.callerId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'calls.reject no Whapi exige "callId" e "callerId" (DELETE /calls/{CallID}, body {callFrom}).',
      { provider: PROVIDER }
    );
  }
  await http.request({
    method: "DELETE",
    path: `/calls/${encodeURIComponent(input.callId)}`,
    body: { callFrom: input.callerId }
  });
}
function parseWebhook(input) {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook Whapi: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe(input) {
  const body = input.body;
  const record = asRecord(body);
  if (!record) {
    return [unknownEvent(body, "Corpo do webhook Whapi n\xE3o \xE9 um objeto JSON.")];
  }
  const instanceId = asString(record.channel_id);
  const eventMeta = asRecord(record.event);
  const eventType = eventMeta ? asString(eventMeta.type) : void 0;
  const eventVerb = eventMeta ? asString(eventMeta.event) : void 0;
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
        unknownEvent(
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
    return [unknownEvent(rawBody, 'Evento "messages" do Whapi sem itens no array.', instanceId)];
  }
  return items.map((item) => mapMessageItem(item, instanceId, rawBody));
}
function mapMessageItem(item, instanceId, rawBody) {
  const fromMe = asBoolean(item.from_me) ?? false;
  const content = mapMessageContent(item);
  const context = asRecord(item.context);
  const message = {
    id: asString(item.id) ?? `whapi-unknown-${Date.now()}`,
    chatId: asString(item.chat_id) ?? "unknown",
    from: asString(item.from),
    fromMe,
    // Confirmado no dossiê: `timestamp` de `messages` é epoch em SEGUNDOS (diferente de
    // `WaMessage.timestamp`, que é ms) — convertido via `toEpochMs`.
    timestamp: toEpochMs(item.timestamp) ?? Date.now(),
    kind: content.kind,
    text: content.text,
    media: content.media,
    quotedId: context ? asString(context.quoted_id) : void 0,
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
function mapMessageContent(record) {
  const type = asString(record.type);
  switch (type) {
    case "text": {
      const text = asRecord(record.text);
      return { kind: "text", text: text ? asString(text.body) : void 0 };
    }
    case "image": {
      const image = asRecord(record.image);
      return {
        kind: "image",
        text: image ? asString(image.caption) : void 0,
        media: image ? buildMediaRef("image", image) : void 0
      };
    }
    case "video": {
      const video = asRecord(record.video);
      return {
        kind: "video",
        text: video ? asString(video.caption) : void 0,
        media: video ? buildMediaRef("video", video) : void 0
      };
    }
    case "audio":
    case "voice": {
      const audio = asRecord(record.audio) ?? asRecord(record.voice);
      return { kind: "audio", media: audio ? buildMediaRef("audio", audio) : void 0 };
    }
    case "document": {
      const document = asRecord(record.document);
      return {
        kind: "document",
        text: document ? asString(document.caption) : void 0,
        media: document ? buildMediaRef("document", document) : void 0
      };
    }
    case "sticker": {
      const sticker = asRecord(record.sticker);
      return { kind: "sticker", media: sticker ? buildMediaRef("sticker", sticker) : void 0 };
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
function buildMediaRef(kind, record) {
  const url = asString(record.link);
  const id = asString(record.id);
  if (!url && !id) return void 0;
  return {
    kind,
    url,
    mimeType: asString(record.mime_type),
    filename: asString(record.file_name),
    id
  };
}
function mapStatusesEvent(record, instanceId, rawBody) {
  const items = asRecordArray(record.statuses);
  if (items.length === 0) {
    return [unknownEvent(rawBody, 'Evento "statuses" do Whapi sem itens no array.', instanceId)];
  }
  return items.map((item) => mapStatusItem(item, instanceId, rawBody));
}
function mapStatusItem(item, instanceId, rawBody) {
  const messageId = asString(item.id);
  if (!messageId) {
    return unknownEvent(rawBody, 'Item de "statuses" do Whapi sem "id".', instanceId);
  }
  const statusText = asString(item.status);
  const ack = mapWhapiAckStatus(statusText);
  if (!ack) {
    return unknownEvent(
      rawBody,
      `Status Whapi n\xE3o mape\xE1vel para MessageAck: "${statusText ?? "ausente"}".`,
      instanceId
    );
  }
  return {
    type: "message.ack",
    provider: PROVIDER,
    instanceId,
    messageId,
    chatId: asString(item.recipient_id),
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
  const health = asRecord(record.health);
  const status = health ? asRecord(health.status) : void 0;
  const state = mapChannelState(status ? asString(status.text) : void 0);
  const qr = asRecord(record.qr);
  return {
    type: "connection.update",
    provider: PROVIDER,
    instanceId,
    state,
    qr: qr ? asString(qr.base64) : void 0,
    raw: rawBody
  };
}
function mapUsersEvent(eventVerb, instanceId, rawBody) {
  if (eventVerb === "post") {
    return {
      type: "connection.update",
      provider: PROVIDER,
      instanceId,
      state: "connected",
      raw: rawBody
    };
  }
  if (eventVerb === "delete") {
    return {
      type: "connection.update",
      provider: PROVIDER,
      instanceId,
      state: "disconnected",
      raw: rawBody
    };
  }
  return unknownEvent(
    rawBody,
    `Evento "users" com verbo desconhecido: "${eventVerb}".`,
    instanceId
  );
}
function unknownEvent(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER, instanceId, raw, reason };
}
function toEpochMs(value) {
  const seconds = asNumber(value);
  if (seconds === void 0 || Number.isNaN(seconds)) return void 0;
  return seconds * 1e3;
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asString(value) {
  return typeof value === "string" ? value : void 0;
}
function asNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  return void 0;
}
function asBoolean(value) {
  return typeof value === "boolean" ? value : void 0;
}
function asRecordArray(value) {
  return Array.isArray(value) ? value.map((item) => asRecord(item)).filter((item) => item !== void 0) : [];
}
function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

export { whapi };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map