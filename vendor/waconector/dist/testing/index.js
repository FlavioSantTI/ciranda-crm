import { CAPABILITIES, MESSAGE_ACKS, INSTANCE_STATES } from '../chunk-OV6FCCMA.js';
import { extractInviteCode, normalizeInviteLink } from '../chunk-SWRBCMQ6.js';
import { WaConnectorError } from '../chunk-JIDVFSO6.js';

// src/testing/mock-adapter.ts
var MockAdapter = class {
  provider;
  capabilities;
  outbox = [];
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
  state;
  seq = 0;
  groupSeq = 0;
  inviteSeq = 0;
  labelSeq = 0;
  channelSeq = 0;
  groupsById = /* @__PURE__ */ new Map();
  groupIdByInviteCode = /* @__PURE__ */ new Map();
  contactsById = /* @__PURE__ */ new Map();
  blockedIds = /* @__PURE__ */ new Set();
  archivedChatIds = /* @__PURE__ */ new Set();
  mutedChatIds = /* @__PURE__ */ new Set();
  pinnedChatIds = /* @__PURE__ */ new Set();
  unreadChatIds = /* @__PURE__ */ new Set();
  starredMessageIds = /* @__PURE__ */ new Set();
  pinnedMessageIds = /* @__PURE__ */ new Set();
  readMessageIds = /* @__PURE__ */ new Set();
  globalPresence;
  typingStateByChatId = /* @__PURE__ */ new Map();
  subscribedPresenceChatIds = /* @__PURE__ */ new Set();
  labelsById = /* @__PURE__ */ new Map();
  labelIdsByChatId = /* @__PURE__ */ new Map();
  channelsById = /* @__PURE__ */ new Map();
  followedChannelIds = /* @__PURE__ */ new Set();
  businessProfile = { raw: { mock: true } };
  constructor(options = {}) {
    this.provider = options.provider ?? "mock";
    this.capabilities = options.capabilities ?? CAPABILITIES;
    this.state = options.initialState ?? "disconnected";
    this.instance = {
      connect: async () => {
        this.state = "qr";
        return { qr: "mock-qr-code", raw: { mock: true } };
      },
      status: async () => ({ state: this.state, raw: { mock: true } }),
      logout: async () => {
        this.state = "disconnected";
      }
    };
    this.messages = {
      sendText: async (input) => this.deliver(input),
      sendMedia: async (input) => this.deliver(input),
      sendReaction: async (input) => this.deliver(input),
      edit: async (input) => {
        this.assertConnected();
        return {
          id: input.messageId,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input }
        };
      },
      delete: async (input) => {
        this.assertConnected();
      },
      forward: async (input) => {
        this.assertConnected();
        return {
          id: `mock-${++this.seq}`,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input }
        };
      },
      star: async (input) => {
        this.assertConnected();
        this.starredMessageIds.add(input.messageId);
      },
      unstar: async (input) => {
        this.assertConnected();
        this.starredMessageIds.delete(input.messageId);
      },
      pin: async (input) => {
        this.assertConnected();
        this.pinnedMessageIds.add(input.messageId);
      },
      unpin: async (input) => {
        this.assertConnected();
        this.pinnedMessageIds.delete(input.messageId);
      },
      markRead: async (input) => {
        this.assertConnected();
        this.readMessageIds.add(input.messageId);
      },
      sendLocation: async (input) => {
        this.assertConnected();
        return {
          id: `mock-${++this.seq}`,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input }
        };
      },
      sendContactCard: async (input) => {
        this.assertConnected();
        return {
          id: `mock-${++this.seq}`,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input }
        };
      },
      sendPoll: async (input) => {
        this.assertConnected();
        return {
          id: `mock-${++this.seq}`,
          chatId: input.to,
          timestamp: Date.now(),
          raw: { mock: true, input }
        };
      },
      download: async (input) => {
        this.assertConnected();
        return {
          base64: "bW9jay1kb3dubG9hZA==",
          mimeType: "application/octet-stream",
          raw: { mock: true, input }
        };
      }
    };
    this.groups = {
      create: async (input) => {
        this.assertConnected();
        const group = {
          id: `mock-group-${++this.groupSeq}`,
          subject: input.subject,
          participants: input.participants.map((id) => ({
            id,
            isAdmin: false,
            isSuperAdmin: false
          })),
          raw: { mock: true, input }
        };
        this.groupsById.set(group.id, group);
        return group;
      },
      getInfo: async (groupId) => this.requireGroup(groupId),
      list: async () => Array.from(this.groupsById.values()),
      addParticipants: async ({ groupId, participants }) => {
        this.assertConnected();
        const group = this.requireGroup(groupId);
        const existingIds = new Set(group.participants.map((participant) => participant.id));
        const added = participants.filter((id) => !existingIds.has(id)).map((id) => ({ id, isAdmin: false, isSuperAdmin: false }));
        this.groupsById.set(groupId, {
          ...group,
          participants: [...group.participants, ...added]
        });
      },
      removeParticipants: async ({ groupId, participants }) => {
        this.assertConnected();
        const group = this.requireGroup(groupId);
        const removed = new Set(participants);
        this.groupsById.set(groupId, {
          ...group,
          participants: group.participants.filter((participant) => !removed.has(participant.id))
        });
      },
      promoteParticipants: async ({ groupId, participants }) => {
        this.assertConnected();
        this.setAdminFlag(groupId, participants, true);
      },
      demoteParticipants: async ({ groupId, participants }) => {
        this.assertConnected();
        this.setAdminFlag(groupId, participants, false);
      },
      updateSubject: async ({ groupId, subject }) => {
        this.assertConnected();
        const group = this.requireGroup(groupId);
        this.groupsById.set(groupId, { ...group, subject });
      },
      updateDescription: async ({ groupId, description }) => {
        this.assertConnected();
        const group = this.requireGroup(groupId);
        this.groupsById.set(groupId, { ...group, description });
      },
      updatePicture: async ({ groupId }) => {
        this.assertConnected();
        this.requireGroup(groupId);
      },
      getInviteLink: async (groupId) => {
        this.assertConnected();
        this.requireGroup(groupId);
        return this.issueInviteLink(groupId);
      },
      revokeInviteLink: async (groupId) => {
        this.assertConnected();
        this.requireGroup(groupId);
        for (const [code, id] of this.groupIdByInviteCode) {
          if (id === groupId) this.groupIdByInviteCode.delete(code);
        }
        return this.issueInviteLink(groupId);
      },
      joinViaInviteLink: async ({ invite }) => {
        this.assertConnected();
        const code = extractInviteCode(invite);
        if (!this.groupIdByInviteCode.has(code)) {
          throw new WaConnectorError(
            "PROVIDER_ERROR",
            `MockAdapter: c\xF3digo de convite "${code}" inv\xE1lido ou expirado.`,
            { provider: this.provider }
          );
        }
      },
      leaveGroup: async (groupId) => {
        this.assertConnected();
        this.requireGroup(groupId);
        this.groupsById.delete(groupId);
      }
    };
    this.contacts = {
      list: async () => {
        this.assertConnected();
        return Array.from(this.contactsById.values());
      },
      get: async (chatId) => {
        this.assertConnected();
        return this.contactsById.get(chatId) ?? { id: chatId, hasWhatsApp: true, raw: { mock: true } };
      },
      checkExists: async (phone) => {
        this.assertConnected();
        const contact = this.contactsById.get(phone);
        return {
          exists: contact?.hasWhatsApp ?? true,
          chatId: phone,
          raw: { mock: true, contact }
        };
      },
      getProfilePicture: async (chatId) => {
        this.assertConnected();
        return { url: this.contactsById.get(chatId)?.profilePictureUrl, raw: { mock: true } };
      },
      getAbout: async (chatId) => {
        this.assertConnected();
        return { about: this.contactsById.get(chatId)?.about, raw: { mock: true } };
      },
      block: async (chatId) => {
        this.assertConnected();
        this.blockedIds.add(chatId);
        const contact = this.contactsById.get(chatId);
        if (contact) this.contactsById.set(chatId, { ...contact, isBlocked: true });
      },
      unblock: async (chatId) => {
        this.assertConnected();
        this.blockedIds.delete(chatId);
        const contact = this.contactsById.get(chatId);
        if (contact) this.contactsById.set(chatId, { ...contact, isBlocked: false });
      },
      listBlocked: async () => {
        this.assertConnected();
        return Array.from(this.blockedIds);
      }
    };
    this.chats = {
      archive: async (chatId) => {
        this.assertConnected();
        this.archivedChatIds.add(chatId);
      },
      unarchive: async (chatId) => {
        this.assertConnected();
        this.archivedChatIds.delete(chatId);
      },
      mute: async (chatId) => {
        this.assertConnected();
        this.mutedChatIds.add(chatId);
      },
      unmute: async (chatId) => {
        this.assertConnected();
        this.mutedChatIds.delete(chatId);
      },
      pin: async (chatId) => {
        this.assertConnected();
        this.pinnedChatIds.add(chatId);
      },
      unpin: async (chatId) => {
        this.assertConnected();
        this.pinnedChatIds.delete(chatId);
      },
      markRead: async (chatId) => {
        this.assertConnected();
        this.unreadChatIds.delete(chatId);
      },
      markUnread: async (chatId) => {
        this.assertConnected();
        this.unreadChatIds.add(chatId);
      }
    };
    this.presence = {
      setTyping: async (input) => {
        this.assertConnected();
        this.typingStateByChatId.set(input.to, input.state);
      },
      set: async (state) => {
        this.assertConnected();
        this.globalPresence = state;
      },
      subscribe: async (chatId) => {
        this.assertConnected();
        this.subscribedPresenceChatIds.add(chatId);
      }
    };
    this.labels = {
      list: async () => {
        this.assertConnected();
        return Array.from(this.labelsById.values());
      },
      create: async (input) => {
        this.assertConnected();
        const label = {
          id: `mock-label-${++this.labelSeq}`,
          name: input.name,
          color: input.color,
          raw: { mock: true, input }
        };
        this.labelsById.set(label.id, label);
        return label;
      },
      update: async (input) => {
        this.assertConnected();
        const label = this.requireLabel(input.labelId);
        this.labelsById.set(input.labelId, { ...label, name: input.name, color: input.color });
      },
      delete: async (labelId) => {
        this.assertConnected();
        this.requireLabel(labelId);
        this.labelsById.delete(labelId);
        for (const labelIds of this.labelIdsByChatId.values()) {
          labelIds.delete(labelId);
        }
      },
      addToChat: async ({ chatId, labelId }) => {
        this.assertConnected();
        this.requireLabel(labelId);
        const labelIds = this.labelIdsByChatId.get(chatId) ?? /* @__PURE__ */ new Set();
        labelIds.add(labelId);
        this.labelIdsByChatId.set(chatId, labelIds);
      },
      removeFromChat: async ({ chatId, labelId }) => {
        this.assertConnected();
        this.requireLabel(labelId);
        this.labelIdsByChatId.get(chatId)?.delete(labelId);
      }
    };
    this.channels = {
      list: async () => {
        this.assertConnected();
        return Array.from(this.channelsById.values());
      },
      create: async (input) => {
        this.assertConnected();
        const channel = {
          id: `mock-channel-${++this.channelSeq}@newsletter`,
          name: input.name,
          description: input.description,
          subscribersCount: 0,
          raw: { mock: true, input }
        };
        this.channelsById.set(channel.id, channel);
        return channel;
      },
      getInfo: async (channelId) => {
        this.assertConnected();
        return this.requireChannel(channelId);
      },
      delete: async (channelId) => {
        this.assertConnected();
        this.requireChannel(channelId);
        this.channelsById.delete(channelId);
        this.followedChannelIds.delete(channelId);
      },
      follow: async (channelId) => {
        this.assertConnected();
        this.requireChannel(channelId);
        this.followedChannelIds.add(channelId);
      },
      unfollow: async (channelId) => {
        this.assertConnected();
        this.requireChannel(channelId);
        this.followedChannelIds.delete(channelId);
      },
      getMessages: async ({ channelId }) => {
        this.assertConnected();
        this.requireChannel(channelId);
        return [];
      },
      markViewed: async ({ channelId }) => {
        this.assertConnected();
        this.requireChannel(channelId);
      },
      reactToPost: async ({ channelId, messageId }) => {
        this.assertConnected();
        this.requireChannel(channelId);
      }
    };
    this.business = {
      getProfile: async () => {
        this.assertConnected();
        return this.businessProfile;
      },
      updateProfile: async (input) => {
        this.assertConnected();
        this.businessProfile = {
          ...this.businessProfile,
          ...input.description !== void 0 ? { description: input.description } : {},
          ...input.address !== void 0 ? { address: input.address } : {},
          ...input.email !== void 0 ? { email: input.email } : {},
          raw: { mock: true, input }
        };
      }
    };
    this.calls = {
      make: async (input) => {
        this.assertConnected();
      },
      reject: async (input) => {
        this.assertConnected();
      }
    };
  }
  /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
  isChatArchived(chatId) {
    return this.archivedChatIds.has(chatId);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
  isChatMuted(chatId) {
    return this.mutedChatIds.has(chatId);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
  isChatPinned(chatId) {
    return this.pinnedChatIds.has(chatId);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
  isChatUnread(chatId) {
    return this.unreadChatIds.has(chatId);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `MessagesApi`). Ver ADR-0013. */
  isMessageStarred(messageId) {
    return this.starredMessageIds.has(messageId);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `MessagesApi`). Ver ADR-0013. */
  isMessagePinned(messageId) {
    return this.pinnedMessageIds.has(messageId);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `MessagesApi`). Ver ADR-0013. */
  isMessageRead(messageId) {
    return this.readMessageIds.has(messageId);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `PresenceApi`). Ver ADR-0015. */
  getGlobalPresence() {
    return this.globalPresence;
  }
  /** Consulta de estado só para testes (não faz parte do contrato `PresenceApi`). Ver ADR-0015. */
  getTypingState(chatId) {
    return this.typingStateByChatId.get(chatId);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `PresenceApi`). Ver ADR-0015. */
  isSubscribedToPresence(chatId) {
    return this.subscribedPresenceChatIds.has(chatId);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `LabelsApi`). Ver ADR-0016. */
  getChatLabelIds(chatId) {
    return Array.from(this.labelIdsByChatId.get(chatId) ?? []);
  }
  /** Consulta de estado só para testes (não faz parte do contrato `ChannelsApi`). Ver ADR-0017. */
  isFollowingChannel(channelId) {
    return this.followedChannelIds.has(channelId);
  }
  simulateConnected() {
    this.state = "connected";
  }
  simulateState(state) {
    this.state = state;
  }
  /** Semeia (ou atualiza) um contato conhecido pelo mock, usado por `list`/`get`/`checkExists`/etc. */
  simulateContact(contact) {
    this.contactsById.set(contact.id, contact);
  }
  parseWebhook(input) {
    const body = input.body;
    if (typeof body !== "object" || body === null) {
      return [this.unknown(input, "Payload n\xE3o reconhecido pelo MockAdapter.")];
    }
    const record = body;
    const event = asString(record.event);
    if (event === "message") {
      const from = asString(record.from);
      const fromMe = asBoolean(record.fromMe) ?? false;
      const message = {
        id: asString(record.id) ?? `mock-in-${++this.seq}`,
        chatId: asString(record.chatId) ?? from ?? "unknown",
        from,
        fromMe,
        timestamp: asNumber(record.timestamp) ?? Date.now(),
        kind: "text",
        text: asString(record.text),
        raw: body
      };
      return [
        {
          type: fromMe ? "message.sent" : "message.received",
          provider: this.provider,
          message,
          raw: body
        }
      ];
    }
    if (event === "reaction") {
      const from = asString(record.from);
      const fromMe = asBoolean(record.fromMe) ?? false;
      const message = {
        id: asString(record.id) ?? `mock-in-${++this.seq}`,
        chatId: asString(record.chatId) ?? from ?? "unknown",
        from,
        fromMe,
        timestamp: asNumber(record.timestamp) ?? Date.now(),
        kind: "reaction",
        reaction: {
          emoji: asString(record.emoji) ?? "",
          targetMessageId: asString(record.targetMessageId) ?? "unknown"
        },
        raw: body
      };
      return [
        {
          type: fromMe ? "message.sent" : "message.received",
          provider: this.provider,
          message,
          raw: body
        }
      ];
    }
    if (event === "ack") {
      return [
        {
          type: "message.ack",
          provider: this.provider,
          messageId: asString(record.messageId) ?? "unknown",
          chatId: asString(record.chatId),
          ack: asMessageAck(record.ack) ?? "sent",
          raw: body
        }
      ];
    }
    if (event === "connection") {
      return [
        {
          type: "connection.update",
          provider: this.provider,
          state: asInstanceState(record.state) ?? "unknown",
          qr: asString(record.qr),
          raw: body
        }
      ];
    }
    return [this.unknown(input, `Evento mock desconhecido: ${String(record.event)}`)];
  }
  /** Webhook sintético de mensagem de texto recebida, no formato que `parseWebhook` entende. */
  buildIncomingText(from, text) {
    return { body: { event: "message", from, chatId: from, text, fromMe: false } };
  }
  buildAck(messageId, ack) {
    return { body: { event: "ack", messageId, ack } };
  }
  /** Webhook sintético de reação recebida, no formato que `parseWebhook` entende. */
  buildReaction(from, targetMessageId, emoji) {
    return {
      body: { event: "reaction", from, chatId: from, targetMessageId, emoji, fromMe: false }
    };
  }
  buildConnectionUpdate(state, qr) {
    return { body: { event: "connection", state, qr } };
  }
  deliver(input) {
    this.assertConnected();
    const message = {
      id: `mock-${++this.seq}`,
      chatId: input.to,
      timestamp: Date.now(),
      raw: { mock: true, input }
    };
    this.outbox.push({ input, message });
    return message;
  }
  assertConnected() {
    if (this.state !== "connected") {
      throw new WaConnectorError(
        "INSTANCE_DISCONNECTED",
        "MockAdapter: inst\xE2ncia n\xE3o conectada (use simulateConnected()).",
        { provider: this.provider }
      );
    }
  }
  requireGroup(groupId) {
    const group = this.groupsById.get(groupId);
    if (!group) {
      throw new WaConnectorError("PROVIDER_ERROR", `MockAdapter: grupo "${groupId}" n\xE3o existe.`, {
        provider: this.provider
      });
    }
    return group;
  }
  requireLabel(labelId) {
    const label = this.labelsById.get(labelId);
    if (!label) {
      throw new WaConnectorError("PROVIDER_ERROR", `MockAdapter: label "${labelId}" n\xE3o existe.`, {
        provider: this.provider
      });
    }
    return label;
  }
  requireChannel(channelId) {
    const channel = this.channelsById.get(channelId);
    if (!channel) {
      throw new WaConnectorError(
        "PROVIDER_ERROR",
        `MockAdapter: canal "${channelId}" n\xE3o existe.`,
        { provider: this.provider }
      );
    }
    return channel;
  }
  issueInviteLink(groupId) {
    const code = `mock-invite-${++this.inviteSeq}`;
    this.groupIdByInviteCode.set(code, groupId);
    return { link: normalizeInviteLink(code), raw: { mock: true, groupId, code } };
  }
  setAdminFlag(groupId, participants, isAdmin) {
    const group = this.requireGroup(groupId);
    const targets = new Set(participants);
    this.groupsById.set(groupId, {
      ...group,
      participants: group.participants.map(
        (participant) => targets.has(participant.id) ? { ...participant, isAdmin, isSuperAdmin: isAdmin ? participant.isSuperAdmin : false } : participant
      )
    });
  }
  unknown(input, reason) {
    return { type: "unknown", provider: this.provider, raw: input.body, reason };
  }
};
function asString(value) {
  return typeof value === "string" ? value : void 0;
}
function asBoolean(value) {
  return typeof value === "boolean" ? value : void 0;
}
function asNumber(value) {
  return typeof value === "number" ? value : void 0;
}
function asMessageAck(value) {
  return typeof value === "string" && MESSAGE_ACKS.includes(value) ? value : void 0;
}
function asInstanceState(value) {
  return typeof value === "string" && INSTANCE_STATES.includes(value) ? value : void 0;
}

export { MockAdapter };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map