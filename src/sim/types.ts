/**
 * Recovery Lab — Simulation Types
 *
 * The simulation is a discrete event simulator that models a chat turn
 * lifecycle in Cloudflare's agent recovery system. Events are scheduled
 * on a timeline, and the playhead advances through them. When a failure
 * is injected, the classifier computes the recovery path and new events
 * are inserted into the timeline.
 */

// ─── Tracks ───────────────────────────────────────────────────────────

export type TrackId =
  | "client" // WebSocket connection state
  | "fiber" // Fiber lifecycle (running → interrupted → recovering)
  | "stream" // Stream chunks persisted to SQLite
  | "tools" // Tool call states
  | "budget"; // Progress budget meter

export interface TrackConfig {
  id: TrackId;
  label: string;
  description: string;
}

// ─── Events ───────────────────────────────────────────────────────────

export type SimEventType =
  | "user_message"
  | "fiber_start" // runFiber writes "running" row
  | "stream_chunk" // chunk produced + persisted
  | "tool_call_start"
  | "tool_call_settle" // result persisted durably
  | "tool_call_error"
  | "stash_checkpoint" // ctx.stash() writes progress
  | "client_disconnect"
  | "client_reconnect"
  | "stream_resume_request" // client requests resume
  | "stream_resume_ack" // server acks, replays chunks
  | "stream_replay" // buffered chunks sent to client
  | "do_eviction" // isolate dies
  | "do_reboot" // new isolate starts
  | "fiber_recover" // recovery sweep finds running fiber
  | "classify" // classifier runs
  | "schedule_recovery" // timer scheduled
  | "timer_fire" // alarm fires
  | "recovery_retry" // retry-turn action
  | "recovery_continue" // continue-partial action
  | "recovery_preserve" // preserve-tool-result action
  | "recovery_repair" // repair-transcript action
  | "recovery_reattach" // reattach-child action
  | "recovery_park" // park-for-human action
  | "recovery_wait" // wait-on-provider action
  | "human_approve" // human approves tool
  | "turn_complete"
  | "turn_sealed"; // budget exhausted

export interface SimEvent {
  id: string;
  time: number; // ms from simulation start
  type: SimEventType;
  track: TrackId;
  label: string;
  description: string;
  data?: Record<string, unknown>;
}

// ─── Recovery Classifier ──────────────────────────────────────────────

export type RecoveryKind =
  | "retry-turn"
  | "park-for-human"
  | "preserve-tool-result"
  | "reattach-child"
  | "repair-transcript"
  | "continue-partial"
  | "wait-on-provider";

export interface RecoveryDecision {
  kind: RecoveryKind;
  reason: string;
  /** The conditions evaluated by the classifier */
  conditions: {
    producedOutput: boolean;
    pendingHumanInteraction: boolean;
    lastToolSettled: boolean;
    hasChildRun: boolean;
    hasLastTool: boolean;
    hasPartialText: boolean;
  };
  /** Human-readable description of what recovery does */
  action: string;
}

// ─── Snapshot State (derived from events up to currentTime) ───────────

export type FiberStatus =
  | "idle"
  | "running"
  | "interrupted"
  | "recovering"
  | "done"
  | "sealed";

export type ClientStatus = "connecting" | "connected" | "disconnected";

export type StreamStatus =
  | "idle"
  | "streaming"
  | "resuming"
  | "orphaned"
  | "done";

export type ToolStatus = "pending" | "running" | "settled" | "error" | "interrupted";

export interface ToolCallState {
  id: string;
  name: string;
  status: ToolStatus;
  result?: string;
  errorText?: string;
  needsApproval?: boolean;
  isChildAgent?: boolean;
  startedAt: number;
  settledAt?: number;
  interruptedAt?: number;
}

export interface StreamChunkState {
  id: number;
  text: string;
  time: number;
  persisted: boolean;
}

export interface BudgetState {
  progress: number; // monotonic counter
  lastProgressAt: number;
  workUnits: number;
  maxWorkUnits: number;
  noProgressLimitMs: number;
  sealed: boolean;
}

export interface FiberState {
  id: string | null;
  status: FiberStatus;
  checkpoint?: {
    phase: string;
    cursor: number;
    progress: number;
  };
  startedAt?: number;
  interruptedAt?: number;
  recoveredAt?: number;
}

export interface ClientState {
  status: ClientStatus;
  connectedAt?: number;
  disconnectedAt?: number;
  bufferedChunksReplayed: number;
}

export interface StreamState {
  status: StreamStatus;
  chunks: StreamChunkState[];
  messageId: string | null;
}

// ─── Durable State ────────────────────────────────────────────────────

export interface MessageRow {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: number;
  complete: boolean;
}

export interface ChunkRow {
  id: number;
  messageId: string;
  text: string;
  time: number;
}

export interface IncidentRow {
  id: string;
  fiberId: string;
  status: "active" | "resolved";
  startedAt: number;
  resolvedAt?: number;
  decision?: RecoveryKind;
}

export interface SqliteState {
  messages: MessageRow[];
  streamChunks: ChunkRow[];
}

export interface StorageState {
  recovering: boolean;
  incidents: IncidentRow[];
  lastTerminal?: string;
}

// ─── Full Snapshot ────────────────────────────────────────────────────

export interface SimSnapshot {
  fiber: FiberState;
  client: ClientState;
  stream: StreamState;
  tools: ToolCallState[];
  budget: BudgetState;
  sqlite: SqliteState;
  storage: StorageState;
  recovery: {
    active: boolean;
    decision: RecoveryDecision | null;
    phase: "detecting" | "classifying" | "scheduling" | "executing" | "done";
  };
  currentEvent: SimEvent | null;
  turnText: string; // accumulated assistant text
}

// ─── Scenarios ────────────────────────────────────────────────────────

export type FailureType =
  | "disconnect_client"
  | "evict_do"
  | "kill_tool"
  | "deploy";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  events: SimEvent[];
  totalDuration: number;
}

// ─── Engine State ─────────────────────────────────────────────────────

export interface EngineState {
  events: SimEvent[]; // all events (past + future), sorted by time
  currentTime: number;
  playing: boolean;
  speed: number;
  selectedScenarioId: string;
  failureInjected: FailureType | null;
  snapshot: SimSnapshot;
  totalDuration: number;
}

export const TRACK_CONFIGS: TrackConfig[] = [
  {
    id: "client",
    label: "Client WS",
    description: "WebSocket connection state",
  },
  {
    id: "fiber",
    label: "Fiber",
    description: "Fiber lifecycle (durable intent + execution)",
  },
  {
    id: "stream",
    label: "Stream",
    description: "Stream chunks persisted to SQLite",
  },
  {
    id: "tools",
    label: "Tools",
    description: "Tool call states",
  },
  {
    id: "budget",
    label: "Budget",
    description: "Progress budget (forward progress vs. sealing)",
  },
];
