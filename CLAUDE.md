# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains a **proposal for a Scroll Timing Performance API** and a demonstration polyfill implementation. The project aims to standardize how developers measure scroll performance metrics including smoothness, responsiveness, frame drops, and scroll velocity.

**Status:** This is a proposal with a working polyfill demonstration. The API is not yet standardized and is not available natively in any browser.

**Live Demo:** [https://nhelfman.github.io/scroll-timing-api/demo.html](https://nhelfman.github.io/scroll-timing-api/demo.html)

**Key concepts:**
- Proposes extending the `PerformanceObserver` pattern with a new `PerformanceScrollTiming` entry type
- Measures scroll start latency (input to first frame), scroll duration, frame production vs expectations, smoothness scores, and scroll velocity
- Includes a JavaScript polyfill that approximates the proposed native API behavior using available browser primitives
- Contains a self-contained demo page showcasing the polyfill's capabilities with real-time metrics and jank simulation

## Repository Structure

```
scroll-timing-api/
├── README.md         # Full API proposal with motivation, metrics explanation, and API shape (~400 lines)
├── polyfill.js       # JavaScript polyfill implementation (~375 lines)
└── demo.html         # Interactive demo page (~1255 lines, self-contained with polyfill)
```

## Development Commands

This is a static web project with no build system or dependencies. To work with it:

**View the demo:**
```bash
# Open demo.html in a browser (any static file server works)
# On Windows with Python:
python -m http.server 8000
# Then navigate to http://localhost:8000/demo.html

# Alternatively, open demo.html directly in a browser
```

**No build, test, or lint commands** - this is a pure HTML/JS demonstration project.

**Testing the polyfill:**
- Open demo.html in multiple browsers to verify cross-browser compatibility
- Test with DevTools open/closed to observe refresh rate measurement behavior
- Try different input methods: mouse wheel, trackpad, touch (mobile), keyboard (arrow keys, Page Up/Down)
- Enable jank simulation to verify dropped frame detection
- Test nested scroller to ensure element-level scroll tracking works correctly
- Verify console output when console logging is enabled

## Architecture

### Polyfill Implementation (polyfill.js)

The polyfill uses an IIFE pattern and implements the proposed API using available browser primitives:

**Core classes:**
- `PerformanceScrollTimingPolyfill`: Entry class that mimics the proposed native API shape
- `ActiveScrollState`: Tracks an ongoing scroll interaction, monitoring frames via rAF and scroll distance
  - Tracks `lastScrollTop`, `lastScrollLeft`, `cumulativeDistanceX`, and `cumulativeDistanceY`
  - Updates distance on each scroll event by accumulating X and Y components separately
  - Maintains frame count, expected frames, and timing metadata

**Scroll detection strategy:**
1. Listens for `scroll` events (with capture to detect element scrolls)
2. Uses "input hints" from `wheel`, `touchstart`/`touchmove`, and `keydown` events to determine scroll source
3. Associates hints with scroll events within a 250ms window
4. Tracks frame production using `requestAnimationFrame` callbacks
5. Ends scroll tracking after 150ms of inactivity
6. Scroll source detection: "wheel", "touch", "keyboard", or "other" (falls back when no hint is available)

**Key implementation details:**
- `measureRefreshRate()`: Samples 60 frames on page load to calculate the median frame time and determine actual display refresh rate (fixes false jank detection in throttled environments)
- `normalizeScrollTarget()`: Handles document vs element scrolling, normalizing to `scrollingElement`
- `isPotentiallyScrollable()`: Checks computed styles to identify scrollable elements
- `findScrollableFromEventTarget()`: Walks up DOM tree from input events to find the scroll container
- Frame counting: Uses rAF timestamps to calculate expected frames based on measured refresh rate (not hardcoded 60fps)
- Patches `window.PerformanceObserver` to intercept `observe()` calls for `type: 'scroll'`

**Metrics calculated:**
- `startTime`: First input event timestamp
- `firstFrameTime`: First rAF callback after scroll starts (monotonic, clamped to >= startTime)
- `scrollStartLatency`: Derived as `firstFrameTime - startTime`
- `smoothnessScore`: `framesProduced / framesExpected` (polyfill-specific convenience metric)
- `framesExpected`: Calculated per-frame based on duration deltas using measured refresh rate
- `framesProduced`: Count of rAF callbacks during scroll
- `distanceX`: Cumulative horizontal scroll distance in pixels (signed: positive = right, negative = left)
- `distanceY`: Cumulative vertical scroll distance in pixels (signed: positive = down, negative = up)
- `scrollVelocity`: Derived metric calculated as `√(distanceX² + distanceY²) / duration` (pixels per second)

**Refresh rate handling:**
The polyfill measures the actual display refresh rate on load to avoid false jank detection. For example, when DevTools is open, browsers often throttle to ~32fps. Using a hardcoded 60fps assumption would incorrectly report 50% smoothness for perfectly smooth scrolling. See the "Open Questions" section in README.md for discussion on whether the native API should use actual refresh rate or standardized 60fps.

### Demo Page (demo.html)

A fully self-contained single-page application with:

**UI structure:**
- Fixed topbar with scroll progress indicator
- Left panel (sticky on desktop): Live metrics, controls, and entry log table
- Right panel: Scrollable content with multiple sections and a nested scroller

**Key features:**
- Real-time metrics display: avg duration, avg smoothness, P75 smoothness, total dropped frames, avg velocity, avg distance
- Controls to start/stop observation, clear entries, export to JSON
- Jank simulation toggle with adjustable busy-loop duration (0-100ms)
- Log table showing up to 50 most recent entries with color-coded smoothness scores, velocity, and distance
- Nested scrollable container to demonstrate element-level scroll tracking
- Scroll progress indicator in top bar
- Console logging toggle for debugging entries

**Implementation notes:**
- Limits stored entries to `MAX_ENTRIES = 50` to prevent memory growth
- Uses color-coded "pills" and dots: green (≥90% smooth), yellow (≥75%), red (<75%)
- Includes an attention animation on "Start observing" button on page load
- All styles are inline; no external CSS dependencies
- Velocity is calculated client-side as `√(distanceX² + distanceY²) / duration * 1000` for display in px/s
- Aggregated metrics include average velocity and average distance across all recorded entries
- Log table displays per-entry velocity alongside smoothness and duration

## Important Notes for Development

**When modifying the polyfill:**
- The polyfill measures actual refresh rate on page load (60 samples) - this is necessary to avoid false jank detection in throttled environments
- The polyfill cannot accurately measure checkerboarding - this requires browser internals
- rAF timestamps may not perfectly align with input event timestamps (different clocks)
- The 150ms scroll end timeout is heuristic-based and may not match native implementations
- `smoothnessScore` is a polyfill convenience property - the native API would only expose raw frame counts
- Frame counting uses delta-based approach (comparing consecutive rAF timestamps) with measured refresh rate baseline
- `distanceX` and `distanceY` are tracked separately by accumulating signed deltas from scroll events
- Distance tracking preserves directionality: positive Y = scrolling down, negative Y = scrolling up; positive X = scrolling right, negative X = scrolling left
- Total distance (for velocity calculations) is derived using Euclidean distance: √(distanceX² + distanceY²)

**When modifying the demo:**
- Jank simulation requires `capture: true` on the scroll listener to catch nested scroller events (scroll events don't bubble)
- Ensure jank simulation only runs when the toggle is enabled
- Keep the nested scroller functional to demonstrate element scroll tracking
- Maintain the 50-entry limit to prevent performance degradation
- The demo must remain self-contained (no external dependencies)

**API shape consistency:**
- The polyfill attempts to match the WebIDL interface defined in README.md
- `scrollStartLatency` is calculated in the polyfill but would ideally come from the browser in a native implementation
- `checkerboardAreaMax` is always 0 in the polyfill (cannot be accurately measured)
- See README.md "Open Questions" for unresolved design decisions:
  - **Refresh Rate Baseline**: Should `framesExpected` use standardized 60fps or device actual refresh rate? (Polyfill uses actual measured rate)
  - **Dynamic Refresh Rates**: How to handle VRR displays and browser throttling mid-session?
  - **Smoothness Scoring**: Should the API provide a pre-calculated smoothness score, or only raw metrics? Options include simple ratio, harmonic mean, or RMS approaches

## Proposed API Shape (from README.md)

```javascript
interface PerformanceScrollTiming : PerformanceEntry {
  readonly attribute DOMHighResTimeStamp startTime;
  readonly attribute DOMHighResTimeStamp firstFrameTime;
  readonly attribute DOMHighResTimeStamp duration;
  readonly attribute unsigned long framesExpected;
  readonly attribute unsigned long framesProduced;
  readonly attribute unsigned long framesDropped;
  readonly attribute double checkerboardTime;
  readonly attribute double checkerboardAreaMax;
  readonly attribute long distanceX;
  readonly attribute long distanceY;
  readonly attribute DOMString scrollSource;  // "touch", "wheel", "keyboard", "other", "programmatic"
  readonly attribute Element? target;
};
```

**Usage pattern:**
```javascript
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    // Derived metrics
    const scrollStartLatency = entry.firstFrameTime - entry.startTime;
    const smoothness = entry.framesProduced / entry.framesExpected;
    const totalDistance = Math.sqrt(entry.distanceX ** 2 + entry.distanceY ** 2);
    const velocity = totalDistance / entry.duration * 1000; // px/s

    console.log({
      scrollStartLatency,
      smoothness,
      droppedFrames: entry.framesDropped,
      distanceX: entry.distanceX,
      distanceY: entry.distanceY,
      totalDistance,
      scrollVelocity: velocity,
      scrollSource: entry.scrollSource
    });
  }
});
observer.observe({ type: 'scroll', buffered: true });
```

## Key Concepts

### Scroll Velocity

Scroll velocity measures the speed at which a user navigates through content. The API provides `distanceX` and `distanceY` components, allowing calculation of total distance as `√(distanceX² + distanceY²)`, and velocity as `totalDistance / duration` (pixels per millisecond, or × 1000 for pixels per second). Directional velocities can also be calculated separately for X and Y axes.

**Why velocity matters:**
1. **Performance Issue Diagnosis**: Jank often correlates with scroll velocity. Performance may degrade at high velocities due to insufficient rasterization, paint operations, or layout recalculations.
2. **User Intent Inference**: High velocity suggests skimming/navigation; low velocity suggests reading/engagement.
3. **Interaction Quality Scoring**: Velocity helps weight metrics by scroll intensity for better aggregation.
4. **Optimization Strategy Validation**: Velocity-stratified data helps validate optimizations across different scroll speeds.
5. **Benchmarking**: Provides a standardized dimension for performance testing across velocity buckets (e.g., slow: <1000 px/s, medium: 1000-3000 px/s, fast: >3000 px/s).

**Common patterns:**
- Fling scrolls (touch): High initial velocity with decay (momentum scrolling)
- Keyboard/wheel scrolls: Lower, more consistent velocity with discrete steps
- Programmatic scrolls: Predictable, constant velocity
- Search navigation: Short-duration, high-velocity jumps

See README.md "Scroll Velocity" section for comprehensive discussion on telemetry use cases, diagnostics, and optimization strategies.

### Polyfill Limitations

The polyfill is intended for **demonstration and prototyping purposes only**. Key limitations:

1. **Timing accuracy**: rAF timestamps and input event timestamps may use different clocks, leading to slight inaccuracies in `scrollStartLatency`
2. **Checkerboarding**: Cannot detect checkerboarding (incomplete content painting) without browser internals; `checkerboardAreaMax` always returns 0
3. **Frame counting**: Uses heuristics based on rAF callbacks; may not perfectly match native compositor frame production
4. **Scroll end detection**: Uses 150ms idle timeout heuristic; native implementations may use different signals
5. **Refresh rate measurement**: Samples on page load only; doesn't adapt to mid-session throttling or VRR changes
6. **Scroll source detection**: Uses 250ms hint window; may misclassify rapid source changes or programmatic scrolls
7. **Performance overhead**: JavaScript-based tracking adds overhead that a native implementation would not have

A native browser implementation would have access to compositor data, precise vsync timing, rasterization pipeline information, and other internals not exposed to JavaScript.
