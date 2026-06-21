/**
 * Recovery Lab — Classifier Overlay (Concept B)
 *
 * When a DO eviction triggers recovery, the classifier evaluates 7
 * conditions in priority order to decide what to do. This overlay
 * animates the decision tree, showing each condition check and
 * highlighting the chosen recovery path.
 *
 * The overlay appears when the classifier runs and can be dismissed
 * by the user. It shows:
 * - Each condition check in priority order
 * - The actual result (true/false) for each condition
 * - The chosen recovery action with its description
 * - The rejected paths (dimmed)
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { XIcon, CheckIcon, MinusIcon, ArrowDownIcon } from "@phosphor-icons/react";
import type { RecoveryDecision, RecoveryKind } from "../sim/types";
import { RECOVERY_INFO } from "../sim/classifier";

interface Step {
  id: string;
  conditionLabel: string;
  conditionKey: string;
  matchOn: boolean;
  action: RecoveryKind;
}

const STEPS: Step[] = [
  { id: "root", conditionLabel: "Was any output produced?", conditionKey: "producedOutput", matchOn: false, action: "retry-turn" },
  { id: "n2", conditionLabel: "Awaiting human approval?", conditionKey: "pendingHumanInteraction", matchOn: true, action: "park-for-human" },
  { id: "n4", conditionLabel: "Last tool settled?", conditionKey: "lastToolSettled", matchOn: true, action: "preserve-tool-result" },
  { id: "n6", conditionLabel: "Child agent running?", conditionKey: "hasChildRun", matchOn: true, action: "reattach-child" },
  { id: "n8", conditionLabel: "Tool call in-flight?", conditionKey: "hasLastTool", matchOn: true, action: "repair-transcript" },
  { id: "n10", conditionLabel: "Partial text streamed?", conditionKey: "hasPartialText", matchOn: true, action: "continue-partial" },
  { id: "else", conditionLabel: "None matched — provider stall?", conditionKey: "_else", matchOn: true, action: "wait-on-provider" },
];

function evaluateSteps(decision: RecoveryDecision): {
  chosenIndex: number;
  results: boolean[];
} {
  const c = decision.conditions;
  const conditionValues: Record<string, boolean> = {
    producedOutput: c.producedOutput,
    pendingHumanInteraction: c.pendingHumanInteraction,
    lastToolSettled: c.lastToolSettled,
    hasChildRun: c.hasChildRun,
    hasLastTool: c.hasLastTool,
    hasPartialText: c.hasPartialText,
  };

  let chosenIndex = STEPS.length - 1; // Default to "else"
  const results: boolean[] = [];

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    if (step.conditionKey === "_else") {
      results.push(true);
      chosenIndex = i;
      break;
    }
    const value = conditionValues[step.conditionKey] ?? false;
    results.push(value);
    if (value === step.matchOn) {
      chosenIndex = i;
      break;
    }
  }

  return { chosenIndex, results };
}

function StepRow({
  step,
  index,
  result,
  isChosen,
  isPast,
}: {
  step: Step;
  index: number;
  result: boolean;
  isChosen: boolean;
  isPast: boolean;
}) {
  const info = RECOVERY_INFO[step.action];
  const matched = result === step.matchOn;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: isPast ? 1 : 0.3, y: 0 }}
      transition={{ delay: index * 0.12, type: "spring", stiffness: 100, damping: 20 }}
      className="flex items-stretch gap-3"
    >
      {/* Condition card */}
      <div
        className="flex-1 rounded-lg border p-3 transition-colors"
        style={{
          borderColor: isChosen ? "var(--viz-durable)" : "var(--kumo-line)",
          backgroundColor: isChosen ? "color-mix(in srgb, var(--viz-durable) 8%, transparent)" : "var(--kumo-base)",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-mono font-bold shrink-0"
              style={{
                backgroundColor: isChosen ? "var(--viz-durable)" : "var(--kumo-elevated)",
                color: isChosen ? "white" : "var(--kumo-inactive)",
              }}
            >
              {index + 1}
            </span>
            <span className="text-sm font-medium text-kumo-default">
              {step.conditionLabel}
            </span>
          </div>

          {/* Result badge */}
          {isPast && step.conditionKey !== "_else" && (
            <span
              className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md shrink-0"
              style={{
                backgroundColor: matched
                  ? "color-mix(in srgb, var(--viz-durable) 15%, transparent)"
                  : "color-mix(in srgb, var(--kumo-inactive) 15%, transparent)",
                color: matched ? "var(--viz-durable)" : "var(--kumo-inactive)",
              }}
            >
              {result ? "TRUE" : "FALSE"}
            </span>
          )}
        </div>

        {/* Action (shown when this step is chosen) */}
        {isChosen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ delay: 0.3, type: "spring", stiffness: 100, damping: 20 }}
            className="mt-2 pt-2 border-t border-kumo-line"
          >
            <div className="flex items-center gap-2 mb-1">
              {matched ? (
                <CheckIcon size={14} weight="bold" style={{ color: "var(--viz-durable)" }} />
              ) : (
                <MinusIcon size={14} weight="bold" style={{ color: "var(--kumo-inactive)" }} />
              )}
              <span
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: "var(--viz-durable)" }}
              >
                {info.label}
              </span>
            </div>
            <p className="text-xs text-kumo-subtle leading-relaxed">
              {info.description}
            </p>
            <div className="mt-2 rounded-md bg-kumo-elevated p-2">
              <span className="text-[10px] uppercase tracking-wider text-kumo-inactive font-semibold">
                Action
              </span>
              <p className="text-xs text-kumo-default mt-0.5 font-mono leading-relaxed">
                {info.action}
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

export function ClassifierOverlay({
  decision,
  active,
}: {
  decision: RecoveryDecision | null;
  active: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const prevActiveRef = useRef(false);

  useEffect(() => {
    if (active && !prevActiveRef.current) {
      setDismissed(false);
    }
    prevActiveRef.current = active;
  }, [active]);

  const shouldShow = Boolean(decision) && !dismissed;
  const evalResult = decision ? evaluateSteps(decision) : null;

  return (
    <AnimatePresence>
      {shouldShow && decision && evalResult && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.6)" }}
          onClick={() => setDismissed(true)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-kumo-line bg-kumo-base shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-kumo-line bg-kumo-base">
              <div>
                <h2 className="text-base font-semibold text-kumo-default">
                  Recovery Classifier
                </h2>
                <p className="text-xs text-kumo-inactive mt-0.5">
                  Evaluating interrupted turn to determine recovery action
                </p>
              </div>
              <button
                onClick={() => setDismissed(true)}
                className="p-1.5 rounded-lg hover:bg-kumo-elevated transition-colors text-kumo-inactive hover:text-kumo-default"
                aria-label="Close"
              >
                <XIcon size={18} />
              </button>
            </div>

            {/* Decision steps */}
            <div className="p-5 flex flex-col gap-1">
              {STEPS.map((step, i) => (
                <div key={step.id}>
                  <StepRow
                    step={step}
                    index={i}
                    result={evalResult.results[i] ?? false}
                    isChosen={i === evalResult.chosenIndex}
                    isPast={i <= evalResult.chosenIndex}
                  />
                  {/* Arrow between steps */}
                  {i < evalResult.chosenIndex && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.12 + 0.1 }}
                      className="flex justify-center py-1"
                    >
                      <ArrowDownIcon
                        size={14}
                        className="text-kumo-inactive"
                        weight="bold"
                      />
                    </motion.div>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 px-5 py-3 border-t border-kumo-line bg-kumo-base">
              <p className="text-[11px] text-kumo-inactive text-center">
                Conditions are evaluated in priority order. The first match wins.
                Click anywhere outside to dismiss.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
