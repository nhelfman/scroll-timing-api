# scroll-timing-api
Proposal for a web performance API to help developers measure scroll performance.

Try out the API (polyfill) in action: [Demo Page](https://nhelfman.github.io/scroll-timing-api/demo.html)

# API Shape
The Scroll Timing API extends the Performance Observer pattern, consistent with other performance APIs like Long Tasks, Layout Instability, and Event Timing.

## `PerformanceScrollTiming` Interface

```java
interface PerformanceScrollTiming : PerformanceEntry {
  // Inherited from PerformanceEntry
  readonly attribute DOMString entryType;  // Always "scroll"
  readonly attribute DOMString name;       // Empty string

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
  readonly attribute DOMString scrollSource;
  readonly attribute Node? target;
};
```

### Attribute Reference

| Attribute | Type | Description |
|-----------|------|-------------|
| `entryType` | DOMString | Always `"scroll"` (inherited from PerformanceEntry) |
| `name` | DOMString | Empty string (inherited from PerformanceEntry) |
| `startTime` | DOMHighResTimeStamp | Timestamp of the first input event that initiated the scroll |
| `firstFrameTime` | DOMHighResTimeStamp | Timestamp when the first visual frame reflecting the scroll was presented |
| `duration` | DOMHighResTimeStamp | Total scroll duration from `startTime` until scrolling stops (includes momentum/inertia) |
| `framesExpected` | unsigned long | Number of frames that should have rendered at the target refresh rate |
| `framesProduced` | unsigned long | Number of frames actually rendered during the scroll |
| `framesDropped` | unsigned long | Number of frames skipped or missed (`framesExpected - framesProduced`) |
| `checkerboardTime` | double | Total duration (ms) that unpainted areas were visible during scroll |
| `checkerboardAreaMax` | double | Peak percentage of viewport affected by incomplete painting |
| `distanceX` | long | Horizontal scroll distance in pixels (positive = right, negative = left) |
| `distanceY` | long | Vertical scroll distance in pixels (positive = down, negative = up) |
| `scrollSource` | DOMString | Input method: `"touch"`, `"wheel"`, `"keyboard"`, `"other"`, or `"programmatic"` |
| `target` | Node? | The scrolled node, or `null` if disconnected/in shadow DOM (consistent with Event Timing API) |

**Possible derived metrics** (not part of the interface, can be calculated from attributes):
- **Scroll start latency**: `firstFrameTime - startTime` — responsiveness of scroll initiation
- **Smoothness score**: `framesProduced / framesExpected` — frame delivery consistency (1.0 = perfect)
- **Total distance**: `√(distanceX² + distanceY²)` — Euclidean scroll distance
- **Scroll velocity**: `totalDistance / duration * 1000` — scroll speed in pixels per second

## Example Usage with PerformanceObserver

```javascript
// Create an observer to capture scroll timing entries
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const scrollStartLatency = Math.max(0, entry.firstFrameTime - entry.startTime);
    const smoothnessScore = entry.framesExpected > 0
      ? entry.framesProduced / entry.framesExpected
      : 1;

    // Calculate total distance and velocity from X/Y components
    const totalDistance = Math.sqrt(entry.distanceX ** 2 + entry.distanceY ** 2);
    const scrollVelocity = entry.duration > 0 ? (totalDistance / entry.duration) * 1000 : 0;

    console.log('Scroll performance:', {
      startTime: entry.startTime,
      firstFrameTime: entry.firstFrameTime,
      scrollStartLatency,
      duration: entry.duration,
      smoothnessScore,
      droppedFrames: entry.framesDropped,
      checkerboardTime: entry.checkerboardTime,
      distanceX: entry.distanceX,
      distanceY: entry.distanceY,
      totalDistance,
      scrollVelocity,
      source: entry.scrollSource,
      target: entry.target
    });

    // Report to analytics
    if (smoothnessScore < 0.9) {
      reportScrollJank(entry);
    }
  }
});

// Start observing scroll timing entries
observer.observe({ type: 'scroll', buffered: true });
```

# Motivation
Scroll is a very common user interaction in many web apps used for navigating content outside the available viewport or container.

Measuring scroll performance is critical because:

1. **User Experience Impact**: Scroll jank and stuttering are immediately perceptible to users and significantly degrade the browsing experience. Smooth, responsive scrolling is associated with higher perceived quality and user engagement.

2. **Lack of Standardized Metrics**: Currently, developers rely on ad-hoc solutions like `requestAnimationFrame` loops or `IntersectionObserver` hacks to approximate scroll performance, leading to inconsistent measurements across sites and tools.

3. **Real User Monitoring (RUM)**: A standard API enables collecting scroll performance data from real users in production, allowing developers to identify performance issues that may not appear in lab testing.

4. **Correlation with Business Metrics**: Poor scroll performance can correlate with reduced user engagement and lower time-on-page, and may impact conversion rates, especially on content-heavy sites (typically validated via RUM analysis and/or A/B tests).

5. **Framework and Library Support**: A standardized API allows UI frameworks, virtual scrolling libraries, and performance monitoring tools to provide consistent scroll performance insights.

# Design Notes
Scroll performance encompasses several measurable aspects that together determine the quality of the scrolling experience:

- **Responsiveness**: How quickly the page responds when a user initiates a scroll gesture
- **Smoothness**: Whether frames are rendered consistently at the target frame rate during scrolling
- **Visual Completeness**: Whether content is fully painted when it scrolls into view
- **Stability**: Whether the scroll position remains predictable without unexpected jumps

## Scroll Start Time
Scroll start time measures the latency between the user's scroll input and the first visual update on screen.

**Key metrics:**
- **Input timestamp**: When the scroll gesture was detected (touch, wheel, or keyboard event)
- **First frame timestamp**: When the first frame reflecting the scroll was presented
- **Scroll start latency**: The delta between input and first frame presentation

In this proposal:
- `entry.startTime` is the **input timestamp** (the first input in the scroll sequence).
- `entry.firstFrameTime` is the **first frame timestamp**.
- `scrollStartLatency` can be derived as `entry.firstFrameTime - entry.startTime`.

**Why it matters:**
High scroll start latency makes the page feel unresponsive. Users expect immediate visual feedback when they initiate a scroll gesture. Latency greater than 100ms is generally perceptible and negatively impacts user experience.

**Common causes of high scroll start latency:**
- Long-running JavaScript blocking the main thread
- Expensive style recalculations or layout operations
- Compositor thread contention
- Touch event handlers without `{ passive: true }`

## Scroll End Time
Scroll end time captures when a scroll interaction completes and the viewport settles at its final position.

**Key metrics:**
- **Last input timestamp**: The final scroll input event in a scroll sequence
- **Settle timestamp**: When momentum/inertia scrolling completes and the viewport is stable
- **Total scroll duration**: Time from scroll start until scrolling stops (includes momentum/inertia)

**Why it matters:**
Understanding scroll end time is essential for:
- Measuring total scroll interaction duration
- Triggering deferred work (lazy loading, analytics) at the right moment
- Calculating overall scroll responsiveness metrics

**Considerations:**
- Momentum scrolling on touch devices extends scroll duration beyond the last touch input
- Programmatic smooth scrolling has predictable end times
- Scroll snapping may adjust the final position after user input ends

## Scroll Smoothness
Scroll smoothness measures how consistently frames are rendered during a scroll animation, reflecting visual fluidity.

**Key metrics:**
- **Frames expected**: Number of frames that should have been rendered at the target refresh rate
- **Frames produced**: Number of frames actually rendered
- **Dropped frame count**: Frames that were skipped or missed their deadline
- **Average frame duration**: Mean time between presented frames
- **Frame duration variance**: Consistency of frame timing (lower is smoother)
- **Smoothness percentage**: `(frames_produced / frames_expected) * 100`

**Why it matters:**
Even if scroll starts quickly, dropped frames during scrolling create visible jank. Users perceive scroll smoothness as a key quality indicator. A smoothness score below 90% is typically noticeable, and below 60% is considered poor.

**Common causes of scroll jank:**
- Expensive paint operations (large areas, complex effects)
- Layout thrashing during scroll event handlers
- Non-composited animations
- Image decoding on the main thread
- Garbage collection pauses

## Scroll Checkerboarding
Scroll checkerboarding occurs when content is not ready to be displayed as it scrolls into the viewport, resulting in blank or placeholder areas.

**Key metrics:**
- **Checkerboard time**: Total duration that unpainted areas were visible during scroll
- **Checkerboard area max**: Maximum percentage of viewport affected by incomplete painting at any point during the scroll
- **Checkerboard events**: Count of distinct checkerboarding occurrences

### Checkerboard Area Calculation

The `checkerboardAreaMax` attribute reports the **peak/maximum area** that was checkerboarded during the scroll interaction. This represents the worst-case user experience moment.

**Why maximum rather than average?**
- Shows the most severe user-visible issue, even if brief
- Simple to track and understand: "at worst, X% was checkerboarded"
- Useful for alerting on critical rendering failures
- Developers can set thresholds: "if > 50% checkerboarding occurs, investigate"

**Example scenario:**
During a 500ms scroll, if checkerboarding occurs across multiple frames:
- Frame 6: 15% of viewport checkerboarded
- Frame 7: 40% of viewport checkerboarded
- Frame 8: 60% of viewport checkerboarded (worst moment)
- Frame 9: 25% of viewport checkerboarded
- Frame 10: 10% of viewport checkerboarded

Then `checkerboardAreaMax` would report `60` (the peak severity), while `checkerboardTime` would report the cumulative duration across all affected frames.

**Note:** See the Open Questions section for discussion of alternative aggregation methods, including time-weighted averaging.

**Why it matters:**
Checkerboarding breaks the illusion of scrolling through continuous content. It's particularly problematic for:
- Image-heavy pages where images load as they scroll into view
- Infinite scroll implementations
- Complex layouts with off-screen content
- Pages with web fonts that haven't loaded

**Common causes:**
- Slow network preventing timely resource loading
- Insufficient tile/layer rasterization ahead of scroll
- Large images without proper sizing hints
- Lazy loading triggered too late

## Scroll Velocity
Scroll velocity measures the speed at which a user navigates through content, calculated as the distance scrolled divided by the duration of the scroll interaction.

**Key metrics:**
- **Scroll distance components**: Horizontal and vertical scroll distances (`entry.distanceX`, `entry.distanceY`)
- **Total scroll distance**: Euclidean distance combining both axes: `√(distanceX² + distanceY²)`
- **Scroll duration**: Time from scroll start to scroll end (`entry.duration`)
- **Average velocity**: `totalDistance / duration` (pixels per millisecond, or multiply by 1000 for pixels per second)
- **Directional velocity**: Calculate velocity separately for X and Y axes to understand scroll direction and bias
- **Peak velocity**: Maximum instantaneous scroll speed (requires sampling during interaction)

**Why it matters:**
Understanding scroll velocity is essential for performance optimization because different scroll speeds reveal different performance characteristics. Since PerformanceObserver reports entries asynchronously after scroll completion, velocity data is primarily used for telemetry, diagnostics, and informing optimization decisions rather than real-time adaptation.

1. **Performance Issue Diagnosis**: Jank often correlates with scroll velocity. Telemetry may show that a page performs smoothly at low speeds but exhibits dropped frames at high velocities due to:
   - Insufficient rasterization ahead of the scroll direction
   - Paint operations that can't keep up with scroll speed
   - Layout recalculations triggered by scroll position-dependent logic

   By analyzing velocity alongside smoothness metrics in RUM data, developers can identify velocity thresholds where performance degrades and optimize accordingly.

2. **User Intent Inference**: Scroll velocity provides context for interpreting other performance metrics:
   - High velocity + high smoothness = well-optimized scrolling at scale
   - High velocity + low smoothness = performance bottleneck under stress
   - Low velocity + low smoothness = fundamental rendering issues even for gentle scrolling
   - Very high velocity = user skimming or navigating, may not be engaging deeply with content

   This helps prioritize which performance issues to address based on actual user behavior patterns.

3. **Interaction Quality Scoring**: For metrics aggregation and percentile analysis, weighting by velocity helps identify the most impactful performance issues. A jank during a fast 5000px scroll (user actively navigating) may have different implications than jank during a tiny 50px adjustment. Velocity data allows developers to segment and analyze performance by scroll intensity.

4. **Optimization Strategy Validation**: By collecting velocity-stratified performance data, developers can:
   - Validate whether optimizations improve performance across all velocity ranges
   - Identify if certain architectural decisions (lazy loading strategies, virtualization approaches, paint complexity) work well for typical scroll speeds but fail at extremes
   - Make informed tradeoffs (e.g., "our current implementation handles 95% of scroll velocities smoothly")

5. **Benchmarking and Regression Detection**: Velocity provides a standardized dimension for performance testing. Developers can establish performance baselines across velocity buckets (slow: <1000 px/s, medium: 1000-3000 px/s, fast: >3000 px/s) and detect regressions when new code degrades smoothness at specific velocity ranges.

**Common velocity-related patterns:**
- **Fling scrolls**: Touch flings on mobile often produce high initial velocity that decays over time (momentum scrolling)
- **Keyboard/wheel scrolls**: Usually lower, more consistent velocity with discrete steps
- **Programmatic scrolls**: Smooth scroll behavior produces predictable, constant velocity
- **Search navigation**: Users jumping to search results often produce short-duration, high-velocity scrolls

## Scroll Interruption and Cancellation

Scroll interactions can be interrupted or cancelled mid-stream. This section defines how `PerformanceScrollTiming` entries behave in these scenarios.

**Scenarios:**

1. **Touch lift during momentum**: User initiates a touch fling, then lifts finger. Momentum scrolling continues until friction stops it or the user touches again.
   - The entry covers the entire interaction including momentum phase
   - `duration` extends until scrolling stops (not when the finger lifts)

2. **Programmatic interruption**: A `scrollTo()` or `scrollIntoView()` call interrupts an ongoing user scroll.
   - The user-initiated scroll entry ends at the interruption point
   - A separate entry with `scrollSource: "programmatic"` may be emitted for the programmatic scroll

3. **Input source switch**: User starts scrolling with touch, then uses mouse wheel mid-scroll.
   - The original entry ends when the new input source is detected
   - A new entry begins for the new input source
   - `scrollSource` reflects the initiating input for each entry

4. **Scroll snap adjustment**: After user input ends, CSS scroll snapping moves the viewport to a snap point.
   - Snap adjustment is considered part of the same scroll interaction
   - `duration` includes the snap animation time

5. **Boundary collision**: Scroll reaches container bounds and cannot continue.
   - Entry ends naturally when scrolling stops at the boundary
   - Overscroll/bounce effects (on supported platforms) are included in `duration`

**Entry emission timing:**
Entries are emitted after the scroll interaction fully completes (including momentum, snap, and settle phases). Interrupted scrolls emit entries at the interruption point with metrics reflecting the partial interaction.

## Edge Cases

This section documents expected behavior for boundary conditions and unusual scenarios.

**Very short scrolls (`framesExpected` = 0):**
- If a scroll interaction completes within a single frame, `framesExpected` may be 0 or 1
- Implementations should avoid division-by-zero when calculating smoothness: treat `framesExpected = 0` as 100% smooth
- Short scrolls are still valid entries and should be emitted

**Zero scroll distance:**
- User attempts to scroll at a boundary (already at top/bottom)
- `distanceX` and `distanceY` are both 0
- Entry is still emitted (the interaction occurred, even if no visual change resulted)
- Useful for detecting "frustrated scrolling" at boundaries

**Overscroll and bounce effects:**
- On platforms with overscroll (iOS rubber-banding, Android overscroll glow):
  - `distanceX`/`distanceY` reflect the actual scroll position change, not the visual overscroll
  - `duration` includes the bounce-back animation time
  - Overscroll does not count as checkerboarding

**Scroll-linked animations:**
- If the page uses `scroll-timeline` or JavaScript scroll-linked animations:
  - Performance of those animations is not directly captured by this API
  - Frame metrics reflect the scroll's visual update, not dependent animations
  - Consider using separate performance instrumentation for scroll-linked effects

**Rapid repeated scrolls:**
- Quick successive scroll gestures (e.g., rapid wheel clicks) may:
  - Merge into a single entry if within the scroll-end detection window
  - Emit separate entries if separated by sufficient idle time
- Implementation defines the debounce/merge behavior

**Disabled scrolling:**
- If `overflow: hidden` prevents scrolling, no entry is emitted (no scroll occurred)
- If JavaScript prevents default on scroll events, behavior is implementation-defined

# Privacy and Security Considerations

Performance APIs can expose information that may be used for fingerprinting or side-channel attacks. This section outlines the privacy and security implications of the Scroll Timing API.

## Fingerprinting Concerns

**Display refresh rate inference:**
The `framesExpected` metric, combined with `duration`, can reveal the device's display refresh rate. For example:
- `framesExpected: 60` over `duration: 1000ms` suggests a 60Hz display
- `framesExpected: 120` over `duration: 1000ms` suggests a 120Hz display

This adds a fingerprinting vector, though display refresh rate is already inferrable via `requestAnimationFrame` timing.

**Hardware performance profiling:**
Frame production patterns (`framesProduced`, `framesDropped`) may reveal information about device GPU capabilities, thermal state, or background load, potentially contributing to device fingerprinting.

**Scroll behavior patterns:**
Aggregated scroll metrics (velocity, distance, source) could theoretically be used to profile user behavior patterns, though this requires persistent observation across sessions.

## Timing Attack Considerations

**High-resolution timestamps:**
The API uses `DOMHighResTimeStamp` for `startTime`, `firstFrameTime`, and `duration`. These are subject to the same timing mitigations applied to other Performance APIs (reduced precision, cross-origin isolation requirements).

**Scroll start latency:**
The `firstFrameTime - startTime` delta could potentially reveal main thread blocking time, which might leak information about JavaScript execution in certain contexts.

## Cross-Origin Considerations

**Nested iframes:**
When scrolling occurs in a cross-origin iframe, the parent document should not receive `PerformanceScrollTiming` entries for that scroll. Each origin observes only its own scroll interactions.

**`target` attribute:**
The `target` attribute returns an `Element` reference. For cross-origin iframes, this would be `null` or restricted to prevent leaking DOM references across origins.

## Mitigations

Implementations should consider:
- Applying timestamp precision reduction consistent with other Performance APIs
- Respecting cross-origin isolation boundaries
- Potentially gating detailed metrics behind permissions or secure contexts
- Following existing precedents from Event Timing, Long Tasks, and Layout Instability APIs

# Polyfill
A demonstration polyfill is provided to illustrate the API usage patterns and enable experimentation before native browser support is available.

See [polyfill.js](polyfill.js) for the full implementation.

**Usage:**
```html
<script src="polyfill.js"></script>
```

**Note:** This polyfill uses heuristics-based approximations due to the lack of relevant native APIs required for accurate scroll performance measurement. It is intended for demonstration and prototyping purposes only. Metrics like checkerboarding detection and precise frame timing cannot be accurately measured without browser-level instrumentation. A native implementation would have access to compositor data, rendering pipeline information, and other internal metrics not exposed to JavaScript.

# Open Questions

For detailed discussion of these design decisions, see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).

## Refresh Rate Baseline for Frame Counting
Should `framesExpected` use a standardized 60fps baseline (consistent across devices) or the device's actual refresh rate (accurate to user experience)? This also raises concerns about dynamic refresh rates (VRR displays, browser throttling).

## Smoothness Scoring Options
Should the API provide a pre-calculated `smoothnessScore`, or only raw frame metrics for developers to calculate their own? Options include simple ratio, harmonic mean, or RMS-based calculations.

## Checkerboard Area Aggregation
Should the API expose only `checkerboardAreaMax` (peak severity), or also provide `checkerboardAreaAvg` (time-weighted average)?

## Scrollbar as a Distinct Scroll Source
Should `"scrollbar"` be added as a distinct `scrollSource` value? This raises privacy concerns as no existing web API exposes scrollbar interaction.

## References

- [Chrome Graphics Metrics Definitions](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/speed/graphics_metrics_definitions.md)
- [Towards an Animation Smoothness Metric (web.dev)](https://web.dev/articles/smoothness)
- [Chrome Rendering Benchmarks](https://www.chromium.org/developers/design-documents/rendering-benchmarks/)