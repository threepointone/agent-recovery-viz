/**
 * Recovery Lab — Timeline Component
 *
 * Multi-track horizontal timeline showing the chat turn lifecycle.
 * Each track shows state segments (colored backgrounds) and event markers
 * positioned by simulation time. The playhead is a vertical line that
 * advances across all tracks. Users can click/drag to scrub.
 */

import { useCallback, useRef } from "react";
import { motion } from "framer-motion";
import type {
  SimEvent,
  SimEventType,
  TrackId,
  BudgetState,
} from "../sim/types";
import { TRACK_CONFIGS } from "../sim/types";

// ─── Constants ────────────────────────────────────────────────────────

const TRACK_HEIGHT = 48;
const AXIS_HEIGHT = 28;

const STATE_COLORS: Record<string, string> = {
  idle: "var(--viz-idle)",
  connected: "var(--viz-durable)",
  disconnected: "var(--viz-interrupted)",
  running: "var(--viz-durable)",
  interrupted: "var(--viz-interrupted)",
  recovering: "var(--viz-recovering)",
  done: "var(--viz-complete)",
  sealed: "var(--viz-sealed)",
  streaming: "var(--viz-durable)",
  resuming: "var(--viz-recovering)",
  orphaned: "var(--viz-interrupted)",
};

const EVENT_COLORS: Partial<Record<SimEventType, string>> = {
  user_message: "var(--viz-durable)",
  fiber_start: "var(--viz-durable)",
  stream_chunk: "var(--viz-durable)",
  tool_call_start: "var(--viz-recovering)",
  tool_call_settle: "var(--viz-complete)",
  tool_call_error: "var(--viz-interrupted)",
  stash_checkpoint: "var(--viz-idle)",
  client_disconnect: "var(--viz-interrupted)",
  client_reconnect: "var(--viz-durable)",
  stream_resume_request: "var(--viz-recovering)",
  stream_resume_ack: "var(--viz-recovering)",
  stream_replay: "var(--viz-durable)",
  do_eviction: "var(--viz-interrupted)",
  do_reboot: "var(--viz-idle)",
  fiber_recover: "var(--viz-recovering)",
  classify: "var(--viz-recovering)",
  schedule_recovery: "var(--viz-idle)",
  timer_fire: "var(--viz-idle)",
  recovery_retry: "var(--viz-recovering)",
  recovery_continue: "var(--viz-recovering)",
  recovery_preserve: "var(--viz-recovering)",
  recovery_repair: "var(--viz-recovering)",
  recovery_reattach: "var(--viz-recovering)",
  recovery_park: "var(--viz-recovering)",
  recovery_wait: "var(--viz-recovering)",
  human_approve: "var(--viz-complete)",
  turn_complete: "var(--viz-complete)",
  turn_sealed: "var(--viz-sealed)",
};

const MAJOR_EVENTS: Partial<Record<SimEventType, boolean>> = {
  do_eviction: true,
  turn_complete: true,
  classify: true,
  fiber_start: true,
  fiber_recover: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────

function timeToPercent(time: number, totalDuration: number): number {
  if (totalDuration === 0) return 0;
  return Math.max(0, Math.min(100, (time / totalDuration) * 100));
}

function getStateAfter(eventType: SimEventType, trackId: TrackId): string | null {
  switch (trackId) {
    case "client":
      switch (eventType) {
        case "user_message": return "connected";
        case "client_disconnect": return "disconnected";
        case "client_reconnect": return "connected";
        default: return null;
      }
    case "fiber":
      switch (eventType) {
        case "fiber_start": return "running";
        case "do_eviction": return "interrupted";
        case "fiber_recover": return "recovering";
        case "recovery_retry":
        case "recovery_continue":
        case "recovery_preserve":
        case "recovery_repair":
        case "recovery_reattach":
        case "recovery_park":
        case "recovery_wait":
          return "running";
        case "turn_complete": return "done";
        case "turn_sealed": return "sealed";
        default: return null;
      }
    case "stream":
      switch (eventType) {
        case "stream_chunk": return "streaming";
        case "stream_resume_request":
        case "stream_resume_ack":
          return "resuming";
        case "stream_replay": return "streaming";
        case "do_eviction": return "orphaned";
        case "turn_complete": return "done";
        default: return null;
      }
    default:
      return null;
  }
}

interface Segment {
  start: number;
  end: number;
  state: string;
}

function computeSegments(
  events: SimEvent[],
  trackId: TrackId,
  totalDuration: number,
): Segment[] {
  const segments: Segment[] = [];
  let currentState = trackId === "client" ? "connected" : "idle";
  let startTime = 0;

  for (const event of events) {
    const newState = getStateAfter(event.type, trackId);
    if (newState && newState !== currentState) {
      if (startTime <= event.time) {
        segments.push({ start: startTime, end: event.time, state: currentState });
      }
      currentState = newState;
      startTime = event.time;
    }
  }

  if (startTime < totalDuration || segments.length === 0) {
    segments.push({ start: startTime, end: totalDuration, state: currentState });
  }

  return segments;
}

interface ToolBlock {
  id: string;
  name: string;
  start: number;
  end: number;
  status: "running" | "settled" | "error" | "interrupted";
  needsApproval: boolean;
  isChildAgent: boolean;
}

function computeToolBlocks(events: SimEvent[], currentTime: number): ToolBlock[] {
  const blocks: ToolBlock[] = [];
  const toolMap = new Map<string, ToolBlock>();

  for (const event of events) {
    if (event.time > currentTime) continue;
    const d = event.data ?? {};

    if (event.type === "tool_call_start") {
      const id = (d.toolId as string) ?? `t_${event.time}`;
      const block: ToolBlock = {
        id,
        name: (d.name as string) ?? "tool",
        start: event.time,
        end: currentTime,
        status: "running",
        needsApproval: (d.needsApproval as boolean) ?? false,
        isChildAgent: (d.isChildAgent as boolean) ?? false,
      };
      toolMap.set(id, block);
      blocks.push(block);
    } else if (event.type === "tool_call_settle") {
      const id = (d.toolId as string) ?? "";
      const block = toolMap.get(id);
      if (block) {
        block.end = event.time;
        block.status = "settled";
      }
    } else if (event.type === "tool_call_error") {
      const id = (d.toolId as string) ?? "";
      const block = toolMap.get(id);
      if (block) {
        block.end = event.time;
        block.status = "error";
      }
    } else if (event.type === "do_eviction") {
      for (const block of blocks) {
        if (block.status === "running") {
          block.end = event.time;
          block.status = "interrupted";
        }
      }
    } else if (event.type === "recovery_reattach") {
      for (const block of blocks) {
        if (block.isChildAgent && block.status === "interrupted") {
          block.status = "settled";
          block.end = event.time;
        }
      }
    } else if (event.type === "recovery_retry") {
      blocks.length = 0;
      toolMap.clear();
    }
  }

  return blocks;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Sub-components ───────────────────────────────────────────────────

function StateSegment({
  segment,
  totalDuration,
}: {
  segment: Segment;
  totalDuration: number;
}) {
  const left = timeToPercent(segment.start, totalDuration);
  const width = timeToPercent(segment.end, totalDuration) - left;
  const color = STATE_COLORS[segment.state] ?? STATE_COLORS.idle;

  return (
    <div
      className="absolute top-0 bottom-0 rounded-sm"
      style={{
        left: `${left}%`,
        width: `${Math.max(width, 0.5)}%`,
        backgroundColor: color,
        opacity: 0.12,
      }}
    />
  );
}

function EventMarker({
  event,
  totalDuration,
  isPast,
}: {
  event: SimEvent;
  totalDuration: number;
  isPast: boolean;
}) {
  const left = timeToPercent(event.time, totalDuration);
  const color = EVENT_COLORS[event.type] ?? "var(--viz-idle)";
  const isMajor = MAJOR_EVENTS[event.type];

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full pointer-events-none"
      style={{
        left: `${left}%`,
        width: isMajor ? 10 : 7,
        height: isMajor ? 10 : 7,
        backgroundColor: color,
        opacity: isPast ? 1 : 0.35,
        boxShadow: isMajor && isPast ? `0 0 6px ${color}` : "none",
        zIndex: 2,
      }}
      title={`${event.label}: ${event.description}`}
    />
  );
}

function StreamChunkBar({
  event,
  totalDuration,
  isPast,
}: {
  event: SimEvent;
  totalDuration: number;
  isPast: boolean;
}) {
  const left = timeToPercent(event.time, totalDuration);

  return (
    <div
      className="absolute top-2 bottom-2 -translate-x-1/2 rounded-sm pointer-events-none"
      style={{
        left: `${left}%`,
        width: 3,
        backgroundColor: "var(--viz-durable)",
        opacity: isPast ? 0.8 : 0.25,
        zIndex: 2,
      }}
      title={event.label}
    />
  );
}

function ToolCallBlock({
  block,
  totalDuration,
}: {
  block: ToolBlock;
  totalDuration: number;
}) {
  const left = timeToPercent(block.start, totalDuration);
  const right = timeToPercent(block.end, totalDuration);
  const width = Math.max(right - left, 1);

  const color =
    block.status === "settled"
      ? "var(--viz-complete)"
      : block.status === "error"
        ? "var(--viz-interrupted)"
        : block.status === "interrupted"
          ? "var(--viz-interrupted)"
          : "var(--viz-recovering)";

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 rounded-md flex items-center px-1.5 pointer-events-none overflow-hidden"
      style={{
        left: `${left}%`,
        width: `${width}%`,
        height: 24,
        backgroundColor: color,
        opacity: 0.25,
        border: `1px solid ${color}`,
        zIndex: 2,
      }}
      title={`${block.name}: ${block.status}`}
    >
      <span
        className="text-[10px] font-mono whitespace-nowrap"
        style={{ color, opacity: 1 }}
      >
        {block.name}
      </span>
    </div>
  );
}

function BudgetBar({
  budget,
}: {
  budget: BudgetState;
}) {
  const maxValue = Math.max(budget.progress, 5);
  const currentPercent = (budget.progress / maxValue) * 100;

  return (
    <div className="absolute inset-0 flex items-center px-1">
      <div className="w-full h-2 rounded-full bg-kumo-elevated overflow-hidden relative">
        <motion.div
          className="h-full rounded-full"
          style={{
            backgroundColor: budget.sealed
              ? "var(--viz-sealed)"
              : "var(--viz-durable)",
          }}
          animate={{ width: `${currentPercent}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>
      <span className="absolute right-2 text-[10px] font-mono text-kumo-inactive">
        {budget.progress} units
      </span>
    </div>
  );
}

// ─── Track Renderer ───────────────────────────────────────────────────

function TimelineTrack({
  config,
  events,
  currentTime,
  totalDuration,
  budget,
}: {
  config: { id: TrackId; label: string; description: string };
  events: SimEvent[];
  currentTime: number;
  totalDuration: number;
  budget: BudgetState;
}) {
  const trackEvents = events.filter((e) => e.track === config.id);

  const toolBlocks =
    config.id === "tools" ? computeToolBlocks(events, currentTime) : [];

  const isBudget = config.id === "budget";
  const isStream = config.id === "stream";
  const isTools = config.id === "tools";

  const segments =
    !isBudget && !isTools
      ? computeSegments(events, config.id, totalDuration)
      : [];

  return (
    <div
      className="flex border-b border-kumo-line last:border-b-0"
      style={{ height: TRACK_HEIGHT }}
    >
      {/* Track label */}
      <div className="w-[100px] shrink-0 flex items-center px-3 border-r border-kumo-line bg-kumo-base">
        <div>
          <div className="text-xs font-medium text-kumo-default">
            {config.label}
          </div>
          <div className="text-[10px] text-kumo-inactive leading-tight">
            {config.description}
          </div>
        </div>
      </div>

      {/* Track content */}
      <div className="flex-1 relative bg-[var(--viz-bg-track)]">
        {/* State segments */}
        {segments.map((seg) => (
          <StateSegment key={`${seg.start}-${seg.state}`} segment={seg} totalDuration={totalDuration} />
        ))}

        {/* Budget bar */}
        {isBudget && (
          <BudgetBar budget={budget} />
        )}

        {/* Tool call blocks */}
        {isTools &&
          toolBlocks.map((block) => (
            <ToolCallBlock
              key={block.id}
              block={block}
              totalDuration={totalDuration}
            />
          ))}

        {/* Event markers */}
        {trackEvents.map((event) => {
          const isPast = event.time <= currentTime;
          if (isStream && event.type === "stream_chunk") {
            return (
              <StreamChunkBar
                key={event.id}
                event={event}
                totalDuration={totalDuration}
                isPast={isPast}
              />
            );
          }
          if (isBudget) return null;
          if (isTools && event.type.startsWith("tool_call")) return null;
          if (isTools && event.type === "human_approve") {
            return (
              <EventMarker
                key={event.id}
                event={event}
                totalDuration={totalDuration}
                isPast={isPast}
              />
            );
          }
          return (
            <EventMarker
              key={event.id}
              event={event}
              totalDuration={totalDuration}
              isPast={isPast}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Playhead ─────────────────────────────────────────────────────────

function Playhead({
  currentTime,
  totalDuration,
}: {
  currentTime: number;
  totalDuration: number;
}) {
  const left = timeToPercent(currentTime, totalDuration);

  return (
    <div
      className="absolute top-0 bottom-0 w-[2px] pointer-events-none z-20"
      style={{
        left: `${left}%`,
        backgroundColor: "var(--viz-durable)",
        boxShadow: "0 0 8px var(--viz-durable)",
      }}
    >
      <div
        className="absolute -top-0 -left-[5px] w-3 h-3 rounded-full"
        style={{
          backgroundColor: "var(--viz-durable)",
          boxShadow: "0 0 8px var(--viz-durable)",
        }}
      />
    </div>
  );
}

// ─── Time Axis ────────────────────────────────────────────────────────

function TimeAxis({ totalDuration }: { totalDuration: number }) {
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const time = (i / (tickCount - 1)) * totalDuration;
    return time;
  });

  return (
    <div
      className="flex border-t border-kumo-line bg-kumo-base"
      style={{ height: AXIS_HEIGHT }}
    >
      <div className="w-[100px] shrink-0 border-r border-kumo-line" />
      <div className="flex-1 relative">
        {ticks.map((time, i) => (
          <div
            key={i}
            className="absolute top-0 flex flex-col items-center"
            style={{
              left: `${timeToPercent(time, totalDuration)}%`,
              transform: "translateX(-50%)",
            }}
          >
            <div className="w-px h-1.5 bg-kumo-line" />
            <span className="text-[10px] font-mono text-kumo-inactive mt-0.5">
              {formatTime(time)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Timeline ────────────────────────────────────────────────────

export function Timeline({
  events,
  currentTime,
  totalDuration,
  onScrub,
  budget,
}: {
  events: SimEvent[];
  currentTime: number;
  totalDuration: number;
  onScrub: (time: number) => void;
  budget: BudgetState;
}) {
  const scrubRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const scrubTo = useCallback(
    (clientX: number) => {
      const rect = scrubRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = clientX - rect.left - 100; // Subtract label width
      const trackWidth = rect.width - 100;
      const percent = Math.max(0, Math.min(1, x / trackWidth));
      onScrub(percent * totalDuration);
    },
    [onScrub, totalDuration],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      scrubTo(e.clientX);
    },
    [scrubTo],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging.current) scrubTo(e.clientX);
    },
    [scrubTo],
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <div className="rounded-xl border border-kumo-line overflow-hidden bg-kumo-base">
      <div
        ref={scrubRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="relative select-none cursor-pointer"
      >
        {TRACK_CONFIGS.map((config) => (
          <TimelineTrack
            key={config.id}
            config={config}
            events={events}
            currentTime={currentTime}
            totalDuration={totalDuration}
            budget={budget}
          />
        ))}
        <TimeAxis totalDuration={totalDuration} />

        {/* Playhead overlay (spans tracks but not the label column) */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: 100, right: 0 }}
        >
          <Playhead
            currentTime={currentTime}
            totalDuration={totalDuration}
          />
        </div>
      </div>
    </div>
  );
}
