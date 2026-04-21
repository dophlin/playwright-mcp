/**
 * OpenMate composite MCP server (M1-B).
 *
 * Wraps upstream `@playwright/mcp`'s `createConnection(config)` and splices the
 * two OpenMate stub tools into its `tools/list` and `tools/call` handlers.
 *
 * The splice uses `Protocol#setRequestHandler`, which explicitly replaces any
 * prior handler for the same method (see
 * `@modelcontextprotocol/sdk/.../shared/protocol.js`). We keep a reference to
 * the upstream handler via the instance's `_requestHandlers` Map and delegate
 * for all non-OpenMate calls so every upstream `browser_*` tool keeps working
 * unchanged.
 */

'use strict';

const { tools: upstreamTools } = require('playwright-core/lib/coreBundle');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const {
  BOOTSTRAP_TOOL,
  BOOTSTRAP_MOCK,
  SESSION_COMPLETE_TOOL,
  SESSION_COMPLETE_MOCK,
  toolCallResult,
} = require('./tools.js');

const OPENMATE_TOOL_NAMES = new Set([
  BOOTSTRAP_TOOL.name,
  SESSION_COMPLETE_TOOL.name,
]);

async function createOpenMateConnection(config) {
  const server = await upstreamTools.createConnection(config);

  const upstreamListHandler = server._requestHandlers.get('tools/list');
  const upstreamCallHandler = server._requestHandlers.get('tools/call');

  if (!upstreamListHandler || !upstreamCallHandler) {
    throw new Error(
      'OpenMate composite server: upstream createConnection() did not register tools/list or tools/call handlers. ' +
        'The playwright-core MCP bundle may have changed; rebase and update openmate/server.js.',
    );
  }

  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const upstream = await upstreamListHandler(request, extra);
    const upstreamList = Array.isArray(upstream && upstream.tools) ? upstream.tools : [];
    return {
      ...upstream,
      tools: [...upstreamList, BOOTSTRAP_TOOL, SESSION_COMPLETE_TOOL],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request && request.params && request.params.name;
    if (name === BOOTSTRAP_TOOL.name)
      return toolCallResult(BOOTSTRAP_MOCK);
    if (name === SESSION_COMPLETE_TOOL.name)
      return toolCallResult(SESSION_COMPLETE_MOCK);
    return upstreamCallHandler(request, extra);
  });

  return server;
}

module.exports = {
  createOpenMateConnection,
  OPENMATE_TOOL_NAMES,
};
