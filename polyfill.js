// Polyfill for Scroll Timing API (ESM)

// === Feature Detection ===
// Check if native implementation exists
const hasNativeImplementation = 'PerformanceScrollTiming' in window;

// If native implementation exists, skip polyfill initialization
if (!hasNativeImplementation) {
  // === Configuration Constants ===
  const CONFIG = {
    // Refresh rate measurement
    DEFAULT_REFRESH_RATE: 60,
    REFRESH_RATE_SAMPLES: 60,
    MIN_SAMPLES_FOR_CALCULATION: 10,
    FRAME_TIME_MIN_MS: 0,
    FRAME_TIME_MAX_MS: 100, // Sanity check: between 10fps and 1000fps

    // Scroll detection timing
    INPUT_HINT_TIMEOUT_MS: 250,
    SCROLL_END_TIMEOUT_MS: 150,
  };

  // Valid scroll source values for validation
  const VALID_SCROLL_SOURCES = new Set(['touch', 'wheel', 'keyboard', 'other', 'programmatic']);

  // Scroll keys for keyboard detection
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

  // === Module: Refresh Rate Measurement ===

  // Measure the display's actual refresh rate to avoid false jank detection.
  // This is critical because DevTools throttling or low-power modes can reduce
  // the effective refresh rate (e.g., to 32fps), and using a hardcoded 60fps
  // would incorrectly report dropped frames for perfectly smooth scrolling.
  let estimatedRefreshRate = CONFIG.DEFAULT_REFRESH_RATE;
  let measuringRefreshRate = false;

  /**
   * Measures the display refresh rate by sampling frame deltas over ~1 second.
   * Uses median frame time to avoid outliers from initial jank or GC pauses.
   */
  function measureRefreshRate() {
    if (measuringRefreshRate) return;
    measuringRefreshRate = true;

    const frameDeltaSamples = [];
    let lastTimestamp = null;
    let sampleCount = 0;

    function sample(timestamp) {
      if (lastTimestamp !== null) {
        const delta = timestamp - lastTimestamp;
        // Sanity check: only accept deltas between 10fps and 1000fps
        if (delta > CONFIG.FRAME_TIME_MIN_MS && delta < CONFIG.FRAME_TIME_MAX_MS) {
          frameDeltaSamples.push(delta);
        }
      }
      lastTimestamp = timestamp;
      sampleCount++;

      if (sampleCount < CONFIG.REFRESH_RATE_SAMPLES) {
        requestAnimationFrame(sample);
      } else {
        // Calculate median frame time to avoid outliers
        if (frameDeltaSamples.length >= CONFIG.MIN_SAMPLES_FOR_CALCULATION) {
          frameDeltaSamples.sort((a, b) => a - b);
          const median = frameDeltaSamples[Math.floor(frameDeltaSamples.length / 2)];
          estimatedRefreshRate = 1000 / median;
        }
        measuringRefreshRate = false;
      }
    }

    requestAnimationFrame(sample);
  }

  // Start measuring on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', measureRefreshRate);
  } else {
    measureRefreshRate();
  }

  // === Module: Input Source Detection ===

  // Input hints help determine the scroll source (wheel, touch, keyboard) because
  // scroll events themselves don't expose which input method triggered them.
  // We track hints per-scroller (inputHints WeakMap) and globally (lastInputHint)
  // to handle both element scrolls and cases where scroll events report incorrect targets.
  const inputHints = new WeakMap();
  let lastInputHint = null;

  /**
   * Records that a specific input type occurred on a scroll container.
   * This hint can be consumed within INPUT_HINT_TIMEOUT_MS to attribute scroll source.
   */
  function recordInputSourceHint(scroller, source) {
    if (!scroller) return;
    const time = performance.now();
    inputHints.set(scroller, { source, time });
    lastInputHint = { scroller, time };
  }

  /**
   * Returns the most recently hinted scroller if within the timeout window.
   * Used as a fallback when scroll events report the wrong target.
   */
  function getMostRecentHintedScroller() {
    if (!lastInputHint) return null;
    if (performance.now() - lastInputHint.time > CONFIG.INPUT_HINT_TIMEOUT_MS) {
      lastInputHint = null;
      return null;
    }
    return lastInputHint.scroller;
  }

  /**
   * Retrieves and clears the input hint for a specific scroller.
   * Returns null if no hint exists or if the hint has expired.
   */
  function getAndClearInputHint(scroller) {
    const hint = inputHints.get(scroller);
    if (!hint) return null;
    if (performance.now() - hint.time > CONFIG.INPUT_HINT_TIMEOUT_MS) {
      inputHints.delete(scroller);
      return null;
    }
    inputHints.delete(scroller);
    return hint;
  }

  // === Module: Scroll Target Detection ===

  /**
   * Returns the root scroller element (document.scrollingElement or documentElement).
   */
  function getRootScrollerElement() {
    return document.scrollingElement || document.documentElement;
  }

  /**
   * Normalizes various scroll target representations to a consistent Element reference.
   * Handles window, document, document nodes, text nodes, and special cases for body/documentElement.
   */
  function normalizeScrollTarget(rawTarget) {
    if (!rawTarget) return getRootScrollerElement();
    if (rawTarget === window || rawTarget === document) return getRootScrollerElement();

    // Document node
    if (rawTarget.nodeType === 9) return getRootScrollerElement();

    // Text node → use parent element
    if (rawTarget.nodeType === 3) return normalizeScrollTarget(rawTarget.parentElement);

    // Element
    if (rawTarget.nodeType === 1) {
      const element = rawTarget;
      if (element === document.documentElement || element === document.body) {
        return getRootScrollerElement();
      }
      return element;
    }

    return getRootScrollerElement();
  }

  /**
   * Checks if an element can scroll based on its overflow properties and content size.
   * The +1 in dimension checks accounts for fractional pixel rounding in some browsers.
   */
  function canElementScroll(element) {
    if (!element || element.nodeType !== 1) return false;

    // The root scroller is always considered potentially scrollable
    if (element === document.documentElement || element === document.body) return true;

    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;

    // Simplify complex conditionals by breaking into logical components
    const hasScrollableOverflowY = ['auto', 'scroll', 'overlay'].includes(overflowY);
    const hasScrollableOverflowX = ['auto', 'scroll', 'overlay'].includes(overflowX);
    const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1;
    const hasHorizontalOverflow = element.scrollWidth > element.clientWidth + 1;

    const canScrollY = hasScrollableOverflowY && hasVerticalOverflow;
    const canScrollX = hasScrollableOverflowX && hasHorizontalOverflow;

    return canScrollY || canScrollX;
  }

  /**
   * Finds the scrollable container for an input event by walking up the DOM tree.
   * Uses composedPath when available to properly handle shadow DOM.
   */
  function findScrollableFromEventTarget(event) {
    const composedPath = typeof event.composedPath === 'function' ? event.composedPath() : null;
    if (Array.isArray(composedPath)) {
      for (const node of composedPath) {
        if (node && node.nodeType === 1 && canElementScroll(node)) {
          return normalizeScrollTarget(node);
        }
      }
    }

    let element = event.target && event.target.nodeType === 1
      ? event.target
      : (event.target && event.target.parentElement);

    while (element) {
      if (canElementScroll(element)) return normalizeScrollTarget(element);
      element = element.parentElement;
    }

    return getRootScrollerElement();
  }

  // === Module: Scroll Tracking ===

  const scrollObservers = new Set();
  const activeScrolls = new WeakMap();

  /**
   * Tracks the state of an active scroll interaction, monitoring frame production,
   * scroll distance, and timing metrics until the scroll ends.
   */
  class ActiveScrollState {
    /**
     * @param {string} source - Scroll source: 'touch', 'wheel', 'keyboard', 'other', 'programmatic'
     * @param {Element} target - The scrolled element
     * @param {number} [inputTime] - Optional timestamp of the initiating input event
     */
    constructor(source, target, inputTime) {
      // Validate inputs
      if (source && !VALID_SCROLL_SOURCES.has(source)) {
        console.warn(`[ScrollTimingPolyfill] Invalid scroll source: ${source}, defaulting to 'other'`);
        source = 'other';
      }

      this.source = source;
      this.target = target;
      this.startTime = typeof inputTime === 'number' ? inputTime : performance.now();
      this.firstFrameTime = null;
      this.frameCount = 0;
      this.expectedFrames = 0;
      this.lastFrameTime = null;
      this.lastScrollEventTime = this.startTime;
      this.checkerboardTime = 0; // Always 0 in polyfill (cannot measure without browser internals)
      this.rafId = null;
      this.timeoutId = null;
      this.ended = false;
      this.lastScrollTop = target.scrollTop || 0;
      this.lastScrollLeft = target.scrollLeft || 0;
      this.cumulativeDistanceX = 0;
      this.cumulativeDistanceY = 0;
    }

    start() {
      this.trackFrames();
      this.scheduleEnd();
    }

    /**
     * Tracks frame production using requestAnimationFrame.
     * Calculates expected frames based on measured refresh rate and actual frame deltas.
     */
    trackFrames() {
      this.rafId = requestAnimationFrame((timestamp) => {
        if (this.ended) return;

        if (this.frameCount === 0) {
          // rAF's timestamp can represent the frame start time and may be slightly
          // earlier than performance.now() (different clocks). Use monotonic clamping
          // to ensure firstFrameTime is never before startTime.
          this.firstFrameTime = Math.max(performance.now(), this.startTime);
        }

        this.frameCount++;

        // Track expected frames using measured refresh rate, not assumed 60fps.
        // This delta-based approach accounts for actual time between frames.
        const targetFrameDuration = 1000 / estimatedRefreshRate;
        if (this.lastFrameTime === null) {
          this.expectedFrames += 1;
        } else {
          const frameDuration = timestamp - this.lastFrameTime;
          this.expectedFrames += Math.max(1, Math.round(frameDuration / targetFrameDuration));
        }

        this.lastFrameTime = timestamp;

        this.trackFrames();
      });
    }

    scheduleEnd() {
      clearTimeout(this.timeoutId);
      this.timeoutId = setTimeout(() => this.end(), CONFIG.SCROLL_END_TIMEOUT_MS);
    }

    /**
     * Called on each scroll event to update distance tracking and extend the scroll duration.
     */
    onScrollEvent() {
      this.lastScrollEventTime = performance.now();

      // Track cumulative scroll distance in X and Y separately
      const currentScrollTop = this.target.scrollTop || 0;
      const currentScrollLeft = this.target.scrollLeft || 0;
      const deltaY = currentScrollTop - this.lastScrollTop;
      const deltaX = currentScrollLeft - this.lastScrollLeft;

      this.cumulativeDistanceX += deltaX;
      this.cumulativeDistanceY += deltaY;
      this.lastScrollTop = currentScrollTop;
      this.lastScrollLeft = currentScrollLeft;

      this.scheduleEnd();
    }

    /**
     * Ends the scroll tracking, creates a PerformanceScrollTiming entry, and notifies observers.
     */
    end() {
      if (this.ended) return;
      this.ended = true;

      cancelAnimationFrame(this.rafId);
      clearTimeout(this.timeoutId);

      const endTime = performance.now();
      const firstFrameTime = this.firstFrameTime ?? this.startTime;
      const duration = endTime - this.startTime;

      const entry = new PerformanceScrollTimingPolyfill({
        startTime: this.startTime,
        firstFrameTime,
        duration,
        framesExpected: this.expectedFrames,
        framesProduced: this.frameCount,
        checkerboardTime: this.checkerboardTime,
        scrollSource: this.source,
        target: this.target,
        distanceX: this.cumulativeDistanceX,
        distanceY: this.cumulativeDistanceY
      });

      scrollObservers.forEach(observer => {
        observer.callback({ getEntries: () => [entry] });
      });

      activeScrolls.delete(this.target);
    }
  }

  /**
   * Handles scroll events and manages active scroll tracking state.
   */
  function onScrollEvent(event) {
    const rootScroller = getRootScrollerElement();
    let scroller = normalizeScrollTarget(event.target);

    // Some browsers can surface element scrolls with a document target when observed
    // from a document-level capture listener. If we recently saw wheel/touch over a
    // specific scroll container, prefer that as the target.
    if (scroller === rootScroller) {
      const candidate = getMostRecentHintedScroller();
      if (candidate && candidate !== rootScroller) {
        scroller = candidate;
      }
    }

    const hinted = getAndClearInputHint(scroller);
    const hintedSource = hinted?.source;
    const hintedTime = hinted?.time;
    let state = activeScrolls.get(scroller);

    if (!state) {
      state = new ActiveScrollState(hintedSource || 'other', scroller, hintedTime);
      activeScrolls.set(scroller, state);
      state.start();
      return;
    }

    // If we started with 'other' (undetermined) and got a fresh hint, upgrade the source.
    if (state.source === 'other' && hintedSource) {
      state.source = hintedSource;
    }
    state.onScrollEvent();
  }

  // === Module: Event Listeners ===

  // Detect scroll start/end for *any* scrollable element.
  // Note: 'scroll' doesn't bubble; using capture allows observing element scrolls.
  document.addEventListener('scroll', onScrollEvent, { passive: true, capture: true });

  document.addEventListener('wheel', (event) => {
    recordInputSourceHint(findScrollableFromEventTarget(event), 'wheel');
  }, { passive: true });

  document.addEventListener('touchstart', (event) => {
    recordInputSourceHint(findScrollableFromEventTarget(event), 'touch');
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    recordInputSourceHint(findScrollableFromEventTarget(event), 'touch');
  }, { passive: true });

  document.addEventListener('keydown', (event) => {
    // Heuristic: keys commonly used to scroll
    if (!SCROLL_KEYS.has(event.key)) return;

    // Prefer a focused scroll container if we can find one
    const active = document.activeElement;
    const pseudoEvent = { target: active, composedPath: () => [active] };
    recordInputSourceHint(findScrollableFromEventTarget(pseudoEvent), 'keyboard');
  }, { passive: true });

  // === Module: Performance Entry ===

  /**
   * Polyfill for the PerformanceScrollTiming API.
   * Provides performance metrics for scroll interactions including timing,
   * smoothness, frame production, and scroll distance.
   *
   * @class
   */
  class PerformanceScrollTimingPolyfill {
    /**
     * @param {Object} data - Scroll timing data
     * @param {DOMHighResTimeStamp} data.startTime - Timestamp of first input event that initiated scroll
     * @param {DOMHighResTimeStamp} data.firstFrameTime - Timestamp when first visual frame was presented
     * @param {DOMHighResTimeStamp} data.duration - Total scroll duration until scrolling stops
     * @param {number} data.framesExpected - Number of frames that should have rendered at target refresh rate
     * @param {number} data.framesProduced - Number of frames actually rendered during scroll
     * @param {number} data.checkerboardTime - Total duration (ms) unpainted areas were visible (always 0 in polyfill)
     * @param {string} data.scrollSource - Input method: 'touch', 'wheel', 'keyboard', 'other', 'programmatic'
     * @param {Element|null} data.target - The scrolled element
     * @param {number} data.distanceX - Horizontal scroll distance in pixels (positive=right, negative=left)
     * @param {number} data.distanceY - Vertical scroll distance in pixels (positive=down, negative=up)
     */
    constructor(data) {
      // Validate required numeric fields
      const numericFields = ['startTime', 'firstFrameTime', 'duration'];
      for (const field of numericFields) {
        if (typeof data[field] !== 'number' || data[field] < 0) {
          console.warn(`[ScrollTimingPolyfill] Invalid ${field}: ${data[field]}, defaulting to 0`);
          data[field] = Math.max(0, data[field] || 0);
        }
      }

      // Validate integer fields
      const integerFields = ['framesExpected', 'framesProduced'];
      for (const field of integerFields) {
        if (typeof data[field] !== 'number' || data[field] < 0 || !Number.isInteger(data[field])) {
          console.warn(`[ScrollTimingPolyfill] Invalid ${field}: ${data[field]}, defaulting to 0`);
          data[field] = Math.max(0, Math.floor(data[field] || 0));
        }
      }

      // Validate scroll source
      if (!VALID_SCROLL_SOURCES.has(data.scrollSource)) {
        console.warn(`[ScrollTimingPolyfill] Invalid scrollSource: ${data.scrollSource}, defaulting to 'other'`);
        data.scrollSource = 'other';
      }

      // Validate target (should be Element or null)
      if (data.target !== null && (!data.target || data.target.nodeType !== 1)) {
        console.warn(`[ScrollTimingPolyfill] Invalid target, setting to null`);
        data.target = null;
      }

      this.entryType = 'scroll';
      this.name = 'scroll';
      this.startTime = data.startTime;
      this.firstFrameTime = data.firstFrameTime;
      this.duration = data.duration;
      this.framesExpected = data.framesExpected;
      this.framesProduced = data.framesProduced;

      // Derived metric: scroll start latency (polyfill convenience, not in proposed spec)
      this.scrollStartLatency = Math.max(0, this.firstFrameTime - this.startTime);

      // Derived metric: smoothness score (polyfill convenience, not in proposed spec)
      this.smoothnessScore = data.framesExpected > 0
        ? data.framesProduced / data.framesExpected
        : 1;

      this.checkerboardTime = data.checkerboardTime;
      this.scrollSource = data.scrollSource;
      this.target = data.target;
      this.distanceX = data.distanceX || 0;
      this.distanceY = data.distanceY || 0;
    }

    /**
     * Returns a JSON representation of the scroll timing entry.
     * @returns {Object} JSON-serializable object with all entry properties
     */
    toJSON() {
      return {
        entryType: this.entryType,
        name: this.name,
        startTime: this.startTime,
        firstFrameTime: this.firstFrameTime,
        duration: this.duration,
        framesExpected: this.framesExpected,
        framesProduced: this.framesProduced,
        checkerboardTime: this.checkerboardTime,
        scrollSource: this.scrollSource,
        target: this.target,
        distanceX: this.distanceX,
        distanceY: this.distanceY
      };
    }
  }

  // === Module: PerformanceObserver Patching ===

  // Extend PerformanceObserver to intercept scroll entry type observations
  const OriginalPerformanceObserver = window.PerformanceObserver;

  window.PerformanceObserver = function(callback) {
    const observer = new OriginalPerformanceObserver(callback);
    const originalObserve = observer.observe.bind(observer);

    observer.observe = function(options) {
      if (options.type === 'scroll' || options.entryTypes?.includes('scroll')) {
        scrollObservers.add({ callback, options });
      }

      try {
        originalObserve(options);
      } catch (error) {
        // Only swallow errors for unsupported 'scroll' entry type
        const observingScroll = options && (options.type === 'scroll' || options.entryTypes?.includes('scroll'));
        if (!observingScroll) {
          // Unexpected error for non-scroll observation, rethrow
          throw error;
        }
        // Expected: 'scroll' type is not supported natively, polyfill handles it
      }
    };

    const originalDisconnect = observer.disconnect.bind(observer);
    observer.disconnect = function() {
      scrollObservers.forEach(obs => {
        if (obs.callback === callback) scrollObservers.delete(obs);
      });
      originalDisconnect();
    };

    return observer;
  };

  // === Module: Public API ===

  // Mark as polyfill for feature detection
  window.PerformanceScrollTiming = PerformanceScrollTimingPolyfill;
  window.PerformanceScrollTiming.__isPolyfill = true;
}

// === ESM Exports (must be at top level) ===

// Export the class - either native or polyfill
const PerformanceScrollTiming = window.PerformanceScrollTiming;

export { PerformanceScrollTiming };
export default PerformanceScrollTiming;
