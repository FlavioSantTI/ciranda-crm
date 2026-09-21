import { HttpClient } from '../../chunk-SYMHJK3P.js';
import { normalizeInviteLink } from '../../chunk-SWRBCMQ6.js';
import { WaConnectorError } from '../../chunk-JIDVFSO6.js';
import { createHmac, timingSafeEqual } from 'crypto';

var PROVIDER = "waha";
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
    provider: PROVIDER,
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
      return { qr: extractQr(qrBody), raw: qrBody };
    },
    status: async () => {
      const body = await http.request({
        method: "GET",
        path: `/api/sessions/${encodeURIComponent(session)}`
      });
      const record = asRecord(body);
      return {
        state: mapWahaStatus(record ? asString(record.status) : void 0),
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
      return mapSentMessage(body, chatId);
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
      return mapSentMessage(body, chatId);
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
      return mapSentMessage(body, chatId);
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
      return mapSentMessage(body, chatId);
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
      return mapSentMessage(body, chatId);
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
      return mapSentMessage(body, chatId);
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
      return mapSentMessage(body, chatId);
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
      return mapSentMessage(body, chatId);
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
      return mapGroupInfo(body, { subject: input.subject, participants: input.participants });
    },
    getInfo: async (groupId) => {
      const body = await http.request({
        method: "GET",
        path: `/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(toWahaGroupId(groupId))}`
      });
      return mapGroupInfo(body, { id: groupId });
    },
    list: async () => {
      const body = await http.request({
        method: "GET",
        path: `/api/${encodeURIComponent(session)}/groups`
      });
      const items = Array.isArray(body) ? body : [];
      return items.map((item) => mapGroupInfo(item));
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
      return mapCheckExistsResult(body);
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
    reject: async (input) => rejectCall(http, session, input)
  };
  return {
    provider: PROVIDER,
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
async function rejectCall(http, session, input) {
  if (!input.callerId || !input.callId) {
    throw new WaConnectorError(
      "INVALID_INPUT",
      'calls.reject no WAHA exige "callerId" e "callId" (schema RejectCallRequest {from, id}).',
      { provider: PROVIDER }
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
    provider: PROVIDER
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
function extractQr(body) {
  const record = asRecord(body);
  if (!record) return void 0;
  return asString(record.value) ?? asString(record.data);
}
function mapSentMessage(body, requestedChatId) {
  const record = asRecord(body);
  const id = (record ? asString(record.id) : void 0) ?? `waha-${Date.now()}`;
  const chatId = (record ? asString(record.chatId) ?? asString(record.to) : void 0) ?? requestedChatId;
  const timestampRaw = record ? asNumber(record.timestamp) : void 0;
  return {
    id,
    chatId,
    timestamp: timestampRaw === void 0 ? void 0 : normalizeTimestamp(timestampRaw),
    raw: body
  };
}
function mapGroupParticipant(entry) {
  const record = asRecord(entry);
  if (!record) return void 0;
  const id = asString(record.pn) ?? asString(record.id);
  if (id === void 0) return void 0;
  const role = asString(record.role);
  return {
    id,
    isAdmin: role === "admin" || role === "superadmin",
    isSuperAdmin: role === "superadmin"
  };
}
function mapGroupParticipants(value) {
  if (!Array.isArray(value)) return void 0;
  const mapped = [];
  for (const entry of value) {
    const participant = mapGroupParticipant(entry);
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
  const participants = mapGroupParticipants(value);
  if (!participants || participants.length === 0) return void 0;
  return participants.map((participant) => participant.id);
}
function mapGroupInfo(body, fallback = {}) {
  const record = asRecord(body);
  const id = (record ? asString(record.id) : void 0) ?? fallback.id ?? `waha-group-${Date.now()}`;
  const subject = (record ? asString(record.subject) : void 0) ?? fallback.subject ?? "";
  const description = record ? asString(record.description) : void 0;
  const participants = (record ? mapGroupParticipants(record.participants) : void 0) ?? (fallback.participants ?? []).map((participantId) => ({
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
  const record = asRecord(body);
  const idSource = (record ? asString(record.id) : void 0) ?? (record ? asString(record.number) : void 0);
  const id = idSource === void 0 ? "unknown" : toWahaChatId(idSource);
  const name = (record ? asString(record.name) : void 0) ?? (record ? asString(record.pushname) : void 0);
  return {
    id,
    name,
    hasWhatsApp: record ? asBoolean(record.isWAContact) : void 0,
    isBlocked: record ? asBoolean(record.isBlocked) : void 0,
    raw: body
  };
}
function mapCheckExistsResult(body) {
  const record = asRecord(body);
  const chatIdRaw = record ? asString(record.chatId) : void 0;
  return {
    exists: (record ? asBoolean(record.numberExists) : void 0) ?? false,
    chatId: chatIdRaw === void 0 ? void 0 : toWahaChatId(chatIdRaw),
    raw: body
  };
}
function mapContactProfilePicture(body) {
  const record = asRecord(body);
  return {
    url: record ? asString(record.profilePictureURL) : void 0,
    raw: body
  };
}
function mapContactAbout(body) {
  const record = asRecord(body);
  return {
    about: record ? asString(record.about) : void 0,
    raw: body
  };
}
function mapWahaLabel(body, fallback = {}) {
  const record = asRecord(body);
  const id = (record ? asString(record.id) : void 0) ?? `waha-label-${Date.now()}`;
  const name = (record ? asString(record.name) : void 0) ?? fallback.name ?? "";
  const colorRaw = record?.color;
  const color = typeof colorRaw === "string" ? colorRaw : typeof colorRaw === "number" ? String(colorRaw) : fallback.color;
  return { id, name, color, raw: body };
}
function mapWahaChannel(body, fallback = {}) {
  const record = asRecord(body);
  const id = (record ? asString(record.id) : void 0) ?? fallback.id ?? `waha-channel-${Date.now()}`;
  const name = (record ? asString(record.name) : void 0) ?? fallback.name ?? "";
  const description = (record ? asString(record.description) : void 0) ?? fallback.description;
  const subscribersCount = record ? asNumber(record.subscribersCount) : void 0;
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
function mapMessageKind(hasMedia, mimetype) {
  if (!hasMedia) return "text";
  if (mimetype === void 0) return "unknown";
  return mapMediaKindFromMime(mimetype);
}
function mapWahaMessage(payload) {
  const fromMe = asBoolean(payload.fromMe) ?? false;
  const from = asString(payload.from);
  const to = asString(payload.to);
  const chatId = (fromMe ? to : from) ?? from ?? to ?? "unknown";
  const hasMedia = asBoolean(payload.hasMedia) ?? false;
  const mediaRecord = asRecord(payload.media);
  const mediaUrl = mediaRecord ? asString(mediaRecord.url) : void 0;
  const mediaMimetype = mediaRecord ? asString(mediaRecord.mimetype) : void 0;
  const media = hasMedia && mediaUrl !== void 0 ? {
    kind: mapMediaKindFromMime(mediaMimetype),
    url: mediaUrl,
    mimeType: mediaMimetype,
    filename: mediaRecord ? asString(mediaRecord.filename) : void 0
  } : void 0;
  const timestampRaw = asNumber(payload.timestamp) ?? Math.floor(Date.now() / 1e3);
  const replyTo = asRecord(payload.replyTo);
  const quotedId = replyTo ? asString(replyTo.id) : void 0;
  return {
    id: asString(payload.id) ?? `waha-unknown-${Date.now()}`,
    chatId,
    from,
    fromMe,
    timestamp: normalizeTimestamp(timestampRaw),
    kind: mapMessageKind(hasMedia, mediaMimetype),
    text: asString(payload.body),
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
      return [unknownEvent(body, verification.reason)];
    }
  }
  const envelope = asRecord(body);
  if (!envelope) {
    return [unknownEvent(body, "Corpo do webhook WAHA n\xE3o \xE9 um objeto JSON.")];
  }
  const eventName = asString(envelope.event);
  const session = asString(envelope.session) ?? defaultSession;
  const payload = asRecord(envelope.payload);
  if (eventName === "message") {
    if (!payload) {
      return [unknownEvent(body, 'Evento "message" do WAHA sem "payload".')];
    }
    const message = mapWahaMessage(payload);
    return [
      {
        type: message.fromMe ? "message.sent" : "message.received",
        provider: PROVIDER,
        instanceId: session,
        message,
        raw: body
      }
    ];
  }
  if (eventName === "message.ack") {
    if (!payload) {
      return [unknownEvent(body, 'Evento "message.ack" do WAHA sem "payload".')];
    }
    return [
      {
        type: "message.ack",
        provider: PROVIDER,
        instanceId: session,
        messageId: asString(payload.id) ?? "unknown",
        chatId: asString(payload.from),
        ack: mapWahaAck(asString(payload.ackName), asNumber(payload.ack)),
        raw: body
      }
    ];
  }
  if (eventName === "session.status") {
    if (!payload) {
      return [unknownEvent(body, 'Evento "session.status" do WAHA sem "payload".')];
    }
    const connectionUpdate = {
      type: "connection.update",
      provider: PROVIDER,
      instanceId: session,
      state: mapWahaStatus(asString(payload.status)),
      raw: body
    };
    return [connectionUpdate];
  }
  if (eventName === "group.v2.participants") {
    if (!payload) {
      return [unknownEvent(body, 'Evento "group.v2.participants" do WAHA sem "payload".')];
    }
    const group = asRecord(payload.group);
    const groupId = group ? asString(group.id) : void 0;
    const action = mapGroupParticipantsAction(asString(payload.type));
    if (groupId === void 0 || action === void 0) {
      return [
        unknownEvent(
          body,
          `Evento "group.v2.participants" do WAHA sem "group.id" ou "type" reconhecido ("${asString(payload.type) ?? "(ausente)"}").`
        )
      ];
    }
    const groupUpdate = {
      type: "group.update",
      provider: PROVIDER,
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
      return [unknownEvent(body, 'Evento "group.v2.update" do WAHA sem "payload".')];
    }
    const group = asRecord(payload.group);
    const groupId = group ? asString(group.id) : void 0;
    if (groupId === void 0) {
      return [unknownEvent(body, 'Evento "group.v2.update" do WAHA sem "group.id".')];
    }
    const groupUpdates = [];
    const subject = group ? asString(group.subject) : void 0;
    if (subject !== void 0) {
      groupUpdates.push({
        type: "group.update",
        provider: PROVIDER,
        instanceId: session,
        groupId,
        action: "subject",
        raw: body
      });
    }
    const description = group ? asString(group.description) : void 0;
    if (description !== void 0) {
      groupUpdates.push({
        type: "group.update",
        provider: PROVIDER,
        instanceId: session,
        groupId,
        action: "description",
        raw: body
      });
    }
    if (groupUpdates.length === 0) {
      return [
        unknownEvent(
          body,
          'Evento "group.v2.update" do WAHA sem "subject"/"description" reconhec\xEDveis em "group".'
        )
      ];
    }
    return groupUpdates;
  }
  if (eventName === "group.v2.join") {
    if (!payload) {
      return [unknownEvent(body, 'Evento "group.v2.join" do WAHA sem "payload".')];
    }
    const group = asRecord(payload.group);
    const groupId = group ? asString(group.id) : void 0;
    if (groupId === void 0) {
      return [unknownEvent(body, 'Evento "group.v2.join" do WAHA sem "group.id".')];
    }
    const groupUpdate = {
      type: "group.update",
      provider: PROVIDER,
      instanceId: session,
      groupId,
      action: "participants.add",
      raw: body
    };
    return [groupUpdate];
  }
  if (eventName === "group.v2.leave") {
    if (!payload) {
      return [unknownEvent(body, 'Evento "group.v2.leave" do WAHA sem "payload".')];
    }
    const group = asRecord(payload.group);
    const groupId = group ? asString(group.id) : void 0;
    if (groupId === void 0) {
      return [unknownEvent(body, 'Evento "group.v2.leave" do WAHA sem "group.id".')];
    }
    const groupUpdate = {
      type: "group.update",
      provider: PROVIDER,
      instanceId: session,
      groupId,
      action: "participants.remove",
      raw: body
    };
    return [groupUpdate];
  }
  return [
    unknownEvent(
      body,
      `Evento WAHA n\xE3o mapeado nesta fase: "${eventName ?? '(sem campo "event")'}".`
    )
  ];
}
function unknownEvent(raw, reason) {
  return { type: "unknown", provider: PROVIDER, raw, reason };
}
function verifyWahaHmac(input, webhookHmacKey) {
  if (input.rawBody === void 0) {
    return {
      valid: false,
      reason: "webhookHmacKey est\xE1 configurada, mas WebhookInput.rawBody n\xE3o foi fornecido \u2014 a verifica\xE7\xE3o HMAC exige o corpo bruto do request (ver docs/providers/waha.md#verifica\xE7\xE3o-hmac-de-webhooks). Falhando fechado: webhook tratado como n\xE3o verific\xE1vel, n\xE3o processado."
    };
  }
  const receivedSignature = firstHeaderValue(input.headers, "x-webhook-hmac");
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
function firstHeaderValue(headers, name) {
  if (!headers) return void 0;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return void 0;
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

export { waha };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map