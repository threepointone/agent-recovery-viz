/**
 * Recovery Lab — Root Component
 *
 * Wires together the timeline, failure controls, state inspector,
 * classifier overlay, and playback controls into a single interactive
 * visualization of Cloudflare's agent chat recovery system.
 */

import { motion } from "framer-motion";
import { Button, Badge, Surface } from "@cloudflare/kumo";
import {
  PlayIcon,
  PauseIcon,
  ArrowClockwiseIcon,
  RobotIcon,
  GaugeIcon,
  InfoIcon,
} from "@phosphor-icons/react";
import { useRecoverySim } from "../sim/useRecoverySim";
import { SCENARIOS, SCENARIO_MAP } from "../sim/scenarios";
import { RECOVERY_INFO } from "../sim/classifier";
import { Timeline } from "./Timeline";
import { FailureControls } from "./FailureControls";
import { ClassifierOverlay } from "./ClassifierOverlay";
import { StateInspector } from "./StateInspector";

// ─── Info Panel ───────────────────────────────────────────────────────

function InfoPanel({
  snapshot,
  currentTime,
  totalDuration,
}: {
  snapshot: ReturnType<typeof useRecoverySim>["snapshot"];
  currentTime: number;
  totalDuration: number;
}) {
  const event = snapshot.currentEvent;
  const decision = snapshot.recovery.decision;

  return (
    <Surface className="p-4 rounded-xl flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <InfoIcon size={14} className="text-kumo-inactive" />
        <span className="text-xs font-semibold uppercase tracking-wider text-kumo-inactive">
          Current State
        </span>
      </div>

      {/* Time display */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-mono font-bold text-kumo-default">
          {(currentTime / 1000).toFixed(2)}s
        </span>
        <span className="text-sm text-kumo-inactive">
          / {(totalDuration / 1000).toFixed(1)}s
        </span>
      </div>

      {/* Current event */}
      {event && (
        <div className="rounded-lg bg-kumo-elevated p-3">
          <div className="text-xs font-bold text-kumo-default mb-1">
            {event.label}
          </div>
          <p className="text-xs text-kumo-subtle leading-relaxed">
            {event.description}
          </p>
        </div>
      )}

      {/* Fiber status */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-kumo-inactive">Fiber</span>
        <Badge
          variant={
            snapshot.fiber.status === "done"
              ? "secondary"
              : snapshot.fiber.status === "interrupted"
                ? "destructive"
                : "secondary"
          }
        >
          {snapshot.fiber.status}
        </Badge>
      </div>

      {/* Recovery decision */}
      {decision && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg p-3 border"
          style={{
            borderColor: "var(--viz-recovering)",
            backgroundColor:
              "color-mix(in srgb, var(--viz-recovering) 8%, transparent)",
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <GaugeIcon size={12} style={{ color: "var(--viz-recovering)" }} />
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "var(--viz-recovering)" }}
            >
              Recovery: {RECOVERY_INFO[decision.kind].label}
            </span>
          </div>
          <p className="text-xs text-kumo-subtle leading-relaxed">
            {decision.reason}
          </p>
        </motion.div>
      )}

      {/* Turn text preview */}
      {snapshot.turnText && (
        <div className="mt-auto">
          <span className="text-[10px] uppercase tracking-wider text-kumo-inactive font-semibold">
            Assistant Output
          </span>
          <p className="text-xs text-kumo-default mt-1 font-mono leading-relaxed max-h-24 overflow-y-auto">
            {snapshot.turnText}
          </p>
        </div>
      )}
    </Surface>
  );
}

// ─── Scenario Picker ──────────────────────────────────────────────────

function ScenarioPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="text-sm bg-kumo-elevated border border-kumo-line rounded-lg px-3 py-1.5 text-kumo-default focus:outline-none focus:ring-2 focus:ring-kumo-ring cursor-pointer"
      >
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Speed Selector ───────────────────────────────────────────────────

function SpeedSelector({
  speed,
  onChange,
}: {
  speed: number;
  onChange: (speed: number) => void;
}) {
  const speeds = [0.5, 1, 2, 4];
  return (
    <div className="flex items-center gap-1 rounded-lg bg-kumo-elevated p-0.5">
      {speeds.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className="px-2 py-1 rounded-md text-xs font-mono font-bold transition-colors"
          style={{
            backgroundColor:
              speed === s ? "var(--viz-durable)" : "transparent",
            color: speed === s ? "white" : "var(--kumo-inactive)",
          }}
        >
          {s}x
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export function RecoveryLab() {
  const sim = useRecoverySim();

  return (
    <div className="flex flex-col min-h-[100dvh] bg-kumo-elevated">
      {/* Header */}
      <header className="shrink-0 px-5 py-3 bg-kumo-base border-b border-kumo-line">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--viz-durable) 15%, transparent)",
              }}
            >
              <RobotIcon
                size={18}
                weight="duotone"
                style={{ color: "var(--viz-durable)" }}
              />
            </div>
            <div>
              <h1 className="text-base font-semibold text-kumo-default leading-tight">
                Recovery Lab
              </h1>
              <p className="text-[11px] text-kumo-inactive leading-tight">
                Cloudflare Agents — Chat Recovery Visualizer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <ScenarioPicker
              selectedId={sim.selectedScenarioId}
              onSelect={sim.loadScenario}
            />
            <SpeedSelector speed={sim.speed} onChange={sim.setSpeed} />
            <Button
              variant={sim.playing ? "secondary" : "primary"}
              shape="square"
              aria-label={sim.playing ? "Pause" : "Play"}
              onClick={sim.togglePlay}
              icon={
                sim.playing ? (
                  <PauseIcon size={16} weight="fill" />
                ) : (
                  <PlayIcon size={16} weight="fill" />
                )
              }
            />
            <Button
              variant="ghost"
              shape="square"
              aria-label="Reset"
              onClick={sim.reset}
              icon={<ArrowClockwiseIcon size={16} />}
            />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-4 lg:p-5">
        <div className="max-w-[1600px] mx-auto flex flex-col gap-4">
          {/* Timeline */}
          <Timeline
            events={sim.events}
            currentTime={sim.currentTime}
            totalDuration={sim.totalDuration}
            onScrub={sim.scrub}
            budget={sim.snapshot.budget}
          />

          {/* Bottom panels */}
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_1fr] gap-4">
            {/* Failure controls */}
            <div className="rounded-xl border border-kumo-line bg-kumo-base p-4">
              <FailureControls
                onInject={sim.injectFailure}
                onReset={sim.reset}
                disabled={false}
              />
            </div>

            {/* State inspector */}
            <div>
              <StateInspector snapshot={sim.snapshot} />
            </div>

            {/* Info panel */}
            <InfoPanel
              snapshot={sim.snapshot}
              currentTime={sim.currentTime}
              totalDuration={sim.totalDuration}
            />
          </div>

          {/* Scenario description */}
          <Surface className="p-4 rounded-xl">
            <p className="text-xs font-semibold text-kumo-inactive uppercase tracking-wider">
              {SCENARIO_MAP[sim.selectedScenarioId]?.name ?? ""}
            </p>
            <p className="text-sm text-kumo-subtle mt-1">
              {SCENARIO_MAP[sim.selectedScenarioId]?.description ?? ""}
            </p>
          </Surface>
        </div>
      </main>

      {/* Classifier overlay (appears when recovery triggers) */}
      <ClassifierOverlay
        decision={sim.snapshot.recovery.decision}
        active={sim.snapshot.recovery.active}
      />
    </div>
  );
}
