import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  PreToolUseHookInput,
  PostToolUseHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { MODELS } from "@/lib/agent/models";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { circuitforgeTools } from "@/lib/agent/tools";
import { subagents } from "@/lib/agent/subagents";
import type { SSEEvent, AgentRequest } from "@/lib/stream/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function sseEncode(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: AgentRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return new Response(
      JSON.stringify({ error: "Missing 'prompt' in request body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let fullPrompt = body.prompt;
  if (body.previousCode) {
    fullPrompt = `The user previously designed a circuit. Here is the existing tscircuit code:\n\n\`\`\`tsx\n${body.previousCode}\n\`\`\`\n\nThe user now says: ${body.prompt}\n\nModify or extend the existing design based on the user's request.`;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const agentQuery = query({
          prompt: fullPrompt,
          options: {
            model: MODELS.ORCHESTRATOR,
            systemPrompt: SYSTEM_PROMPT,
            includePartialMessages: true,
            persistSession: false,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            allowedTools: [
              "WebFetch",
              "WebSearch",
              "Task",
              "mcp__circuitforge-tools__search_parts",
            ],
            mcpServers: { "circuitforge-tools": circuitforgeTools },
            agents: subagents,
            maxTurns: 20,
            env: { ANTHROPIC_API_KEY: apiKey },
            hooks: {
              PreToolUse: [{
                hooks: [async (input): Promise<HookJSONOutput> => {
                  const h = input as PreToolUseHookInput;
                  controller.enqueue(encoder.encode(sseEncode({
                    type: "tool_start", tool: h.tool_name, input: h.tool_input,
                  })));
                  return { continue: true };
                }],
              }],
              PostToolUse: [{
                hooks: [async (input): Promise<HookJSONOutput> => {
                  const h = input as PostToolUseHookInput;
                  controller.enqueue(encoder.encode(sseEncode({
                    type: "tool_result", tool: h.tool_name, output: h.tool_response,
                  })));
                  return { continue: true };
                }],
              }],
              SubagentStart: [{
                hooks: [async (input): Promise<HookJSONOutput> => {
                  const h = input as SubagentStartHookInput;
                  controller.enqueue(encoder.encode(sseEncode({
                    type: "subagent_start", agent: h.agent_type,
                  })));
                  return { continue: true };
                }],
              }],
              SubagentStop: [{
                hooks: [async (input): Promise<HookJSONOutput> => {
                  const h = input as SubagentStopHookInput;
                  controller.enqueue(encoder.encode(sseEncode({
                    type: "subagent_stop", agent: h.agent_type,
                  })));
                  return { continue: true };
                }],
              }],
            },
          },
        });

        for await (const message of agentQuery) {
          if (message.type === "stream_event" && "event" in message) {
            const event = (message as { event: Record<string, unknown> }).event;

            if (event.type === "content_block_delta") {
              const delta = event.delta as Record<string, unknown> | undefined;
              if (delta?.type === "text_delta" && typeof delta.text === "string") {
                controller.enqueue(encoder.encode(sseEncode({ type: "text", content: delta.text })));
              }
              if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
                controller.enqueue(encoder.encode(sseEncode({ type: "thinking", content: delta.thinking })));
              }
            }
          }

          if (message.type === "result") {
            const result = message as Record<string, unknown>;
            controller.enqueue(encoder.encode(sseEncode({
              type: "done",
              usage: {
                total_cost_usd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : undefined,
              },
            })));
          }
        }
      } catch (error) {
        controller.enqueue(encoder.encode(sseEncode({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown agent error",
        })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
