const axios = require("axios");

const ATTACK_TIMEOUT = parseInt(process.env.ATTACK_TIMEOUT_MS || "30000", 10);

/**
 * Replace the {{INPUT}} placeholder in a string (recursively in objects/arrays).
 */
function injectPayload(value, payload) {
  if (typeof value === "string") {
    return value.replace(/\{\{INPUT\}\}/g, payload);
  }
  if (Array.isArray(value)) {
    return value.map((v) => injectPayload(v, payload));
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = injectPayload(v, payload);
    }
    return result;
  }
  return value;
}

/**
 * Build the final axios request config by injecting the attack payload.
 *
 * targetRequest shape:
 * {
 *   method: "POST",
 *   url: "https://...",
 *   headers: { "Content-Type": "application/json", ... },
 *   body: { "message": "{{INPUT}}", ... }   // OR query params for GET
 * }
 */
function buildRequest(targetRequest, payload) {
  const { method = "POST", url, headers = {}, body = null, params = null } = targetRequest;

  const config = {
    method: method.toUpperCase(),
    url: injectPayload(url, payload),
    headers: injectPayload(headers, payload),
    timeout: ATTACK_TIMEOUT,
    validateStatus: () => true, // capture all HTTP status codes
  };

  if (body !== null) {
    config.data = injectPayload(body, payload);
  }

  if (params !== null) {
    config.params = injectPayload(params, payload);
  }

  return config;
}

/**
 * Send a single red team attack to the target application.
 * Returns a structured result with timing, status, and response body.
 */
async function sendAttack(targetRequest, payload) {
  const requestConfig = buildRequest(targetRequest, payload);
  const startTime = Date.now();

  try {
    const response = await axios(requestConfig);
    const elapsed = Date.now() - startTime;

    let responseBody = response.data;
    if (typeof responseBody !== "string") {
      responseBody = JSON.stringify(responseBody, null, 2);
    }

    return {
      success: true,
      status_code: response.status,
      elapsed_ms: elapsed,
      response_body: responseBody,
      response_headers: response.headers,
      error: null,
    };
  } catch (err) {
    const elapsed = Date.now() - startTime;

    if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
      return {
        success: false,
        status_code: null,
        elapsed_ms: elapsed,
        response_body: null,
        response_headers: null,
        error: "Request timed out — possible DoS indicator",
      };
    }

    return {
      success: false,
      status_code: err.response?.status || null,
      elapsed_ms: elapsed,
      response_body: err.response?.data ? JSON.stringify(err.response.data) : null,
      response_headers: err.response?.headers || null,
      error: err.message,
    };
  }
}

module.exports = { sendAttack, injectPayload };
