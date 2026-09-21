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

// src/core/types.ts
var INSTANCE_STATES = [
  "disconnected",
  "connecting",
  "qr",
  "connected",
  "unknown"
];
var MESSAGE_ACKS = ["pending", "sent", "delivered", "read", "played", "error"];

export { CAPABILITIES, INSTANCE_STATES, MESSAGE_ACKS, hasCapability, isKnownCapability };
//# sourceMappingURL=chunk-OV6FCCMA.js.map
//# sourceMappingURL=chunk-OV6FCCMA.js.map