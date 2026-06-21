# Recovery Lab

<img width="3010" height="1634" alt="image" src="https://github.com/user-attachments/assets/9e2f5dfb-8890-4b55-9fd8-7697b0854286" />

An interactive visualization of Cloudflare Agents' chat recovery system. A
discrete event simulator that lets you watch a chat turn flow through the
system, inject failures (client disconnect, Durable Object eviction), and see
the recovery engine classify and repair the interrupted turn.

Built with React 19, Tailwind v4, [Kumo](https://www.npmjs.com/package/@cloudflare/kumo)
(Cloudflare's design system), and Framer Motion. Pure static frontend — no
server, no Workers, no build-time code generation.

## What you can do

- **Watch a chat turn lifecycle** unfold on a multi-track timeline (client
  WebSocket, fiber, stream, tools, budget)
- **Inject failures at any point** — disconnect the client, evict the Durable
  Object, kill a tool mid-execution, or trigger a deploy
- **See the classifier decide** — when a DO is evicted, the 7-branch recovery
  classifier evaluates conditions in priority order and picks a recovery
  action. An animated overlay shows each condition check and the chosen path.
- **Inspect internal state** — durable state (SQLite tables, DO storage) is
  shown separately from volatile state (in-memory). Durable state survives
  eviction; volatile state is lost. This is the key visual: you see exactly
  what the recovery system protects.
- **Scrub the timeline** — drag the playhead to any point and see the
  reconstructed state at that moment
- **8 preset scenarios** covering every recovery path, plus manual failure
  injection on any scenario

## Run it

```sh
npm install
npm run dev
```

Open the printed URL.

To build for production:

```sh
npm run build       # outputs to dist/
npm run preview     # serve the production build locally
```

The `dist/` folder is fully static — deploy it to any static host (Cloudflare
Pages, Netlify, Vercel, GitHub Pages, S3, etc.).

## Recovery paths visualized

The classifier evaluates conditions in strict priority order (first match wins):

| # | Condition | Recovery action | What happens |
|---|---|---|---|
| 1 | No output produced | **Retry Turn** | Discard the interrupted fiber, re-run from the user message |
| 2 | Awaiting human approval | **Park for Human** | Wait — budget-free, no progress consumed |
| 3 | Last tool already settled | **Preserve Tool Result** | Reuse the persisted result, skip re-execution |
| 4 | Child agent (facet) running | **Reattach Child** | Look up child's durable runId, reattach to its result |
| 5 | Tool call in-flight (not settled) | **Repair Transcript** | Remove dangling entry, retry the tool from scratch |
| 6 | Partial text streamed | **Continue Partial** | Reconstruct from persisted chunks, resume streaming |
| 7 | None matched | **Wait on Provider** | Stream went quiet — wait and monitor for forward progress |

## Project structure

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

### Two-layer recovery

The visualization distinguishes two recovery layers:

- **Stream resume** (client disconnect, DO alive) — the WebSocket drops but
  the Durable Object keeps streaming. On reconnect, buffered chunks are
  replayed from SQLite. No fiber recovery needed.
- **Fiber recovery** (DO eviction, isolate dies) — all in-memory state is
  lost. The recovery engine sweeps for "running" fibers, the classifier
  decides what to do, and a timer fires to execute the recovery action.

### Durable vs volatile state

| Durable (survives eviction) | Volatile (lost on eviction) |
|---|---|
| `cf_ai_chat_agent_messages` (SQLite) | WebSocket connection |
| `cf_ai_chat_stream_chunks` (SQLite) | Stream controller |
| `cf:chat:recovering` (DO storage) | Fiber execution state |
| `cf:chat:last-terminal` (DO storage) | In-memory tool promises |
| `cf:chat-recovery:incident:*` (DO storage) | Progress budget counter |

The State Inspector panel shows both side by side — blue accent for durable,
orange accent for volatile. When the isolate is replaced, the volatile panel
dims to 50% opacity with a warning banner.

## Tech stack

- **React 19** with TypeScript (strict, no `as any` or `@ts-ignore`)
- **Tailwind v4** via `@tailwindcss/vite`
- **Kumo** (`@cloudflare/kumo`) — Cloudflare's design system
- **Framer Motion** for animations (GPU-composited: transform/opacity only)
- **Phosphor Icons** for iconography
- **Vite 8** for dev server and build

## Design system

All visualization-specific tokens use `light-dark()` CSS function and
inherit Kumo's `data-mode` attribute system. Dark mode is the default.

See [DESIGN.md](./DESIGN.md) for the full spec — color tokens, typography,
spacing, component patterns, and motion guidelines.
