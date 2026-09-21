import { W as WaAdapter } from '../../adapter-Drr42jS8.cjs';

/**
 * Opções do adapter Z-API (SaaS, `https://api.z-api.io`, hospedagem própria da Z-API — sem opção
 * self-hosted documentada).
 *
 * @see docs/providers/zapi.md para o dossiê completo (auth, endpoints, payloads, assunções).
 */
interface ZapiOptions {
    /**
     * URL base da API Z-API. Padrão: `https://api.z-api.io` — diferente de WAHA/Evolution GO/uazapi
     * (self-hosted ou multi-tenant por subdomínio), a Z-API é um único host fixo para todos os
     * clientes, então este campo raramente precisa ser sobrescrito. Existe mesmo assim (em vez de
     * uma constante interna) para permitir apontar para um proxy/gateway de teste sem rede real.
     */
    baseUrl?: string;
    /**
     * ID da instância, exibido no painel Z-API. **Não é enviado em header** — vai embutido como
     * segmento da URL de toda chamada (`/instances/{instanceId}/token/{token}/...`), conforme o
     * mecanismo de autenticação documentado (não há `Authorization: Bearer`).
     */
    instanceId: string;
    /**
     * Token da instância, exibido no painel Z-API. Mesma observação de `instanceId`: vai embutido
     * como segmento da URL, não em header.
     */
    token: string;
    /**
     * "Token de Segurança da Conta" opcional (painel > Segurança), desabilitado por padrão. Quando
     * uma conta o ativa, TODAS as instâncias da conta passam a exigir o header `Client-Token` em
     * toda requisição — sem ele a Z-API responde 200 com `{"error":"null not allowed"}`. Deixe
     * indefinido se o recurso não estiver ativado na conta.
     */
    clientToken?: string;
    /** Timeout por tentativa, em ms (repassado ao `HttpClient`). */
    timeoutMs?: number;
    /** Retentativas para 429/5xx/erros de rede (repassado ao `HttpClient`; ver ADR-0007). */
    retries?: number;
    /** Injetável para testes (mesmo padrão de `HttpClientOptions.fetch`). */
    fetch?: typeof globalThis.fetch;
}
/** Fábrica do adapter Z-API. */
declare function zapi(options: ZapiOptions): WaAdapter;

export { type ZapiOptions, zapi };
