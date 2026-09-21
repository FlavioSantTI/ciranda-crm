import { WaConnectorError, statusToErrorCode, redactSecrets } from './chunk-JIDVFSO6.js';

// src/core/http.ts
function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}
var RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 502, 503, 504]);
var RETRY_AFTER_MAX_MS = 3e4;
var HttpClient = class {
  baseUrl;
  headers;
  timeoutMs;
  retries;
  secrets;
  provider;
  fetchImpl;
  constructor(options) {
    this.baseUrl = stripTrailingSlashes(options.baseUrl);
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 3e4;
    this.retries = options.retries ?? 2;
    this.secrets = options.secrets ?? [];
    this.provider = options.provider;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }
  async request(options) {
    const url = this.buildUrl(options);
    const method = resolveMethod(options);
    const canRetry = method === "GET" || method === "HEAD" || options.idempotent === true;
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await sleep(lastError?.retryAfterMs ?? backoffMs(attempt));
      }
      try {
        return await this.attempt(url, options);
      } catch (error) {
        if (!(error instanceof WaConnectorError)) {
          throw error;
        }
        lastError = error;
        const retryable = canRetry && (error.code === "NETWORK_ERROR" || error.status !== void 0 && RETRYABLE_STATUSES.has(error.status));
        if (!retryable) {
          throw error;
        }
      }
    }
    throw lastError ?? new WaConnectorError("NETWORK_ERROR", "Falha de rede sem detalhes.", {
      provider: this.provider
    });
  }
  async attempt(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const method = resolveMethod(options);
    try {
      const hasJsonBody = options.body !== void 0;
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          ...hasJsonBody ? { "content-type": "application/json" } : {},
          ...this.headers,
          ...options.headers
        },
        body: hasJsonBody ? JSON.stringify(options.body) : void 0,
        signal: controller.signal
      });
      if (!response.ok) {
        const bodyText = await safeText(response);
        const retryAfterMs = response.status === 429 || response.status === 503 ? parseRetryAfterMs(response.headers.get("retry-after")) : void 0;
        throw new WaConnectorError(
          statusToErrorCode(response.status),
          this.redact(
            `HTTP ${response.status} em ${method} ${options.path}: ${truncate(bodyText, 400)}`
          ),
          { provider: this.provider, status: response.status, retryAfterMs }
        );
      }
      if (response.status === 204) {
        return void 0;
      }
      if (options.responseType === "base64") {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer).toString("base64");
      }
      const text = await safeText(response);
      if (text.length === 0) {
        return void 0;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("json") || looksLikeJson(text)) {
        try {
          return JSON.parse(text);
        } catch {
        }
      }
      return text;
    } catch (error) {
      if (error instanceof WaConnectorError) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new WaConnectorError(
          "TIMEOUT",
          this.redact(`Timeout ap\xF3s ${this.timeoutMs}ms em ${method} ${options.path}.`),
          { provider: this.provider, cause: error }
        );
      }
      throw new WaConnectorError(
        "NETWORK_ERROR",
        this.redact(`Erro de rede em ${method} ${options.path}: ${errorMessage(error)}`),
        { provider: this.provider, cause: error }
      );
    } finally {
      clearTimeout(timer);
    }
  }
  buildUrl(options) {
    const path = options.path.startsWith("/") ? options.path : `/${options.path}`;
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== void 0) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
  redact(text) {
    return redactSecrets(text, this.secrets);
  }
};
function resolveMethod(options) {
  return options.method ?? (options.body !== void 0 ? "POST" : "GET");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function backoffMs(attempt) {
  return Math.min(4e3, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
}
function parseRetryAfterMs(headerValue) {
  if (headerValue === null) return void 0;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return void 0;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 48 || code > 57) return void 0;
  }
  const seconds = Number(trimmed);
  return Math.min(RETRY_AFTER_MAX_MS, seconds * 1e3);
}
async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}\u2026`;
}
function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function looksLikeJson(text) {
  const first = text.trimStart().charAt(0);
  return first === "{" || first === "[";
}

export { HttpClient };
//# sourceMappingURL=chunk-SYMHJK3P.js.map
//# sourceMappingURL=chunk-SYMHJK3P.js.map