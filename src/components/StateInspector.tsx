/**
 * Recovery Lab — State Inspector
 *
 * Shows the internal state of the Durable Object at the current playhead
 * position. The key visual: durable state (SQLite + DO storage) is shown
 * with a blue accent and survives eviction; volatile state (in-memory)
 * is shown with an orange accent and is lost on eviction.
 *
 * This is where the user *sees* what the recovery system protects.
 */

import { motion, AnimatePresence } from "framer-motion";
import {
  DatabaseIcon,
  LightningIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import type { SimSnapshot } from "../sim/types";

// ─── Helpers ──────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

function formatTime(ms: number): string {
  return `${Math.round(ms)}ms`;
}

// ─── Durable State Section ────────────────────────────────────────────

function DurableSection({ snapshot }: { snapshot: SimSnapshot }) {
  const { sqlite, storage } = snapshot;

  return (
    <div
      className="rounded-lg border-l-[3px] border-l-[var(--viz-durable)] border-y border-r border-kumo-line bg-kumo-base overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-kumo-line bg-kumo-elevated">
        <DatabaseIcon size={14} style={{ color: "var(--viz-durable)" }} />
        <span className="text-xs font-semibold uppercase tracking-wider text-kumo-default">
          Durable State
        </span>
        <span className="text-[10px] text-kumo-inactive ml-auto">
          survives eviction
        </span>
      </div>

      {/* SQLite: messages */}
      <div className="border-b border-kumo-line">
        <div className="px-3 py-1.5 text-[10px] font-mono text-kumo-inactive border-b border-kumo-line">
          cf_ai_chat_agent_messages ({sqlite.messages.length})
        </div>
        <div className="max-h-32 overflow-y-auto">
          <AnimatePresence mode="popLayout">
            {sqlite.messages.map((msg) => (
              <motion.div
                key={msg.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ type: "spring", stiffness: 100, damping: 20 }}
                className="flex items-baseline gap-2 px-3 py-1 text-[11px] font-mono border-b border-kumo-line/50 last:border-b-0"
              >
                <span
                  className="shrink-0 px-1 rounded text-[9px] font-bold"
                  style={{
                    backgroundColor:
                      msg.role === "user"
                        ? "color-mix(in srgb, var(--viz-durable) 15%, transparent)"
                        : "color-mix(in srgb, var(--viz-complete) 15%, transparent)",
                    color:
                      msg.role === "user"
                        ? "var(--viz-durable)"
                        : "var(--viz-complete)",
                  }}
                >
                  {msg.role.toUpperCase()}
                </span>
                <span className="flex-1 text-kumo-subtle truncate">
                  {truncate(msg.text, 40)}
                </span>
                <span className="shrink-0 text-kumo-inactive text-[9px]">
                  {formatTime(msg.time)}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {sqlite.messages.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-kumo-inactive italic">
              No messages
            </div>
          )}
        </div>
      </div>

      {/* SQLite: stream_chunks */}
      <div className="border-b border-kumo-line">
        <div className="px-3 py-1.5 text-[10px] font-mono text-kumo-inactive border-b border-kumo-line">
          cf_ai_chat_stream_chunks ({sqlite.streamChunks.length})
        </div>
        <div className="max-h-32 overflow-y-auto">
          <AnimatePresence mode="popLayout">
            {sqlite.streamChunks.map((chunk) => (
              <motion.div
                key={`${chunk.messageId}_${chunk.id}`}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ type: "spring", stiffness: 100, damping: 20 }}
                className="flex items-baseline gap-2 px-3 py-1 text-[11px] font-mono border-b border-kumo-line/50 last:border-b-0"
              >
                <span className="shrink-0 text-kumo-inactive text-[9px] w-6">
                  #{chunk.id}
                </span>
                <span className="flex-1 text-kumo-subtle truncate">
                  {truncate(chunk.text, 36)}
                </span>
                <span className="shrink-0 text-kumo-inactive text-[9px]">
                  {formatTime(chunk.time)}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {sqlite.streamChunks.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-kumo-inactive italic">
              No stream chunks
            </div>
          )}
        </div>
      </div>

      {/* DO Storage keys */}
      <div>
        <div className="px-3 py-1.5 text-[10px] font-mono text-kumo-inactive border-b border-kumo-line">
          DurableObjectStorage
        </div>
        <div className="px-3 py-2 space-y-1">
          <StorageRow
            keyName="cf:chat:recovering"
            value={storage.recovering ? "true" : "false"}
            highlight={storage.recovering}
            highlightColor="var(--viz-recovering)"
          />
          <StorageRow
            keyName="cf:chat:last-terminal"
            value={storage.lastTerminal ?? "null"}
            highlight={!!storage.lastTerminal}
            highlightColor="var(--viz-complete)"
          />
          {storage.incidents.map((inc) => (
            <StorageRow
              key={inc.id}
              keyName={`cf:chat-recovery:incident:${inc.id}`}
              value={`${inc.status}${inc.decision ? ` → ${inc.decision}` : ""}`}
              highlight={inc.status === "active"}
              highlightColor="var(--viz-recovering)"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StorageRow({
  keyName,
  value,
  highlight,
  highlightColor,
}: {
  keyName: string;
  value: string;
  highlight: boolean;
  highlightColor: string;
}) {
  return (
    <div className="flex items-baseline gap-2 text-[11px] font-mono">
      <span className="text-kumo-inactive shrink-0">{keyName}</span>
      <span className="text-kumo-line">:</span>
      <span
        className="font-bold"
        style={{
          color: highlight ? highlightColor : "var(--kumo-subtle)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Volatile State Section ───────────────────────────────────────────

function VolatileSection({ snapshot }: { snapshot: SimSnapshot }) {
  const { fiber, client, stream, tools, budget } = snapshot;
  const isInterrupted = fiber.status === "interrupted";

  return (
    <div
      className="rounded-lg border-l-[3px] border-l-[var(--viz-volatile)] border-y border-r border-kumo-line bg-kumo-base overflow-hidden"
      style={{
        opacity: isInterrupted ? 0.5 : 1,
        transition: "opacity 0.3s ease",
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-kumo-line bg-kumo-elevated">
        <LightningIcon size={14} style={{ color: "var(--viz-volatile)" }} />
        <span className="text-xs font-semibold uppercase tracking-wider text-kumo-default">
          Volatile State
        </span>
        <span className="text-[10px] text-kumo-inactive ml-auto">
          {isInterrupted ? "lost on eviction" : "in-memory only"}
        </span>
      </div>

      {isInterrupted && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-950/20 border-b border-kumo-line">
          <WarningIcon size={12} className="text-red-500" />
          <span className="text-[10px] font-mono text-red-500 font-bold">
            ISOLATE REPLACED — ALL IN-MEMORY STATE LOST
          </span>
        </div>
      )}

      <div className="px-3 py-2 space-y-1.5">
        <VolatileRow label="WebSocket" value={client.status} active={client.status === "connected"} />
        <VolatileRow label="Stream ctrl" value={stream.status} active={stream.status === "streaming"} />
        <VolatileRow
          label="Fiber"
          value={fiber.status}
          active={fiber.status === "running"}
        />
        <VolatileRow
          label="Checkpoint"
          value={fiber.checkpoint ? `${fiber.checkpoint.phase}@${fiber.checkpoint.cursor}` : "none"}
          active={!!fiber.checkpoint}
        />
        <VolatileRow
          label="Tools active"
          value={`${tools.filter((t) => t.status === "running").length}/${tools.length}`}
          active={tools.some((t) => t.status === "running")}
        />
        <VolatileRow
          label="Budget"
          value={`${budget.progress} prog / ${budget.workUnits} units${budget.sealed ? " (SEALED)" : ""}`}
          active={!budget.sealed && budget.progress > 0}
        />
      </div>
    </div>
  );
}

function VolatileRow({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px] font-mono">
      <span className="text-kumo-inactive">{label}</span>
      <span
        className="font-bold"
        style={{
          color: active ? "var(--viz-volatile)" : "var(--kumo-subtle)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export function StateInspector({ snapshot }: { snapshot: SimSnapshot }) {
  return (
    <div className="flex flex-col gap-3">
      <DurableSection snapshot={snapshot} />
      <VolatileSection snapshot={snapshot} />
    </div>
  );
}
