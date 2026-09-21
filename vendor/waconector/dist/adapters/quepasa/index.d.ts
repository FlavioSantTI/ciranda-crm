import { W as WaAdapter } from '../../adapter-Drr42jS8.js';

/**
 * Opções do adapter QuePasa (self-hosted via Docker, `nocodeleaks/quepasa` — construído sobre
 * `tulir/whatsmeow`, mesma base do Wuzapi).
 *
 * ⚠️ **Fonte da pesquisa**: o repositório canônico `github.com/nocodeleaks/quepasa` está bloqueado
 * no GitHub por um aviso de DMCA (não relacionado a mensagens/webhooks — o aviso é sobre um módulo
 * de VoIP, `src/voip/calls`). A pesquisa usada para este adapter foi feita em dois forks/mirrors
 * (`botarenaweb/Quepasa-api`, snapshot ~2023-04-20, e `deivisonrpg/quepasa`, snapshot 2026-07-07 —
 * o mais recente disponível; note-se que o GitHub reporta `fork: false` para este último, sem
 * repositório-pai registrado — é tratado aqui como snapshot/mirror independente, não um "fork"
 * formal), não no repo oficial. Ver docs/providers/quepasa.md para a discussão completa de
 * confiança/gaps por seção.
 *
 * @see docs/providers/quepasa.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
interface QuepasaOptions {
    /**
     * URL base da instância QuePasa self-hosted (ex.: `http://localhost:31000`). Sem padrão — cada
     * implantação Docker define seu próprio host/porta, mesmo padrão dos demais adapters self-hosted
     * deste pacote (WAHA/Evolution GO/uazapi/Wuzapi).
     */
    baseUrl: string;
    /**
     * Token da instância ("server"/"bot"), uma string ARBITRÁRIA escolhida pelo cliente — não é uma
     * API key emitida pelo servidor. Não existe passo explícito de "criar instância": o registro só é
     * persistido quando o pareamento via QR é confirmado (`OnPaired`). Ver
     * docs/providers/quepasa.md#autenticação.
     */
    token: string;
    /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
    timeoutMs?: number;
    /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
    retries?: number;
    /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
    fetch?: typeof globalThis.fetch;
}
/** Fábrica do adapter QuePasa. */
declare function quepasa(options: QuepasaOptions): WaAdapter;

export { type QuepasaOptions, quepasa };
