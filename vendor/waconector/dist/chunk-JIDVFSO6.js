// src/core/errors.ts
var WaConnectorError = class extends Error {
  /** Marcador estável para `isWaConnectorError` (sobrevive a cópias do módulo em bundles distintos). */
  isWaConnectorError = true;
  code;
  provider;
  status;
  retryAfterMs;
  constructor(code, message, options = {}) {
    super(message, options.cause === void 0 ? void 0 : { cause: options.cause });
    this.name = "WaConnectorError";
    this.code = code;
    this.provider = options.provider;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
};
var UnsupportedCapabilityError = class extends WaConnectorError {
  capability;
  constructor(capability, provider) {
    const message = provider ? `O provider "${provider}" n\xE3o suporta a capability "${capability}".` : `Capability n\xE3o suportada: "${capability}".`;
    super("UNSUPPORTED_CAPABILITY", message, { provider });
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
  }
};
function isWaConnectorError(value) {
  if (value instanceof WaConnectorError) return true;
  return typeof value === "object" && value !== null && value.isWaConnectorError === true;
}
function statusToErrorCode(status) {
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 429) return "RATE_LIMITED";
  return "PROVIDER_ERROR";
}
function redactSecrets(text, secrets) {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      result = result.split(secret).join("***");
    }
  }
  return result;
}

export { UnsupportedCapabilityError, WaConnectorError, isWaConnectorError, redactSecrets, statusToErrorCode };
//# sourceMappingURL=chunk-JIDVFSO6.js.map
//# sourceMappingURL=chunk-JIDVFSO6.js.map