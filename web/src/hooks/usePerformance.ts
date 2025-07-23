/**
 * Performance optimization hooks for React components
 * Provides memory management, lazy loading, and mobile optimizations
 */

import { useEffect, useRef, useCallback, useState, lazy, Suspense } from 'react';
import { useInView } from 'react-intersection-observer';
import PerformanceOptimizer, { defaultPerformanceConfig } from '../../../src/performance';

// Initialize performance optimizer
const performanceOptimizer = new PerformanceOptimizer(defaultPerformanceConfig);

/**
 * Hook for tracking component performance
 */
export function useComponentPerformance(componentName: string) {
  const { useTrackComponent } = performanceOptimizer.getReactHooks();
  const { id, useEffect: trackedUseEffect } = useTrackComponent(componentName);
  
  const renderCount = useRef(0);
  const renderStartTime = useRef<number>();
  
  // Track render time
  useEffect(() => {
    renderCount.current++;
    const renderTime = renderStartTime.current ? Date.now() - renderStartTime.current : 0;
    
    if (renderTime > 16) { // More than one frame (60fps)
      console.warn(`Slow render in ${componentName}: ${renderTime}ms`);
    }
  });
  
  // Set render start time
  renderStartTime.current = Date.now();
  
  return {
    id,
    renderCount: renderCount.current,
    useEffect: trackedUseEffect,
  };
}

/**
 * Hook for lazy loading components with intersection observer
 */
export function useLazyComponent<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  options?: {
    rootMargin?: string;
    threshold?: number;
    fallback?: React.ReactNode;
  }
) {
  const [Component, setComponent] = useState<T | null>(null);
  const { ref, inView } = useInView({
    triggerOnce: true,
    rootMargin: options?.rootMargin || '100px',
    threshold: options?.threshold || 0,
  });
  
  useEffect(() => {
    if (inView && !Component) {
      importFn().then(module => {
        setComponent(() => module.default);
      });
    }
  }, [inView, Component, importFn]);
  
  return {
    ref,
    Component,
    isLoading: inView && !Component,
  };
}

/**
 * Hook for optimizing images with lazy loading and format selection
 */
export function useOptimizedImage(src: string, options?: {
  sizes?: string;
  loading?: 'lazy' | 'eager';
  formats?: string[];
}) {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { ref, inView } = useInView({
    triggerOnce: true,
    rootMargin: '50px',
  });
  
  useEffect(() => {
    if (!inView || !src) return;
    
    // Check WebP support
    const supportsWebP = document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0;
    
    // Select best format
    let selectedSrc = src;
    if (supportsWebP && options?.formats?.includes('webp')) {
      selectedSrc = src.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    }
    
    // Preload image
    const img = new Image();
    img.onload = () => {
      setImageSrc(selectedSrc);
      setIsLoading(false);
    };
    img.onerror = () => {
      setError(new Error('Failed to load image'));
      setIsLoading(false);
    };
    img.src = selectedSrc;
  }, [inView, src, options?.formats]);
  
  return {
    ref,
    src: imageSrc,
    isLoading,
    error,
    imgProps: {
      loading: options?.loading || 'lazy',
      sizes: options?.sizes,
    },
  };
}

/**
 * Hook for debouncing values (useful for search inputs)
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  
  return debouncedValue;
}

/**
 * Hook for throttling callbacks (useful for scroll/resize handlers)
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRan = useRef(Date.now());
  const timeoutRef = useRef<NodeJS.Timer>();
  
  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    
    if (now - lastRan.current >= delay) {
      callback(...args);
      lastRan.current = now;
    } else {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        callback(...args);
        lastRan.current = Date.now();
      }, delay - (now - lastRan.current));
    }
  }, [callback, delay]) as T;
}

/**
 * Hook for detecting network connection type
 */
export function useNetworkStatus() {
  const [networkStatus, setNetworkStatus] = useState({
    online: navigator.onLine,
    effectiveType: '4g',
    saveData: false,
  });
  
  useEffect(() => {
    const updateNetworkStatus = () => {
      const connection = (navigator as any).connection;
      
      setNetworkStatus({
        online: navigator.onLine,
        effectiveType: connection?.effectiveType || '4g',
        saveData: connection?.saveData || false,
      });
    };
    
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    
    if ('connection' in navigator) {
      (navigator as any).connection.addEventListener('change', updateNetworkStatus);
    }
    
    updateNetworkStatus();
    
    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
      
      if ('connection' in navigator) {
        (navigator as any).connection.removeEventListener('change', updateNetworkStatus);
      }
    };
  }, []);
  
  return networkStatus;
}

/**
 * Hook for virtual scrolling large lists
 */
export function useVirtualScroll<T>(
  items: T[],
  options: {
    itemHeight: number;
    containerHeight: number;
    overscan?: number;
  }
) {
  const [scrollTop, setScrollTop] = useState(0);
  const overscan = options.overscan || 3;
  
  const startIndex = Math.max(0, Math.floor(scrollTop / options.itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + options.containerHeight) / options.itemHeight) + overscan
  );
  
  const visibleItems = items.slice(startIndex, endIndex + 1);
  const totalHeight = items.length * options.itemHeight;
  const offsetY = startIndex * options.itemHeight;
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);
  
  return {
    visibleItems,
    totalHeight,
    offsetY,
    handleScroll,
    startIndex,
    endIndex,
  };
}

/**
 * Hook for prefetching data based on user interaction
 */
export function usePrefetch<T>(
  fetchFn: () => Promise<T>,
  options?: {
    trigger?: 'hover' | 'focus' | 'visible';
    delay?: number;
  }
) {
  const [isPrefetching, setIsPrefetching] = useState(false);
  const [prefetchedData, setPrefetchedData] = useState<T | null>(null);
  const timeoutRef = useRef<NodeJS.Timer>();
  
  const prefetch = useCallback(() => {
    if (isPrefetching || prefetchedData) return;
    
    const doPrefetch = async () => {
      setIsPrefetching(true);
      try {
        const data = await fetchFn();
        setPrefetchedData(data);
      } catch (error) {
        console.error('Prefetch failed:', error);
      } finally {
        setIsPrefetching(false);
      }
    };
    
    if (options?.delay) {
      timeoutRef.current = setTimeout(doPrefetch, options.delay);
    } else {
      doPrefetch();
    }
  }, [fetchFn, isPrefetching, prefetchedData, options?.delay]);
  
  const cancelPrefetch = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);
  
  useEffect(() => {
    return () => {
      cancelPrefetch();
    };
  }, [cancelPrefetch]);
  
  return {
    prefetch,
    cancelPrefetch,
    isPrefetching,
    prefetchedData,
  };
}

/**
 * Hook for optimizing re-renders with custom comparison
 */
export function useDeepCompareMemo<T>(
  factory: () => T,
  deps: React.DependencyList
): T {
  const ref = useRef<{ deps: React.DependencyList; value: T }>();
  
  if (!ref.current || !deepEqual(deps, ref.current.deps)) {
    ref.current = { deps, value: factory() };
  }
  
  return ref.current.value;
}

// Helper function for deep equality check
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a === null || b === null) return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  
  return true;
}

export default {
  useComponentPerformance,
  useLazyComponent,
  useOptimizedImage,
  useDebounce,
  useThrottle,
  useNetworkStatus,
  useVirtualScroll,
  usePrefetch,
  useDeepCompareMemo,
};