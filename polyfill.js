// Polyfill for Scroll Timing API
(function() {
  if ('PerformanceScrollTiming' in window) return;

  const scrollObservers = new Set();
  let currentScroll = null;
  let frameCount = 0;
  let expectedFrames = 0;
  let scrollStartTime = null;
  let lastFrameTime = null;
  let checkerboardTime = 0;
  let rafId = null;

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
        scrollSource: this.scrollSource
      };
    }
  }

  function startScrollTracking(source, target) {
    scrollStartTime = performance.now();
    frameCount = 0;
    expectedFrames = 0;
    lastFrameTime = scrollStartTime;
    checkerboardTime = 0;
    currentScroll = { source, target };
    trackFrames();
  }

  function trackFrames() {
    rafId = requestAnimationFrame((timestamp) => {
      if (!currentScroll) return;
      
      frameCount++;
      const frameDuration = timestamp - lastFrameTime;
      const targetFrameDuration = 1000 / 60; // Assuming 60fps target
      expectedFrames += Math.max(1, Math.round(frameDuration / targetFrameDuration));
      lastFrameTime = timestamp;
      
      trackFrames();
    });
  }

  function endScrollTracking() {
    if (!currentScroll || !scrollStartTime) return;
    
    cancelAnimationFrame(rafId);
    
    const endTime = performance.now();
    const entry = new PerformanceScrollTimingPolyfill({
      startTime: scrollStartTime,
      duration: endTime - scrollStartTime,
      framesExpected: expectedFrames,
      framesProduced: frameCount,
      checkerboardTime: checkerboardTime,
      scrollSource: currentScroll.source,
      target: currentScroll.target
    });

    // Notify observers
    scrollObservers.forEach(observer => {
      observer.callback({ getEntries: () => [entry] });
    });

    currentScroll = null;
    scrollStartTime = null;
  }

  // Detect scroll start
  let scrollTimeout = null;
  
  document.addEventListener('scroll', (e) => {
    if (!currentScroll) {
      startScrollTracking('unknown', e.target);
    }
    
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(endScrollTracking, 150);
  }, { passive: true });

  document.addEventListener('wheel', (e) => {
    if (!currentScroll) {
      startScrollTracking('wheel', e.target);
    }
  }, { passive: true });

  document.addEventListener('touchstart', (e) => {
    if (!currentScroll) {
      startScrollTracking('touch', e.target);
    }
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
        if (!options.type === 'scroll') throw e;
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
