import { W as WaAdapter, C as CapabilitySet, S as SendTextInput, b as SendMediaInput, c as SendReactionInput, a as SentMessage, I as InstanceApi, ac as MessagesApi, ah as GroupsApi, ai as ContactsApi, aj as ChatsApi, ak as PresenceApi, al as LabelsApi, am as ChannelsApi, an as BusinessApi, ao as CallsApi, a2 as InstanceState, t as PresenceState, ap as TypingState, o as Contact, Q as WebhookInput, T as CanonicalEvent, a7 as MessageAck } from '../adapter-Drr42jS8.js';

interface MockAdapterOptions {
    provider?: string;
    capabilities?: CapabilitySet;
    initialState?: InstanceState;
}
interface MockOutboxEntry {
    input: SendTextInput | SendMediaInput | SendReactionInput;
    message: SentMessage;
}
/**
 * Adapter em memória: implementação de referência do contrato `WaAdapter` e
 * ferramenta para testar bots sem um provider real. Simula o ciclo de vida da
 * instância (desconectado → qr → conectado), registra envios em `outbox` e
 * gera webhooks sintéticos via `buildIncomingText`/`buildAck`/`buildConnectionUpdate`.
 */
declare class MockAdapter implements WaAdapter {
    readonly provider: string;
    readonly capabilities: CapabilitySet;
    readonly outbox: MockOutboxEntry[];
    readonly instance: InstanceApi;
    readonly messages: MessagesApi;
    readonly groups: GroupsApi;
    readonly contacts: ContactsApi;
    readonly chats: ChatsApi;
    readonly presence: PresenceApi;
    readonly labels: LabelsApi;
    readonly channels: ChannelsApi;
    readonly business: BusinessApi;
    readonly calls: CallsApi;
    private state;
    private seq;
    private groupSeq;
    private inviteSeq;
    private labelSeq;
    private channelSeq;
    private readonly groupsById;
    private readonly groupIdByInviteCode;
    private readonly contactsById;
    private readonly blockedIds;
    private readonly archivedChatIds;
    private readonly mutedChatIds;
    private readonly pinnedChatIds;
    private readonly unreadChatIds;
    private readonly starredMessageIds;
    private readonly pinnedMessageIds;
    private readonly readMessageIds;
    private globalPresence;
    private readonly typingStateByChatId;
    private readonly subscribedPresenceChatIds;
    private readonly labelsById;
    private readonly labelIdsByChatId;
    private readonly channelsById;
    private readonly followedChannelIds;
    private businessProfile;
    constructor(options?: MockAdapterOptions);
    /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
    isChatArchived(chatId: string): boolean;
    /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
    isChatMuted(chatId: string): boolean;
    /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
    isChatPinned(chatId: string): boolean;
    /** Consulta de estado só para testes (não faz parte do contrato `ChatsApi`). */
    isChatUnread(chatId: string): boolean;
    /** Consulta de estado só para testes (não faz parte do contrato `MessagesApi`). Ver ADR-0013. */
    isMessageStarred(messageId: string): boolean;
    /** Consulta de estado só para testes (não faz parte do contrato `MessagesApi`). Ver ADR-0013. */
    isMessagePinned(messageId: string): boolean;
    /** Consulta de estado só para testes (não faz parte do contrato `MessagesApi`). Ver ADR-0013. */
    isMessageRead(messageId: string): boolean;
    /** Consulta de estado só para testes (não faz parte do contrato `PresenceApi`). Ver ADR-0015. */
    getGlobalPresence(): PresenceState | undefined;
    /** Consulta de estado só para testes (não faz parte do contrato `PresenceApi`). Ver ADR-0015. */
    getTypingState(chatId: string): TypingState | undefined;
    /** Consulta de estado só para testes (não faz parte do contrato `PresenceApi`). Ver ADR-0015. */
    isSubscribedToPresence(chatId: string): boolean;
    /** Consulta de estado só para testes (não faz parte do contrato `LabelsApi`). Ver ADR-0016. */
    getChatLabelIds(chatId: string): string[];
    /** Consulta de estado só para testes (não faz parte do contrato `ChannelsApi`). Ver ADR-0017. */
    isFollowingChannel(channelId: string): boolean;
    simulateConnected(): void;
    simulateState(state: InstanceState): void;
    /** Semeia (ou atualiza) um contato conhecido pelo mock, usado por `list`/`get`/`checkExists`/etc. */
    simulateContact(contact: Contact): void;
    parseWebhook(input: WebhookInput): CanonicalEvent[];
    /** Webhook sintético de mensagem de texto recebida, no formato que `parseWebhook` entende. */
    buildIncomingText(from: string, text: string): WebhookInput;
    buildAck(messageId: string, ack: MessageAck): WebhookInput;
    /** Webhook sintético de reação recebida, no formato que `parseWebhook` entende. */
    buildReaction(from: string, targetMessageId: string, emoji: string): WebhookInput;
    buildConnectionUpdate(state: InstanceState, qr?: string): WebhookInput;
    private deliver;
    private assertConnected;
    private requireGroup;
    private requireLabel;
    private requireChannel;
    private issueInviteLink;
    private setAdminFlag;
    private unknown;
}

export { MockAdapter, type MockAdapterOptions, type MockOutboxEntry };
