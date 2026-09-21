import { W as WaAdapter } from '../../adapter-Drr42jS8.cjs';

/**
 * Opções do adapter Evolution GO.
 *
 * @see docs/providers/evolution.md para o dossiê completo (auth, endpoints, payloads).
 */
interface EvolutionOptions {
    /** URL base do servidor Evolution GO self-hosted (ex.: `https://evolution.exemplo.com`). */
    baseUrl: string;
    /**
     * Valor enviado no header `apikey`. Todas as capabilities implementadas por este adapter usam
     * rotas OPERACIONAIS do Evolution GO (connect/status/logout/send/*), que são resolvidas pelo
     * TOKEN DA INSTÂNCIA — não pelo `GLOBAL_API_KEY` (usado só nas rotas admin, fora do escopo).
     */
    apiKey: string;
    /**
     * Nome/identificador da instância. Atualmente não utilizado pelo adapter (as rotas
     * operacionais resolvem a instância a partir do `apiKey`, e este adapter não faz logging) —
     * reservado para uso futuro em telemetria/diagnóstico.
     */
    instance?: string;
    /** `webhookUrl` enviado em `POST /instance/connect` (opcional; o provider também suporta um webhook global via env var no servidor). */
    webhookUrl?: string;
    /** Categorias de evento (`MESSAGE`, `CONNECTION`, `ALL`, ...) enviadas em `POST /instance/connect`. */
    subscribe?: string[];
    /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
    timeoutMs?: number;
    /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`). */
    retries?: number;
    /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
    fetch?: typeof globalThis.fetch;
}
/** Fábrica do adapter Evolution GO. */
declare function evolution(options: EvolutionOptions): WaAdapter;

export { type EvolutionOptions, evolution };
