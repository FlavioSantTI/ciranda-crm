import { W as WaAdapter } from '../../adapter-Drr42jS8.js';

/**
 * Opções do adapter Whapi.Cloud (SaaS, host único `https://gate.whapi.cloud` para todos os
 * clientes — sem opção self-hosted documentada).
 *
 * @see docs/providers/whapi.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
interface WhapiOptions {
    /**
     * URL base da API Whapi.Cloud. Padrão: `https://gate.whapi.cloud`. Existe mesmo assim (em vez de
     * uma constante interna) para permitir apontar para um proxy/gateway de teste sem rede real.
     */
    baseUrl?: string;
    /**
     * Bearer token do CANAL ("channel"), exibido no dashboard do canal. Diferente da Z-API
     * (`instanceId` + `token` separados no path), o Whapi usa um único token por canal, enviado como
     * `Authorization: Bearer <token>` — não há um segundo identificador de instância. Um token por
     * conta (a "Partner API", `manager.whapi.cloud`, usada para criar/listar canais) existe mas é uma
     * API totalmente separada, fora do escopo deste adapter — ver docs/providers/whapi.md#autenticação.
     */
    token: string;
    /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
    timeoutMs?: number;
    /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
    retries?: number;
    /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
    fetch?: typeof globalThis.fetch;
}
/** Fábrica do adapter Whapi.Cloud. */
declare function whapi(options: WhapiOptions): WaAdapter;

export { type WhapiOptions, whapi };
