#!/usr/bin/env node
/**
 * OpenMate MCP server entrypoint (M1-B).
 *
 * Boots the composite MCP server (upstream playwright-mcp + two OpenMate stub
 * tools) behind an HTTP/Streamable-HTTP transport guarded by Bearer-token
 * authentication.
 *
 * Environment:
 *   - OPENMATE_API_KEY (required) — shape `sk-om-` + 48 base62 chars
 *   - OPENMATE_PORT    (default 3100)
 *   - OPENMATE_HOST    (default 0.0.0.0)
 *   - OPENMATE_LOG_BANNER=1 to force banner even when stdout is not a TTY
 *
 * Browser configuration mirrors the upstream Docker image: headless chromium,
 * --no-sandbox.
 */

'use strict';

const http = require('node:http');

const packageJson = require('../package.json');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { createOpenMateConnection } = require('./server.js');
const { assertStartupApiKey, createAuthGate } = require('./auth.js');

const PORT = Number(process.env.OPENMATE_PORT || 3100);
const HOST = process.env.OPENMATE_HOST || '0.0.0.0';
const API_KEY = process.env.OPENMATE_API_KEY;
const IMAGE_REVISION =
  process.env.GIT_COMMIT_SHA ||
  process.env.OPENMATE_IMAGE_REVISION ||
  'unknown';

function logBanner() {
  const startedAt = new Date().toISOString();
  const banner = [
    '============================================================',
    ` OpenMate MCP server  v${packageJson.version}`,
    ` Listening on http://${HOST}:${PORT}`,
    ' Upstream: @playwright/mcp (composite mode)',
    ' Auth: Bearer <OPENMATE_API_KEY>',
    '============================================================',
    `openmate-mcp: running commit ${IMAGE_REVISION} at ${startedAt}`,
  ].join('\n');
  process.stderr.write(banner + '\n');
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw)
        return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function main() {
  assertStartupApiKey(API_KEY);

  const config = {
    browser: {
      browserName: 'chromium',
      launchOptions: { headless: true, args: ['--no-sandbox'] },
    },
    server: { port: PORT, host: HOST },
  };

  const server = await createOpenMateConnection(config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const authGate = createAuthGate(API_KEY);

  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (!authGate(req, res))
      return;

    let body;
    if (req.method === 'POST') {
      try {
        body = await readJsonBody(req);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { code: 400, message: 'Invalid JSON body' } }));
        return;
      }
    }

    try {
      await transport.handleRequest(req, res, body);
    } catch (err) {
      process.stderr.write(
        `transport error: ${(err && err.stack) || err}\n`,
      );
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { code: 500, message: 'Internal error' } }));
      }
    }
  });

  httpServer.listen(PORT, HOST, () => {
    logBanner();
  });

  const shutdown = async signal => {
    process.stderr.write(`Received ${signal}, shutting down\n`);
    httpServer.close();
    try {
      await server.close();
    } catch (_) { /* no-op */ }
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

main().catch(err => {
  process.stderr.write(
    `FATAL: OpenMate MCP server failed to start: ${(err && err.stack) || err}\n`,
  );
  process.exit(1);
});
