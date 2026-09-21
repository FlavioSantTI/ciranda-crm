import { W as WaAdapter } from '../../adapter-Drr42jS8.js';

/**
 * Opções do adapter izapia (SaaS multi-tenant, `https://api.izapia.com`).
 *
 * @see docs/providers/izapia.md para o dossiê completo (auth, endpoints, payloads, gaps confirmados).
 */
interface IzapiaOptions {
    /** URL base da API, ex.: `https://api.izapia.com`. */
    baseUrl: string;
    /** API key do tenant, enviada como `Authorization: Bearer <apiKey>`. */
    apiKey: string;
    /**
     * ID de uma sessão JÁ CRIADA (`POST /api/v1/sessions/`) — a criação da sessão é um passo de
     * provisionamento fora do contrato `WaAdapter` (mesmo critério de "criação de instância" nos
     * demais adapters SaaS deste pacote: uazapi/Z-API tratam isso como operação administrativa,
     * fora de `instance.connect()`). `instance.connect()` deste adapter só inicia o pareamento
     * (`POST /sessions/{sid}/pair`) de uma sessão que já existe.
     */
    sid: string;
    /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
    timeoutMs?: number;
    /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
    retries?: number;
    /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
    fetch?: typeof globalThis.fetch;
}
/** Fábrica do adapter izapia. */
declare function izapia(options: IzapiaOptions): WaAdapter;

export { type IzapiaOptions, izapia };
