import { W as WaAdapter } from '../../adapter-Drr42jS8.cjs';

/**
 * Opções do adapter Wuzapi (self-hosted, construído sobre `tulir/whatsmeow`).
 *
 * @see docs/providers/wuzapi.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
interface WuzapiOptions {
    /** URL base do servidor Wuzapi self-hosted (ex.: `https://wuzapi.exemplo.com`). */
    baseUrl: string;
    /**
     * Token de usuário, enviado cru (sem prefixo `Bearer`) no header `token`. Escopo: todas as
     * capabilities implementadas por este adapter (`/session/*`, `/chat/send/*`). Definido pelo
     * admin ao criar o usuário via `POST /admin/users` — não é autogerado pelo servidor.
     */
    token: string;
    /**
     * Token administrativo, enviado no header `Authorization` (comparação em tempo constante no
     * servidor). Escopo real: rotas `/admin/**` (ex. `POST /admin/users`) — **nenhuma implementada
     * nesta fase**. Opcional aqui apenas para permitir guardar os dois segredos num único lugar (e
     * redigi-los em erros); reservado para uma fase futura que exponha provisionamento de usuário.
     * Mesmo padrão de `UazapiOptions.adminToken`. Ver docs/providers/wuzapi.md#autenticação.
     */
    adminToken?: string;
    /**
     * Nome/identificador da sessão, apenas para referência do chamador. Não é enviado em nenhuma
     * requisição — as rotas operacionais resolvem o usuário a partir do header `token`.
     */
    instance?: string;
    /** Categorias de evento enviadas em `Subscribe` no `POST /session/connect` (ex.: `["Message", "ReadReceipt"]`, ou `["All"]`). */
    subscribe?: string[];
    /**
     * Valor de `Immediate` em `POST /session/connect`. Quando `false`, a chamada bloqueia por até
     * 10s no servidor para validar o login antes de responder. Padrão: `true` (não bloqueia).
     */
    immediate?: boolean;
    /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
    timeoutMs?: number;
    /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
    retries?: number;
    /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
    fetch?: typeof globalThis.fetch;
}
/** Fábrica do adapter Wuzapi. */
declare function wuzapi(options: WuzapiOptions): WaAdapter;

export { type WuzapiOptions, wuzapi };
