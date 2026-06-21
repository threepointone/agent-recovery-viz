/**
 * Recovery Lab — Failure Controls
 *
 * Chaos buttons that inject failures into the simulation. Each button
 * triggers a different recovery path, letting the user see how the
 * system responds to different failure modes.
 */

import { motion } from "framer-motion";
import { Button } from "@cloudflare/kumo";
import {
  PlugsIcon,
  PowerIcon,
  HammerIcon,
  RocketLaunchIcon,
  ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import type { FailureType } from "../sim/types";

interface FailureConfig {
  type: FailureType;
  label: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
}

const FAILURES: FailureConfig[] = [
  {
    type: "disconnect_client",
    label: "Disconnect Client",
    description: "WebSocket drops. DO stays alive — stream resume path.",
    icon: <PlugsIcon size={18} weight="duotone" />,
    accent: "var(--viz-recovering)",
  },
  {
    type: "evict_do",
    label: "Evict Durable Object",
    description: "Isolate dies. Fiber recovery + classifier decision.",
    icon: <PowerIcon size={18} weight="duotone" />,
    accent: "var(--viz-interrupted)",
  },
  {
    type: "kill_tool",
    label: "Kill Mid-Tool-Call",
    description: "Tool promise dies mid-execution. Triggers eviction + repair.",
    icon: <HammerIcon size={18} weight="duotone" />,
    accent: "var(--viz-interrupted)",
  },
  {
    type: "deploy",
    label: "Deploy Now",
    description: "New version rolls. All isolates replaced. Full recovery.",
    icon: <RocketLaunchIcon size={18} weight="duotone" />,
    accent: "var(--viz-interrupted)",
  },
];

export function FailureControls({
  onInject,
  onReset,
  disabled,
}: {
  onInject: (type: FailureType) => void;
  onReset: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-kumo-inactive">
          Inject Failure
        </span>
        <Button
          variant="ghost"
          shape="square"
          aria-label="Reset scenario"
          onClick={onReset}
          icon={<ArrowClockwiseIcon size={14} />}
        />
      </div>

      <div className="flex flex-col gap-2">
        {FAILURES.map((f, i) => (
          <motion.button
            key={f.type}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 100, damping: 20 }}
            disabled={disabled}
            onClick={() => onInject(f.type)}
            className="group flex items-start gap-3 p-3 rounded-lg border border-kumo-line bg-kumo-base hover:bg-kumo-elevated transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderLeft: `3px solid ${f.accent}` }}
          >
            <span
              className="shrink-0 mt-0.5"
              style={{ color: f.accent }}
            >
              {f.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-kumo-default">
                {f.label}
              </div>
              <div className="text-xs text-kumo-subtle leading-snug mt-0.5">
                {f.description}
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
