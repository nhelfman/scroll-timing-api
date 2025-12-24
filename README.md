# scroll-timing-api
Proposal for a web performance API to help developers measure scroll performance.

Try out the API (polyfill) in action: [Demo Page](https://nhelfman.github.io/scroll-timing-api/demo.html)

# API Shape
The Scroll Timing API extends the Performance Observer pattern, consistent with other performance APIs like Long Tasks, Layout Instability, and Event Timing.

## `PerformanceScrollTiming` Interface

```java
interface PerformanceScrollTiming : PerformanceEntry {
  readonly attribute DOMHighResTimeStamp startTime;
  readonly attribute DOMHighResTimeStamp firstFrameTime;
  readonly attribute DOMHighResTimeStamp endTime;
  readonly attribute DOMHighResTimeStamp duration;
  readonly attribute unsigned long framesExpected;
  readonly attribute unsigned long framesProduced;
  readonly attribute unsigned long framesDropped;
  readonly attribute double checkerboardTime;
  readonly attribute double checkerboardArea;
  readonly attribute unsigned long scrollDistance;
  readonly attribute DOMString scrollSource; // "touch", "wheel", "keyboard", "other", "programmatic"
  readonly attribute Element? target;
};
```

## Usage with PerformanceObserver

```javascript
// Create an observer to capture scroll timing entries
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    // Derived metric.
    const scrollStartLatency = Math.max(0, entry.firstFrameTime - entry.startTime);

    // Not part of the native API shape; derived metric.
    const smoothnessScore = entry.framesExpected > 0
      ? entry.framesProduced / entry.framesExpected
      : 1;

    console.log('Scroll performance:', {
      startTime: entry.startTime,
      firstFrameTime: entry.firstFrameTime,
      scrollStartLatency,
      duration: entry.duration,
      smoothnessScore,
      droppedFrames: entry.framesDropped,
      checkerboardTime: entry.checkerboardTime,
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

# Scroll Performance
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
- **Total scroll duration**: Time from scroll start to scroll settle

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
- **Checkerboard area**: Percentage of viewport affected by incomplete painting
- **Checkerboard events**: Count of distinct checkerboarding occurrences

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
- **Scroll distance**: Total pixels scrolled during the interaction (`entry.scrollDistance`)
- **Scroll duration**: Time from scroll start to scroll end (`entry.duration`)
- **Average velocity**: `scrollDistance / duration` (pixels per millisecond, or multiply by 1000 for pixels per second)
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


# Polyfill
A demonstration polyfill is provided to illustrate the API usage patterns and enable experimentation before native browser support is available.

See [polyfill.js](polyfill.js) for the full implementation.

**Usage:**
```html
<script src="polyfill.js"></script>
```

**Note:** This polyfill uses heuristics-based approximations due to the lack of relevant native APIs required for accurate scroll performance measurement. It is intended for demonstration and prototyping purposes only. Metrics like checkerboarding detection and precise frame timing cannot be accurately measured without browser-level instrumentation. A native implementation would have access to compositor data, rendering pipeline information, and other internal metrics not exposed to JavaScript.

# Open Questions

## Refresh Rate Baseline for Frame Counting

**Question:** Should the API calculate expected frames based on a standardized baseline (e.g., 60fps) or use the device's actual refresh rate?

**Context:**
- The `framesExpected` and `framesProduced` metrics aim to quantify scroll smoothness
- Different approaches have different tradeoffs:

**Option A: Standardized 60fps baseline**
- **Pros:**
  - Consistent metrics across all devices and refresh rates
  - Easier to compare scroll performance between different hardware
  - Simpler mental model: "90% smoothness" means the same thing everywhere
  - Matches most existing performance tools and metrics
- **Cons:**
  - On high refresh rate displays (90Hz, 120Hz, 144Hz), smooth scrolling would appear to have "extra" frames and show >100% smoothness
  - On throttled environments (30fps, 32fps), even perfectly smooth scrolling would show low smoothness scores (~50%)
  - Doesn't reflect actual user experience on non-60Hz displays

**Option B: Device actual refresh rate**
- **Pros:**
  - Accurately reflects whether frames are being dropped relative to what the display can show
  - Better represents actual user experience on that specific device
  - Works correctly in throttled scenarios (DevTools open, background tabs, power saving)
- **Cons:**
  - Metrics not directly comparable across devices (90% on 60Hz ≠ 90% on 120Hz in absolute terms)
  - Adds complexity: developers need to know the refresh rate to interpret metrics
  - Different users on different hardware would report different "smoothness" for identical code

**Polyfill implementation:**
The current polyfill measures the actual refresh rate on page load using `requestAnimationFrame` sampling and uses that for frame expectations. This was necessary to avoid reporting false jank in throttled environments (where browsers run at ~32fps instead of 60fps).

**Recommendation needed:**
This decision affects the API design and should be resolved before standardization. Consider:
- Are these metrics primarily for RUM (real user monitoring) where actual experience matters?
- Or for lab testing where cross-device comparison is critical?
- Should there be separate metrics for both approaches?
- Could `framesExpected` include the target refresh rate as context?

### Related Concern: Dynamic Refresh Rates

In addition to choosing between a standardized baseline or device refresh rate, there's a related consideration: **refresh rates are not static throughout a page's lifetime**.

**Variable Refresh Rate (VRR) displays:**
- Technologies like Adaptive Sync, FreeSync, and G-Sync allow displays to dynamically adjust refresh rates (typically 48-240Hz)
- Refresh rate varies based on content, power state, GPU load, and application demands
- Increasingly common in gaming laptops, high-end monitors, and mobile devices

**Dynamic browser throttling:**
- Opening/closing DevTools often changes rendering rate (e.g., 60fps → 32fps)
- Tab backgrounding reduces to ~1fps or lower
- Battery saver modes and power state changes affect rendering pipeline timing
- Performance settings can be changed by users mid-session

**Impact on API design:**

If the API uses Option B (device actual refresh rate), how should it handle changes mid-session?
- Should each `PerformanceScrollTiming` entry snapshot the refresh rate at scroll start?
- Should browsers continuously track refresh rate changes during a scroll interaction?
- If a fixed baseline is measured once, it becomes stale when throttling changes (leading to incorrect `framesExpected` and false jank reports)

Alternatively, does this complexity make Option A (standardized 60fps baseline) more attractive, since it avoids the dynamic measurement problem entirely?

**Considerations for implementation:**
- Native browser implementations have direct access to compositor and display information, making refresh rate tracking more feasible than JavaScript-based measurement
- However, the API specification should still be explicit about whether and when refresh rate is determined
- This concern may influence whether Option A or Option B is ultimately chosen

## Smoothness Scoring Options

**Philosophy:** This API intentionally provides raw frame metrics (`framesExpected`, `framesProduced`, `framesDropped`) rather than a single "smoothness score." Different use cases may require different calculation methods, and prescribing a specific formula could limit flexibility or become outdated as best practices evolve.

### Available Metrics for Smoothness Calculation

The API provides these building blocks:
- `framesExpected`: Frames that should have rendered at the target refresh rate
- `framesProduced`: Frames actually rendered
- `framesDropped`: Frames skipped (`framesExpected - framesProduced`)
- `duration`: Total scroll duration in milliseconds

### Calculation Options

#### Option 1: Simple Ratio (Frame Throughput)

**Formula:** `smoothness = framesProduced / framesExpected`

- **Pros:** Simple, intuitive, easy to explain
- **Cons:** Treats all dropped frames equally regardless of when they occur; doesn't capture variance in frame timing

**Example:**
```javascript
const smoothness = entry.framesProduced / entry.framesExpected;
// 54 frames produced out of 60 expected = 90% smoothness
```

#### Option 2: Harmonic Mean of Frame Rates

**Formula:** `smoothness = n / (Σ(1/fps_i))` where `fps_i` is instantaneous FPS per frame

The harmonic mean weights lower frame rates more heavily, better reflecting perceived smoothness. A single slow frame has a disproportionate impact on the final score.

- **Pros:** Better reflects perceived smoothness; low frame rates impact the score more (matching human perception)
- **Cons:** Requires per-frame timing data; more complex to compute

**Example:**
```javascript
// If you have individual frame times [16ms, 16ms, 50ms, 16ms]
// Frame rates: [62.5, 62.5, 20, 62.5]
// Arithmetic mean: 51.9 FPS
// Harmonic mean: 4 / (1/62.5 + 1/62.5 + 1/20 + 1/62.5) = 37.0 FPS
// The harmonic mean better reflects the impact of that one slow frame
```

#### Option 3: RMS (Root Mean Square) of Frame Times

**Formula:** `rms = √(Σ(frameTime_i²) / n)`

RMS penalizes longer frames quadratically, making outlier frames (jank) more impactful in the final metric.

- **Pros:** Properly penalizes long frames; mathematically simpler than percentile-based metrics; has a clear definition
- **Cons:** Requires per-frame timing data; result is in milliseconds (needs comparison to target frame time)

**Example:**
```javascript
// Frame times: [16ms, 16ms, 50ms, 16ms]
// Arithmetic mean: 24.5ms
// RMS: √((16² + 16² + 50² + 16²) / 4) = √(3268/4) = 28.6ms
// Can derive smoothness: targetFrameTime / rms = 16 / 28.6 = 56%
```

### Open Question: Should the API Provide Pre-Calculated Smoothness?

**Question:** Should `PerformanceScrollTiming` include a `smoothnessScore` property, or only expose raw metrics for developers to calculate their own?

**Option A: Raw metrics only**
- **Pros:**
  - Developers choose the calculation method appropriate for their use case
  - API remains flexible as best practices evolve
  - Avoids debates about which formula is "correct"
  - Smaller API surface
- **Cons:**
  - More work for developers; may lead to inconsistent implementations
  - Harder to compare metrics across different sites/tools

**Option B: Provide a default smoothness score**
- **Pros:**
  - Consistent metric across the ecosystem
  - Easier adoption; works out of the box
  - Can be optimized by browsers using internal data (compositor timing, vsync alignment)
- **Cons:**
  - Locks the API to a specific calculation method
  - May not suit all use cases
  - Harder to change once standardized

**Option C: Provide both raw metrics and a standardized score**
- **Pros:**
  - Best of both worlds: consistency for simple use cases, flexibility for advanced users
  - Allows ecosystem to converge on standardized score while enabling research
- **Cons:**
  - Larger API surface
  - May cause confusion about which to use

**Additional consideration:** If providing a pre-calculated score, should the API expose which calculation method was used, or allow developers to request a specific method (e.g., `{ smoothnessMethod: 'rms' }`)?

### References

- [Chrome Graphics Metrics Definitions](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/speed/graphics_metrics_definitions.md)
- [Towards an Animation Smoothness Metric (web.dev)](https://web.dev/articles/smoothness)
- [Chrome Rendering Benchmarks](https://www.chromium.org/developers/design-documents/rendering-benchmarks/)