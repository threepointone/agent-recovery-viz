# Start here

Paste this file into your AI coding agent (Cursor, Claude, Codex, etc.) and ask
it to help you build. It is a guided tour of Recovery Lab and the rules for
changing it safely.

## What this is

**Recovery Lab** — an interactive visualization of Cloudflare Agents' chat
recovery system. A discrete event simulator that lets you watch a chat turn
flow through the system, inject failures, and see the recovery engine classify
and repair the interrupted turn.

Pure static frontend — no server, no Workers, no build-time code generation.
Built with React 19, Tailwind v4, Kumo (Cloudflare's design system), and
Framer Motion.

## Layout

```
src/
  client.tsx                  # Entry point — renders RecoveryLab + ModeToggle
  styles.css                  # Tailwind v4 + Kumo + viz CSS variables
  sim/
    types.ts                  # All simulation types, enums, track configs
    classifier.ts             # 7-branch classifier + RECOVERY_INFO metadata
    scenarios.ts              # 8 preset scenarios + SCENARIO_MAP
    useRecoverySim.ts         # Simulation engine: computeSnapshot, playback hook
  components/
    RecoveryLab.tsx           # Root layout: header, timeline, panels
    Timeline.tsx              # Multi-track timeline + budget bar + scrubbing
    FailureControls.tsx       # 4 chaos buttons (disconnect, evict, kill, deploy)
    ClassifierOverlay.tsx     # Animated decision tree modal
    StateInspector.tsx        # Durable (blue) vs volatile (orange) state panels
DESIGN.md                     # Design system spec (colors, typography, motion)
public/
  favicon.ico
```

## Run it

```sh
npm install
npm run dev
```

Open the printed URL. Build for production with `npm run build` (outputs to
`dist/`). Preview the production build with `npm run preview`.

The `dist/` folder is fully static — deploy it to any static host (Cloudflare
Pages, Netlify, Vercel, GitHub Pages, S3, etc.).

## How the simulation works

The engine is a **discrete event simulator**. Events are timestamped and
sorted on a timeline. The playhead advances through them at a configurable
speed (0.5x–4x). A snapshot (derived state) is computed by replaying all
events up to the current time — `computeSnapshot()` is a pure function that
folds over the event list.

When a failure is injected, the engine:
1. Computes a fresh snapshot at the current time
2. Runs the real classifier logic (`classify()`) on that snapshot
3. Generates recovery events (`computeRecoveryEvents()`) and merges them
   into the timeline using a stable sort

The simulation auto-pauses when the playhead reaches a `classify` event, so
the user can read the classifier overlay before continuing.

### Key types

- **`SimEvent`** — a timestamped event on the timeline (type, track, label,
  description, optional data)
- **`SimSnapshot`** — the full derived state at a point in time (fiber,
  client, stream, tools, budget, sqlite, storage, recovery)
- **`RecoveryDecision`** — the classifier's output (kind, reason, conditions,
  action)
- **`Scenario`** — a preset sequence of events with a name and description

### The classifier

7 branches evaluated in strict priority order (first match wins):

1. `!producedOutput` → **retry-turn**
2. `pendingHumanInteraction` → **park-for-human** (budget-free)
3. `lastToolSettled` → **preserve-tool-result** (skip re-execution)
4. `hasChildRun` → **reattach-child** (reattach to child's durable run)
5. `hasLastTool` → **repair-transcript** (remove dangling entry, retry tool)
6. `hasPartialText` → **continue-partial** (resume from checkpoint)
7. else → **wait-on-provider** (monitor for forward progress)

The classifier lives in `src/sim/classifier.ts`. The `deriveClassifyInput()`
function maps snapshot state (chunks, tools) to the 6 boolean conditions. The
`classify()` function is a pure switch-true evaluation.

### Durable vs volatile state

The State Inspector shows both side by side:

| Durable (survives eviction) | Volatile (lost on eviction) |
|---|---|
| `cf_ai_chat_agent_messages` (SQLite) | WebSocket connection |
| `cf_ai_chat_stream_chunks` (SQLite) | Stream controller |
| `cf:chat:recovering` (DO storage) | Fiber execution state |
| `cf:chat:last-terminal` (DO storage) | In-memory tool promises |
| `cf:chat-recovery:incident:*` (DO storage) | Progress budget counter |

When the isolate is replaced, the volatile panel dims to 50% opacity with a
warning banner. Durable state persists across eviction — this is the key
visual: you see exactly what the recovery system protects.

## Common changes

- **Add a scenario:** Add an entry to the `SCENARIOS` array in
  `src/sim/scenarios.ts`. Use the `ev()` factory for deterministic event IDs.
  Set `totalDuration` to the last event's time. The scenario automatically
  appears in the dropdown.
- **Change the classifier:** Edit `classify()` or `deriveClassifyInput()` in
  `src/sim/classifier.ts`. Update `RECOVERY_INFO` and `DECISION_TREE` to
  match. The `ClassifierOverlay` component reads from `STEPS` (defined in the
  overlay) — update that array if you add or reorder branches.
- **Add a failure type:** Add to `FailureType` in `src/sim/types.ts`, add a
  button in `FailureControls.tsx`, and handle it in `injectFailure` in
  `useRecoverySim.ts`.
- **Add a track:** Add to `TrackId` and `TRACK_CONFIGS` in `src/sim/types.ts`.
  Add state colors in `Timeline.tsx` (`STATE_COLORS`). Handle the track in
  `getStateAfter()` and `computeSegments()`.

## Rules

- **Type safety:** Never use `as any`, `@ts-ignore`, or `@ts-expect-error`.
  Use runtime-validated accessors (`str()`, `num()`, `bool()` in
  `useRecoverySim.ts`) for event data — not unchecked `as` assertions.
- **Pure snapshot:** `computeSnapshot()` must remain a pure function. It
  folds over the event list — no side effects, no external state.
- **Stable sort:** Event ordering after failure injection uses `stableSort()`
  with an index tiebreaker. Do not replace with plain `.sort()`.
- **GPU-composited animations only:** Framer Motion animations must use
  `transform` and `opacity` only. No layout property animations.
- **AnimatePresence:** Conditional rendering of animated elements must be
  inside `<AnimatePresence>` — never early-return before it, or exit
  animations break.
- **Dark mode default:** The app defaults to dark mode via `data-mode` on
  `<html>`. All viz tokens use `light-dark()`. Do not hardcode colors.
- **No custom fonts:** Use Kumo's built-in font system. Do not import
  Inter or other external fonts.

## Design system

All visualization-specific tokens are defined in `src/styles.css` and
documented in `DESIGN.md`. Key tokens:

| Token | Meaning |
|---|---|
| `--viz-durable` | Durable state — survives eviction (blue) |
| `--viz-volatile` | Volatile state — lost on eviction (orange) |
| `--viz-interrupted` | Interrupted/dead — isolate replaced (red) |
| `--viz-recovering` | Recovery in progress (amber) |
| `--viz-complete` | Turn completed successfully (green) |
| `--viz-sealed` | Turn sealed — budget exhausted (purple) |
| `--viz-idle` | Idle/waiting (gray) |
