/**
 * Recovery Lab — Simulation Engine
 *
 * A discrete event simulator that models a chat turn lifecycle in
 * Cloudflare's agent recovery system. The engine maintains a list of
 * events on a timeline. The playhead advances through them at a
 * configurable speed. A snapshot (derived state) is computed by
 * replaying all events up to the current time.
 *
 * When a failure is injected, the engine computes the recovery path
 * using the real classifier logic and inserts new events into the timeline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BudgetState,
  ClientState,
  FailureType,
  FiberState,
  RecoveryDecision,
  SimEvent,
  SimEventType,
  SimSnapshot,
  Scenario,
  StreamState,
  ToolCallState,
  TrackId,
} from "./types";
import { classify, deriveClassifyInput } from "./classifier";
import { SCENARIO_MAP, resetEventCounter } from "./scenarios";

// ─── Event Factory ────────────────────────────────────────────────────

let engineEventCounter = 10000;

function ev(
  time: number,
  type: SimEventType,
  track: TrackId,
  label: string,
  description: string,
  data?: Record<string, unknown>,
): SimEvent {
  engineEventCounter += 1;
  return { id: `eng_${engineEventCounter}`, time, type, track, label, description, data };
}

function stableSort(events: SimEvent[]): SimEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.time - b.e.time || a.i - b.i)
    .map(({ e }) => e);
}

// ─── Snapshot Computation ─────────────────────────────────────────────

const INITIAL_BUDGET: BudgetState = {
  progress: 0,
  lastProgressAt: 0,
  workUnits: 0,
  maxWorkUnits: 500,
  noProgressLimitMs: 60_000,
  sealed: false,
};

const INITIAL_FIBER: FiberState = { id: null, status: "idle" };

const INITIAL_CLIENT: ClientState = {
  status: "connecting",
  bufferedChunksReplayed: 0,
};

const INITIAL_STREAM: StreamState = {
  status: "idle",
  chunks: [],
  messageId: null,
};

// ─── Safe Data Accessors ──────────────────────────────────────────────
// Runtime-validated accessors that replace unchecked `as` assertions.

function str(event: SimEvent, key: string, fallback = ""): string {
  const v = event.data?.[key];
  return typeof v === "string" ? v : fallback;
}

function num(event: SimEvent, key: string, fallback = 0): number {
  const v = event.data?.[key];
  return typeof v === "number" ? v : fallback;
}

function bool(event: SimEvent, key: string, fallback = false): boolean {
  const v = event.data?.[key];
  return typeof v === "boolean" ? v : fallback;
}

export function computeSnapshot(events: SimEvent[], currentTime: number): SimSnapshot {
  const pastEvents = events.filter((e) => e.time <= currentTime);

  let fiber: FiberState = { ...INITIAL_FIBER };
  let client: ClientState = { ...INITIAL_CLIENT };
  let stream: StreamState = { ...INITIAL_STREAM, chunks: [] };
  let tools: ToolCallState[] = [];
  let budget: BudgetState = { ...INITIAL_BUDGET };
  let sqlite = { messages: [] as SimSnapshot["sqlite"]["messages"], streamChunks: [] as SimSnapshot["sqlite"]["streamChunks"] };
  let storage = { recovering: false, incidents: [] as SimSnapshot["storage"]["incidents"], lastTerminal: undefined as string | undefined };
  let recovery: SimSnapshot["recovery"] = { active: false, decision: null, phase: "done" };
  let currentEvent: SimEvent | null = null;
  let turnText = "";

  // Client starts connected (simulating an established WebSocket)
  client.status = "connected";

  for (const event of pastEvents) {
    currentEvent = event;

    switch (event.type) {
      case "user_message": {
        sqlite.messages.push({
          id: `msg_${event.time}`,
          role: "user",
          text: str(event, "text"),
          time: event.time,
          complete: true,
        });
        break;
      }

      case "fiber_start": {
        fiber = {
          id: `turn:${event.time}`,
          status: "running",
          startedAt: event.time,
        };
        budget.lastProgressAt = event.time;
        break;
      }

      case "stream_chunk": {
        const text = str(event, "text");
        const chunkId = num(event, "chunkId", stream.chunks.length + 1);
        stream.chunks.push({ id: chunkId, text, time: event.time, persisted: true });
        stream.status = "streaming";
        if (!stream.messageId) stream.messageId = `asst_${event.time}`;
        sqlite.streamChunks.push({
          id: chunkId,
          messageId: stream.messageId,
          text,
          time: event.time,
        });
        budget.progress += 1;
        budget.lastProgressAt = event.time;
        budget.workUnits += 1;
        turnText += text;
        break;
      }

      case "tool_call_start": {
        tools.push({
          id: str(event, "toolId", `t_${event.time}`),
          name: str(event, "name", "tool"),
          status: "running",
          needsApproval: bool(event, "needsApproval"),
          isChildAgent: bool(event, "isChildAgent"),
          startedAt: event.time,
        });
        budget.workUnits += 1;
        break;
      }

      case "tool_call_settle": {
        const toolId = str(event, "toolId");
        const tool = tools.find((t) => t.id === toolId);
        if (tool) {
          tool.status = "settled";
          tool.result = str(event, "result");
          tool.settledAt = event.time;
        }
        budget.progress += 1;
        budget.lastProgressAt = event.time;
        break;
      }

      case "tool_call_error": {
        const toolId = str(event, "toolId");
        const tool = tools.find((t) => t.id === toolId);
        if (tool) {
          tool.status = "error";
          tool.errorText = str(event, "errorText", "Unknown error");
        }
        break;
      }

      case "stash_checkpoint": {
        fiber.checkpoint = {
          phase: str(event, "phase", "unknown"),
          cursor: num(event, "cursor"),
          progress: num(event, "progress", budget.progress),
        };
        break;
      }

      case "client_disconnect": {
        client.status = "disconnected";
        client.disconnectedAt = event.time;
        break;
      }

      case "client_reconnect": {
        client.status = "connected";
        client.connectedAt = event.time;
        break;
      }

      case "stream_resume_request": {
        stream.status = "resuming";
        break;
      }

      case "stream_resume_ack": {
        // Server acknowledges — replay is about to start
        break;
      }

      case "stream_replay": {
        client.bufferedChunksReplayed += 1;
        stream.status = "streaming";
        break;
      }

      case "do_eviction": {
        fiber.status = "interrupted";
        fiber.interruptedAt = event.time;
        stream.status = "orphaned";
        for (const tool of tools) {
          if (tool.status === "running") {
            tool.status = "interrupted";
            tool.interruptedAt = event.time;
          }
        }
        storage.incidents.push({
          id: `inc_${event.time}`,
          fiberId: fiber.id ?? "unknown",
          status: "active",
          startedAt: event.time,
        });
        break;
      }

      case "do_reboot": {
        // New isolate starts. Nothing to update in snapshot yet.
        break;
      }

      case "fiber_recover": {
        fiber.status = "recovering";
        fiber.recoveredAt = event.time;
        storage.recovering = true;
        recovery = { active: true, decision: null, phase: "detecting" };
        break;
      }

      case "classify": {
        recovery = { ...recovery, phase: "classifying" };
        const input = deriveClassifyInput(stream.chunks, tools);
        const decision = classify(input);
        recovery.decision = decision;
        const incident = storage.incidents[storage.incidents.length - 1];
        if (incident) incident.decision = decision.kind;
        break;
      }

      case "schedule_recovery": {
        recovery = { ...recovery, phase: "scheduling" };
        break;
      }

      case "timer_fire": {
        recovery = { ...recovery, phase: "executing" };
        break;
      }

      case "recovery_retry": {
        fiber = { id: `turn:${event.time}`, status: "running", startedAt: event.time };
        tools = [];
        stream = { status: "idle", chunks: [], messageId: null };
        sqlite.streamChunks = [];
        turnText = "";
        budget.progress = 0;
        budget.workUnits = 0;
        budget.lastProgressAt = event.time;
        break;
      }

      case "recovery_continue": {
        // Resume from checkpoint — keep existing chunks
        fiber.status = "running";
        stream.status = "streaming";
        break;
      }

      case "recovery_preserve": {
        // Reuse settled tool result, continue streaming
        fiber.status = "running";
        stream.status = "streaming";
        break;
      }

      case "recovery_repair": {
        tools = tools.filter((t) => t.status !== "interrupted");
        fiber.status = "running";
        stream.status = "streaming";
        break;
      }

      case "recovery_reattach": {
        // Reattach to child — mark child tool as settled
        const child = tools.find((t) => t.isChildAgent);
        if (child) {
          child.status = "settled";
          child.result = "Child agent result collected";
          child.settledAt = event.time;
        }
        fiber.status = "running";
        stream.status = "streaming";
        break;
      }

      case "recovery_park": {
        // Park — just wait. Budget is NOT consumed.
        fiber.status = "running";
        break;
      }

      case "recovery_wait": {
        // Wait for provider — monitor for forward progress
        fiber.status = "running";
        break;
      }

      case "human_approve": {
        // Human approves the pending tool — tool can now proceed
        break;
      }

      case "turn_complete": {
        fiber.status = "done";
        stream.status = "done";
        // Persist final assistant message
        if (turnText) {
          sqlite.messages.push({
            id: stream.messageId ?? `asst_${event.time}`,
            role: "assistant",
            text: turnText,
            time: event.time,
            complete: true,
          });
        }
        // Resolve any active incident
        const inc = storage.incidents[storage.incidents.length - 1];
        if (inc && inc.status === "active") {
          inc.status = "resolved";
          inc.resolvedAt = event.time;
        }
        storage.recovering = false;
        recovery = { active: false, decision: recovery.decision, phase: "done" };
        storage.lastTerminal = "complete";
        break;
      }

      case "turn_sealed": {
        fiber.status = "sealed";
        budget.sealed = true;
        const inc = storage.incidents[storage.incidents.length - 1];
        if (inc && inc.status === "active") {
          inc.status = "resolved";
          inc.resolvedAt = event.time;
        }
        storage.recovering = false;
        recovery = { active: false, decision: recovery.decision, phase: "done" };
        storage.lastTerminal = "sealed";
        break;
      }
    }
  }

  return {
    fiber,
    client,
    stream,
    tools,
    budget,
    sqlite,
    storage,
    recovery,
    currentEvent,
    turnText,
  };
}

// ─── Recovery Event Generation ────────────────────────────────────────

function computeRecoveryEvents(
  startTime: number,
  decision: RecoveryDecision,
  snapshot: SimSnapshot,
): SimEvent[] {
  const events: SimEvent[] = [];
  let t = startTime;

  // Common recovery detection sequence
  events.push(ev(t, "do_eviction", "fiber", "DO eviction", "The isolate is replaced (deploy/eviction/OOM). All in-memory state is lost. Durable rows in SQLite survive."));
  t += 100;
  events.push(ev(t, "do_reboot", "fiber", "DO reboot", "A new isolate starts. The recovery engine sweeps for 'running' fibers with no live execution."));
  t += 100;
  events.push(ev(t, "fiber_recover", "fiber", "Fiber recovered", `onFiberRecovered() called. ${snapshot.fiber.checkpoint ? `Checkpoint: phase=${snapshot.fiber.checkpoint.phase}, cursor=${snapshot.fiber.checkpoint.cursor}` : "No checkpoint exists."}`));
  t += 100;
  events.push(ev(t, "classify", "fiber", "Classify", `Classifier: ${decision.conditions.producedOutput ? "produced output" : "no output"}${decision.conditions.lastToolSettled ? ", tool settled" : decision.conditions.hasLastTool ? ", tool in-flight" : ""}${decision.conditions.pendingHumanInteraction ? ", pending human" : ""} → ${decision.kind}`));
  t += 100;
  events.push(ev(t, "schedule_recovery", "fiber", "Schedule", "A named timer is scheduled in the timer table. The single DO alarm is armed."));
  t += 200;
  events.push(ev(t, "timer_fire", "fiber", "Timer fires", "The DO alarm fires. The recovery callback runs idempotently."));
  t += 100;

  switch (decision.kind) {
    case "retry-turn": {
      events.push(ev(t, "recovery_retry", "fiber", "Retry turn", "The interrupted fiber is discarded. The entire turn is retried from the user message."));
      t += 100;
      events.push(ev(t, "fiber_start", "fiber", "Fiber start (retry)", "A new runFiber() writes a new 'running' row."));
      t += 100;
      events.push(ev(t, "stream_chunk", "stream", "Chunk 1", 'Model streams: "Let me check..."', { text: "Let me check...", chunkId: 1 }));
      t += 100;
      events.push(ev(t, "tool_call_start", "tools", "getWeather", "Tool call starts.", { toolId: "t1", name: "getWeather" }));
      t += 200;
      events.push(ev(t, "tool_call_settle", "tools", "getWeather settled", 'Tool result: "62°F"', { toolId: "t1", name: "getWeather", result: "62°F" }));
      t += 100;
      events.push(ev(t, "stream_chunk", "stream", "Chunk 2", 'Model streams: "It\'s 62°F and sunny."', { text: "It's 62°F and sunny.", chunkId: 2 }));
      t += 300;
      events.push(ev(t, "turn_complete", "fiber", "Turn complete", "The turn completes successfully after recovery."));
      break;
    }

    case "continue-partial": {
      events.push(ev(t, "recovery_continue", "fiber", "Continue partial", "The partial assistant message is reconstructed from persisted chunks. Streaming resumes from the last cursor."));
      t += 100;
      events.push(ev(t, "stream_chunk", "stream", "Chunk (continued)", 'Model streams: "...and partly cloudy."', { text: "...and partly cloudy.", chunkId: snapshot.stream.chunks.length + 1 }));
      t += 200;
      events.push(ev(t, "stream_chunk", "stream", "Chunk (continued)", 'Model streams: "You might want a jacket."', { text: "You might want a jacket.", chunkId: snapshot.stream.chunks.length + 2 }));
      t += 300;
      events.push(ev(t, "turn_complete", "fiber", "Turn complete", "The turn completes. The user sees a seamless response."));
      break;
    }

    case "preserve-tool-result": {
      events.push(ev(t, "recovery_preserve", "fiber", "Preserve result", "The settled tool result is reused. The model continues streaming from the checkpoint. No re-execution."));
      t += 100;
      events.push(ev(t, "stream_chunk", "stream", "Chunk (continued)", 'Model streams: "It\'s 62°F and partly cloudy."', { text: "It's 62°F and partly cloudy.", chunkId: snapshot.stream.chunks.length + 1 }));
      t += 300;
      events.push(ev(t, "turn_complete", "fiber", "Turn complete", "Turn completes. The tool was never re-executed."));
      break;
    }

    case "repair-transcript": {
      events.push(ev(t, "recovery_repair", "fiber", "Repair transcript", "The dangling tool-call entry is removed from the transcript. The tool call is retried."));
      t += 100;
      events.push(ev(t, "tool_call_start", "tools", "getWeather (retry)", "Tool call retries from scratch.", { toolId: "t1_retry", name: "getWeather" }));
      t += 200;
      events.push(ev(t, "tool_call_settle", "tools", "getWeather settled", 'Tool result: "62°F"', { toolId: "t1_retry", name: "getWeather", result: "62°F" }));
      t += 100;
      events.push(ev(t, "stream_chunk", "stream", "Chunk (continued)", 'Model streams: "It\'s 62°F and sunny."', { text: "It's 62°F and sunny.", chunkId: snapshot.stream.chunks.length + 1 }));
      t += 300;
      events.push(ev(t, "turn_complete", "fiber", "Turn complete", "Turn completes after transcript repair."));
      break;
    }

    case "reattach-child": {
      events.push(ev(t, "recovery_reattach", "fiber", "Reattach child", "Parent looks up child runId in durable state. The child recovers its own state. Parent reattaches."));
      t += 200;
      events.push(ev(t, "tool_call_settle", "tools", "Child result", "Child's terminal result collected.", { toolId: "t1", name: "spawnChild", result: "Research complete" }));
      t += 100;
      events.push(ev(t, "stream_chunk", "stream", "Chunk (continued)", 'Model streams: "Here are the results..."', { text: "Here are the results...", chunkId: snapshot.stream.chunks.length + 1 }));
      t += 300;
      events.push(ev(t, "turn_complete", "fiber", "Turn complete", "Turn completes. The child's work was preserved."));
      break;
    }

    case "park-for-human": {
      events.push(ev(t, "recovery_park", "fiber", "Park for human", "The turn is parked. The progress budget is NOT consumed while waiting."));
      t += 300;
      events.push(ev(t, "human_approve", "tools", "Human approves", "The human approves the pending tool call."));
      t += 100;
      events.push(ev(t, "tool_call_settle", "tools", "Tool settled", "Tool executes after approval.", { toolId: "t1", name: "sendEmail", result: "sent" }));
      t += 100;
      events.push(ev(t, "stream_chunk", "stream", "Chunk (continued)", 'Model streams: "Done!"', { text: "Done!", chunkId: snapshot.stream.chunks.length + 1 }));
      t += 200;
      events.push(ev(t, "turn_complete", "fiber", "Turn complete", "Turn completes after human approval."));
      break;
    }

    case "wait-on-provider": {
      events.push(ev(t, "recovery_wait", "fiber", "Wait on provider", "The stream went quiet. Recovery waits and monitors for forward progress."));
      t += 300;
      events.push(ev(t, "stream_chunk", "stream", "Chunk (resumed)", 'Model resumes: "Sorry for the delay..."', { text: "Sorry for the delay...", chunkId: snapshot.stream.chunks.length + 1 }));
      t += 200;
      events.push(ev(t, "turn_complete", "fiber", "Turn complete", "Turn completes after the provider resumed."));
      break;
    }
  }

  return events;
}

function computeDisconnectEvents(startTime: number): SimEvent[] {
  return [
    ev(startTime, "client_disconnect", "client", "Client disconnect", "WebSocket drops. The Durable Object is still alive — the stream continues server-side."),
    ev(startTime + 200, "client_reconnect", "client", "Client reconnect", "Client reconnects to the same Durable Object via stable session ID."),
    ev(startTime + 250, "stream_resume_request", "client", "Resume request", "Client sends STREAM_RESUME_REQUEST."),
    ev(startTime + 300, "stream_resume_ack", "stream", "Resume ACK", "Server replies with STREAM_RESUMING."),
    ev(startTime + 350, "stream_replay", "stream", "Chunk replay", "Buffered chunks replayed from SQLite."),
  ];
}

// ─── Hook ─────────────────────────────────────────────────────────────

export interface RecoverySim {
  events: SimEvent[];
  currentTime: number;
  playing: boolean;
  speed: number;
  selectedScenarioId: string;
  failureInjected: FailureType | null;
  snapshot: SimSnapshot;
  totalDuration: number;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  scrub: (time: number) => void;
  setSpeed: (speed: number) => void;
  loadScenario: (id: string) => void;
  injectFailure: (type: FailureType) => void;
  reset: () => void;
}

export function useRecoverySim(): RecoverySim {
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const setSpeed = useCallback((s: number) => {
    if (s > 0) setSpeedState(s);
  }, []);
  const [selectedScenarioId, setSelectedScenarioId] = useState("normal");
  const [failureInjected, setFailureInjected] = useState<FailureType | null>(null);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const snapshot = useMemo(
    () => computeSnapshot(events, currentTime),
    [events, currentTime],
  );

  const totalDuration = useMemo(
    () => (events.length > 0 ? events[events.length - 1].time : 0),
    [events],
  );

  // Playback loop
  useEffect(() => {
    if (!playing) return;

    lastFrameRef.current = performance.now();

    const tick = (now: number) => {
      const delta = (now - lastFrameRef.current) * speed;
      lastFrameRef.current = now;
      if (delta <= 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      setCurrentTime((prev) => {
        const next = prev + delta;

        for (const e of eventsRef.current) {
          if (e.type === "classify" && e.time > prev && e.time <= next) {
            setPlaying(false);
            return e.time;
          }
        }

        if (next >= totalDuration) {
          setPlaying(false);
          return totalDuration;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, totalDuration]);

  const loadScenario = useCallback((id: string) => {
    const scenario: Scenario | undefined = SCENARIO_MAP[id];
    if (!scenario) return;
    resetEventCounter();
    engineEventCounter = 10000;
    setEvents([...scenario.events]);
    setCurrentTime(0);
    setPlaying(false);
    setFailureInjected(null);
    setSelectedScenarioId(id);
  }, []);

  // Auto-load first scenario on mount
  useEffect(() => {
    loadScenario("normal");
  }, [loadScenario]);

  const play = useCallback(() => {
    setCurrentTime((prev) => {
      if (prev >= totalDuration) return 0;
      return prev;
    });
    setPlaying(true);
  }, [totalDuration]);

  const pause = useCallback(() => setPlaying(false), []);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
    } else {
      play();
    }
  }, [playing, play]);

  const scrub = useCallback(
    (time: number) => {
      setPlaying(false);
      setCurrentTime(Math.max(0, Math.min(time, totalDuration)));
    },
    [totalDuration],
  );

  const injectFailure = useCallback(
    (type: FailureType) => {
      const snap = computeSnapshot(eventsRef.current, currentTime);

      const isEviction = type === "evict_do" || type === "deploy" || type === "kill_tool";
      if (isEviction && (snap.recovery.active || snap.fiber.status !== "running")) {
        return;
      }

      setPlaying(false);
      setFailureInjected(type);

      setEvents((prevEvents) => {
        const pastEvents = prevEvents.filter((e) => e.time <= currentTime);
        const futureEvents = prevEvents.filter((e) => e.time > currentTime);

        if (type === "disconnect_client") {
          const disconnectEvents = computeDisconnectEvents(currentTime);
          return stableSort([...pastEvents, ...disconnectEvents, ...futureEvents]);
        }

        const freshSnap = computeSnapshot(prevEvents, currentTime);
        const input = deriveClassifyInput(freshSnap.stream.chunks, freshSnap.tools);
        const decision = classify(input);
        const recoveryEvents = computeRecoveryEvents(currentTime, decision, freshSnap);

        return stableSort([...pastEvents, ...recoveryEvents]);
      });
    },
    [currentTime],
  );

  const reset = useCallback(() => {
    loadScenario(selectedScenarioId);
  }, [loadScenario, selectedScenarioId]);

  return {
    events,
    currentTime,
    playing,
    speed,
    selectedScenarioId,
    failureInjected,
    snapshot,
    totalDuration,
    play,
    pause,
    togglePlay,
    scrub,
    setSpeed,
    loadScenario,
    injectFailure,
    reset,
  };
}
