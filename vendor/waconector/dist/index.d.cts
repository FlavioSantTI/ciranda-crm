import { W as WaAdapter, C as CapabilitySet, I as InstanceApi, S as SendTextInput, a as SentMessage, b as SendMediaInput, c as SendReactionInput, E as EditMessageInput, D as DeleteMessageInput, F as ForwardMessageInput, d as StarMessageInput, P as PinMessageInput, M as MarkMessageReadInput, e as SendLocationInput, f as SendContactCardInput, g as SendPollInput, h as DownloadMediaInput, i as DownloadedMedia, j as CreateGroupInput, G as GroupInfo, k as GroupParticipantsInput, U as UpdateGroupSubjectInput, l as UpdateGroupDescriptionInput, m as UpdateGroupPictureInput, n as GroupInviteLink, J as JoinGroupInviteInput, o as Contact, p as CheckExistsResult, q as ContactProfilePicture, r as ContactAbout, s as SetTypingInput, t as PresenceState, L as LabelInfo, u as CreateLabelInput, v as UpdateLabelInput, w as LabelChatInput, x as ChannelInfo, y as CreateChannelInput, z as GetChannelMessagesInput, A as ChannelPost, B as MarkChannelMessagesViewedInput, R as ReactToChannelMessageInput, H as BusinessProfile, K as UpdateBusinessProfileInput, N as MakeCallInput, O as RejectCallInput, Q as WebhookInput, T as CanonicalEvent, V as Capability, X as CanonicalEventType, Y as EventOf } from './adapter-Drr42jS8.cjs';
export { Z as CAPABILITIES, _ as ConnectResult, $ as ConnectionUpdateEvent, a0 as GroupUpdateEvent, a1 as INSTANCE_STATES, a2 as InstanceState, a3 as InstanceStatus, a4 as MESSAGE_ACKS, a5 as MediaKind, a6 as MediaRef, a7 as MessageAck, a8 as MessageAckEvent, a9 as MessageKind, aa as MessageReceivedEvent, ab as MessageSentEvent, ac as MessagesApi, ad as UnknownEvent, ae as WaMessage, af as hasCapability, ag as isKnownCapability } from './adapter-Drr42jS8.cjs';

declare function digitsOnly(value: string): string;
/** Identificador já no formato JID do WhatsApp (`...@s.whatsapp.net`, `...@c.us`, `...@g.us`). */
declare function isJid(value: string): boolean;
declare function isGroupChatId(value: string): boolean;
/**
 * Normaliza o identificador de chat para o formato canônico do waconector:
 * - JIDs explícitos passam intactos (grupos, broadcast, LID);
 * - telefones viram apenas dígitos (E.164 sem `+` nem pontuação).
 *
 * Cada adapter converte deste formato canônico para o que o provider espera.
 */
declare function normalizeChatId(value: string): string;

type WaEventListener<T extends CanonicalEventType | '*'> = (event: T extends '*' ? CanonicalEvent : EventOf<Exclude<T, '*'>>) => void | Promise<void>;
interface WebhooksApi {
    /** Traduz um webhook do provider para eventos canônicos. Nunca lança: payloads irreconhecíveis viram `unknown`. */
    parse(input: WebhookInput): CanonicalEvent[];
    /** `parse` + emissão para os listeners registrados via `on()`. */
    dispatch(input: WebhookInput): Promise<CanonicalEvent[]>;
}
/**
 * `MessagesApi` exposta pelo conector: diferente da interface que o adapter implementa
 * (`sendReaction` é opcional lá, já que nem todo provider suporta), aqui todo método está sempre
 * presente — chamar uma capability não suportada lança `UnsupportedCapabilityError` de forma
 * uniforme, em vez de o consumidor precisar checar `typeof wa.messages.sendReaction === 'function'`.
 */
interface ConnectorMessagesApi {
    sendText(input: SendTextInput): Promise<SentMessage>;
    sendMedia(input: SendMediaInput): Promise<SentMessage>;
    sendReaction(input: SendReactionInput): Promise<SentMessage>;
    edit(input: EditMessageInput): Promise<SentMessage>;
    delete(input: DeleteMessageInput): Promise<void>;
    forward(input: ForwardMessageInput): Promise<SentMessage>;
    star(input: StarMessageInput): Promise<void>;
    unstar(input: StarMessageInput): Promise<void>;
    pin(input: PinMessageInput): Promise<void>;
    unpin(input: PinMessageInput): Promise<void>;
    markRead(input: MarkMessageReadInput): Promise<void>;
    sendLocation(input: SendLocationInput): Promise<SentMessage>;
    sendContactCard(input: SendContactCardInput): Promise<SentMessage>;
    sendPoll(input: SendPollInput): Promise<SentMessage>;
    download(input: DownloadMediaInput): Promise<DownloadedMedia>;
}
/**
 * `GroupsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde todos são opcionais — ver ADR-0009), gateado por capability + guard-rail
 * `PROVIDER_ERROR` quando o adapter declara a capability sem implementar o método.
 */
interface ConnectorGroupsApi {
    create(input: CreateGroupInput): Promise<GroupInfo>;
    getInfo(groupId: string): Promise<GroupInfo>;
    list(): Promise<GroupInfo[]>;
    addParticipants(input: GroupParticipantsInput): Promise<void>;
    removeParticipants(input: GroupParticipantsInput): Promise<void>;
    promoteParticipants(input: GroupParticipantsInput): Promise<void>;
    demoteParticipants(input: GroupParticipantsInput): Promise<void>;
    updateSubject(input: UpdateGroupSubjectInput): Promise<void>;
    updateDescription(input: UpdateGroupDescriptionInput): Promise<void>;
    updatePicture(input: UpdateGroupPictureInput): Promise<void>;
    getInviteLink(groupId: string): Promise<GroupInviteLink>;
    revokeInviteLink(groupId: string): Promise<GroupInviteLink>;
    joinViaInviteLink(input: JoinGroupInviteInput): Promise<void>;
    leaveGroup(groupId: string): Promise<void>;
}
/**
 * `ContactsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde todos são opcionais — ver ADR-0010), gateado por capability + guard-rail
 * `PROVIDER_ERROR` quando o adapter declara a capability sem implementar o método.
 */
interface ConnectorContactsApi {
    list(): Promise<Contact[]>;
    get(chatId: string): Promise<Contact>;
    checkExists(phone: string): Promise<CheckExistsResult>;
    getProfilePicture(chatId: string): Promise<ContactProfilePicture>;
    getAbout(chatId: string): Promise<ContactAbout>;
    block(chatId: string): Promise<void>;
    unblock(chatId: string): Promise<void>;
    listBlocked(): Promise<string[]>;
}
/**
 * `ChatsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0012), gateado por capability +
 * guard-rail `PROVIDER_ERROR`. `this.adapter.chats` pode ser `undefined`; o guard-rail trata isso
 * exatamente como "método ausente" (nunca deixa um `TypeError` vazar).
 */
interface ConnectorChatsApi {
    archive(chatId: string): Promise<void>;
    unarchive(chatId: string): Promise<void>;
    mute(chatId: string): Promise<void>;
    unmute(chatId: string): Promise<void>;
    pin(chatId: string): Promise<void>;
    unpin(chatId: string): Promise<void>;
    markRead(chatId: string): Promise<void>;
    markUnread(chatId: string): Promise<void>;
}
/**
 * `PresenceApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0015, mesmo critério de `ChatsApi`).
 */
interface ConnectorPresenceApi {
    setTyping(input: SetTypingInput): Promise<void>;
    set(state: PresenceState): Promise<void>;
    subscribe(chatId: string): Promise<void>;
}
/**
 * `LabelsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0016, mesmo critério de `ChatsApi`/
 * `PresenceApi`).
 */
interface ConnectorLabelsApi {
    list(): Promise<LabelInfo[]>;
    create(input: CreateLabelInput): Promise<LabelInfo>;
    update(input: UpdateLabelInput): Promise<void>;
    delete(labelId: string): Promise<void>;
    addToChat(input: LabelChatInput): Promise<void>;
    removeFromChat(input: LabelChatInput): Promise<void>;
}
/**
 * `ChannelsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0017, mesmo critério de `ChatsApi`/
 * `PresenceApi`/`LabelsApi`).
 */
interface ConnectorChannelsApi {
    list(): Promise<ChannelInfo[]>;
    create(input: CreateChannelInput): Promise<ChannelInfo>;
    getInfo(channelId: string): Promise<ChannelInfo>;
    delete(channelId: string): Promise<void>;
    follow(channelId: string): Promise<void>;
    unfollow(channelId: string): Promise<void>;
    getMessages(input: GetChannelMessagesInput): Promise<ChannelPost[]>;
    markViewed(input: MarkChannelMessagesViewedInput): Promise<void>;
    reactToPost(input: ReactToChannelMessageInput): Promise<void>;
}
/**
 * `BusinessApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0018, mesmo critério de `ChatsApi`/
 * `PresenceApi`/`LabelsApi`/`ChannelsApi`).
 */
interface ConnectorBusinessApi {
    getProfile(): Promise<BusinessProfile>;
    updateProfile(input: UpdateBusinessProfileInput): Promise<void>;
}
/**
 * `CallsApi` exposta pelo conector: todo método sempre presente (diferente da interface do
 * adapter, onde o NAMESPACE INTEIRO é opcional — ver ADR-0019, mesmo critério de `ChatsApi`/
 * `PresenceApi`/`LabelsApi`/`ChannelsApi`/`BusinessApi`).
 */
interface ConnectorCallsApi {
    make(input: MakeCallInput): Promise<void>;
    reject(input: RejectCallInput): Promise<void>;
}
/**
 * Camada de ergonomia e política sobre um adapter: checagem de capabilities,
 * validação e normalização de entrada, eventos e parsing seguro de webhooks.
 */
declare class WaConnector {
    readonly adapter: WaAdapter;
    readonly provider: string;
    readonly capabilities: CapabilitySet;
    readonly instance: InstanceApi;
    readonly messages: ConnectorMessagesApi;
    readonly groups: ConnectorGroupsApi;
    readonly contacts: ConnectorContactsApi;
    readonly chats: ConnectorChatsApi;
    readonly presence: ConnectorPresenceApi;
    readonly labels: ConnectorLabelsApi;
    readonly channels: ConnectorChannelsApi;
    readonly business: ConnectorBusinessApi;
    readonly calls: ConnectorCallsApi;
    readonly webhooks: WebhooksApi;
    private readonly listeners;
    constructor(adapter: WaAdapter);
    supports(capability: Capability): boolean;
    /** Registra um listener para um tipo de evento canônico (ou `*` para todos). Retorna o unsubscribe. */
    on<T extends CanonicalEventType | '*'>(type: T, listener: WaEventListener<T>): () => void;
    emit(event: CanonicalEvent): Promise<void>;
    private assertCapability;
    private prepareSendText;
    private prepareSendMedia;
    private prepareSendReaction;
    private prepareEditMessage;
    private prepareDeleteMessage;
    private prepareForwardMessage;
    private prepareStarMessage;
    private preparePinMessage;
    private prepareMarkMessageRead;
    private prepareSendLocation;
    private prepareSendContactCard;
    private prepareSendPoll;
    private prepareSetTyping;
    private prepareCreateLabel;
    /**
     * `name` é sempre obrigatório aqui (ver `UpdateLabelInput`/ADR-0016) — nunca um patch parcial,
     * mesmo quando só a cor muda.
     */
    private prepareUpdateLabel;
    private requireLabelName;
    private prepareLabelChat;
    /** `labelId` é opaco (mesmo critério de `groupId` — ver ADR-0009): não passa por `normalizeChatId`. */
    private requireLabelId;
    private prepareCreateChannel;
    /** `channelId` é opaco (mesmo critério de `groupId`/`labelId` — ver ADR-0009/0016): não passa por `normalizeChatId`. */
    private requireChannelId;
    /** Ver ADR-0021. `channelId` é opaco (mesmo critério de `requireChannelId`). */
    private prepareGetChannelMessages;
    private prepareMarkChannelMessagesViewed;
    /** Emoji vazio remove uma reação já enviada — mesma convenção de `prepareSendReaction` (ADR-0008). */
    private prepareReactToChannelMessage;
    /** Ver ADR-0020. `raw` é opaco — repassado como o consumidor forneceu, sem validação. */
    private prepareDownloadMedia;
    /** Ao menos 1 campo é obrigatório (ver `UpdateBusinessProfileInput`/ADR-0018) — nenhum provider confirmado aceita update vazio. */
    private prepareUpdateBusinessProfile;
    private prepareMakeCall;
    /**
     * `callerId`, quando presente, é normalizado como um chatId comum (não é opaco, diferente de
     * `callId` — ver ADR-0019). A obrigatoriedade de `callId`/`callerId` varia por provider (uazapi
     * não exige nenhum dos dois; WPPConnect só exige `callId`; WAHA/Whapi/Wuzapi/Evolution GO exigem
     * ambos) — por isso essa checagem fica no ADAPTER, não aqui (não é uma regra universal).
     */
    private prepareRejectCall;
    /**
     * Guard-rail comum aos métodos opcionais de `MessagesApi` (`sendReaction`/`edit`/`delete`/
     * `forward`/`star`/`unstar`/`pin`/`unpin`/`markRead`/`sendLocation`/`sendContactCard`/
     * `sendPoll`) — generaliza o que antes era inline só para `sendReaction` (ADR-0008), sem mudar o
     * texto do erro nem o comportamento observável. Reaproveitado para `edit`/`delete` (ADR-0012),
     * `forward`/`star`/`unstar`/`pin`/`unpin`/`markRead` (ADR-0013) e `sendLocation`/
     * `sendContactCard`/`sendPoll` (ADR-0014).
     */
    private callMessagesMethod;
    /**
     * Guard-rail comum aos 7 métodos de `groups.*`: checa a capability e, se o adapter a declarou
     * sem de fato implementar o método correspondente, lança `PROVIDER_ERROR` (bug do adapter, não
     * entrada inválida) — mesmo padrão do `sendReaction` (ADR-0008), reaproveitado (ADR-0009).
     */
    private callGroupsMethod;
    /**
     * Guard-rail comum aos 5 métodos de `contacts.*`: mesmo padrão de `callGroupsMethod` (ADR-0009),
     * reaproveitado para `contacts.*` (ADR-0010).
     */
    private callContactsMethod;
    /**
     * Guard-rail de `chats.*` — mesmo padrão de `callGroupsMethod`/`callContactsMethod`, com uma
     * diferença: `this.adapter.chats` pode ser `undefined` inteiro (namespace opcional, ver
     * ADR-0012), não só o método individual. `?.` cobre os dois casos com o mesmo `PROVIDER_ERROR`
     * — nunca um `TypeError` por acessar propriedade de `undefined`.
     */
    private callChatsMethod;
    /**
     * Guard-rail de `presence.*` — mesmo padrão de `callChatsMethod` (namespace inteiro opcional no
     * adapter, ver ADR-0015).
     */
    private callPresenceMethod;
    /**
     * Guard-rail de `labels.*` — mesmo padrão de `callPresenceMethod`/`callChatsMethod` (namespace
     * inteiro opcional no adapter, ver ADR-0016).
     */
    private callLabelsMethod;
    /**
     * Guard-rail de `channels.*` — mesmo padrão de `callLabelsMethod`/`callPresenceMethod` (namespace
     * inteiro opcional no adapter, ver ADR-0017).
     */
    private callChannelsMethod;
    /**
     * Guard-rail de `business.*` — mesmo padrão de `callChannelsMethod`/`callLabelsMethod`
     * (namespace inteiro opcional no adapter, ver ADR-0018).
     */
    private callBusinessMethod;
    /**
     * Guard-rail de `calls.*` — mesmo padrão de `callBusinessMethod`/`callChannelsMethod`
     * (namespace inteiro opcional no adapter, ver ADR-0019).
     */
    private callCallsMethod;
    /**
     * `chatId` de contato NÃO é opaco (diferente de `groupId` — ver ADR-0010): é o mesmo chatId
     * canônico de `messages.*`, então passa por `normalizeChatId` normalmente.
     */
    private requireChatId;
    private prepareCreateGroup;
    private prepareGroupParticipants;
    private prepareUpdateGroupSubject;
    /** Descrição vazia é válida: limpa a descrição do grupo (suportado por todos os providers pesquisados). */
    private prepareUpdateGroupDescription;
    private prepareUpdateGroupPicture;
    private requireImageMedia;
    /**
     * `invite` aceita código bare ou link completo do chamador — normalizado aqui para SEMPRE o
     * link completo antes de chegar ao adapter (constante universal do protocolo WhatsApp, não
     * opaca por provider como `groupId` — ver `normalizeInviteLink`/ADR-0009). Adapters que
     * precisam só do código (ex.: Wuzapi) usam `extractInviteCode` por conta própria.
     */
    private prepareJoinViaInviteLink;
    private normalizeParticipants;
    /**
     * `groupId` é opaco (ver ADR-0009 e `GroupInfo.id`) — diferente de `to`, NÃO passa por
     * `normalizeChatId` (a Z-API usa um ID sintético sem `@` que `normalizeChatId` corromperia).
     */
    private requireGroupId;
    private requireTo;
    private parseWebhook;
    private unknownEvent;
}
declare function createConnector(adapter: WaAdapter): WaConnector;

type WaErrorCode = 'AUTH_FAILED' | 'INSTANCE_DISCONNECTED' | 'RATE_LIMITED' | 'INVALID_RECIPIENT' | 'INVALID_INPUT' | 'UNSUPPORTED_CAPABILITY' | 'TIMEOUT' | 'NETWORK_ERROR' | 'WEBHOOK_PARSE_ERROR' | 'PROVIDER_ERROR';
interface WaConnectorErrorOptions {
    provider?: string;
    status?: number;
    cause?: unknown;
    /**
     * Delay (em ms) sugerido pelo provider via header `Retry-After` para a próxima tentativa.
     * Preenchido só por `HttpClient` em respostas 429/503 com o header numérico presente; usado
     * pelo laço de retry no lugar do backoff calculado (ver ADR-0007).
     */
    retryAfterMs?: number;
}
declare class WaConnectorError extends Error {
    /** Marcador estável para `isWaConnectorError` (sobrevive a cópias do módulo em bundles distintos). */
    readonly isWaConnectorError: true;
    readonly code: WaErrorCode;
    readonly provider?: string;
    readonly status?: number;
    readonly retryAfterMs?: number;
    constructor(code: WaErrorCode, message: string, options?: WaConnectorErrorOptions);
}
declare class UnsupportedCapabilityError extends WaConnectorError {
    readonly capability: Capability;
    constructor(capability: Capability, provider?: string);
}
/**
 * Type guard por duck-typing (mesma estratégia do `axios.isAxiosError`):
 * `instanceof` falharia entre cópias do módulo em bundles ESM/CJS distintos.
 */
declare function isWaConnectorError(value: unknown): value is WaConnectorError;
declare function statusToErrorCode(status: number): WaErrorCode;
/** Substitui valores sensíveis (tokens, apikeys) por `***` em textos de erro/log. */
declare function redactSecrets(text: string, secrets: readonly string[]): string;

interface HttpClientOptions {
    baseUrl: string;
    headers?: Record<string, string>;
    /** Timeout por tentativa, em ms (padrão: 30_000). */
    timeoutMs?: number;
    /**
     * Retentativas para 429/5xx/erros de rede, com backoff exponencial (padrão: 2). Só se aplicam a
     * métodos idempotentes: GET/HEAD sempre, os demais (POST/PUT/PATCH/DELETE) só com
     * `idempotent: true` explícito em `HttpRequestOptions` (ver ADR-0007). Quando a resposta 429/503
     * traz o header `retry-after` numérico, ele tem precedência sobre o backoff calculado.
     */
    retries?: number;
    /** Valores sensíveis (tokens) redigidos em toda mensagem de erro. */
    secrets?: readonly string[];
    provider?: string;
    /** Injetável para testes. */
    fetch?: typeof globalThis.fetch;
}
interface HttpRequestOptions {
    method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
    /** Serializado como JSON quando presente. */
    body?: unknown;
    /**
     * Marca a requisição como idempotente (reenviá-la não duplica efeito colateral no provider).
     * GET/HEAD já são tratados como idempotentes por natureza; para POST/PUT/PATCH/DELETE, sem essa
     * flag em `true`, o retry NUNCA acontece (nem em NETWORK_ERROR, nem em 429/5xx) — evita reenviar
     * um `sendText`/`sendMedia` que o provider já processou antes da conexão cair (ver ADR-0007).
     */
    idempotent?: boolean;
    /**
     * Quando `'base64'`, a resposta de SUCESSO é lida como binário (`arrayBuffer`) e devolvida como
     * uma string base64 — necessário para providers que devolvem o arquivo bruto (ex.:
     * `Content-Type: image/jpeg`) em vez de um envelope JSON com o conteúdo já codificado (ver
     * ADR-0020, `messages.download`). Respostas de ERRO continuam lidas como texto (para a
     * mensagem de erro), independente deste campo. Padrão (`undefined`/`'json'`): comportamento
     * atual (JSON quando o content-type/corpo indicar, senão texto puro).
     */
    responseType?: 'json' | 'base64';
}
/**
 * Client HTTP mínimo sobre `fetch` nativo, compartilhado pelos adapters:
 * timeout, retry idempotente com backoff (ou `Retry-After` do provider quando presente),
 * mapeamento de status para erros tipados e redação de segredos. Zero dependências de runtime.
 */
declare class HttpClient {
    private readonly baseUrl;
    private readonly headers;
    private readonly timeoutMs;
    private readonly retries;
    private readonly secrets;
    private readonly provider?;
    private readonly fetchImpl;
    constructor(options: HttpClientOptions);
    request<T = unknown>(options: HttpRequestOptions): Promise<T>;
    private attempt;
    private buildUrl;
    private redact;
}

export { CanonicalEvent, CanonicalEventType, Capability, CapabilitySet, EventOf, HttpClient, type HttpClientOptions, type HttpRequestOptions, InstanceApi, SendMediaInput, SendTextInput, SentMessage, UnsupportedCapabilityError, WaAdapter, WaConnector, WaConnectorError, type WaConnectorErrorOptions, type WaErrorCode, type WaEventListener, WebhookInput, type WebhooksApi, createConnector, digitsOnly, isGroupChatId, isJid, isWaConnectorError, normalizeChatId, redactSecrets, statusToErrorCode };
