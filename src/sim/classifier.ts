/**
 * Recovery Lab — Classifier
 *
 * Implements the 7-branch recovery decision tree from the chat recovery system.
 * When a Durable Object is evicted mid-turn, the recovery engine sweeps for
 * "running" fibers and calls the classifier to decide what to do.
 *
 * The classifier evaluates conditions in strict priority order (switch-true):
 *   1. No output produced at all          → retry-turn
 *   2. Awaiting human approval            → park-for-human (budget-free)
 *   3. Last tool already settled          → preserve-tool-result
 *   4. Child agent (facet) was running    → reattach-child
 *   5. Last tool exists but didn't settle → repair-transcript
 *   6. Partial text was streamed          → continue-partial
 *   7. None of the above                  → wait-on-provider
 */

import type { RecoveryDecision, RecoveryKind, ToolCallState, StreamChunkState } from "./types";

// ─── Classify Input ───────────────────────────────────────────────────

export interface ClassifyInput {
  producedOutput: boolean;
  pendingHumanInteraction: boolean;
  lastToolSettled: boolean;
  hasChildRun: boolean;
  hasLastTool: boolean;
  hasPartialText: boolean;
}

/**
 * Derive classifier input from the simulation snapshot's components.
 * Called by the engine when a DO eviction triggers recovery.
 */
export function deriveClassifyInput(
  chunks: StreamChunkState[],
  tools: ToolCallState[],
): ClassifyInput {
  const producedOutput = chunks.length > 0 || tools.length > 0;
  const pendingHumanInteraction = tools.some(
    (t) => t.needsApproval && t.status !== "settled" && t.status !== "error",
  );
  const lastTool = tools[tools.length - 1];
  const lastToolSettled = lastTool?.status === "settled";
  const hasChildRun = tools.some(
    (t) => t.isChildAgent && (t.status === "running" || t.status === "interrupted"),
  );
  const hasLastTool = tools.length > 0;
  const hasPartialText = chunks.length > 0;

  return {
    producedOutput,
    pendingHumanInteraction,
    lastToolSettled,
    hasChildRun,
    hasLastTool,
    hasPartialText,
  };
}

// ─── Classifier ───────────────────────────────────────────────────────

export function classify(input: ClassifyInput): RecoveryDecision {
  const c = input;

  if (!c.producedOutput) {
    return decision("retry-turn", c, "No output was produced before eviction. The entire turn is retried from scratch.");
  }

  if (c.pendingHumanInteraction) {
    return decision("park-for-human", c, "A tool is awaiting human approval. Recovery parks the turn — waiting is budget-free.");
  }

  if (c.lastToolSettled) {
    return decision("preserve-tool-result", c, "The last tool call settled and was persisted. Recovery reuses the result instead of re-executing the tool.");
  }

  if (c.hasChildRun) {
    return decision("reattach-child", c, "A child agent (facet) has its own durable run. The parent reattaches to the child's run by stable ID.");
  }

  if (c.hasLastTool) {
    return decision("repair-transcript", c, "A tool call was in-flight when the isolate died, leaving a dangling transcript entry. Recovery repairs the transcript and retries the tool.");
  }

  if (c.hasPartialText) {
    return decision("continue-partial", c, "Partial text was streamed and persisted. Recovery continues from the last checkpoint.");
  }

  return decision("wait-on-provider", c, "The stream went quiet — possibly a provider stall. Recovery waits and checks for forward progress.");
}

function decision(
  kind: RecoveryKind,
  conditions: ClassifyInput,
  reason: string,
): RecoveryDecision {
  return {
    kind,
    reason,
    conditions,
    action: RECOVERY_INFO[kind].action,
  };
}

// ─── Recovery Metadata (for UI) ───────────────────────────────────────

export const RECOVERY_INFO: Record<
  RecoveryKind,
  {
    label: string;
    shortLabel: string;
    description: string;
    action: string;
    condition: string;
  }
> = {
  "retry-turn": {
    label: "Retry Turn",
    shortLabel: "Retry",
    description: "No output was produced before the isolate died. Start the turn over from the beginning.",
    action: "Discard the interrupted fiber and re-run the entire turn from the user message.",
    condition: "!producedOutput",
  },
  "park-for-human": {
    label: "Park for Human",
    shortLabel: "Park",
    description: "A tool is waiting for human approval. The turn is parked — waiting does not consume the progress budget.",
    action: "Do nothing. The turn resumes when the human responds. Budget-free.",
    condition: "pendingHumanInteraction",
  },
  "preserve-tool-result": {
    label: "Preserve Tool Result",
    shortLabel: "Preserve",
    description: "The last tool call completed and its result was persisted to SQLite. Recovery reuses it.",
    action: "Skip re-executing the tool. Feed the settled result back into the model and continue streaming.",
    condition: "lastTool.settled === true",
  },
  "reattach-child": {
    label: "Reattach Child",
    shortLabel: "Reattach",
    description: "A child agent (facet) was running with its own durable run. The parent reattaches to it.",
    action: "Look up the child's runId in durable state. Reattach to the child's terminal result.",
    condition: "childRun != null",
  },
  "repair-transcript": {
    label: "Repair Transcript",
    shortLabel: "Repair",
    description: "A tool call was in-flight when the isolate died, leaving a dangling entry in the transcript.",
    action: "Remove the dangling tool call from the transcript. Retry the tool call from scratch.",
    condition: "lastTool != null (not settled)",
  },
  "continue-partial": {
    label: "Continue Partial",
    shortLabel: "Continue",
    description: "Partial text was streamed and persisted. Recovery continues from the last checkpoint.",
    action: "Reconstruct the partial assistant message from persisted chunks. Resume streaming from the last cursor.",
    condition: "partialText != null",
  },
  "wait-on-provider": {
    label: "Wait on Provider",
    shortLabel: "Wait",
    description: "The stream went quiet — possibly a provider stall. Recovery waits and monitors for forward progress.",
    action: "Schedule a timed wait. If forward progress resumes, continue. If the budget is exhausted, seal the turn.",
    condition: "default (no other condition matched)",
  },
};

// ─── Decision Tree (for ClassifierOverlay visualization) ──────────────

export interface DecisionTreeNode {
  id: string;
  condition: string;
  label: string;
  yes: DecisionTreeNode | RecoveryKind;
  no: DecisionTreeNode | RecoveryKind;
}

export const DECISION_TREE: DecisionTreeNode = {
  id: "root",
  condition: "producedOutput",
  label: "Was any output produced?",
  yes: {
    id: "n2",
    condition: "pendingHumanInteraction",
    label: "Awaiting human approval?",
    yes: "park-for-human",
    no: {
      id: "n4",
      condition: "lastToolSettled",
      label: "Last tool settled?",
      yes: "preserve-tool-result",
      no: {
        id: "n6",
        condition: "hasChildRun",
        label: "Child agent running?",
        yes: "reattach-child",
        no: {
          id: "n8",
          condition: "hasLastTool",
          label: "Tool call in-flight?",
          yes: "repair-transcript",
          no: {
            id: "n10",
            condition: "hasPartialText",
            label: "Partial text streamed?",
            yes: "continue-partial",
            no: "wait-on-provider",
          },
        },
      },
    },
  },
  no: "retry-turn",
};
