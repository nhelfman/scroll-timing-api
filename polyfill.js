// Polyfill for Scroll Timing API
(function() {
  if ('PerformanceScrollTiming' in window) return;

  const scrollObservers = new Set();
  const activeScrolls = new WeakMap();
  const inputHints = new WeakMap();
  let lastInputHint = null;

  class PerformanceScrollTimingPolyfill {
    constructor(data) {
      this.entryType = 'scroll';
      this.name = 'scroll';
      this.startTime = data.startTime;
      this.duration = data.duration;
      this.endTime = data.startTime + data.duration;
      this.framesExpected = data.framesExpected;
      this.framesProduced = data.framesProduced;
      this.framesDropped = data.framesExpected - data.framesProduced;
      this.smoothnessScore = data.framesExpected > 0 
        ? data.framesProduced / data.framesExpected 
        : 1;
      this.checkerboardTime = data.checkerboardTime;
      this.checkerboardArea = 0; // Difficult to polyfill accurately
      this.scrollSource = data.scrollSource;
      this.target = data.target;
    }

    toJSON() {
      return {
        entryType: this.entryType,
        name: this.name,
        startTime: this.startTime,
        duration: this.duration,
        smoothnessScore: this.smoothnessScore,
        framesDropped: this.framesDropped,
        scrollSource: this.scrollSource,
        target: this.target
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

  function consumeRecentInputSource(scroller) {
    const hint = inputHints.get(scroller);
    if (!hint) return null;
    if (performance.now() - hint.time > 250) {
      inputHints.delete(scroller);
      return null;
    }
    inputHints.delete(scroller);
    return hint.source;
  }

  class ActiveScrollState {
    constructor(source, target) {
      this.source = source;
      this.target = target;
      this.startTime = performance.now();
      this.frameCount = 0;
      this.expectedFrames = 0;
      this.lastFrameTime = this.startTime;
      this.checkerboardTime = 0;
      this.rafId = null;
      this.timeoutId = null;
      this.ended = false;
    }

    start() {
      this.trackFrames();
      this.scheduleEnd();
    }

    trackFrames() {
      this.rafId = requestAnimationFrame((timestamp) => {
        if (this.ended) return;

        this.frameCount++;
        const frameDuration = timestamp - this.lastFrameTime;
        const targetFrameDuration = 1000 / 60; // Assuming 60fps target
        this.expectedFrames += Math.max(1, Math.round(frameDuration / targetFrameDuration));
        this.lastFrameTime = timestamp;

        this.trackFrames();
      });
    }

    scheduleEnd() {
      clearTimeout(this.timeoutId);
      this.timeoutId = setTimeout(() => this.end(), 150);
    }

    end() {
      if (this.ended) return;
      this.ended = true;

      cancelAnimationFrame(this.rafId);
      clearTimeout(this.timeoutId);

      const endTime = performance.now();
      const entry = new PerformanceScrollTimingPolyfill({
        startTime: this.startTime,
        duration: endTime - this.startTime,
        framesExpected: this.expectedFrames,
        framesProduced: this.frameCount,
        checkerboardTime: this.checkerboardTime,
        scrollSource: this.source,
        target: this.target
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

    const hintedSource = consumeRecentInputSource(scroller);
    let state = activeScrolls.get(scroller);

    if (!state) {
      state = new ActiveScrollState(hintedSource || 'unknown', scroller);
      activeScrolls.set(scroller, state);
      state.start();
      return;
    }

    // If we started with unknown and got a fresh hint, upgrade the source.
    if (state.source === 'unknown' && hintedSource) {
      state.source = hintedSource;
    }
    state.scheduleEnd();
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
