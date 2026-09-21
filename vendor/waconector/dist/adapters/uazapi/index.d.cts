import { W as WaAdapter } from '../../adapter-Drr42jS8.cjs';

/**
 * Opções do adapter uazapi (SaaS multi-tenant, `https://{subdomain}.uazapi.com`).
 *
 * @see docs/providers/uazapi.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
interface UazapiOptions {
    /** URL base da instância uazapi do cliente, ex.: `https://minhaempresa.uazapi.com`. */
    baseUrl: string;
    /**
     * Token de instância, enviado cru (sem prefixo `Bearer`) no header `token`. Escopo: todas as
     * capabilities implementadas por este adapter (connect/status/disconnect, send/text, send/media).
     */
    token: string;
    /**
     * Token administrativo, enviado cru no header `admintoken`. Escopo real: endpoints
     * administrativos (`POST /instance/create`, listar instâncias, webhook global, rotacionar
     * admin token) — **nenhum implementado nesta fase**. Opcional aqui apenas para permitir guardar
     * os dois tokens num único lugar (e redigi-los em erros); reservado para uma fase futura que
     * exponha provisionamento de instância. Ver docs/providers/uazapi.md#autenticação.
     */
    adminToken?: string;
    /**
     * Nome/identificador da instância, apenas para referência do chamador. Não é enviado em
     * nenhuma requisição — as rotas operacionais resolvem a instância a partir do header `token`.
     */
    instance?: string;
    /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
    timeoutMs?: number;
    /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
    retries?: number;
    /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
    fetch?: typeof globalThis.fetch;
}
/** Fábrica do adapter uazapi. */
declare function uazapi(options: UazapiOptions): WaAdapter;

export { type UazapiOptions, uazapi };
