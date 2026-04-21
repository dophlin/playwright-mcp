/**
 * OpenMate API key authentication (M1-B).
 *
 * Contract (per specs/005-m1-b-mcp-server/spec.md FR-004..FR-006 and Q3):
 *   - Valid keys match `^sk-om-[0-9A-Za-z]{48}$` (56 chars total).
 *   - `Authorization: Bearer <key>` is mandatory on every MCP request.
 *   - Missing / malformed / wrong keys → HTTP 401 with the JSON body
 *     `{ "error": { "code": 401, "message": "Unauthorised — valid API key required" } }`
 *     and a structured single-line JSON log record to stdout.
 *   - Startup fails fast (non-zero exit) if `OPENMATE_API_KEY` is missing or
 *     malformed.
 */

'use strict';

const API_KEY_PATTERN = /^sk-om-[0-9A-Za-z]{48}$/;
const UNAUTHORISED_MESSAGE = 'Unauthorised — valid API key required';

function validateApiKeyFormat(key) {
  return typeof key === 'string' && API_KEY_PATTERN.test(key);
}

function assertStartupApiKey(envKey) {
  if (!envKey) {
    process.stderr.write(
      'FATAL: OPENMATE_API_KEY is not set. Refusing to start.\n',
    );
    process.exit(1);
  }
  if (!validateApiKeyFormat(envKey)) {
    process.stderr.write(
      'FATAL: OPENMATE_API_KEY does not match required shape ' +
        '`sk-om-` + 48 chars of [0-9A-Za-z]. Refusing to start.\n',
    );
    process.exit(1);
  }
}

function extractBearer(authHeader) {
  if (typeof authHeader !== 'string') return null;
  const match = /^Bearer (.+)$/.exec(authHeader);
  return match ? match[1] : null;
}

function logAuthFailure(reason, req) {
  const record = {
    ts: new Date().toISOString(),
    outcome: 'auth_failed',
    reason,
    method: req.method,
    path: req.url,
    correlation_id:
      req.headers['x-request-id'] ||
      req.headers['x-correlation-id'] ||
      null,
  };
  process.stdout.write(JSON.stringify(record) + '\n');
}

function respond401(res) {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('WWW-Authenticate', 'Bearer');
  res.end(
    JSON.stringify({
      error: { code: 401, message: UNAUTHORISED_MESSAGE },
    }),
  );
}

function createAuthGate(expectedKey) {
  return function authGate(req, res) {
    const header = req.headers['authorization'];
    const presented = extractBearer(header);
    if (!presented) {
      logAuthFailure(header ? 'malformed_header' : 'missing_header', req);
      respond401(res);
      return false;
    }
    if (!validateApiKeyFormat(presented)) {
      logAuthFailure('bad_shape', req);
      respond401(res);
      return false;
    }
    if (presented !== expectedKey) {
      logAuthFailure('wrong_key', req);
      respond401(res);
      return false;
    }
    return true;
  };
}

module.exports = {
  API_KEY_PATTERN,
  UNAUTHORISED_MESSAGE,
  validateApiKeyFormat,
  assertStartupApiKey,
  createAuthGate,
};
