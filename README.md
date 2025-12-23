# scroll-timing-api
Proposal for a performance API to help developers measure scroll performance.

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

# API Shape
The Scroll Timing API extends the Performance Observer pattern, consistent with other performance APIs like Long Tasks, Layout Instability, and Event Timing.

## PerformanceScrollTiming Interface

```webidl
interface PerformanceScrollTiming : PerformanceEntry {
  readonly attribute DOMHighResTimeStamp startTime;
  readonly attribute DOMHighResTimeStamp endTime;
  readonly attribute DOMHighResTimeStamp duration;
  readonly attribute unsigned long framesExpected;
  readonly attribute unsigned long framesProduced;
  readonly attribute unsigned long framesDropped;
  readonly attribute double smoothnessScore;
  readonly attribute double checkerboardTime;
  readonly attribute double checkerboardArea;
  readonly attribute DOMString scrollSource; // "touch", "wheel", "keyboard", "programmatic"
  readonly attribute Element? target;
};
```

## Usage with PerformanceObserver

```javascript
// Create an observer to capture scroll timing entries
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log('Scroll performance:', {
      startTime: entry.startTime,
      duration: entry.duration,
      smoothness: entry.smoothnessScore,
      droppedFrames: entry.framesDropped,
      checkerboardTime: entry.checkerboardTime,
      source: entry.scrollSource,
      target: entry.target
    });
    
    // Report to analytics
    if (entry.smoothnessScore < 0.9) {
      reportScrollJank(entry);
    }
  }
});

// Start observing scroll timing entries
observer.observe({ type: 'scroll', buffered: true });
```

# Polyfill
A polyfill implementation is provided to demonstrate the API usage patterns and enable experimentation before native browser support is available.

See [polyfill.js](polyfill.js) for the full implementation.

**Usage:**
```html
<script src="polyfill.js"></script>
```

This polyfill provides a basic implementation demonstrating the API usage patterns. Note that a production polyfill would need additional work to accurately measure checkerboarding and handle edge cases across different browsers and input methods.