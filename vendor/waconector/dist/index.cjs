'use strict';

// src/core/capabilities.ts
var CAPABILITIES = [
  "instance.connect",
  "instance.pairingCode",
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
  "channels.markViewed",
  "channels.reactToPost",
  "business.getProfile",
  "business.updateProfile",
  "calls.make",
  "calls.reject",
  "webhooks.parse"
];
function hasCapability(set, capability) {
  return set.includes(capability);
}
function isKnownCapability(value) {
  return CAPABILITIES.includes(value);
}

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
var UnsupportedCapabilityError = class extends WaConnectorError {
  capability;
  constructor(capability, provider) {
    const message = provider ? `O provider "${provider}" n\xE3o suporta a capability "${capability}".` : `Capability n\xE3o suportada: "${capability}".`;
    super("UNSUPPORTED_CAPABILITY", message, { provider });
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
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
function normalizeChatId(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new WaConnectorError("INVALID_RECIPIENT", "Identificador de chat vazio.");
  }
  if (isJid(trimmed)) {
    return trimmed;
  }
  const digits = digitsOnly(trimmed);
  if (digits.length < 7 || digits.length > 15) {
    throw new WaConnectorError(
      "INVALID_RECIPIENT",
      `N\xFAmero de telefone inv\xE1lido: "${trimmed}" (esperado E.164 com 7 a 15 d\xEDgitos).`
    );
  }
  return digits;
}

// src/core/connector.ts
var TYPING_STATES = ["composing", "recording", "paused"];
var WaConnector = class {
  adapter;
  provider;
  capabilities;
  instance;
  messages;
  groups;
  contacts;
  chats;
  presence;
  labels;
  channels;
  business;
  calls;
  webhooks;
  listeners = /* @__PURE__ */ new Map();
  constructor(adapter) {
    this.adapter = adapter;
    this.provider = adapter.provider;
    this.capabilities = adapter.capabilities;
    this.instance = {
      connect: async () => {
        this.assertCapability("instance.connect");
        return adapter.instance.connect();
      },
      status: async () => {
        this.assertCapability("instance.status");
        return adapter.instance.status();
      },
      logout: async () => {
        this.assertCapability("instance.logout");
        return adapter.instance.logout();
      }
    };
    this.messages = {
      sendText: async (input) => {
        this.assertCapability("messages.sendText");
        return adapter.messages.sendText(this.prepareSendText(input));
      },
      sendMedia: async (input) => {
        this.assertCapability("messages.sendMedia");
        return adapter.messages.sendMedia(this.prepareSendMedia(input));
      },
      sendReaction: (input) => this.callMessagesMethod(
        "sendReaction",
        "messages.sendReaction",
        (fn) => fn(this.prepareSendReaction(input))
      ),
      edit: (input) => this.callMessagesMethod(
        "edit",
        "messages.edit",
        (fn) => fn(this.prepareEditMessage(input))
      ),
      delete: (input) => this.callMessagesMethod(
        "delete",
        "messages.delete",
        (fn) => fn(this.prepareDeleteMessage(input))
      ),
      forward: (input) => this.callMessagesMethod(
        "forward",
        "messages.forward",
        (fn) => fn(this.prepareForwardMessage(input))
      ),
      star: (input) => this.callMessagesMethod(
        "star",
        "messages.star",
        (fn) => fn(this.prepareStarMessage(input))
      ),
      unstar: (input) => this.callMessagesMethod(
        "unstar",
        "messages.unstar",
        (fn) => fn(this.prepareStarMessage(input))
      ),
      pin: (input) => this.callMessagesMethod("pin", "messages.pin", (fn) => fn(this.preparePinMessage(input))),
      unpin: (input) => this.callMessagesMethod(
        "unpin",
        "messages.unpin",
        (fn) => fn(this.preparePinMessage(input))
      ),
      markRead: (input) => this.callMessagesMethod(
        "markRead",
        "messages.markRead",
        (fn) => fn(this.prepareMarkMessageRead(input))
      ),
      sendLocation: (input) => this.callMessagesMethod(
        "sendLocation",
        "messages.sendLocation",
        (fn) => fn(this.prepareSendLocation(input))
      ),
      sendContactCard: (input) => this.callMessagesMethod(
        "sendContactCard",
        "messages.sendContactCard",
        (fn) => fn(this.prepareSendContactCard(input))
      ),
      sendPoll: (input) => this.callMessagesMethod(
        "sendPoll",
        "messages.sendPoll",
        (fn) => fn(this.prepareSendPoll(input))
      ),
      download: (input) => this.callMessagesMethod(
        "download",
        "messages.download",
        (fn) => fn(this.prepareDownloadMedia(input))
      )
    };
    this.groups = {
      create: (input) => this.callGroupsMethod(
        "create",
        "groups.create",
        (fn) => fn(this.prepareCreateGroup(input))
      ),
      getInfo: (groupId) => this.callGroupsMethod(
        "getInfo",
        "groups.getInfo",
        (fn) => fn(this.requireGroupId(groupId))
      ),
      list: () => this.callGroupsMethod("list", "groups.list", (fn) => fn()),
      addParticipants: (input) => this.callGroupsMethod(
        "addParticipants",
        "groups.addParticipants",
        (fn) => fn(this.prepareGroupParticipants(input))
      ),
      removeParticipants: (input) => this.callGroupsMethod(
        "removeParticipants",
        "groups.removeParticipants",
        (fn) => fn(this.prepareGroupParticipants(input))
      ),
      promoteParticipants: (input) => this.callGroupsMethod(
        "promoteParticipants",
        "groups.promoteParticipants",
        (fn) => fn(this.prepareGroupParticipants(input))
      ),
      demoteParticipants: (input) => this.callGroupsMethod(
        "demoteParticipants",
        "groups.demoteParticipants",
        (fn) => fn(this.prepareGroupParticipants(input))
      ),
      updateSubject: (input) => this.callGroupsMethod(
        "updateSubject",
        "groups.updateSubject",
        (fn) => fn(this.prepareUpdateGroupSubject(input))
      ),
      updateDescription: (input) => this.callGroupsMethod(
        "updateDescription",
        "groups.updateDescription",
        (fn) => fn(this.prepareUpdateGroupDescription(input))
      ),
      updatePicture: (input) => this.callGroupsMethod(
        "updatePicture",
        "groups.updatePicture",
        (fn) => fn(this.prepareUpdateGroupPicture(input))
      ),
      getInviteLink: (groupId) => this.callGroupsMethod(
        "getInviteLink",
        "groups.getInviteLink",
        (fn) => fn(this.requireGroupId(groupId))
      ),
      revokeInviteLink: (groupId) => this.callGroupsMethod(
        "revokeInviteLink",
        "groups.revokeInviteLink",
        (fn) => fn(this.requireGroupId(groupId))
      ),
      joinViaInviteLink: (input) => this.callGroupsMethod(
        "joinViaInviteLink",
        "groups.joinViaInviteLink",
        (fn) => fn(this.prepareJoinViaInviteLink(input))
      ),
      leaveGroup: (groupId) => this.callGroupsMethod(
        "leaveGroup",
        "groups.leaveGroup",
        (fn) => fn(this.requireGroupId(groupId))
      )
    };
    this.contacts = {
      list: () => this.callContactsMethod("list", "contacts.list", (fn) => fn()),
      get: (chatId) => this.callContactsMethod("get", "contacts.get", (fn) => fn(this.requireChatId(chatId))),
      checkExists: (phone) => this.callContactsMethod(
        "checkExists",
        "contacts.checkExists",
        (fn) => fn(normalizeChatId(this.requireTo(phone)))
      ),
      getProfilePicture: (chatId) => this.callContactsMethod(
        "getProfilePicture",
        "contacts.getProfilePicture",
        (fn) => fn(this.requireChatId(chatId))
      ),
      getAbout: (chatId) => this.callContactsMethod(
        "getAbout",
        "contacts.getAbout",
        (fn) => fn(this.requireChatId(chatId))
      ),
      block: (chatId) => this.callContactsMethod("block", "contacts.block", (fn) => fn(this.requireChatId(chatId))),
      unblock: (chatId) => this.callContactsMethod(
        "unblock",
        "contacts.unblock",
        (fn) => fn(this.requireChatId(chatId))
      ),
      listBlocked: () => this.callContactsMethod("listBlocked", "contacts.listBlocked", (fn) => fn())
    };
    this.chats = {
      archive: (chatId) => this.callChatsMethod("archive", "chats.archive", (fn) => fn(this.requireChatId(chatId))),
      unarchive: (chatId) => this.callChatsMethod(
        "unarchive",
        "chats.unarchive",
        (fn) => fn(this.requireChatId(chatId))
      ),
      mute: (chatId) => this.callChatsMethod("mute", "chats.mute", (fn) => fn(this.requireChatId(chatId))),
      unmute: (chatId) => this.callChatsMethod("unmute", "chats.unmute", (fn) => fn(this.requireChatId(chatId))),
      pin: (chatId) => this.callChatsMethod("pin", "chats.pin", (fn) => fn(this.requireChatId(chatId))),
      unpin: (chatId) => this.callChatsMethod("unpin", "chats.unpin", (fn) => fn(this.requireChatId(chatId))),
      markRead: (chatId) => this.callChatsMethod("markRead", "chats.markRead", (fn) => fn(this.requireChatId(chatId))),
      markUnread: (chatId) => this.callChatsMethod(
        "markUnread",
        "chats.markUnread",
        (fn) => fn(this.requireChatId(chatId))
      )
    };
    this.presence = {
      setTyping: (input) => this.callPresenceMethod(
        "setTyping",
        "presence.setTyping",
        (fn) => fn(this.prepareSetTyping(input))
      ),
      set: (state) => this.callPresenceMethod("set", "presence.set", (fn) => fn(state)),
      subscribe: (chatId) => this.callPresenceMethod(
        "subscribe",
        "presence.subscribe",
        (fn) => fn(this.requireChatId(chatId))
      )
    };
    this.labels = {
      list: () => this.callLabelsMethod("list", "labels.list", (fn) => fn()),
      create: (input) => this.callLabelsMethod(
        "create",
        "labels.create",
        (fn) => fn(this.prepareCreateLabel(input))
      ),
      update: (input) => this.callLabelsMethod(
        "update",
        "labels.update",
        (fn) => fn(this.prepareUpdateLabel(input))
      ),
      delete: (labelId) => this.callLabelsMethod("delete", "labels.delete", (fn) => fn(this.requireLabelId(labelId))),
      addToChat: (input) => this.callLabelsMethod(
        "addToChat",
        "labels.addToChat",
        (fn) => fn(this.prepareLabelChat(input))
      ),
      removeFromChat: (input) => this.callLabelsMethod(
        "removeFromChat",
        "labels.removeFromChat",
        (fn) => fn(this.prepareLabelChat(input))
      )
    };
    this.channels = {
      list: () => this.callChannelsMethod("list", "channels.list", (fn) => fn()),
      create: (input) => this.callChannelsMethod(
        "create",
        "channels.create",
        (fn) => fn(this.prepareCreateChannel(input))
      ),
      getInfo: (channelId) => this.callChannelsMethod(
        "getInfo",
        "channels.getInfo",
        (fn) => fn(this.requireChannelId(channelId))
      ),
      delete: (channelId) => this.callChannelsMethod(
        "delete",
        "channels.delete",
        (fn) => fn(this.requireChannelId(channelId))
      ),
      follow: (channelId) => this.callChannelsMethod(
        "follow",
        "channels.follow",
        (fn) => fn(this.requireChannelId(channelId))
      ),
      unfollow: (channelId) => this.callChannelsMethod(
        "unfollow",
        "channels.unfollow",
        (fn) => fn(this.requireChannelId(channelId))
      ),
      getMessages: (input) => this.callChannelsMethod(
        "getMessages",
        "channels.getMessages",
        (fn) => fn(this.prepareGetChannelMessages(input))
      ),
      markViewed: (input) => this.callChannelsMethod(
        "markViewed",
        "channels.markViewed",
        (fn) => fn(this.prepareMarkChannelMessagesViewed(input))
      ),
      reactToPost: (input) => this.callChannelsMethod(
        "reactToPost",
        "channels.reactToPost",
        (fn) => fn(this.prepareReactToChannelMessage(input))
      )
    };
    this.business = {
      getProfile: () => this.callBusinessMethod("getProfile", "business.getProfile", (fn) => fn()),
      updateProfile: (input) => this.callBusinessMethod(
        "updateProfile",
        "business.updateProfile",
        (fn) => fn(this.prepareUpdateBusinessProfile(input))
      )
    };
    this.calls = {
      make: (input) => this.callCallsMethod("make", "calls.make", (fn) => fn(this.prepareMakeCall(input))),
      reject: (input) => this.callCallsMethod("reject", "calls.reject", (fn) => fn(this.prepareRejectCall(input)))
    };
    this.webhooks = {
      parse: (input) => this.parseWebhook(input),
      dispatch: async (input) => {
        const events = this.parseWebhook(input);
        for (const event of events) {
          await this.emit(event);
        }
        return events;
      }
    };
  }
  supports(capability) {
    return hasCapability(this.capabilities, capability);
  }
  /** Registra um listener para um tipo de evento canônico (ou `*` para todos). Retorna o unsubscribe. */
  on(type, listener) {
    const set = this.listeners.get(type) ?? /* @__PURE__ */ new Set();
    set.add(listener);
    this.listeners.set(type, set);
    return () => {
      set.delete(listener);
    };
  }
  async emit(event) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      await listener(event);
    }
    for (const listener of this.listeners.get("*") ?? []) {
      await listener(event);
    }
  }
  assertCapability(capability) {
    if (!this.supports(capability)) {
      throw new UnsupportedCapabilityError(capability, this.provider);
    }
  }
  prepareSendText(input) {
    if (typeof input.text !== "string" || input.text.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'sendText exige "text" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareSendMedia(input) {
    if (!input.media || input.media.url === void 0 && input.media.base64 === void 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'sendMedia exige "media.url" ou "media.base64".',
        {
          provider: this.provider
        }
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareSendReaction(input) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'sendReaction exige "messageId" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    if (typeof input.emoji !== "string") {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'sendReaction exige "emoji" (string vazia remove uma rea\xE7\xE3o anterior).',
        { provider: this.provider }
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareEditMessage(input) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'messages.edit exige "messageId" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    if (typeof input.text !== "string" || input.text.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'messages.edit exige "text" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareDeleteMessage(input) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'messages.delete exige "messageId" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareForwardMessage(input) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'messages.forward exige "messageId" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    return {
      ...input,
      to: normalizeChatId(this.requireTo(input.to)),
      fromChatId: input.fromChatId ? normalizeChatId(input.fromChatId) : void 0
    };
  }
  prepareStarMessage(input) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'messages.star/unstar exige "messageId" n\xE3o vazio.',
        { provider: this.provider }
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  preparePinMessage(input) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'messages.pin/unpin exige "messageId" n\xE3o vazio.',
        { provider: this.provider }
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareMarkMessageRead(input) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'messages.markRead exige "messageId" n\xE3o vazio.',
        { provider: this.provider }
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareSendLocation(input) {
    if (typeof input.latitude !== "number" || !Number.isFinite(input.latitude)) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'messages.sendLocation exige "latitude" num\xE9rica.',
        {
          provider: this.provider
        }
      );
    }
    if (typeof input.longitude !== "number" || !Number.isFinite(input.longitude)) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'messages.sendLocation exige "longitude" num\xE9rica.',
        { provider: this.provider }
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareSendContactCard(input) {
    if (typeof input.contactName !== "string" || input.contactName.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'messages.sendContactCard exige "contactName" n\xE3o vazio.',
        { provider: this.provider }
      );
    }
    if (typeof input.contactPhone !== "string" || input.contactPhone.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'messages.sendContactCard exige "contactPhone" n\xE3o vazio.',
        { provider: this.provider }
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareSendPoll(input) {
    if (typeof input.question !== "string" || input.question.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'messages.sendPoll exige "question" n\xE3o vazia.', {
        provider: this.provider
      });
    }
    if (!Array.isArray(input.options) || input.options.length < 2) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'messages.sendPoll exige "options" com pelo menos 2 itens.',
        { provider: this.provider }
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareSetTyping(input) {
    if (!TYPING_STATES.includes(input.state)) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        `presence.setTyping exige "state" em ${TYPING_STATES.join("|")}.`,
        { provider: this.provider }
      );
    }
    return { ...input, to: normalizeChatId(this.requireTo(input.to)) };
  }
  prepareCreateLabel(input) {
    if (typeof input.name !== "string" || input.name.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'labels.create exige "name" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    return input;
  }
  /**
   * `name` é sempre obrigatório aqui (ver `UpdateLabelInput`/ADR-0016) — nunca um patch parcial,
   * mesmo quando só a cor muda.
   */
  prepareUpdateLabel(input) {
    return {
      labelId: this.requireLabelId(input.labelId),
      name: this.requireLabelName(input.name),
      color: input.color
    };
  }
  requireLabelName(name) {
    if (typeof name !== "string" || name.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'labels.update exige "name" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    return name;
  }
  prepareLabelChat(input) {
    return {
      chatId: normalizeChatId(this.requireTo(input.chatId)),
      labelId: this.requireLabelId(input.labelId)
    };
  }
  /** `labelId` é opaco (mesmo critério de `groupId` — ver ADR-0009): não passa por `normalizeChatId`. */
  requireLabelId(labelId) {
    if (typeof labelId !== "string" || labelId.trim().length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'Campo "labelId" \xE9 obrigat\xF3rio.', {
        provider: this.provider
      });
    }
    return labelId;
  }
  prepareCreateChannel(input) {
    if (typeof input.name !== "string" || input.name.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'channels.create exige "name" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    return input;
  }
  /** `channelId` é opaco (mesmo critério de `groupId`/`labelId` — ver ADR-0009/0016): não passa por `normalizeChatId`. */
  requireChannelId(channelId) {
    if (typeof channelId !== "string" || channelId.trim().length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'Campo "channelId" \xE9 obrigat\xF3rio.', {
        provider: this.provider
      });
    }
    return channelId;
  }
  /** Ver ADR-0021. `channelId` é opaco (mesmo critério de `requireChannelId`). */
  prepareGetChannelMessages(input) {
    return { ...input, channelId: this.requireChannelId(input.channelId) };
  }
  prepareMarkChannelMessagesViewed(input) {
    if (!Array.isArray(input.messageIds) || input.messageIds.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'channels.markViewed exige "messageIds" com ao menos 1 item.',
        { provider: this.provider }
      );
    }
    return { channelId: this.requireChannelId(input.channelId), messageIds: input.messageIds };
  }
  /** Emoji vazio remove uma reação já enviada — mesma convenção de `prepareSendReaction` (ADR-0008). */
  prepareReactToChannelMessage(input) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'channels.reactToPost exige "messageId" n\xE3o vazio.',
        { provider: this.provider }
      );
    }
    if (typeof input.emoji !== "string") {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'channels.reactToPost exige "emoji" (string vazia remove uma rea\xE7\xE3o anterior).',
        { provider: this.provider }
      );
    }
    return { ...input, channelId: this.requireChannelId(input.channelId) };
  }
  /** Ver ADR-0020. `raw` é opaco — repassado como o consumidor forneceu, sem validação. */
  prepareDownloadMedia(input) {
    if (typeof input.messageId !== "string" || input.messageId.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'messages.download exige "messageId" n\xE3o vazio.',
        {
          provider: this.provider
        }
      );
    }
    return input;
  }
  /** Ao menos 1 campo é obrigatório (ver `UpdateBusinessProfileInput`/ADR-0018) — nenhum provider confirmado aceita update vazio. */
  prepareUpdateBusinessProfile(input) {
    if (input.description === void 0 && input.address === void 0 && input.email === void 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'business.updateProfile exige ao menos 1 campo ("description", "address" ou "email").',
        { provider: this.provider }
      );
    }
    return input;
  }
  prepareMakeCall(input) {
    return {
      to: normalizeChatId(this.requireTo(input.to)),
      durationSeconds: input.durationSeconds
    };
  }
  /**
   * `callerId`, quando presente, é normalizado como um chatId comum (não é opaco, diferente de
   * `callId` — ver ADR-0019). A obrigatoriedade de `callId`/`callerId` varia por provider (uazapi
   * não exige nenhum dos dois; WPPConnect só exige `callId`; WAHA/Whapi/Wuzapi/Evolution GO exigem
   * ambos) — por isso essa checagem fica no ADAPTER, não aqui (não é uma regra universal).
   */
  prepareRejectCall(input) {
    if (input.callerId !== void 0 && input.callerId.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'Campo "callerId" n\xE3o pode ser vazio quando fornecido.',
        { provider: this.provider }
      );
    }
    return {
      callId: input.callId,
      callerId: input.callerId !== void 0 ? normalizeChatId(input.callerId) : void 0
    };
  }
  /**
   * Guard-rail comum aos métodos opcionais de `MessagesApi` (`sendReaction`/`edit`/`delete`/
   * `forward`/`star`/`unstar`/`pin`/`unpin`/`markRead`/`sendLocation`/`sendContactCard`/
   * `sendPoll`) — generaliza o que antes era inline só para `sendReaction` (ADR-0008), sem mudar o
   * texto do erro nem o comportamento observável. Reaproveitado para `edit`/`delete` (ADR-0012),
   * `forward`/`star`/`unstar`/`pin`/`unpin`/`markRead` (ADR-0013) e `sendLocation`/
   * `sendContactCard`/`sendPoll` (ADR-0014).
   */
  async callMessagesMethod(method, capability, invoke) {
    this.assertCapability(capability);
    const fn = this.adapter.messages[method];
    if (!fn) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `Adapter "${this.provider}" declara a capability "${capability}" mas n\xE3o implementa messages.${String(method)} \u2014 isso \xE9 um bug no adapter, n\xE3o uma entrada inv\xE1lida.`,
        { provider: this.provider }
      );
    }
    return invoke(fn);
  }
  /**
   * Guard-rail comum aos 7 métodos de `groups.*`: checa a capability e, se o adapter a declarou
   * sem de fato implementar o método correspondente, lança `PROVIDER_ERROR` (bug do adapter, não
   * entrada inválida) — mesmo padrão do `sendReaction` (ADR-0008), reaproveitado (ADR-0009).
   */
  async callGroupsMethod(method, capability, invoke) {
    this.assertCapability(capability);
    const fn = this.adapter.groups[method];
    if (!fn) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `Adapter "${this.provider}" declara a capability "${capability}" mas n\xE3o implementa groups.${String(method)} \u2014 isso \xE9 um bug no adapter, n\xE3o uma entrada inv\xE1lida.`,
        { provider: this.provider }
      );
    }
    return invoke(fn);
  }
  /**
   * Guard-rail comum aos 5 métodos de `contacts.*`: mesmo padrão de `callGroupsMethod` (ADR-0009),
   * reaproveitado para `contacts.*` (ADR-0010).
   */
  async callContactsMethod(method, capability, invoke) {
    this.assertCapability(capability);
    const fn = this.adapter.contacts[method];
    if (!fn) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `Adapter "${this.provider}" declara a capability "${capability}" mas n\xE3o implementa contacts.${String(method)} \u2014 isso \xE9 um bug no adapter, n\xE3o uma entrada inv\xE1lida.`,
        { provider: this.provider }
      );
    }
    return invoke(fn);
  }
  /**
   * Guard-rail de `chats.*` — mesmo padrão de `callGroupsMethod`/`callContactsMethod`, com uma
   * diferença: `this.adapter.chats` pode ser `undefined` inteiro (namespace opcional, ver
   * ADR-0012), não só o método individual. `?.` cobre os dois casos com o mesmo `PROVIDER_ERROR`
   * — nunca um `TypeError` por acessar propriedade de `undefined`.
   */
  async callChatsMethod(method, capability, invoke) {
    this.assertCapability(capability);
    const fn = this.adapter.chats?.[method];
    if (!fn) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `Adapter "${this.provider}" declara a capability "${capability}" mas n\xE3o implementa chats.${String(method)} \u2014 isso \xE9 um bug no adapter, n\xE3o uma entrada inv\xE1lida.`,
        { provider: this.provider }
      );
    }
    return invoke(fn);
  }
  /**
   * Guard-rail de `presence.*` — mesmo padrão de `callChatsMethod` (namespace inteiro opcional no
   * adapter, ver ADR-0015).
   */
  async callPresenceMethod(method, capability, invoke) {
    this.assertCapability(capability);
    const fn = this.adapter.presence?.[method];
    if (!fn) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `Adapter "${this.provider}" declara a capability "${capability}" mas n\xE3o implementa presence.${String(method)} \u2014 isso \xE9 um bug no adapter, n\xE3o uma entrada inv\xE1lida.`,
        { provider: this.provider }
      );
    }
    return invoke(fn);
  }
  /**
   * Guard-rail de `labels.*` — mesmo padrão de `callPresenceMethod`/`callChatsMethod` (namespace
   * inteiro opcional no adapter, ver ADR-0016).
   */
  async callLabelsMethod(method, capability, invoke) {
    this.assertCapability(capability);
    const fn = this.adapter.labels?.[method];
    if (!fn) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `Adapter "${this.provider}" declara a capability "${capability}" mas n\xE3o implementa labels.${String(method)} \u2014 isso \xE9 um bug no adapter, n\xE3o uma entrada inv\xE1lida.`,
        { provider: this.provider }
      );
    }
    return invoke(fn);
  }
  /**
   * Guard-rail de `channels.*` — mesmo padrão de `callLabelsMethod`/`callPresenceMethod` (namespace
   * inteiro opcional no adapter, ver ADR-0017).
   */
  async callChannelsMethod(method, capability, invoke) {
    this.assertCapability(capability);
    const fn = this.adapter.channels?.[method];
    if (!fn) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `Adapter "${this.provider}" declara a capability "${capability}" mas n\xE3o implementa channels.${String(method)} \u2014 isso \xE9 um bug no adapter, n\xE3o uma entrada inv\xE1lida.`,
        { provider: this.provider }
      );
    }
    return invoke(fn);
  }
  /**
   * Guard-rail de `business.*` — mesmo padrão de `callChannelsMethod`/`callLabelsMethod`
   * (namespace inteiro opcional no adapter, ver ADR-0018).
   */
  async callBusinessMethod(method, capability, invoke) {
    this.assertCapability(capability);
    const fn = this.adapter.business?.[method];
    if (!fn) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `Adapter "${this.provider}" declara a capability "${capability}" mas n\xE3o implementa business.${String(method)} \u2014 isso \xE9 um bug no adapter, n\xE3o uma entrada inv\xE1lida.`,
        { provider: this.provider }
      );
    }
    return invoke(fn);
  }
  /**
   * Guard-rail de `calls.*` — mesmo padrão de `callBusinessMethod`/`callChannelsMethod`
   * (namespace inteiro opcional no adapter, ver ADR-0019).
   */
  async callCallsMethod(method, capability, invoke) {
    this.assertCapability(capability);
    const fn = this.adapter.calls?.[method];
    if (!fn) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `Adapter "${this.provider}" declara a capability "${capability}" mas n\xE3o implementa calls.${String(method)} \u2014 isso \xE9 um bug no adapter, n\xE3o uma entrada inv\xE1lida.`,
        { provider: this.provider }
      );
    }
    return invoke(fn);
  }
  /**
   * `chatId` de contato NÃO é opaco (diferente de `groupId` — ver ADR-0010): é o mesmo chatId
   * canônico de `messages.*`, então passa por `normalizeChatId` normalmente.
   */
  requireChatId(chatId) {
    return normalizeChatId(this.requireTo(chatId));
  }
  prepareCreateGroup(input) {
    if (typeof input.subject !== "string" || input.subject.length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'groups.create exige "subject" n\xE3o vazio.', {
        provider: this.provider
      });
    }
    return { ...input, participants: this.normalizeParticipants(input.participants) };
  }
  prepareGroupParticipants(input) {
    return {
      groupId: this.requireGroupId(input.groupId),
      participants: this.normalizeParticipants(input.participants)
    };
  }
  prepareUpdateGroupSubject(input) {
    if (typeof input.subject !== "string" || input.subject.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'groups.updateSubject exige "subject" n\xE3o vazio.',
        { provider: this.provider }
      );
    }
    return { groupId: this.requireGroupId(input.groupId), subject: input.subject };
  }
  /** Descrição vazia é válida: limpa a descrição do grupo (suportado por todos os providers pesquisados). */
  prepareUpdateGroupDescription(input) {
    if (typeof input.description !== "string") {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'groups.updateDescription exige "description" (string vazia limpa a descri\xE7\xE3o).',
        { provider: this.provider }
      );
    }
    return { groupId: this.requireGroupId(input.groupId), description: input.description };
  }
  prepareUpdateGroupPicture(input) {
    const media = this.requireImageMedia(input.media);
    return { groupId: this.requireGroupId(input.groupId), media };
  }
  requireImageMedia(media) {
    if (media?.kind !== "image") {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'groups.updatePicture exige "media.kind" igual a "image".',
        { provider: this.provider }
      );
    }
    if (media.url === void 0 && media.base64 === void 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'groups.updatePicture exige "media.url" ou "media.base64".',
        { provider: this.provider }
      );
    }
    return media;
  }
  /**
   * `invite` aceita código bare ou link completo do chamador — normalizado aqui para SEMPRE o
   * link completo antes de chegar ao adapter (constante universal do protocolo WhatsApp, não
   * opaca por provider como `groupId` — ver `normalizeInviteLink`/ADR-0009). Adapters que
   * precisam só do código (ex.: Wuzapi) usam `extractInviteCode` por conta própria.
   */
  prepareJoinViaInviteLink(input) {
    if (typeof input.invite !== "string" || input.invite.trim().length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'groups.joinViaInviteLink exige "invite" (c\xF3digo ou link do convite) n\xE3o vazio.',
        { provider: this.provider }
      );
    }
    return { invite: normalizeInviteLink(input.invite.trim()) };
  }
  normalizeParticipants(participants) {
    if (!Array.isArray(participants) || participants.length === 0) {
      throw new WaConnectorError(
        "INVALID_INPUT",
        'groups.* exige "participants" com ao menos um telefone/JID.',
        { provider: this.provider }
      );
    }
    return participants.map((participant) => normalizeChatId(this.requireTo(participant)));
  }
  /**
   * `groupId` é opaco (ver ADR-0009 e `GroupInfo.id`) — diferente de `to`, NÃO passa por
   * `normalizeChatId` (a Z-API usa um ID sintético sem `@` que `normalizeChatId` corromperia).
   */
  requireGroupId(groupId) {
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'Campo "groupId" \xE9 obrigat\xF3rio.', {
        provider: this.provider
      });
    }
    return groupId;
  }
  requireTo(to) {
    if (typeof to !== "string" || to.trim().length === 0) {
      throw new WaConnectorError("INVALID_INPUT", 'Campo "to" \xE9 obrigat\xF3rio.', {
        provider: this.provider
      });
    }
    return to;
  }
  parseWebhook(input) {
    try {
      const events = this.adapter.parseWebhook(input);
      if (!Array.isArray(events)) {
        return [this.unknownEvent(input, "Adapter retornou valor n\xE3o-array em parseWebhook.")];
      }
      return events;
    } catch (error) {
      return [this.unknownEvent(input, error instanceof Error ? error.message : String(error))];
    }
  }
  unknownEvent(input, reason) {
    return { type: "unknown", provider: this.provider, raw: input.body, reason };
  }
};
function createConnector(adapter) {
  return new WaConnector(adapter);
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

// src/core/types.ts
var INSTANCE_STATES = [
  "disconnected",
  "connecting",
  "qr",
  "connected",
  "unknown"
];
var MESSAGE_ACKS = ["pending", "sent", "delivered", "read", "played", "error"];

exports.CAPABILITIES = CAPABILITIES;
exports.HttpClient = HttpClient;
exports.INSTANCE_STATES = INSTANCE_STATES;
exports.MESSAGE_ACKS = MESSAGE_ACKS;
exports.UnsupportedCapabilityError = UnsupportedCapabilityError;
exports.WaConnector = WaConnector;
exports.WaConnectorError = WaConnectorError;
exports.createConnector = createConnector;
exports.digitsOnly = digitsOnly;
exports.hasCapability = hasCapability;
exports.isGroupChatId = isGroupChatId;
exports.isJid = isJid;
exports.isKnownCapability = isKnownCapability;
exports.isWaConnectorError = isWaConnectorError;
exports.normalizeChatId = normalizeChatId;
exports.redactSecrets = redactSecrets;
exports.statusToErrorCode = statusToErrorCode;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map