// Polyfill for Scroll Timing API
(function() {
  if ('PerformanceScrollTiming' in window) return;

  const scrollObservers = new Set();
  const activeScrolls = new WeakMap();
  const inputHints = new WeakMap();
  let lastInputHint = null;

  // Measure display refresh rate
  let estimatedRefreshRate = 60; // Default fallback
  let measuringRefreshRate = false;

  function measureRefreshRate() {
    if (measuringRefreshRate) return;
    measuringRefreshRate = true;

    const samples = [];
    let lastTimestamp = null;
    let sampleCount = 0;
    const maxSamples = 60; // Sample for ~1 second

    function sample(timestamp) {
      if (lastTimestamp !== null) {
        const delta = timestamp - lastTimestamp;
        if (delta > 0 && delta < 100) { // Sanity check: between 10fps and 1000fps
          samples.push(delta);
        }
      }
      lastTimestamp = timestamp;
      sampleCount++;

      if (sampleCount < maxSamples) {
        requestAnimationFrame(sample);
      } else {
        // Calculate median frame time to avoid outliers
        if (samples.length > 10) {
          samples.sort((a, b) => a - b);
          const median = samples[Math.floor(samples.length / 2)];
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

  class PerformanceScrollTimingPolyfill {
    constructor(data) {
      this.entryType = 'scroll';
      this.name = 'scroll';
      this.startTime = data.startTime;
      this.firstFrameTime = data.firstFrameTime;
      this.duration = data.duration;
      this.framesExpected = data.framesExpected;
      this.framesProduced = data.framesProduced;
      this.framesDropped = data.framesExpected - data.framesProduced;
      this.scrollStartLatency = Math.max(0, this.firstFrameTime - this.startTime);
      this.smoothnessScore = data.framesExpected > 0
        ? data.framesProduced / data.framesExpected
        : 1;
      this.checkerboardTime = data.checkerboardTime;
      this.scrollSource = data.scrollSource;
      this.target = data.target;
      this.distanceX = data.distanceX || 0;
      this.distanceY = data.distanceY || 0;
    }

    toJSON() {
      return {
        entryType: this.entryType,
        name: this.name,
        startTime: this.startTime,
        firstFrameTime: this.firstFrameTime,
        duration: this.duration,
        framesExpected: this.framesExpected,
        framesProduced: this.framesProduced,
        framesDropped: this.framesDropped,
        checkerboardTime: this.checkerboardTime,
        scrollSource: this.scrollSource,
        target: this.target,
        distanceX: this.distanceX,
        distanceY: this.distanceY
      };
    }
  }

  function getRootScrollerElement() {
    return document.scrollingElement || document.documentElement;
  }

  function normalizeScrollTarget(rawTarget) {
    if (!rawTarget) return getRootScrollerElement();
    if (rawTarget === window || rawTarget === document) return getRootScrollerElement();

    // Document node
    if (rawTarget.nodeType === 9) return getRootScrollerElement();

    // Text node → use parent element
    if (rawTarget.nodeType === 3) return normalizeScrollTarget(rawTarget.parentElement);

    // Element
    if (rawTarget.nodeType === 1) {
      const el = rawTarget;
      if (el === document.documentElement || el === document.body) return getRootScrollerElement();
      return el;
    }

    return getRootScrollerElement();
  }

  function isPotentiallyScrollable(el) {
    if (!el || el.nodeType !== 1) return false;

    // Avoid treating the root scroller incorrectly.
    if (el === document.documentElement || el === document.body) return true;

    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const canScrollY = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && (el.scrollHeight > el.clientHeight + 1);
    const canScrollX = (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') && (el.scrollWidth > el.clientWidth + 1);
    return canScrollY || canScrollX;
  }

  function findScrollableFromEventTarget(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
    if (Array.isArray(path)) {
      for (const node of path) {
        if (node && node.nodeType === 1 && isPotentiallyScrollable(node)) {
          return normalizeScrollTarget(node);
        }
      }
    }

    let el = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
    while (el) {
      if (isPotentiallyScrollable(el)) return normalizeScrollTarget(el);
      el = el.parentElement;
    }

    return getRootScrollerElement();
  }

  function hintInputSource(scroller, source) {
    if (!scroller) return;
    const time = performance.now();
    inputHints.set(scroller, { source, time });
    lastInputHint = { scroller, time };
  }

  function getRecentInputScrollerCandidate() {
    if (!lastInputHint) return null;
    if (performance.now() - lastInputHint.time > 250) {
      lastInputHint = null;
      return null;
    }
    return lastInputHint.scroller;
  }

  function consumeRecentInputHint(scroller) {
    const hint = inputHints.get(scroller);
    if (!hint) return null;
    if (performance.now() - hint.time > 250) {
      inputHints.delete(scroller);
      return null;
    }
    inputHints.delete(scroller);
    return hint;
  }

  class ActiveScrollState {
    constructor(source, target, inputTime) {
      this.source = source;
      this.target = target;
      this.startTime = typeof inputTime === 'number' ? inputTime : performance.now();
      this.firstFrameTime = null;
      this.frameCount = 0;
      this.expectedFrames = 0;
      this.lastFrameTime = null;
      this.lastScrollEventTime = this.startTime;
      this.checkerboardTime = 0;
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

    trackFrames() {
      this.rafId = requestAnimationFrame((timestamp) => {
        if (this.ended) return;

        if (this.frameCount === 0) {
          // rAF's `timestamp` can represent the frame start time and may be slightly
          // earlier than `performance.now()` (and thus earlier than the input event).
          // Use a monotonic "now" from the same clock, clamped to be >= startTime.
          this.firstFrameTime = Math.max(performance.now(), this.startTime);
        }

        this.frameCount++;

        // Track expected frames using measured refresh rate, not assumed 60fps
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
      this.timeoutId = setTimeout(() => this.end(), 150);
    }

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

  function onScrollEvent(e) {
    const rootScroller = getRootScrollerElement();
    let scroller = normalizeScrollTarget(e.target);

    // Some browsers can surface element scrolls with a document target when observed
    // from a document-level capture listener. If we recently saw wheel/touch over a
    // specific scroll container, prefer that as the target.
    if (scroller === rootScroller) {
      const candidate = getRecentInputScrollerCandidate();
      if (candidate && candidate !== rootScroller) {
        scroller = candidate;
      }
    }

    const hinted = consumeRecentInputHint(scroller);
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

  // Detect scroll start/end for *any* scrollable element.
  // Note: `scroll` doesn't bubble; using capture allows observing element scrolls.
  document.addEventListener('scroll', onScrollEvent, { passive: true, capture: true });

  document.addEventListener('wheel', (e) => {
    hintInputSource(findScrollableFromEventTarget(e), 'wheel');
  }, { passive: true });

  document.addEventListener('touchstart', (e) => {
    hintInputSource(findScrollableFromEventTarget(e), 'touch');
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    hintInputSource(findScrollableFromEventTarget(e), 'touch');
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    // Heuristic: keys commonly used to scroll.
    const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
    if (!scrollKeys.has(e.key)) return;

    // Prefer a focused scroll container if we can find one.
    const active = document.activeElement;
    const pseudoEvent = { target: active, composedPath: () => [active] };
    hintInputSource(findScrollableFromEventTarget(pseudoEvent), 'keyboard');
  }, { passive: true });

  // Extend PerformanceObserver
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
      } catch (e) {
        // Ignore if 'scroll' type is not supported natively
        const observingScroll = options && (options.type === 'scroll' || options.entryTypes?.includes('scroll'));
        if (!observingScroll) throw e;
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

  window.PerformanceScrollTiming = PerformanceScrollTimingPolyfill;
})();
