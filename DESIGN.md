# Recovery Lab — Design System

## 1. Product Context

**What:** An interactive visualization of Cloudflare's agent chat recovery system —
a deterministic simulation that lets you watch a chat turn flow through the system,
inject failures (client disconnect, Durable Object eviction), and see the recovery
engine classify and repair the interrupted turn.

**Who:** Developers learning how Cloudflare Agents persist and recover state.
Secondary: engineers evaluating the recovery architecture for production use.

**Feeling:** Technical, precise, alive. A lab instrument, not a marketing page.
Information-dense but calm. Every pixel earns its place.

## 2. Color Tokens

Built on top of Kumo (Cloudflare's design system). All Kumo semantic tokens
(`kumo-base`, `kumo-elevated`, `kumo-contrast`, `kumo-default`, `kumo-subtle`,
`kumo-inactive`, `kumo-line`, `kumo-success`, `kumo-warning`, `kumo-danger`,
`kumo-ring`) are inherited unchanged.

### Visualization-specific tokens

These map to Kumo's light/dark mode system via `light-dark()`.

| Token | Light | Dark | Semantic meaning |
|---|---|---|---|
| `--viz-durable` | `#2563eb` | `#60a5fa` | Durable state — survives eviction (SQLite, DO storage) |
| `--viz-volatile` | `#ea580c` | `#fb923c` | Volatile state — lost on eviction (in-memory, WebSocket) |
| `--viz-running` | `#2563eb` | `#60a5fa` | Active/running (same as durable — running fibers are durable) |
| `--viz-interrupted` | `#dc2626` | `#f87171` | Interrupted/dead (isolate replaced) |
| `--viz-recovering` | `#d97706` | `#fbbf24` | Recovery in progress |
| `--viz-complete` | `#16a34a` | `#4ade80` | Turn completed successfully |
| `--viz-sealed` | `#7c3aed` | `#a78bfa` | Turn sealed (budget exhausted) |
| `--viz-idle` | `#9ca3af` | `#6b7280` | Idle/waiting |
| `--viz-bg-track` | `#f9fafb` | `#111317` | Track background |
| `--viz-bg-track-alt` | `#f3f4f6` | `#16181d` | Alternating track background |

### Status mapping

| System state | Token | Kumo equivalent |
|---|---|---|
| Connected / running | `--viz-durable` | `kumo-success` family |
| Disconnected / interrupted | `--viz-interrupted` | `kumo-danger` |
| Recovering | `--viz-recovering` | `kumo-warning` |
| Complete | `--viz-complete` | `kumo-success` |
| Idle | `--viz-idle` | `kumo-inactive` |

## 3. Typography

Follows Kumo's built-in font system. No custom fonts imported.

| Role | Font | Size | Weight | Tracking |
|---|---|---|---|---|
| Page title | Kumo sans | `text-lg` | 600 | normal |
| Section label | Kumo sans | `text-xs` | 600 | `tracking-wider uppercase` |
| Track label | Kumo sans | `text-xs` | 500 | normal |
| Event label | Kumo sans | `text-[11px]` | 500 | normal |
| Mono / data | `ui-monospace, SFMono-Regular, Menlo` | `text-xs` | 400 | normal |
| Body | Kumo sans | `text-sm` | 400 | normal |

## 4. Spacing & Layout

| Token | Value | Usage |
|---|---|---|
| Track height | `56px` | Each timeline track |
| Track label width | `120px` | Left-aligned labels |
| Track gap | `1px` | Between tracks (border) |
| Timeline padding | `16px` | Left/right of timeline area |
| Panel padding | `20px` | Side panels |
| Component gap | `16px` | Between major sections |

### Layout grid

```
┌─────────────────────────────────────────────────────┐
│ Header (64px)                                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│ Timeline (flex-1, min-height 360px)                 │
│                                                      │
├──────────────────┬──────────────────┬───────────────┤
│ Failures (240px) │ State Inspector  │ Info (flex-1) │
│                  │ (320px)          │               │
└──────────────────┴──────────────────┴───────────────┘
```

On viewports < 1024px, the three bottom panels stack vertically.

## 5. Component Patterns

### Timeline track
A horizontal lane with a label on the left and events positioned by time.
Events are colored blocks or dots. State segments span between events.

### Event marker
Small rounded rectangle on a track. Color matches the event type.
Past events: full opacity. Future events: 40% opacity.

### Playhead
Vertical line spanning all tracks, with a draggable handle at the top.
Color: `--viz-durable`. Width: `2px`. Z-index: above tracks, below overlays.

### Failure button
Kumo `Button` with `variant="secondary"`. Icon + label.
On hover: subtle ring. On click: `scale-[0.98]` tactile feedback.

### Classifier tree node
Rounded rectangle with label. Default: `kumo-base` bg, `kumo-line` border.
Active (chosen path): `--viz-durable` border, subtle bg tint.
Rejected: 40% opacity. Animated with Framer Motion `layout` transitions.

### State inspector row
Monospace text in a table-like layout. New rows animate in with `layoutId`.
Deleted rows fade out. Durable rows have a blue left border.
Volatile rows have an orange left border.

## 6. Motion

| Interaction | Animation | Duration | Easing |
|---|---|---|---|
| Playhead move | Linear (time-driven) | continuous | linear |
| Event appear | opacity 0→1, scale 0.8→1 | 300ms | spring(100, 20) |
| State segment transition | background-color | 200ms | ease-out |
| Classifier overlay enter | opacity + scale | 400ms | spring(100, 20) |
| Tree path highlight | border-color + bg | 300ms | ease-out |
| State inspector row enter | layout + opacity | 300ms | spring(100, 20) |
| Failure injection flash | red flash on timeline | 200ms | ease-out |

All animations use `transform` and `opacity` only (GPU-composited).
No layout property animations.

## 7. Dark Mode

Inherited from Kumo's `data-mode` attribute system. All visualization tokens
use `light-dark()` CSS function. The `ModeToggle` component in the existing
client sets `data-mode` on `<html>`. No additional dark mode logic needed.

Dark mode is the default for this tool — it reads better as a "lab instrument."
