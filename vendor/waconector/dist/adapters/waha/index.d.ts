import { W as WaAdapter } from '../../adapter-Drr42jS8.js';

/**
 * Opções do adapter WAHA (waha.devlike.pro). `baseUrl` é sempre fornecido pelo consumidor —
 * WAHA é self-hosted, não existe endpoint SaaS fixo. Ver docs/providers/waha.md.
 */
interface WahaOptions {
    /** URL base da instância WAHA, ex.: `http://localhost:3000`. */
    baseUrl: string;
    /** Enviado no header `X-Api-Key`. Pode ser a chave global (`WAHA_API_KEY`) ou uma chave escopada por sessão (Keys API). */
    apiKey: string;
    /** Nome da sessão WAHA (equivalente a "instance" em outros providers). Padrão: `'default'`. */
    session?: string;
    /** Timeout por tentativa, em ms (repassado ao HttpClient). */
    timeoutMs?: number;
    /** Retentativas para 429/5xx/erros de rede (repassado ao HttpClient). */
    retries?: number;
    /** Injetável para testes (mesmo padrão de HttpClientOptions). */
    fetch?: typeof globalThis.fetch;
    /**
     * Chave HMAC configurada no lado do servidor WAHA (`config.webhooks[].hmac.key` na sessão, ou
     * `WHATSAPP_HOOK_HMAC_KEY` globalmente). Quando definida, `parseWebhook` verifica a assinatura
     * `X-Webhook-Hmac` (HMAC-SHA512, conforme `X-Webhook-Hmac-Algorithm: sha512`) antes de processar
     * o payload — ver docs/providers/waha.md#verificação-hmac-de-webhooks.
     *
     * **Exige `WebhookInput.rawBody`**: a verificação precisa do corpo bruto do request (bytes
     * originais, antes do `JSON.parse` do framework do consumidor) — reserializar `body` já
     * parseado não é garantidamente idêntico byte-a-byte ao que o WAHA assinou. Se `webhookHmacKey`
     * estiver configurada mas `rawBody` não vier em `parseWebhook`, o adapter falha fechado: trata o
     * webhook como não verificável e devolve evento `unknown` (nunca processa o payload como se a
     * assinatura fosse válida). Opt-in: se `webhookHmacKey` não for configurada, o comportamento é
     * o mesmo de antes (sem verificação).
     */
    webhookHmacKey?: string;
}
/** Cria um adapter WAHA pronto para uso com `createConnector`. */
declare function waha(options: WahaOptions): WaAdapter;

export { type WahaOptions, waha };
