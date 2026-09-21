import { HttpClient } from '../../chunk-SYMHJK3P.js';
import { normalizeInviteLink, isJid, digitsOnly } from '../../chunk-SWRBCMQ6.js';
import { WaConnectorError } from '../../chunk-JIDVFSO6.js';
import { randomUUID } from 'crypto';

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

export { evolution };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map