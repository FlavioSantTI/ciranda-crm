import { HttpClient } from '../../chunk-SYMHJK3P.js';
import { WaConnectorError } from '../../chunk-JIDVFSO6.js';

// src/adapters/izapia/index.ts
var PROVIDER = "izapia";
var IZAPIA_CAPABILITIES = [
  "instance.connect",
  "instance.status",
  "instance.logout",
  "messages.sendText",
  "messages.sendMedia",
  "messages.sendReaction",
  "messages.edit",
  "messages.delete",
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
  "channels.follow",
  "channels.unfollow",
  "channels.getMessages",
  "channels.markViewed",
  "channels.reactToPost",
  "business.getProfile",
  "calls.make",
  "calls.reject",
  "webhooks.parse"
];
function izapia(options) {
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    headers: { authorization: `Bearer ${options.apiKey}` },
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    secrets: [options.apiKey],
    provider: PROVIDER,
    fetch: options.fetch
  });
  const sid = options.sid;
  const instance = {
    connect: () => connectInstance(http, sid),
    status: () => statusInstance(http, sid),
    logout: () => logoutInstance(http, sid)
  };
  const messages = {
    sendText: (input) => sendText(http, sid, input),
    sendMedia: (input) => sendMedia(http, sid, input),
    sendReaction: (input) => sendReaction(http, sid, input),
    edit: (input) => editMessage(http, sid, input),
    delete: (input) => deleteMessage(http, sid, input),
    star: (input) => setMessageStarred(http, sid, input, true),
    unstar: (input) => setMessageStarred(http, sid, input, false),
    pin: (input) => setMessagePinned(http, sid, input, true),
    unpin: (input) => setMessagePinned(http, sid, input, false),
    markRead: (input) => markMessageRead(http, sid, input),
    sendLocation: (input) => sendLocation(http, sid, input),
    sendContactCard: (input) => sendContactCard(http, sid, input),
    sendPoll: (input) => sendPoll(http, sid, input),
    download: (input) => downloadMedia(http, sid, input)
    // `messages.forward` NÃO implementado: POST .../messages/forward só aceita {to, text} — o
    // izapia não guarda histórico (stateless por design, ver docs/providers/izapia.md), então não
    // há como resolver o texto original a partir de só `messageId`/`fromChatId` (ForwardMessageInput
    // do contrato canônico não carrega o texto). Limitação real do provider, não gap de pesquisa.
  };
  const groups = {
    create: (input) => createGroup(http, sid, input),
    getInfo: (groupId) => getGroupInfo(http, sid, groupId),
    list: () => listGroups(http, sid),
    addParticipants: (input) => updateGroupParticipants(http, sid, input, "add"),
    removeParticipants: (input) => updateGroupParticipants(http, sid, input, "remove"),
    promoteParticipants: (input) => updateGroupParticipants(http, sid, input, "promote"),
    demoteParticipants: (input) => updateGroupParticipants(http, sid, input, "demote"),
    updateSubject: (input) => updateGroupSubject(http, sid, input),
    updateDescription: (input) => updateGroupDescription(http, sid, input),
    updatePicture: (input) => updateGroupPicture(http, sid, input),
    getInviteLink: (groupId) => getGroupInviteLink(http, sid, groupId),
    revokeInviteLink: (groupId) => revokeGroupInviteLink(http, sid, groupId),
    joinViaInviteLink: (input) => joinGroupViaInviteLink(http, sid, input),
    leaveGroup: (groupId) => leaveGroup(http, sid, groupId)
  };
  const contacts = {
    list: () => listContacts(http, sid),
    get: (chatId) => getContact(http, sid, chatId),
    checkExists: (phone) => checkContactExists(http, sid, phone),
    getProfilePicture: (chatId) => getContactProfilePicture(http, sid, chatId),
    getAbout: (chatId) => getContactAbout(http, sid, chatId),
    block: (chatId) => setContactBlocked(http, sid, chatId, true),
    unblock: (chatId) => setContactBlocked(http, sid, chatId, false),
    listBlocked: () => listBlockedContacts(http, sid)
  };
  const chats = {
    archive: (chatId) => setChatArchived(http, sid, chatId, true),
    unarchive: (chatId) => setChatArchived(http, sid, chatId, false),
    mute: (chatId) => setChatMuted(http, sid, chatId, true),
    unmute: (chatId) => setChatMuted(http, sid, chatId, false),
    pin: (chatId) => setChatPinned(http, sid, chatId, true),
    unpin: (chatId) => setChatPinned(http, sid, chatId, false),
    markRead: (chatId) => setChatRead(http, sid, chatId, true),
    markUnread: (chatId) => setChatRead(http, sid, chatId, false)
  };
  const presence = {
    setTyping: (input) => setTyping(http, sid, input),
    set: (state) => setPresence(http, sid, state),
    subscribe: (chatId) => subscribePresence(http, sid, chatId)
  };
  const labels = {
    list: () => listLabels(http, sid),
    create: (input) => createLabel(http, sid, input),
    update: (input) => updateLabel(http, sid, input),
    delete: (labelId) => deleteLabel(http, sid, labelId),
    addToChat: (input) => setChatLabel(http, sid, input, true),
    removeFromChat: (input) => setChatLabel(http, sid, input, false)
  };
  const channels = {
    list: () => listChannels(http, sid),
    create: (input) => createChannel(http, sid, input),
    getInfo: (channelId) => getChannelInfo(http, sid, channelId),
    follow: (channelId) => setChannelFollowed(http, sid, channelId, true),
    unfollow: (channelId) => setChannelFollowed(http, sid, channelId, false),
    getMessages: (input) => getChannelMessages(http, sid, input),
    markViewed: (input) => markChannelMessagesViewed(http, sid, input),
    reactToPost: (input) => reactToChannelPost(http, sid, input)
    // `channels.delete` NÃO implementado: POST .../channels/{channelId}/delete hoje devolve
    // 501 NOT_IMPLEMENTED — o whatsmeow não expõe "apagar canal" publicamente (ver dossiê).
  };
  const business = {
    getProfile: () => getBusinessProfile(http, sid)
  };
  const calls = {
    make: (input) => makeCall(http, sid, input),
    reject: (input) => rejectCall(http, sid, input)
  };
  return {
    provider: PROVIDER,
    capabilities: IZAPIA_CAPABILITIES,
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
async function connectInstance(http, sid) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/pair`
  });
  const data = unwrapEnvelope(body);
  return { qr: asString(data.qr_png_base64), raw: body };
}
async function statusInstance(http, sid) {
  const body = await http.request({ method: "GET", path: `/api/v1/sessions/${sid}` });
  const data = unwrapEnvelope(body);
  return { state: mapInstanceState(asString(data.status)), raw: body };
}
async function logoutInstance(http, sid) {
  await http.request({ method: "POST", path: `/api/v1/sessions/${sid}/logout` });
}
function mapInstanceState(status) {
  switch (status) {
    case "created":
      return "disconnected";
    case "pairing":
      return "qr";
    case "connected":
      return "connected";
    case "disconnected":
      return "connecting";
    case "logged_out":
      return "disconnected";
    default:
      return "unknown";
  }
}
async function sendText(http, sid, input) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/text`,
    body: { to: input.to, text: input.text }
  });
  return mapSentMessage(body, input.to);
}
async function sendMedia(http, sid, input) {
  const source = input.media.url ?? input.media.base64;
  if (!source) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'izapia: sendMedia exige "media.url" ou "media.base64".',
      { provider: PROVIDER }
    );
  }
  const requestBody = {
    to: input.to,
    kind: mapMediaKind(input.media.kind)
  };
  if (input.media.url) requestBody.url = input.media.url;
  else requestBody.base64 = input.media.base64;
  if (input.media.mimeType) requestBody.mimetype = input.media.mimeType;
  if (input.caption) requestBody.caption = input.caption;
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/media`,
    body: requestBody
  });
  return mapSentMessage(body, input.to);
}
function mapMediaKind(kind) {
  return kind;
}
function mapSentMessage(body, requestedTo) {
  const data = unwrapEnvelope(body);
  const id = asString(data.message_id) ?? `izapia-${Date.now()}`;
  return { id, chatId: requestedTo, raw: body };
}
async function sendReaction(http, sid, input) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/react`,
    body: { to: input.to, message_id: input.messageId, reaction: input.emoji }
  });
  return mapSentMessage(body, input.to);
}
async function editMessage(http, sid, input) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/edit`,
    body: { to: input.to, message_id: input.messageId, text: input.text }
  });
  return mapSentMessage(body, input.to);
}
async function deleteMessage(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/delete`,
    body: { to: input.to, message_id: input.messageId }
  });
}
async function setMessageStarred(http, sid, input, starred) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/star`,
    body: { to: input.to, message_id: input.messageId, starred }
  });
}
async function setMessagePinned(http, sid, input, pinned) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/pin`,
    body: { to: input.to, message_id: input.messageId, pinned }
  });
}
async function markMessageRead(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/read`,
    body: { to: input.to, message_ids: [input.messageId] }
  });
}
async function sendLocation(http, sid, input) {
  const requestBody = {
    to: input.to,
    latitude: input.latitude,
    longitude: input.longitude
  };
  if (input.name) requestBody.name = input.name;
  if (input.address) requestBody.address = input.address;
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/location`,
    body: requestBody
  });
  return mapSentMessage(body, input.to);
}
async function sendContactCard(http, sid, input) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/contact`,
    body: { to: input.to, display_name: input.contactName, phone: input.contactPhone }
  });
  return mapSentMessage(body, input.to);
}
async function sendPoll(http, sid, input) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/poll`,
    body: {
      to: input.to,
      name: input.question,
      options: input.options,
      ...input.allowMultipleAnswers ? { selectable_count: input.options.length } : {}
    }
  });
  return mapSentMessage(body, input.to);
}
async function downloadMedia(http, sid, input) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/messages/download`,
    body: extractDownloadRequestBody(input.raw)
  });
  const data = unwrapEnvelope(body);
  return {
    base64: asString(data.data_base64) ?? "",
    mimeType: asString(data.mimetype),
    raw: body
  };
}
var MEDIA_KIND_FIELDS = [
  ["image", "imageMessage"],
  ["video", "videoMessage"],
  ["audio", "audioMessage"],
  ["document", "documentMessage"],
  ["sticker", "stickerMessage"]
];
function extractDownloadRequestBody(raw) {
  const envelope = asRecord(raw);
  const eventData = envelope ? asRecord(envelope.data) : void 0;
  const message = eventData ? asRecord(eventData.raw) : void 0;
  if (!message) return {};
  for (const [kind, field] of MEDIA_KIND_FIELDS) {
    const mediaObject = asRecord(message[field]);
    if (mediaObject) return buildDownloadRequestBody(kind, mediaObject);
  }
  return {};
}
function buildDownloadRequestBody(kind, mediaObject) {
  const fileLengthRaw = mediaObject.fileLength;
  const fileLength = typeof fileLengthRaw === "number" ? fileLengthRaw : typeof fileLengthRaw === "string" ? Number(fileLengthRaw) : void 0;
  return {
    kind,
    url: asString(mediaObject.URL) ?? asString(mediaObject.url),
    mimetype: asString(mediaObject.mimetype),
    direct_path: asString(mediaObject.directPath),
    media_key: mediaObject.mediaKey,
    file_enc_sha256: mediaObject.fileEncSHA256,
    file_sha256: mediaObject.fileSHA256,
    file_length: fileLength
  };
}
function mapGroupInfo(body) {
  const data = unwrapEnvelope(body);
  const participantsRaw = data.participants;
  const participants = Array.isArray(participantsRaw) ? participantsRaw.map(mapParticipant) : [];
  return {
    id: asString(data.group_id) ?? "",
    subject: asString(data.subject) ?? "",
    description: asString(data.description),
    owner: asString(data.owner),
    participants,
    raw: body
  };
}
function mapParticipant(value) {
  const record = asRecord(value);
  return {
    id: (record ? asString(record.jid) : void 0) ?? "unknown",
    isAdmin: (record ? asBoolean(record.is_admin) : void 0) ?? false,
    isSuperAdmin: (record ? asBoolean(record.is_super_admin) : void 0) ?? false
  };
}
async function createGroup(http, sid, input) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/groups`,
    body: { subject: input.subject, participants: input.participants }
  });
  return mapGroupInfo(body);
}
async function getGroupInfo(http, sid, groupId) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/groups/${groupId}`
  });
  return mapGroupInfo(body);
}
async function listGroups(http, sid) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/groups`
  });
  const record = asRecord(body);
  const groups = record && Array.isArray(record.data) ? record.data : [];
  return groups.map((group) => mapGroupInfo({ ok: true, data: group }));
}
async function updateGroupParticipants(http, sid, input, action) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/groups/${input.groupId}/participants`,
    body: { action, participants: input.participants }
  });
}
async function updateGroupSubject(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/groups/${input.groupId}/subject`,
    body: { subject: input.subject }
  });
}
async function updateGroupDescription(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/groups/${input.groupId}/description`,
    body: { description: input.description }
  });
}
function toIzapiaImageBody(media) {
  const requestBody = {};
  if (media.url) requestBody.url = media.url;
  else requestBody.base64 = media.base64;
  if (media.mimeType) requestBody.mimetype = media.mimeType;
  return requestBody;
}
async function updateGroupPicture(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/groups/${input.groupId}/picture`,
    body: toIzapiaImageBody(input.media)
  });
}
async function getGroupInviteLink(http, sid, groupId) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/groups/${groupId}/invite`
  });
  const data = unwrapEnvelope(body);
  return { link: asString(data.invite_link) ?? "", raw: body };
}
async function revokeGroupInviteLink(http, sid, groupId) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/groups/${groupId}/invite/revoke`
  });
  const data = unwrapEnvelope(body);
  return { link: asString(data.invite_link) ?? "", raw: body };
}
async function joinGroupViaInviteLink(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/groups/join`,
    body: { link: input.invite }
  });
}
async function leaveGroup(http, sid, groupId) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/groups/${groupId}/leave`
  });
}
function mapContact(body) {
  const data = unwrapEnvelope(body);
  return {
    id: asString(data.jid) ?? "",
    name: asString(data.full_name) ?? asString(data.push_name) ?? asString(data.first_name),
    about: asString(data.about),
    raw: body
  };
}
async function listContacts(http, sid) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/contacts`
  });
  const record = asRecord(body);
  const contacts = record && Array.isArray(record.data) ? record.data : [];
  return contacts.map((contact) => mapContact({ ok: true, data: contact }));
}
async function getContact(http, sid, chatId) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/contacts/${chatId}`
  });
  return mapContact(body);
}
async function getContactAbout(http, sid, chatId) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/contacts/${chatId}`
  });
  const data = unwrapEnvelope(body);
  return { about: asString(data.about), raw: body };
}
async function checkContactExists(http, sid, phone) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/contacts/check`,
    body: { numbers: [phone] }
  });
  const record = asRecord(body);
  const list = record && Array.isArray(record.data) ? record.data : [];
  const first = asRecord(list[0]);
  return {
    exists: (first ? asBoolean(first.is_in_whatsapp) : void 0) ?? false,
    chatId: first ? asString(first.jid) : void 0,
    raw: body
  };
}
async function getContactProfilePicture(http, sid, chatId) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/contacts/${chatId}/picture`
  });
  const data = unwrapEnvelope(body);
  return { url: asString(data.url), raw: body };
}
async function setContactBlocked(http, sid, chatId, block) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/contacts/${chatId}/${block ? "block" : "unblock"}`
  });
}
async function listBlockedContacts(http, sid) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/contacts/blocked`
  });
  const record = asRecord(body);
  const list = record && Array.isArray(record.data) ? record.data : [];
  return list.map((item) => asString(asRecord(item)?.jid)).filter((id) => id !== void 0);
}
async function setChatArchived(http, sid, chatId, archived) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/chats/${chatId}/archive`,
    body: { archived }
  });
}
async function setChatMuted(http, sid, chatId, muted) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/chats/${chatId}/mute`,
    body: { muted }
  });
}
async function setChatPinned(http, sid, chatId, pinned) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/chats/${chatId}/pin`,
    body: { pinned }
  });
}
async function setChatRead(http, sid, chatId, read) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/chats/${chatId}/read`,
    body: { read }
  });
}
async function setTyping(http, sid, input) {
  const body = input.state === "recording" ? { to: input.to, state: "composing", media: "audio" } : { to: input.to, state: input.state };
  await http.request({ method: "POST", path: `/api/v1/sessions/${sid}/presence/typing`, body });
}
async function setPresence(http, sid, state) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/presence`,
    body: { state: state === "online" ? "available" : "unavailable" }
  });
}
async function subscribePresence(http, sid, chatId) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/presence/${chatId}/subscribe`
  });
}
function mapLabel(body) {
  const data = unwrapEnvelope(body);
  const color = asNumber(data.color);
  return {
    id: asString(data.id) ?? "",
    name: asString(data.name) ?? "",
    color: color === void 0 ? void 0 : String(color),
    raw: body
  };
}
async function listLabels(http, sid) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/labels`
  });
  const record = asRecord(body);
  const labels = record && Array.isArray(record.data) ? record.data : [];
  return labels.map((label) => mapLabel({ ok: true, data: label }));
}
async function createLabel(http, sid, input) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/labels`,
    body: { name: input.name, ...input.color ? { color: Number(input.color) } : {} }
  });
  return mapLabel(body);
}
async function updateLabel(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/labels/${input.labelId}`,
    body: { name: input.name, ...input.color ? { color: Number(input.color) } : {} }
  });
}
async function deleteLabel(http, sid, labelId) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/labels/${labelId}/delete`
  });
}
async function setChatLabel(http, sid, input, add) {
  const suffix = add ? "" : "/remove";
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/labels/${input.labelId}/chats/${input.chatId}${suffix}`
  });
}
function mapChannel(body) {
  const data = unwrapEnvelope(body);
  return {
    id: asString(data.channel_id) ?? "",
    name: asString(data.name) ?? "",
    description: asString(data.description),
    subscribersCount: asNumber(data.subscriber_count),
    raw: body
  };
}
async function listChannels(http, sid) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/channels`
  });
  const record = asRecord(body);
  const channels = record && Array.isArray(record.data) ? record.data : [];
  return channels.map((channel) => mapChannel({ ok: true, data: channel }));
}
async function createChannel(http, sid, input) {
  const body = await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/channels`,
    body: { name: input.name, ...input.description ? { description: input.description } : {} }
  });
  return mapChannel(body);
}
async function getChannelInfo(http, sid, channelId) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/channels/${channelId}`
  });
  return mapChannel(body);
}
async function setChannelFollowed(http, sid, channelId, follow) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/channels/${channelId}/${follow ? "follow" : "unfollow"}`
  });
}
async function getChannelMessages(http, sid, input) {
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/channels/${input.channelId}/messages`,
    query: {
      count: input.count,
      before: input.before !== void 0 ? Number(input.before) : void 0
    }
  });
  const record = asRecord(body);
  const items = record && Array.isArray(record.data) ? record.data : [];
  return items.map((item) => mapChannelPost(item));
}
function mapChannelPost(body) {
  const record = asRecord(body);
  const serverId = record ? asNumber(record.server_id) : void 0;
  const reactionCountsRaw = record ? asRecord(record.reaction_counts) : void 0;
  const reactionCounts = reactionCountsRaw ? Object.fromEntries(
    Object.entries(reactionCountsRaw).map(([emoji, count]) => [emoji, asNumber(count)]).filter((entry) => entry[1] !== void 0)
  ) : void 0;
  return {
    id: serverId !== void 0 ? String(serverId) : "",
    timestamp: ((record ? asNumber(record.timestamp) : void 0) ?? 0) * 1e3,
    text: record ? asString(record.text) : void 0,
    viewsCount: record ? asNumber(record.views_count) : void 0,
    reactionCounts: reactionCounts && Object.keys(reactionCounts).length > 0 ? reactionCounts : void 0,
    raw: body
  };
}
async function markChannelMessagesViewed(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/channels/${input.channelId}/messages/viewed`,
    body: { server_ids: input.messageIds.map(Number) }
  });
}
async function reactToChannelPost(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/channels/${input.channelId}/messages/${Number(input.messageId)}/react`,
    body: { reaction: input.emoji }
  });
}
async function getBusinessProfile(http, sid) {
  const status = await http.request({ method: "GET", path: `/api/v1/sessions/${sid}` });
  const jid = asString(unwrapEnvelope(status).jid);
  if (!jid) {
    throw new WaConnectorError(
      "INSTANCE_DISCONNECTED",
      "izapia: business.getProfile exige uma sess\xE3o pareada (JID desconhecido).",
      { provider: PROVIDER }
    );
  }
  const body = await http.request({
    method: "GET",
    path: `/api/v1/sessions/${sid}/business/profile/${jid}`
  });
  const data = unwrapEnvelope(body);
  const categoriesRaw = data.categories;
  const categories = Array.isArray(categoriesRaw) ? categoriesRaw.map((c) => asString(asRecord(c)?.name)).filter((n) => n !== void 0) : void 0;
  return {
    address: asString(data.address),
    email: asString(data.email),
    categories,
    raw: body
  };
}
async function makeCall(http, sid, input) {
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/calls`,
    body: { to: input.to }
  });
}
async function rejectCall(http, sid, input) {
  if (!input.callId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'izapia: calls.reject exige "callId" (obrigat\xF3rio no path do endpoint).',
      { provider: PROVIDER }
    );
  }
  await http.request({
    method: "POST",
    path: `/api/v1/sessions/${sid}/calls/${input.callId}/reject`
  });
}
function parseWebhook(input) {
  try {
    return parseWebhookUnsafe(input);
  } catch (error) {
    return [
      unknownEvent(
        input.body,
        `Erro inesperado ao parsear webhook izapia: ${error instanceof Error ? error.message : String(error)}`
      )
    ];
  }
}
function parseWebhookUnsafe(input) {
  const envelope = asRecord(input.body);
  if (!envelope) {
    return [unknownEvent(input.body, "Corpo do webhook izapia n\xE3o \xE9 um objeto JSON.")];
  }
  const type = asString(envelope.type);
  const sessionId = asString(envelope.session_id);
  const data = asRecord(envelope.data) ?? {};
  if (!type) {
    return [unknownEvent(input.body, 'Payload de webhook izapia sem campo "type".', sessionId)];
  }
  switch (type) {
    case "session.qr":
      return [connectionUpdate(input.body, sessionId, "qr")];
    case "session.connected":
      return [connectionUpdate(input.body, sessionId, "connected")];
    case "session.disconnected":
      return [connectionUpdate(input.body, sessionId, "connecting")];
    case "session.logged_out":
      return [connectionUpdate(input.body, sessionId, "disconnected")];
    case "message.received":
      return [messageReceived(input.body, sessionId, data)];
    case "message.ack":
      return [messageAck(input.body, sessionId, data)];
    default:
      return [
        unknownEvent(input.body, `Evento izapia n\xE3o mapeado nesta fase: "${type}".`, sessionId)
      ];
  }
}
function connectionUpdate(raw, sessionId, state) {
  return { type: "connection.update", provider: PROVIDER, instanceId: sessionId, state, raw };
}
function messageReceived(raw, sessionId, data) {
  const message = {
    id: asString(data.message_id) ?? `izapia-unknown-${Date.now()}`,
    chatId: asString(data.chat) ?? "unknown",
    from: asString(data.from),
    fromMe: asBoolean(data.from_me) ?? false,
    timestamp: (asNumber(data.timestamp) ?? 0) * 1e3,
    kind: asString(data.text) ? "text" : "unknown",
    text: asString(data.text),
    raw
  };
  return { type: "message.received", provider: PROVIDER, instanceId: sessionId, message, raw };
}
function messageAck(raw, sessionId, data) {
  const messageIds = Array.isArray(data.message_ids) ? data.message_ids.map(asString) : [];
  return {
    type: "message.ack",
    provider: PROVIDER,
    instanceId: sessionId,
    messageId: messageIds.find((id) => id !== void 0) ?? "unknown",
    chatId: asString(data.chat),
    ack: mapAckStatus(asString(data.status)),
    raw
  };
}
function mapAckStatus(status) {
  switch (status) {
    case "delivered":
      return "delivered";
    case "read":
    case "read-self":
      return "read";
    case "played":
    case "played-self":
      return "played";
    default:
      return "sent";
  }
}
function unknownEvent(raw, reason, instanceId) {
  return { type: "unknown", provider: PROVIDER, instanceId, raw, reason };
}
function unwrapEnvelope(body) {
  const record = asRecord(body);
  return (record ? asRecord(record.data) : void 0) ?? {};
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

export { izapia };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map