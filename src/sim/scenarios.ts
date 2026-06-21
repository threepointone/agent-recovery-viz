/**
 * Recovery Lab — Preset Scenarios
 *
 * Each scenario is a pre-planned sequence of events that demonstrates
 * a specific recovery path. The user can also start a normal turn and
 * inject failures manually — the engine computes the recovery path on
 * the fly using the classifier.
 *
 * Time values are in simulation milliseconds. The playhead advances
 * through them at a configurable speed.
 */

import type { Scenario, SimEvent, SimEventType, TrackId } from "./types";

// ─── Event Factory ────────────────────────────────────────────────────

let eventCounter = 0;

function ev(
  time: number,
  type: SimEventType,
  track: TrackId,
  label: string,
  description: string,
  data?: Record<string, unknown>,
): SimEvent {
  eventCounter += 1;
  return {
    id: `e${eventCounter}`,
    time,
    type,
    track,
    label,
    description,
    data,
  };
}

/** Reset counter so scenario rebuilds are deterministic */
export function resetEventCounter(): void {
  eventCounter = 0;
}

// ─── Scenarios ────────────────────────────────────────────────────────

export const SCENARIOS: Scenario[] = [
  // ── 1. Normal Turn ──────────────────────────────────────────────────
  {
    id: "normal",
    name: "Normal Turn",
    description:
      "A happy-path chat turn with no failures. The user sends a message, the fiber starts, the model streams a response with a tool call, and the turn completes.",
    totalDuration: 1000,
    events: [
      ev(0, "user_message", "client", "User message", "User sends: \"What's the weather in San Francisco?\""),
      ev(100, "fiber_start", "fiber", "Fiber start", "runFiber() writes a durable 'running' row to SQLite before any volatile work begins."),
      ev(200, "stream_chunk", "stream", "Chunk 1", "Model streams: \"Let me check the weather for you.\"", { text: "Let me check the weather for you.", chunkId: 1 }),
      ev(300, "tool_call_start", "tools", "getWeather", "Tool call starts: getWeather(location: \"SF\")", { toolId: "t1", name: "getWeather" }),
      ev(500, "tool_call_settle", "tools", "getWeather settled", "Tool result persisted durably to SQLite: \"62°F, partly cloudy\"", { toolId: "t1", name: "getWeather", result: "62°F, partly cloudy" }),
      ev(600, "stream_chunk", "stream", "Chunk 2", "Model streams: \"It's currently 62°F and partly cloudy in San Francisco.\"", { text: "It's currently 62°F and partly cloudy in San Francisco.", chunkId: 2 }),
      ev(700, "stash_checkpoint", "fiber", "Checkpoint", "ctx.stash() writes progress to the fiber row: phase=streaming, cursor=2, progress=2", { phase: "streaming", cursor: 2, progress: 2 }),
      ev(800, "stream_chunk", "stream", "Chunk 3", "Model streams: \"You might want a light jacket.\"", { text: "You might want a light jacket.", chunkId: 3 }),
      ev(1000, "turn_complete", "fiber", "Turn complete", "The assistant message is finalized and persisted. The fiber row transitions to 'done'."),
    ],
  },

  // ── 2. Client Disconnect (Stream Resume) ────────────────────────────
  {
    id: "client_disconnect",
    name: "Client Disconnect",
    description:
      "The client's WebSocket drops mid-stream. The Durable Object is still alive and keeps streaming. On reconnect, the resume handshake replays buffered chunks from SQLite.",
    totalDuration: 1200,
    events: [
      ev(0, "user_message", "client", "User message", "User sends: \"What's the weather in San Francisco?\""),
      ev(100, "fiber_start", "fiber", "Fiber start", "runFiber() writes a durable 'running' row."),
      ev(200, "stream_chunk", "stream", "Chunk 1", "Model streams: \"Let me check the weather for you.\"", { text: "Let me check the weather for you.", chunkId: 1 }),
      ev(300, "tool_call_start", "tools", "getWeather", "Tool call starts."),
      ev(500, "tool_call_settle", "tools", "getWeather settled", "Tool result persisted: \"62°F, partly cloudy\""),
      ev(600, "stream_chunk", "stream", "Chunk 2", "Model streams: \"It's currently 62°F...\"", { text: "It's currently 62°F...", chunkId: 2 }),
      ev(700, "client_disconnect", "client", "Client disconnect", "WebSocket drops. The Durable Object is still alive — the stream continues server-side."),
      ev(750, "stream_chunk", "stream", "Chunk 3 (buffered)", "Model streams: \"and partly cloudy.\" — chunk is persisted to SQLite but client isn't connected to receive it.", { text: "and partly cloudy.", chunkId: 3 }),
      ev(850, "stream_chunk", "stream", "Chunk 4 (buffered)", "Model streams: \"Bring a jacket.\" — persisted, buffered for replay.", { text: "Bring a jacket.", chunkId: 4 }),
      ev(950, "client_reconnect", "client", "Client reconnect", "Client reconnects to the same Durable Object via stable session ID."),
      ev(1000, "stream_resume_request", "client", "Resume request", "Client sends STREAM_RESUME_REQUEST after its handler is ready."),
      ev(1050, "stream_resume_ack", "stream", "Resume ACK", "Server replies with STREAM_RESUMING. ResumableStream prepares to replay buffered chunks."),
      ev(1100, "stream_replay", "stream", "Chunk replay", "Buffered chunks 3-4 are replayed to the client from the SQLite chunk log."),
      ev(1200, "turn_complete", "fiber", "Turn complete", "The turn completes. The client has the full response."),
    ],
  },

  // ── 3. DO Eviction: Retry Turn ──────────────────────────────────────
  {
    id: "evict_retry",
    name: "Eviction → Retry Turn",
    description:
      "The Durable Object is evicted before the model produces any output. The classifier sees no output was produced and retries the entire turn from scratch.",
    totalDuration: 2000,
    events: [
      ev(0, "user_message", "client", "User message", "User sends: \"What's the weather?\""),
      ev(100, "fiber_start", "fiber", "Fiber start", "runFiber() writes 'running' row. The model is thinking..."),
      ev(400, "do_eviction", "fiber", "DO eviction", "The isolate is replaced (deploy/eviction/OOM). All in-memory state is lost. The durable 'running' row survives in SQLite."),
      ev(500, "do_reboot", "fiber", "DO reboot", "A new isolate starts. The recovery engine sweeps for 'running' fibers with no live execution."),
      ev(600, "fiber_recover", "fiber", "Fiber recovered", "onFiberRecovered() is called. The fiber row shows 'running' but no checkpoint exists — no output was produced."),
      ev(700, "classify", "fiber", "Classify", "Classifier evaluates: producedOutput=false → retry-turn"),
      ev(800, "schedule_recovery", "fiber", "Schedule", "A named timer is scheduled in the timer table. The single DO alarm is armed."),
      ev(1000, "timer_fire", "fiber", "Timer fires", "The DO alarm fires. The recovery callback runs idempotently."),
      ev(1100, "recovery_retry", "fiber", "Retry turn", "The interrupted fiber is discarded. The entire turn is retried from the user message."),
      ev(1200, "fiber_start", "fiber", "Fiber start (retry)", "A new runFiber() writes a new 'running' row."),
      ev(1300, "stream_chunk", "stream", "Chunk 1", "Model streams: \"Let me check...\"", { text: "Let me check...", chunkId: 1 }),
      ev(1400, "tool_call_start", "tools", "getWeather", "Tool call starts."),
      ev(1600, "tool_call_settle", "tools", "getWeather settled", "Tool result persisted: \"62°F\""),
      ev(1700, "stream_chunk", "stream", "Chunk 2", "Model streams: \"It's 62°F and sunny.\"", { text: "It's 62°F and sunny.", chunkId: 2 }),
      ev(2000, "turn_complete", "fiber", "Turn complete", "The turn completes successfully after recovery."),
    ],
  },

  // ── 4. DO Eviction: Preserve Tool Result ────────────────────────────
  {
    id: "evict_preserve",
    name: "Eviction → Preserve Result",
    description:
      "The DO is evicted after a tool call settled and was persisted. The classifier sees the settled tool and preserves its result — no re-execution needed.",
    totalDuration: 1700,
    events: [
      ev(0, "user_message", "client", "User message", "User sends: \"What's the weather?\""),
      ev(100, "fiber_start", "fiber", "Fiber start", "runFiber() writes 'running' row."),
      ev(200, "stream_chunk", "stream", "Chunk 1", "Model streams: \"Let me check...\"", { text: "Let me check...", chunkId: 1 }),
      ev(300, "tool_call_start", "tools", "getWeather", "Tool call starts."),
      ev(500, "tool_call_settle", "tools", "getWeather settled", "Tool result persisted to SQLite: \"62°F, partly cloudy\". Idempotency boundary — this result is now durable."),
      ev(600, "stash_checkpoint", "fiber", "Checkpoint", "ctx.stash(): phase=tool-done, cursor=1, progress=1", { phase: "tool-done", cursor: 1, progress: 1 }),
      ev(700, "do_eviction", "fiber", "DO eviction", "Isolate replaced. In-memory state lost. But the tool result and checkpoint survive in SQLite."),
      ev(800, "do_reboot", "fiber", "DO reboot", "New isolate starts. Recovery sweep begins."),
      ev(900, "fiber_recover", "fiber", "Fiber recovered", "onFiberRecovered() with checkpoint: phase=tool-done, cursor=1."),
      ev(1000, "classify", "fiber", "Classify", "Classifier: lastTool.settled=true → preserve-tool-result. The settled result will NOT be re-executed."),
      ev(1100, "schedule_recovery", "fiber", "Schedule", "Timer scheduled for recovery continuation."),
      ev(1300, "timer_fire", "fiber", "Timer fires", "Alarm fires. Recovery callback executes."),
      ev(1400, "recovery_preserve", "fiber", "Preserve result", "The settled tool result is reused. The model continues streaming from the checkpoint."),
      ev(1500, "stream_chunk", "stream", "Chunk 2", "Model streams: \"It's 62°F and partly cloudy.\"", { text: "It's 62°F and partly cloudy.", chunkId: 2 }),
      ev(1700, "turn_complete", "fiber", "Turn complete", "Turn completes. The tool was never re-executed — side effects were preserved."),
    ],
  },

  // ── 5. DO Eviction: Continue Partial ────────────────────────────────
  {
    id: "evict_continue",
    name: "Eviction → Continue Partial",
    description:
      "The DO is evicted while the model is streaming text (no tool calls). The classifier sees partial text and continues from the last checkpoint.",
    totalDuration: 1500,
    events: [
      ev(0, "user_message", "client", "User message", "User sends: \"Explain how DNS works.\""),
      ev(100, "fiber_start", "fiber", "Fiber start", "runFiber() writes 'running' row."),
      ev(200, "stream_chunk", "stream", "Chunk 1", "Model streams: \"DNS, or Domain Name System,\"", { text: "DNS, or Domain Name System,", chunkId: 1 }),
      ev(300, "stream_chunk", "stream", "Chunk 2", "Model streams: \"is like a phonebook for the internet.\"", { text: "is like a phonebook for the internet.", chunkId: 2 }),
      ev(350, "stash_checkpoint", "fiber", "Checkpoint", "ctx.stash(): phase=streaming, cursor=2, progress=2", { phase: "streaming", cursor: 2, progress: 2 }),
      ev(400, "do_eviction", "fiber", "DO eviction", "Isolate replaced. Partial text (chunks 1-2) survives in SQLite. No tool calls were made."),
      ev(500, "do_reboot", "fiber", "DO reboot", "New isolate. Recovery sweep."),
      ev(600, "fiber_recover", "fiber", "Fiber recovered", "onFiberRecovered() with checkpoint: cursor=2. Two chunks already persisted."),
      ev(700, "classify", "fiber", "Classify", "Classifier: partialText != null, no tool → continue-partial. Recovery will resume from chunk 2."),
      ev(800, "schedule_recovery", "fiber", "Schedule", "Timer scheduled."),
      ev(1000, "timer_fire", "fiber", "Timer fires", "Alarm fires."),
      ev(1100, "recovery_continue", "fiber", "Continue partial", "The partial assistant message is reconstructed from persisted chunks. Streaming resumes from cursor=2."),
      ev(1200, "stream_chunk", "stream", "Chunk 3", "Model streams: \"When you type a URL,\"", { text: "When you type a URL,", chunkId: 3 }),
      ev(1300, "stream_chunk", "stream", "Chunk 4", "Model streams: \"your computer queries a DNS resolver...\"", { text: "your computer queries a DNS resolver...", chunkId: 4 }),
      ev(1500, "turn_complete", "fiber", "Turn complete", "Turn completes. The user sees a seamless response — no gap from the recovery."),
    ],
  },

  // ── 6. DO Eviction: Repair Transcript ───────────────────────────────
  {
    id: "evict_repair",
    name: "Eviction → Repair Transcript",
    description:
      "The DO is evicted while a tool call is in-flight (not yet settled). The classifier sees a dangling tool entry and repairs the transcript before retrying the tool.",
    totalDuration: 1800,
    events: [
      ev(0, "user_message", "client", "User message", "User sends: \"What's the weather?\""),
      ev(100, "fiber_start", "fiber", "Fiber start", "runFiber() writes 'running' row."),
      ev(200, "stream_chunk", "stream", "Chunk 1", "Model streams: \"Let me check...\"", { text: "Let me check...", chunkId: 1 }),
      ev(300, "tool_call_start", "tools", "getWeather", "Tool call starts: getWeather(\"SF\"). The tool promise is in-flight — not yet persisted."),
      ev(400, "do_eviction", "fiber", "DO eviction", "Isolate replaced. The tool promise dies, leaving a dangling tool-call entry in the transcript. No result was persisted."),
      ev(500, "do_reboot", "fiber", "DO reboot", "New isolate. Recovery sweep."),
      ev(600, "fiber_recover", "fiber", "Fiber recovered", "onFiberRecovered(). The transcript shows a tool call with no result — a dangling entry."),
      ev(700, "classify", "fiber", "Classify", "Classifier: lastTool != null, not settled, no child → repair-transcript. The dangling entry must be repaired."),
      ev(800, "schedule_recovery", "fiber", "Schedule", "Timer scheduled."),
      ev(1000, "timer_fire", "fiber", "Timer fires", "Alarm fires."),
      ev(1100, "recovery_repair", "fiber", "Repair transcript", "The dangling tool-call entry is removed from the transcript. The tool call is retried from scratch."),
      ev(1200, "tool_call_start", "tools", "getWeather (retry)", "Tool call retries: getWeather(\"SF\")."),
      ev(1400, "tool_call_settle", "tools", "getWeather settled", "Tool result persisted: \"62°F\""),
      ev(1500, "stream_chunk", "stream", "Chunk 2", "Model streams: \"It's 62°F and sunny.\"", { text: "It's 62°F and sunny.", chunkId: 2 }),
      ev(1800, "turn_complete", "fiber", "Turn complete", "Turn completes after transcript repair and tool retry."),
    ],
  },

  // ── 7. DO Eviction: Park for Human ──────────────────────────────────
  {
    id: "evict_park",
    name: "Eviction → Park for Human",
    description:
      "The DO is evicted while a tool is awaiting human approval. The classifier parks the turn — waiting is budget-free. The turn resumes when the human responds.",
    totalDuration: 2000,
    events: [
      ev(0, "user_message", "client", "User message", "User sends: \"Email the team about the deploy.\""),
      ev(100, "fiber_start", "fiber", "Fiber start", "runFiber() writes 'running' row."),
      ev(200, "stream_chunk", "stream", "Chunk 1", "Model streams: \"I'll send that email for you.\"", { text: "I'll send that email for you.", chunkId: 1 }),
      ev(300, "tool_call_start", "tools", "sendEmail (needs approval)", "Tool call starts: sendEmail(to: team, subject: deploy). This tool needs human approval before executing.", { toolId: "t1", name: "sendEmail", needsApproval: true }),
      ev(400, "stash_checkpoint", "fiber", "Checkpoint", "ctx.stash(): phase=awaiting-approval. The turn is now waiting on a human.", { phase: "awaiting-approval", cursor: 1, progress: 1 }),
      ev(500, "do_eviction", "fiber", "DO eviction", "Isolate replaced. The turn was waiting for human approval — no work was in-flight."),
      ev(600, "do_reboot", "fiber", "DO reboot", "New isolate. Recovery sweep."),
      ev(700, "fiber_recover", "fiber", "Fiber recovered", "onFiberRecovered() with checkpoint: phase=awaiting-approval."),
      ev(800, "classify", "fiber", "Classify", "Classifier: pendingHumanInteraction=true → park-for-human. Waiting is budget-free — no progress budget is consumed."),
      ev(900, "schedule_recovery", "fiber", "Schedule", "Timer scheduled, but the recovery just waits."),
      ev(1100, "timer_fire", "fiber", "Timer fires", "Alarm fires. Recovery checks: still waiting for human. No-op."),
      ev(1200, "recovery_park", "fiber", "Park for human", "The turn is parked. The progress budget is NOT consumed while waiting."),
      ev(1500, "human_approve", "tools", "Human approves", "The human approves the email tool call. The turn resumes."),
      ev(1600, "tool_call_settle", "tools", "sendEmail settled", "Email sent. Result persisted: \"sent to 12 recipients\""),
      ev(1700, "stream_chunk", "stream", "Chunk 2", "Model streams: \"Email sent successfully to 12 recipients.\"", { text: "Email sent successfully to 12 recipients.", chunkId: 2 }),
      ev(2000, "turn_complete", "fiber", "Turn complete", "Turn completes after human approval."),
    ],
  },

  // ── 8. DO Eviction: Reattach Child ──────────────────────────────────
  {
    id: "evict_reattach",
    name: "Eviction → Reattach Child",
    description:
      "The DO is evicted while a child agent (facet) is running with its own durable run. The parent reattaches to the child's run by stable ID and collects its result.",
    totalDuration: 2000,
    events: [
      ev(0, "user_message", "client", "User message", "User sends: \"Research the top 3 competitors and summarize.\""),
      ev(100, "fiber_start", "fiber", "Fiber start", "runFiber() writes 'running' row for the parent turn."),
      ev(200, "stream_chunk", "stream", "Chunk 1", "Model streams: \"I'll research the competitors for you.\"", { text: "I'll research the competitors for you.", chunkId: 1 }),
      ev(300, "tool_call_start", "tools", "spawnChild (facet)", "Parent spawns a child agent (facet) to do the research. The child has its own durable run with a stable runId.", { toolId: "t1", name: "spawnChild", isChildAgent: true }),
      ev(400, "stash_checkpoint", "fiber", "Checkpoint", "ctx.stash(): phase=child-running, childRunId=run_42", { phase: "child-running", cursor: 1, progress: 1 }),
      ev(500, "do_eviction", "fiber", "DO eviction", "Isolate replaced. Both parent and child die together on deploy. But both have durable state — the child's runId survives."),
      ev(600, "do_reboot", "fiber", "DO reboot", "New isolate. Recovery sweep finds the parent's 'running' fiber."),
      ev(700, "fiber_recover", "fiber", "Fiber recovered", "onFiberRecovered() with checkpoint: phase=child-running, childRunId=run_42."),
      ev(800, "classify", "fiber", "Classify", "Classifier: hasChildRun=true (child agent was running) → reattach-child. The parent will reattach to the child's durable run."),
      ev(900, "schedule_recovery", "fiber", "Schedule", "Timer scheduled for reattachment."),
      ev(1100, "timer_fire", "fiber", "Timer fires", "Alarm fires."),
      ev(1200, "recovery_reattach", "fiber", "Reattach child", "Parent looks up child runId=run_42 in durable state. The child also recovers its own state. Parent reattaches to the child's terminal result."),
      ev(1400, "tool_call_settle", "tools", "Child result collected", "Child's terminal result is collected by the parent: \"Found 3 competitors: A, B, C\""),
      ev(1500, "stream_chunk", "stream", "Chunk 2", "Model streams: \"Here are the top 3 competitors...\"", { text: "Here are the top 3 competitors...", chunkId: 2 }),
      ev(1700, "stream_chunk", "stream", "Chunk 3", "Model streams: \"Company A leads in market share...\"", { text: "Company A leads in market share...", chunkId: 3 }),
      ev(2000, "turn_complete", "fiber", "Turn complete", "Turn completes. The child's work was preserved across the eviction."),
    ],
  },
];

// ─── Scenario Map ─────────────────────────────────────────────────────

export const SCENARIO_MAP: Record<string, Scenario> = Object.fromEntries(
  SCENARIOS.map((s) => [s.id, s]),
);
