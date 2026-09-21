import { WaConnectorError } from './chunk-JIDVFSO6.js';

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

export { digitsOnly, extractInviteCode, isGroupChatId, isJid, normalizeChatId, normalizeInviteLink };
//# sourceMappingURL=chunk-SWRBCMQ6.js.map
//# sourceMappingURL=chunk-SWRBCMQ6.js.map