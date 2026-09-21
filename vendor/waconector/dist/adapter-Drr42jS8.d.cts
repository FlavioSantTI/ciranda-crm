/**
 * Capabilities declaradas: cada adapter anuncia exatamente o que o provider
 * suporta. O conector bloqueia chamadas fora do conjunto declarado com
 * `UnsupportedCapabilityError`, em vez de nivelar a API pelo mínimo
 * denominador comum.
 *
 * Este enum cresce junto com a superfície pública (novos namespaces em F1+).
 */
declare const CAPABILITIES: readonly ["instance.connect", "instance.pairingCode", "instance.status", "instance.logout", "messages.sendText", "messages.sendMedia", "messages.sendReaction", "messages.edit", "messages.delete", "messages.forward", "messages.star", "messages.unstar", "messages.pin", "messages.unpin", "messages.markRead", "messages.sendLocation", "messages.sendContactCard", "messages.sendPoll", "messages.download", "groups.create", "groups.getInfo", "groups.list", "groups.addParticipants", "groups.removeParticipants", "groups.promoteParticipants", "groups.demoteParticipants", "groups.updateSubject", "groups.updateDescription", "groups.updatePicture", "groups.getInviteLink", "groups.revokeInviteLink", "groups.joinViaInviteLink", "groups.leaveGroup", "contacts.list", "contacts.get", "contacts.checkExists", "contacts.getProfilePicture", "contacts.getAbout", "contacts.block", "contacts.unblock", "contacts.listBlocked", "chats.archive", "chats.unarchive", "chats.mute", "chats.unmute", "chats.pin", "chats.unpin", "chats.markRead", "chats.markUnread", "presence.setTyping", "presence.set", "presence.subscribe", "labels.list", "labels.create", "labels.update", "labels.delete", "labels.addToChat", "labels.removeFromChat", "channels.list", "channels.create", "channels.getInfo", "channels.delete", "channels.follow", "channels.unfollow", "channels.getMessages", "channels.markViewed", "channels.reactToPost", "business.getProfile", "business.updateProfile", "calls.make", "calls.reject", "webhooks.parse"];
type Capability = (typeof CAPABILITIES)[number];
type CapabilitySet = readonly Capability[];
declare function hasCapability(set: CapabilitySet, capability: Capability): boolean;
declare function isKnownCapability(value: string): value is Capability;

/**
 * Tipos canônicos do domínio waconector.
 *
 * Regra de ouro: normalizar o comum, preservar o específico — todo objeto
 * normalizado carrega `raw` com o payload original do provider.
 */
declare const INSTANCE_STATES: readonly ["disconnected", "connecting", "qr", "connected", "unknown"];
/** Estado normalizado de uma instância/sessão de WhatsApp. */
type InstanceState = (typeof INSTANCE_STATES)[number];
interface InstanceStatus {
    state: InstanceState;
    raw: unknown;
}
interface ConnectResult {
    /** Conteúdo do QR code (string/base64) quando o provider expõe. */
    qr?: string;
    /** Código de pareamento quando o provider suporta `instance.pairingCode`. */
    pairingCode?: string;
    raw: unknown;
}
declare const MESSAGE_ACKS: readonly ["pending", "sent", "delivered", "read", "played", "error"];
/** Status de entrega normalizado de uma mensagem. */
type MessageAck = (typeof MESSAGE_ACKS)[number];
type MessageKind = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'reaction' | 'poll' | 'unknown';
type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';
/**
 * Referência de mídia. Como entrada de `sendMedia`, pelo menos um entre `url` e `base64` deve
 * estar presente. Como saída em `WaMessage.media` (mensagem recebida), pode trazer só `id` quando
 * o provider não entrega `url`/`base64` prontos no webhook — nesse caso, `messages.download`
 * (ADR-0020) resolve o conteúdo real a partir do `messageId` (e de `WaMessage.raw`, para os
 * poucos providers stateless que precisam do descritor bruto original).
 */
interface MediaRef {
    kind: MediaKind;
    url?: string;
    base64?: string;
    mimeType?: string;
    filename?: string;
    /** Identificador opaco do arquivo no provider — nunca usado como entrada de `sendMedia`. */
    id?: string;
}
/** Detalhe de uma reação (presente em `WaMessage` quando `kind === 'reaction'`). */
interface ReactionInfo {
    /** Emoji da reação (ex.: `'👍'`). String vazia representa remoção de uma reação anterior. */
    emoji: string;
    /** ID da mensagem original que recebeu a reação. */
    targetMessageId: string;
}
/** Mensagem normalizada (recebida ou ecoada via webhook). */
interface WaMessage {
    id: string;
    chatId: string;
    from?: string;
    fromMe: boolean;
    /** Epoch em milissegundos. */
    timestamp: number;
    kind: MessageKind;
    text?: string;
    media?: MediaRef;
    quotedId?: string;
    /** Presente quando `kind === 'reaction'`. Ver ADR-0008. */
    reaction?: ReactionInfo;
    raw: unknown;
}
/** Resultado normalizado de um envio. */
interface SentMessage {
    id: string;
    chatId: string;
    /** Epoch em milissegundos, quando o provider informa. */
    timestamp?: number;
    raw: unknown;
}
/**
 * Ver ADR-0020. Baixa o arquivo de uma mensagem de mídia já recebida (`WaMessage.media.id`, sem
 * `url`/`base64` prontos). `messageId` é suficiente para providers com histórico server-side
 * (uazapi, Evolution GO, Whapi); `raw` (o `WaMessage.raw` da mensagem original) só é consumido por
 * providers stateless que não guardam histórico (ex.: izapia) e precisam do descritor bruto
 * original do webhook para resolver o download — os demais o ignoram.
 */
interface DownloadMediaInput {
    messageId: string;
    raw?: unknown;
}
interface DownloadedMedia {
    /** Conteúdo do arquivo, já em base64. */
    base64: string;
    mimeType?: string;
    filename?: string;
    raw: unknown;
}
interface SendTextInput {
    /** Telefone E.164 (com ou sem `+`/pontuação) ou JID explícito (`...@g.us`, `...@s.whatsapp.net`). */
    to: string;
    text: string;
    quotedId?: string;
    mentions?: string[];
}
interface SendMediaInput {
    to: string;
    media: MediaRef;
    caption?: string;
    quotedId?: string;
}
interface SendReactionInput {
    to: string;
    /** ID da mensagem a reagir. */
    messageId: string;
    /** Emoji da reação (ex.: `'👍'`). String vazia remove uma reação já enviada. */
    emoji: string;
}
/** Ver ADR-0012. */
interface EditMessageInput {
    to: string;
    /** ID da mensagem original a ser editada. */
    messageId: string;
    /**
     * Novo texto da mensagem. Alguns providers também aceitam editar a legenda de uma mídia já
     * enviada — não confirmado de forma uniforme entre providers, então o contrato canônico só
     * assume texto; cada adapter documenta no próprio dossiê se aceita mais que isso.
     */
    text: string;
}
/**
 * Ver ADR-0012. Semântica é sempre revogação ("apagar para todos") — nenhum campo de escopo
 * (`onlyLocal`/`forEveryone`) nesta fase: só um provider pesquisado confirma essa distinção em
 * código, os demais não têm alternativa "local" confirmada.
 */
interface DeleteMessageInput {
    to: string;
    /** ID da mensagem a ser apagada. */
    messageId: string;
}
/** Ver ADR-0013. */
interface ForwardMessageInput {
    /** Chat de DESTINO do encaminhamento. */
    to: string;
    /** ID da mensagem a ser encaminhada. */
    messageId: string;
    /**
     * Chat de ORIGEM da mensagem — só necessário para providers que não conseguem resolver a
     * origem sozinhos a partir do `messageId` (a maioria resolve, já que o formato do id costuma
     * autoidentificar o chat de origem). Ausente = o adapter usa só `messageId`.
     */
    fromChatId?: string;
}
/** Ver ADR-0013. Usado por `MessagesApi.star`/`unstar` (mesma forma para as duas direções). */
interface StarMessageInput {
    to: string;
    messageId: string;
}
/**
 * Ver ADR-0013. Usado por `MessagesApi.pin`/`unpin` (mesma forma para as duas direções). Sem
 * campo de duração — nenhum formato converge entre os providers pesquisados (mesmo critério já
 * usado para `chats.mute`, ADR-0012); cada adapter decide seu próprio default/sentinela.
 */
interface PinMessageInput {
    to: string;
    messageId: string;
}
/** Ver ADR-0013. Nível de MENSAGEM — distinto de `chats.markRead` (nível de conversa, ADR-0012). */
interface MarkMessageReadInput {
    to: string;
    messageId: string;
}
/**
 * Ver ADR-0014. Localização estática (não "ao vivo") — nenhum provider pesquisado confirma um
 * endpoint canônico de encerrar/atualizar uma live location já enviada, então esta fase cobre só o
 * envio simples.
 */
interface SendLocationInput {
    to: string;
    latitude: number;
    longitude: number;
    /** Rótulo/título do pin (ex.: nome do local). Alguns providers exigem, outros ignoram. */
    name?: string;
    address?: string;
}
/**
 * Ver ADR-0014. Cartão de contato único (`vCard`). Campos simples e não o vCard bruto: providers
 * pesquisados ou já aceitam campos soltos (nome + telefone) ou exigem um vCard já montado — para os
 * últimos, o próprio adapter monta a string a partir destes dois campos (é trabalho de tradução,
 * não de validação — mesma responsabilidade que já cabe ao adapter para outras capabilities).
 */
interface SendContactCardInput {
    to: string;
    contactName: string;
    contactPhone: string;
}
/**
 * Ver ADR-0014. `allowMultipleAnswers` ausente/`false` = escolha única (default mais restritivo e
 * mais amplamente suportado — pelo menos um provider pesquisado, Wuzapi, só aceita escolha única e
 * não tem como habilitar múltipla escolha nenhuma forma).
 */
interface SendPollInput {
    to: string;
    question: string;
    /** Pelo menos 2 opções — todos os providers pesquisados rejeitam enquete com menos de 2. */
    options: string[];
    allowMultipleAnswers?: boolean;
}
/**
 * Ver ADR-0015. Vocabulário canônico do indicador de digitação/gravação por conversa
 * (`presence.setTyping`) — mapeia para o enum nativo do whatsmeow (`composing`/`recording`/
 * `paused`) que a maioria dos providers pesquisados já usa diretamente ou com pequenas variações
 * (ex.: Whapi usa `pause` no singular; Wuzapi expressa `recording` como `composing` + um campo
 * `Media: "audio"` separado). Sem estado "stop"/"idle" distinto — `paused` já é a convenção do
 * protocolo para "parar de mostrar o indicador".
 */
type TypingState = 'composing' | 'recording' | 'paused';
/** Ver ADR-0015. */
interface SetTypingInput {
    to: string;
    state: TypingState;
}
/**
 * Ver ADR-0015. Presença GLOBAL da conta (`presence.set`) — distinta do indicador por conversa
 * (`presence.setTyping`). Nenhum provider pesquisado usa vocabulário diferente de online/offline
 * para este conceito (alguns usam `available`/`unavailable` no wire, mas o significado é sempre
 * este par binário) — cada adapter traduz internamente.
 */
type PresenceState = 'online' | 'offline';
/**
 * Etiqueta normalizada. Ver ADR-0016. `color` é uma string OPACA — cada provider usa um vocabulário
 * de cor diferente (índice numérico 0-19, nome de cor, hex, inteiro ARGB) e nenhum converge o
 * suficiente para justificar um vocabulário canônico; o valor é repassado como o adapter recebe,
 * documentado por provider no dossiê.
 */
interface LabelInfo {
    id: string;
    name: string;
    color?: string;
    raw: unknown;
}
/** Ver ADR-0016. */
interface CreateLabelInput {
    name: string;
    color?: string;
}
/**
 * Ver ADR-0016. Diferente de `CreateLabelInput`, `name` é sempre obrigatório aqui mesmo quando só
 * a cor muda — pelo menos um provider pesquisado (QuePasa) sobrescreve o campo com o que vier no
 * corpo da requisição (sem merge parcial no servidor), então enviar um `name` ausente/vazio
 * apagaria o nome atual. Exigir `name` sempre evita esse risco em todos os adapters, não só nesse.
 */
interface UpdateLabelInput {
    labelId: string;
    name: string;
    color?: string;
}
/** Ver ADR-0016. Usado por `LabelsApi.addToChat`/`removeFromChat` (mesma forma para as duas direções). */
interface LabelChatInput {
    chatId: string;
    labelId: string;
}
/**
 * Canal do WhatsApp ("WhatsApp Channels" — nome público do produto; a maioria dos providers chama
 * de "newsletter" internamente, herdado do protocolo reverso-projetado, ver ADR-0017). `id` é um
 * identificador OPACO (mesmo critério de `GroupInfo.id`, ADR-0009): normalmente um JID
 * `<dígitos>@newsletter`, repassado como o adapter recebe — nunca passa por `normalizeChatId`.
 */
interface ChannelInfo {
    id: string;
    name: string;
    description?: string;
    subscribersCount?: number;
    raw: unknown;
}
/** Ver ADR-0017. */
interface CreateChannelInput {
    name: string;
    description?: string;
}
/**
 * Post do feed de um canal (`channels.getMessages`, ver ADR-0021). `id` é o identificador opaco do
 * post no provider (ex.: `serverId`/`serverid`) — usado por `channels.markViewed`/`reactToPost`,
 * não é o `messageId` de uma mensagem de chat comum.
 */
interface ChannelPost {
    id: string;
    /** Epoch em milissegundos. */
    timestamp: number;
    text?: string;
    viewsCount?: number;
    /** Mapa emoji -> contagem, quando o provider expõe. */
    reactionCounts?: Record<string, number>;
    raw: unknown;
}
/** Ver ADR-0021. */
interface GetChannelMessagesInput {
    /** ID opaco do canal — ver `ChannelInfo.id`. */
    channelId: string;
    count?: number;
    /** Cursor de paginação (ID do post mais antigo já visto) — pede posts anteriores a ele. */
    before?: string;
}
/** Ver ADR-0021. */
interface MarkChannelMessagesViewedInput {
    /** ID opaco do canal — ver `ChannelInfo.id`. */
    channelId: string;
    /** IDs opacos dos posts — ver `ChannelPost.id`. */
    messageIds: string[];
}
/** Ver ADR-0021. Emoji vazio remove uma reação já enviada (mesma convenção de `SendReactionInput`). */
interface ReactToChannelMessageInput {
    /** ID opaco do canal — ver `ChannelInfo.id`. */
    channelId: string;
    /** ID opaco do post — ver `ChannelPost.id`. */
    messageId: string;
    emoji: string;
}
/**
 * Perfil comercial WhatsApp Business (ver ADR-0018) — distinto do perfil PESSOAL do WhatsApp
 * (nome/about/foto, fora de escopo aqui). `categories` é normalizado para uma lista de nomes
 * (o shape completo do objeto categoria diverge entre providers: uazapi usa
 * `{id, localized_display_name}`, Z-API usa `{id, label, displayName}` — o valor bruto por
 * categoria fica só em `raw`, mesmo critério já usado para `LabelInfo.color`/ADR-0016).
 */
interface BusinessProfile {
    description?: string;
    address?: string;
    email?: string;
    websites?: string[];
    categories?: string[];
    raw: unknown;
}
/**
 * Ver ADR-0018. Ao menos 1 campo é obrigatório (o conector valida isso antes de chamar o
 * adapter) — nenhum provider confirmado aceita um update totalmente vazio.
 */
interface UpdateBusinessProfileInput {
    description?: string;
    address?: string;
    email?: string;
}
/**
 * Ver ADR-0019. Origina uma chamada de voz — nuance real e universal entre os 2 providers
 * confirmados (uazapi/Z-API): NÃO estabelece áudio de fato ("chamada vazia"), só faz o telefone
 * tocar (usado tipicamente para notificar/"acordar" um contato ou testar liveness da conexão).
 */
interface MakeCallInput {
    to: string;
    durationSeconds?: number;
}
/**
 * Ver ADR-0019. `callId`/`callerId` são obrigatórios em WAHA/Whapi/Wuzapi/Evolution GO
 * (identificam a chamada específica a rejeitar — só disponíveis inspecionando o payload bruto do
 * webhook recebido, já que este pacote não faz parsing de eventos de chamada nesta rodada);
 * WPPConnect exige só `callId`; uazapi não exige nenhum dos dois (corpo vazio rejeita a chamada
 * ativa no momento). `callerId` é normalizado como um chatId comum (não é opaco, ao contrário de
 * `callId`, que é um identificador de chamada específico do provider).
 */
interface RejectCallInput {
    callId?: string;
    callerId?: string;
}
/** Participante de um grupo, normalizado. Ver ADR-0009. */
interface GroupParticipant {
    /** Telefone E.164 sem `+` ou JID explícito — mesma convenção de chatId de mensagem. */
    id: string;
    isAdmin: boolean;
    isSuperAdmin: boolean;
}
/**
 * Grupo normalizado. `id` é um identificador OPACO do grupo (ver ADR-0009): a maioria dos
 * providers usa JID (`...@g.us`), mas a Z-API usa um ID sintético sem `@` — por isso `id` nunca
 * passa por `normalizeChatId` no conector, diferente do `to` de mensagens.
 */
interface GroupInfo {
    id: string;
    subject: string;
    /** Nem todo provider retorna descrição/dono no payload de metadados do grupo. */
    description?: string;
    owner?: string;
    participants: GroupParticipant[];
    raw: unknown;
}
interface CreateGroupInput {
    subject: string;
    /** Telefones E.164 (com ou sem `+`/pontuação) ou JIDs explícitos dos participantes iniciais. */
    participants: string[];
}
interface GroupParticipantsInput {
    /** ID opaco do grupo — ver `GroupInfo.id`. */
    groupId: string;
    /** Telefones E.164 (com ou sem `+`/pontuação) ou JIDs explícitos dos participantes-alvo. */
    participants: string[];
}
interface UpdateGroupSubjectInput {
    /** ID opaco do grupo — ver `GroupInfo.id`. */
    groupId: string;
    subject: string;
}
interface UpdateGroupDescriptionInput {
    /** ID opaco do grupo — ver `GroupInfo.id`. */
    groupId: string;
    /** String vazia limpa a descrição do grupo (suportado por todos os providers pesquisados). */
    description: string;
}
interface UpdateGroupPictureInput {
    /** ID opaco do grupo — ver `GroupInfo.id`. */
    groupId: string;
    /** `media.kind` deve ser `'image'` — grupos só aceitam foto, não vídeo/áudio/documento/figurinha. */
    media: MediaRef;
}
/**
 * Link de convite de grupo. `link` é sempre o formato completo
 * (`https://chat.whatsapp.com/<código>`), normalizado pelo core mesmo quando o provider devolve só
 * o código bare (ver `normalizeInviteLink` em `chat-id.ts`) — diferente do `groupId` (opaco por
 * provider), o link de convite é um formato universal do próprio WhatsApp.
 */
interface GroupInviteLink {
    link: string;
    raw: unknown;
}
interface JoinGroupInviteInput {
    /** Código do convite OU link completo (`https://chat.whatsapp.com/<código>`) — ambos aceitos. */
    invite: string;
}
/**
 * Contato normalizado (ver ADR-0010). `id` é o MESMO chatId canônico usado por `messages.*`
 * (telefone E.164 ou JID explícito) — diferente de `GroupInfo.id`, não é opaco por provider.
 * Todos os campos de detalhe são opcionais: nenhum provider pesquisado confirma todos ao mesmo
 * tempo numa única chamada (ex.: Evolution GO/Wuzapi não devolvem nome de exibição no endpoint
 * mais próximo de "getContact"). O adapter NUNCA compõe múltiplas requisições para preencher os
 * campos ausentes — mapeia o melhor match de uma única chamada e deixa o resto `undefined`.
 */
interface Contact {
    id: string;
    name?: string;
    about?: string;
    profilePictureUrl?: string;
    hasWhatsApp?: boolean;
    isBlocked?: boolean;
    raw: unknown;
}
interface CheckExistsResult {
    exists: boolean;
    /** chatId canônico resolvido pelo provider — nem todos devolvem isso quando `exists` é `false`. */
    chatId?: string;
    raw: unknown;
}
interface ContactProfilePicture {
    /** Ausente quando o contato não tem foto ou a privacidade dele não permite. */
    url?: string;
    raw: unknown;
}
interface ContactAbout {
    /** Ausente quando o contato não tem recado definido ou a privacidade dele não permite. */
    about?: string;
    raw: unknown;
}

/**
 * Eventos canônicos: todo webhook de qualquer provider é traduzido para um
 * destes formatos. Payloads não reconhecidos viram `unknown` (nunca exceção),
 * para que um endpoint de webhook jamais responda 500 por causa de um evento
 * novo do provider.
 */
interface BaseEvent {
    provider: string;
    instanceId?: string;
    raw: unknown;
}
interface MessageReceivedEvent extends BaseEvent {
    type: 'message.received';
    message: WaMessage;
}
/** Mensagem enviada pelo próprio número (eco de `fromMe`). */
interface MessageSentEvent extends BaseEvent {
    type: 'message.sent';
    message: WaMessage;
}
interface MessageAckEvent extends BaseEvent {
    type: 'message.ack';
    messageId: string;
    chatId?: string;
    ack: MessageAck;
}
interface ConnectionUpdateEvent extends BaseEvent {
    type: 'connection.update';
    state: InstanceState;
    qr?: string;
}
/**
 * `action` é livre (não um union estrito) porque a granularidade de mudança varia por provider —
 * mas segue, por convenção, um destes valores quando identificável univocamente:
 * `'participants.add'|'participants.remove'|'participants.promote'|'participants.demote'|
 * 'subject'|'description'`. Ausente quando o provider reporta múltiplas mudanças simultâneas num
 * único payload (comum em providers baseados em whatsmeow) — nesse caso, `parseWebhook` emite um
 * `GroupUpdateEvent` por mudança identificada (mesma mensagem pode gerar vários eventos no array
 * retornado), e `raw` sempre carrega o payload original completo para o que não for coberto aqui.
 */
interface GroupUpdateEvent extends BaseEvent {
    type: 'group.update';
    groupId: string;
    action?: string;
    /** Participantes afetados — presente quando `action` for uma mudança de participante. */
    participants?: string[];
}
interface UnknownEvent extends BaseEvent {
    type: 'unknown';
    reason?: string;
}
type CanonicalEvent = MessageReceivedEvent | MessageSentEvent | MessageAckEvent | ConnectionUpdateEvent | GroupUpdateEvent | UnknownEvent;
type CanonicalEventType = CanonicalEvent['type'];
type EventOf<T extends CanonicalEventType> = Extract<CanonicalEvent, {
    type: T;
}>;

/**
 * Entrada de webhook framework-agnostic: o app entrega `{ headers, body }`
 * de qualquer framework (Express, Fastify, Next.js, Workers) — o waconector
 * nunca depende do objeto `req` de um framework específico.
 */
interface WebhookInput {
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
    body: unknown;
    /**
     * Corpo bruto do request (string, capturado ANTES do body-parser do framework rodar
     * `JSON.parse`). Opcional e aditivo: existe apenas para adapters que precisam verificar uma
     * assinatura (HMAC ou similar) calculada pelo provider sobre os bytes originais do payload.
     * `JSON.stringify(body)` NÃO é garantidamente idêntico byte-a-byte ao request original (ordem
     * de chaves, espaçamento, escaping podem diferir), então não serve para essa comparação — só o
     * `rawBody` capturado pelo consumidor é confiável. Adapters/consumidores que não fazem
     * verificação de assinatura podem ignorar este campo com segurança.
     */
    rawBody?: string;
}
interface InstanceApi {
    connect(): Promise<ConnectResult>;
    status(): Promise<InstanceStatus>;
    logout(): Promise<void>;
}
interface MessagesApi {
    sendText(input: SendTextInput): Promise<SentMessage>;
    sendMedia(input: SendMediaInput): Promise<SentMessage>;
    /**
     * Opcional: só precisa ser implementado por adapters que declaram a capability
     * `messages.sendReaction` (nem todo provider expõe reação programática). Ver ADR-0008.
     */
    sendReaction?(input: SendReactionInput): Promise<SentMessage>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.edit`. Ver ADR-0012. */
    edit?(input: EditMessageInput): Promise<SentMessage>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.delete`. Ver ADR-0012. */
    delete?(input: DeleteMessageInput): Promise<void>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.forward`. Ver ADR-0013. */
    forward?(input: ForwardMessageInput): Promise<SentMessage>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.star`. Ver ADR-0013. */
    star?(input: StarMessageInput): Promise<void>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.unstar`. Ver ADR-0013. */
    unstar?(input: StarMessageInput): Promise<void>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.pin`. Ver ADR-0013. */
    pin?(input: PinMessageInput): Promise<void>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.unpin`. Ver ADR-0013. */
    unpin?(input: PinMessageInput): Promise<void>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.markRead`. Ver ADR-0013. */
    markRead?(input: MarkMessageReadInput): Promise<void>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.sendLocation`. Ver ADR-0014. */
    sendLocation?(input: SendLocationInput): Promise<SentMessage>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.sendContactCard`. Ver ADR-0014. */
    sendContactCard?(input: SendContactCardInput): Promise<SentMessage>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.sendPoll`. Ver ADR-0014. */
    sendPoll?(input: SendPollInput): Promise<SentMessage>;
    /** Opcional: só implementado por adapters que declaram a capability `messages.download`. Ver ADR-0020. */
    download?(input: DownloadMediaInput): Promise<DownloadedMedia>;
}
/**
 * Todo método é opcional (ver ADR-0009): diferente de `messages` (`sendText`/`sendMedia`
 * obrigatórios desde o F0), `groups` é um namespace inteiramente novo — nem todo adapter precisa
 * implementar nenhum método dele, e adapters futuros (F3+) podem cobrir só um subconjunto.
 */
interface GroupsApi {
    create?(input: CreateGroupInput): Promise<GroupInfo>;
    getInfo?(groupId: string): Promise<GroupInfo>;
    list?(): Promise<GroupInfo[]>;
    addParticipants?(input: GroupParticipantsInput): Promise<void>;
    removeParticipants?(input: GroupParticipantsInput): Promise<void>;
    promoteParticipants?(input: GroupParticipantsInput): Promise<void>;
    demoteParticipants?(input: GroupParticipantsInput): Promise<void>;
    updateSubject?(input: UpdateGroupSubjectInput): Promise<void>;
    updateDescription?(input: UpdateGroupDescriptionInput): Promise<void>;
    updatePicture?(input: UpdateGroupPictureInput): Promise<void>;
    getInviteLink?(groupId: string): Promise<GroupInviteLink>;
    revokeInviteLink?(groupId: string): Promise<GroupInviteLink>;
    /** `input.invite` já chega normalizado como link completo (ver `normalizeInviteLink`). */
    joinViaInviteLink?(input: JoinGroupInviteInput): Promise<void>;
    leaveGroup?(groupId: string): Promise<void>;
}
/**
 * Todo método é opcional (ver ADR-0010, mesmo padrão de `GroupsApi`/ADR-0009). Diferente de
 * `groups`, o identificador de contato (`chatId`) NÃO é opaco — é o mesmo chatId canônico de
 * `messages.*`, normalizado pelo conector via `normalizeChatId` antes de chegar ao adapter.
 */
interface ContactsApi {
    list?(): Promise<Contact[]>;
    get?(chatId: string): Promise<Contact>;
    checkExists?(phone: string): Promise<CheckExistsResult>;
    getProfilePicture?(chatId: string): Promise<ContactProfilePicture>;
    getAbout?(chatId: string): Promise<ContactAbout>;
    block?(chatId: string): Promise<void>;
    unblock?(chatId: string): Promise<void>;
    listBlocked?(): Promise<string[]>;
}
/**
 * Namespace de gestão de ESTADO da conversa (arquivar, silenciar, fixar, marcar como lida) — ver
 * ADR-0012. Distinto de `messages.*` (ação sobre UMA mensagem) e de `groups.*`/`contacts.*`
 * (metadados/participantes/perfil). Todo método é opcional, mesmo padrão de `GroupsApi`/
 * `ContactsApi` (ADR-0009/0010).
 *
 * `chatId` NÃO é opaco (diferente de `GroupInfo.id`) — é o mesmo chatId canônico de
 * `messages.*`/`contacts.*`, normalizado pelo conector via `normalizeChatId`.
 */
interface ChatsApi {
    archive?(chatId: string): Promise<void>;
    unarchive?(chatId: string): Promise<void>;
    /** Silenciar notificações da conversa. Duração fica fora do contrato canônico nesta fase — ver ADR-0012. */
    mute?(chatId: string): Promise<void>;
    unmute?(chatId: string): Promise<void>;
    /** Fixa a CONVERSA no topo da lista — distinto de fixar uma mensagem dentro do chat (fora de escopo, ver ADR-0012). */
    pin?(chatId: string): Promise<void>;
    unpin?(chatId: string): Promise<void>;
    /** Marca a conversa INTEIRA como lida — distinto de marcar uma mensagem por id (fora de escopo, ver ADR-0012). */
    markRead?(chatId: string): Promise<void>;
    markUnread?(chatId: string): Promise<void>;
}
/**
 * Namespace novo (ADR-0015), inteiramente OPCIONAL — mesmo padrão de `chats?` (ADR-0012), não
 * obrigatório como `messages`. Cobre presença/indicador de atividade, distinto de `chats.*`
 * (estado de conversa) e `messages.*` (conteúdo de mensagem).
 */
interface PresenceApi {
    /** Indicador de digitação/gravação por conversa (`composing`/`recording`/`paused`). */
    setTyping?(input: SetTypingInput): Promise<void>;
    /** Presença GLOBAL da conta (online/offline) — distinta do indicador por conversa acima. */
    set?(state: PresenceState): Promise<void>;
    /** Inscreve-se para receber atualizações de presença de um contato via webhook. */
    subscribe?(chatId: string): Promise<void>;
}
/**
 * Namespace novo (ADR-0016), inteiramente OPCIONAL — mesmo padrão de `chats?`/`presence?`.
 * Etiquetas estilo WhatsApp Business (CRUD + associação a conversa).
 */
interface LabelsApi {
    list?(): Promise<LabelInfo[]>;
    create?(input: CreateLabelInput): Promise<LabelInfo>;
    /** Sempre reenvia `name` (ver `UpdateLabelInput`) — nunca um patch parcial. */
    update?(input: UpdateLabelInput): Promise<void>;
    delete?(labelId: string): Promise<void>;
    addToChat?(input: LabelChatInput): Promise<void>;
    removeFromChat?(input: LabelChatInput): Promise<void>;
}
/**
 * Namespace novo (ADR-0017), inteiramente OPCIONAL — mesmo padrão de `chats?`/`presence?`/
 * `labels?`. Canais do WhatsApp ("WhatsApp Channels" — nome público; a maioria dos providers chama
 * de "newsletter" internamente).
 */
interface ChannelsApi {
    list?(): Promise<ChannelInfo[]>;
    create?(input: CreateChannelInput): Promise<ChannelInfo>;
    getInfo?(channelId: string): Promise<ChannelInfo>;
    delete?(channelId: string): Promise<void>;
    follow?(channelId: string): Promise<void>;
    unfollow?(channelId: string): Promise<void>;
    /** Opcional: só implementado por adapters que declaram a capability `channels.getMessages`. Ver ADR-0021. */
    getMessages?(input: GetChannelMessagesInput): Promise<ChannelPost[]>;
    /** Opcional: só implementado por adapters que declaram a capability `channels.markViewed`. Ver ADR-0021. */
    markViewed?(input: MarkChannelMessagesViewedInput): Promise<void>;
    /** Opcional: só implementado por adapters que declaram a capability `channels.reactToPost`. Ver ADR-0021. */
    reactToPost?(input: ReactToChannelMessageInput): Promise<void>;
}
/**
 * Namespace novo (ADR-0018), inteiramente OPCIONAL — mesmo padrão de `chats?`/`presence?`/
 * `labels?`/`channels?`. Perfil comercial WhatsApp Business (endereço, categoria, site, e-mail) —
 * distinto do perfil PESSOAL do WhatsApp (fora de escopo do core atual).
 */
interface BusinessApi {
    getProfile?(): Promise<BusinessProfile>;
    /** Sempre reenvia só os campos alterados — ver caveat do 207 parcial da uazapi em ADR-0018. */
    updateProfile?(input: UpdateBusinessProfileInput): Promise<void>;
}
/**
 * Namespace novo (ADR-0019), inteiramente OPCIONAL — mesmo padrão de `chats?`/`presence?`/
 * `labels?`/`channels?`/`business?`. Chamadas de voz — `make` é uma "chamada vazia" (só toca,
 * sem áudio real, ver `MakeCallInput`); `reject` rejeita uma chamada recebida.
 */
interface CallsApi {
    make?(input: MakeCallInput): Promise<void>;
    reject?(input: RejectCallInput): Promise<void>;
}
/**
 * Contrato que todo adapter de provider implementa.
 *
 * O adapter é "burro" de propósito: apenas traduz o modelo canônico de/para o
 * provider (`map-out`/`map-in`). Validação, checagem de capabilities, retry e
 * eventos são responsabilidade do conector (`createConnector`).
 */
interface WaAdapter {
    readonly provider: string;
    readonly capabilities: CapabilitySet;
    readonly instance: InstanceApi;
    readonly messages: MessagesApi;
    readonly groups: GroupsApi;
    readonly contacts: ContactsApi;
    /**
     * Namespace OPCIONAL — diferente de `groups`/`contacts` (ADR-0009/0010, campo obrigatório mesmo
     * com todo método interno opcional). Ver ADR-0012 para a justificativa da divergência: mudança
     * aditiva (evita o gate de breaking change pós-v1.0 do CONTRIBUTING.md) + cobertura por provider
     * real demais irregular para justificar um campo mandatório.
     */
    readonly chats?: ChatsApi;
    /** Namespace OPCIONAL (ADR-0015) — mesmo critério de `chats?` acima. */
    readonly presence?: PresenceApi;
    /** Namespace OPCIONAL (ADR-0016) — mesmo critério de `chats?` acima. */
    readonly labels?: LabelsApi;
    /** Namespace OPCIONAL (ADR-0017) — mesmo critério de `chats?` acima. */
    readonly channels?: ChannelsApi;
    /** Namespace OPCIONAL (ADR-0018) — mesmo critério de `chats?` acima. */
    readonly business?: BusinessApi;
    /** Namespace OPCIONAL (ADR-0019) — mesmo critério de `chats?` acima. */
    readonly calls?: CallsApi;
    parseWebhook(input: WebhookInput): CanonicalEvent[];
}

export { type ConnectionUpdateEvent as $, type ChannelPost as A, type MarkChannelMessagesViewedInput as B, type CapabilitySet as C, type DeleteMessageInput as D, type EditMessageInput as E, type ForwardMessageInput as F, type GroupInfo as G, type BusinessProfile as H, type InstanceApi as I, type JoinGroupInviteInput as J, type UpdateBusinessProfileInput as K, type LabelInfo as L, type MarkMessageReadInput as M, type MakeCallInput as N, type RejectCallInput as O, type PinMessageInput as P, type WebhookInput as Q, type ReactToChannelMessageInput as R, type SendTextInput as S, type CanonicalEvent as T, type UpdateGroupSubjectInput as U, type Capability as V, type WaAdapter as W, type CanonicalEventType as X, type EventOf as Y, CAPABILITIES as Z, type ConnectResult as _, type SentMessage as a, type GroupUpdateEvent as a0, INSTANCE_STATES as a1, type InstanceState as a2, type InstanceStatus as a3, MESSAGE_ACKS as a4, type MediaKind as a5, type MediaRef as a6, type MessageAck as a7, type MessageAckEvent as a8, type MessageKind as a9, type MessageReceivedEvent as aa, type MessageSentEvent as ab, type MessagesApi as ac, type UnknownEvent as ad, type WaMessage as ae, hasCapability as af, isKnownCapability as ag, type GroupsApi as ah, type ContactsApi as ai, type ChatsApi as aj, type PresenceApi as ak, type LabelsApi as al, type ChannelsApi as am, type BusinessApi as an, type CallsApi as ao, type TypingState as ap, type SendMediaInput as b, type SendReactionInput as c, type StarMessageInput as d, type SendLocationInput as e, type SendContactCardInput as f, type SendPollInput as g, type DownloadMediaInput as h, type DownloadedMedia as i, type CreateGroupInput as j, type GroupParticipantsInput as k, type UpdateGroupDescriptionInput as l, type UpdateGroupPictureInput as m, type GroupInviteLink as n, type Contact as o, type CheckExistsResult as p, type ContactProfilePicture as q, type ContactAbout as r, type SetTypingInput as s, type PresenceState as t, type CreateLabelInput as u, type UpdateLabelInput as v, type LabelChatInput as w, type ChannelInfo as x, type CreateChannelInput as y, type GetChannelMessagesInput as z };
