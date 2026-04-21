/**
 * OpenMate stub tool definitions (M1-B).
 *
 * Per `specs/005-m1-b-mcp-server/spec.md` FR-002/FR-003 and execution plan
 * §B3/§B4 these handlers return hardcoded mock documents. Real implementations
 * land in M2.
 */

'use strict';

const BOOTSTRAP_TOOL = {
  name: 'openmate_agent_bootstrap',
  description:
    'Always call this tool first before any browser action. Loads the workflow grounding document and initialises the session.',
  inputSchema: {
    type: 'object',
    properties: {
      request: { type: 'string' },
      mode: { type: 'string', enum: ['executor', 'copilot', 'tutor'] },
    },
    required: ['request'],
    additionalProperties: false,
  },
};

const BOOTSTRAP_MOCK = {
  session_id: 'mock-session-001',
  protocol: {
    description: 'Use browser_* tools to execute this workflow.',
    credential_rule: 'Never pass credentials through this conversation.',
    completion: 'Call openmate_session_complete when done.',
  },
  agent: { name: 'Mock Agent', persona: 'Be concise.', mode: 'executor' },
  grounding: {
    type: 'skill',
    title: 'Mock Skill',
    ai_description: 'A mock skill for testing.',
    allowed_domains: ['example.com'],
    steps: [
      {
        step_index: 0,
        intent: 'Navigate to example.com',
        expected_element_description: 'Main heading',
      },
    ],
  },
  extension_status: 'connected',
  extension_tab_title: 'Mock Tab',
};

const SESSION_COMPLETE_TOOL = {
  name: 'openmate_session_complete',
  description:
    'Call this tool when the OpenMate session is complete. Returns a fixed acknowledgement in M1-B.',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: { type: 'string' },
      outcome: { type: 'string', enum: ['success', 'partial', 'failed'] },
      summary: { type: 'string' },
    },
    required: ['session_id', 'outcome', 'summary'],
    additionalProperties: false,
  },
};

const SESSION_COMPLETE_MOCK = {
  status: 'acknowledged',
  session_duration_ms: 0,
  steps_executed: 0,
  log_url: null,
};

function toolCallResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload),
      },
    ],
  };
}

module.exports = {
  BOOTSTRAP_TOOL,
  BOOTSTRAP_MOCK,
  SESSION_COMPLETE_TOOL,
  SESSION_COMPLETE_MOCK,
  toolCallResult,
};
