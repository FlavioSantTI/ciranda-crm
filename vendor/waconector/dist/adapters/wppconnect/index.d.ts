import { W as WaAdapter } from '../../adapter-Drr42jS8.js';

/**
 * Opções do adapter WPPConnect Server (self-hosted via Docker, `wppconnect-team/wppconnect-server`
 * — wrapper REST em cima da lib `@wppconnect-team/wppconnect`, que controla o WhatsApp Web via
 * Puppeteer).
 *
 * @see docs/providers/wppconnect.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
interface WppconnectOptions {
    /** URL base do servidor WPPConnect Server (ex.: `http://localhost:21465`). */
    baseUrl: string;
    /**
     * Nome da sessão. Diferente de outros adapters self-hosted deste pacote (Wuzapi/uazapi, onde a
     * sessão é resolvida a partir do header de auth), o WPPConnect exige o nome da sessão embutido
     * no PATH de toda chamada (`/api/{session}/...`) — por isso é obrigatório aqui, não opcional.
     */
    session: string;
    /**
     * Token Bearer da sessão, obtido via `POST /api/{session}/{secretkey}/generate-token` (fora do
     * escopo deste adapter — provisionamento feito pelo operador do servidor, que precisa conhecer o
     * `secretKey` global do `config.ts`; mesmo padrão de "token pré-provisionado" já usado em
     * `WuzapiOptions.token`/`UazapiOptions.token`). Enviado como `Authorization: Bearer <token>` —
     * ver docs/providers/wppconnect.md#autenticação para a forma alternativa (token embutido no
     * próprio path `:session`), não usada por este adapter.
     */
    token: string;
    /**
     * URL de webhook a configurar para esta sessão especificamente (campo `webhook` do body de
     * `POST /start-session`, sobrepõe o `webhook.url` global do `config.ts` do servidor). Opcional —
     * quando ausente, vale o que já estiver configurado no servidor.
     */
    webhook?: string;
    /**
     * Quando `true` (padrão), `instance.connect()` envia `waitQrCode: true` — a única forma de obter
     * o QR (ou pairing code) de volta na própria resposta HTTP síncrona, em vez de precisar fazer
     * polling em `instance.status()`. **Risco reavaliado, ainda não confirmado empiricamente**: a
     * leitura de `src/controller/sessionController.ts` mostra que `startSession` chama
     * `getSessionState` incondicionalmente ANTES do fluxo de espera pelo QR, e esta responde de
     * imediato sempre que a sessão já existir (`req.client` truthy) — em QUALQUER estado
     * (`CONNECTED`, `INITIALIZING`, etc.), não só quando já conectada. Ou seja, o "pendurar até o
     * QR/pairing code chegar" só deveria ocorrer para uma sessão genuinamente NOVA (nunca iniciada,
     * ou removida após logout), não para uma reconexão de sessão já vista antes — cenário mais
     * estreito do que a versão anterior deste aviso sugeria. Ainda não testado contra uma instância
     * real (ver docs/providers/wppconnect.md#instanceconnect). Defina `false` para retornar
     * imediatamente (sem QR) e fazer polling via `instance.status()` em vez disso.
     */
    waitQrCode?: boolean;
    /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
    timeoutMs?: number;
    /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
    retries?: number;
    /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
    fetch?: typeof globalThis.fetch;
}
/** Fábrica do adapter WPPConnect Server. */
declare function wppconnect(options: WppconnectOptions): WaAdapter;

export { type WppconnectOptions, wppconnect };
