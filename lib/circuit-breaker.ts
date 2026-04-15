import logger from './logger';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED',      // Normal operation, requests pass through
  OPEN = 'OPEN',          // Circuit tripped, requests fail fast
  HALF_OPEN = 'HALF_OPEN', // Testing if service has recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerOptions {
  /**
   * Number of failures before opening the circuit
   * @default 5
   */
  failureThreshold?: number;

  /**
   * Time in milliseconds to wait before transitioning from OPEN to HALF_OPEN
   * @default 30000 (30 seconds)
   */
  resetTimeout?: number;

  /**
   * Number of successful requests in HALF_OPEN state before closing the circuit
   * @default 3
   */
  successThreshold?: number;

  /**
   * Name of the circuit breaker for logging
   * @default 'unnamed'
   */
  name?: string;

  /**
   * Sliding window size in milliseconds for failure rate calculation
   * @default 60000 (1 minute)
   */
  windowSize?: number;

  /**
   * Failure rate threshold (0-1) for opening circuit based on sliding window
   * @default 0.5 (50% failure rate)
   */
  failureRateThreshold?: number;

  /**
   * Minimum number of requests in window before applying failure rate threshold
   * @default 10
   */
  minimumRequestsInWindow?: number;
}

/**
 * Sliding window entry for failure tracking
 */
interface WindowEntry {
  timestamp: number;
  success: boolean;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastStateChange: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  failureRate: number;
  windowSize: number;
  requestsInWindow: number;
}

/**
 * Circuit breaker error
 */
export class CircuitBreakerError extends Error {
  constructor(message: string, public readonly state: CircuitState) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit breaker implementation with sliding window support
 * 
 * Protects against cascade failures by failing fast when a service is unhealthy.
 * Implements the standard circuit breaker pattern with three states:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is unhealthy, requests fail immediately
 * - HALF_OPEN: Testing if service has recovered
 */
export class CircuitBreaker<T extends (...args: unknown[]) => Promise<unknown>> {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number | null = null;
  private lastStateChange: number = Date.now();
  private resetTimer: NodeJS.Timeout | null = null;
  
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly successThreshold: number;
  private readonly name: string;
  private readonly windowSize: number;
  private readonly failureRateThreshold: number;
  private readonly minimumRequestsInWindow: number;
  
  // Sliding window for failure rate tracking
  private readonly window: WindowEntry[] = [];
  
  private totalRequests: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;

  constructor(private readonly fn: T, options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000;
    this.successThreshold = options.successThreshold ?? 3;
    this.name = options.name ?? 'unnamed';
    this.windowSize = options.windowSize ?? 60000; // 1 minute default
    this.failureRateThreshold = options.failureRateThreshold ?? 0.5; // 50% default
    this.minimumRequestsInWindow = options.minimumRequestsInWindow ?? 10;
    
    logger.debug(`[CircuitBreaker] Created: ${this.name} (window: ${this.windowSize}ms)`);
  }

  /**
   * Execute the wrapped function with circuit breaker protection
   */
  async execute(...args: Parameters<T>): Promise<ReturnType<T>> {
    this.totalRequests++;

    // Check if we can execute the request
    if (!this.canExecute()) {
      logger.warn(`[CircuitBreaker] ${this.name}: Circuit is ${this.state}, rejecting request`);
      throw new CircuitBreakerError(
        `Circuit breaker is ${this.state} for ${this.name}`,
        this.state
      );
    }

    try {
      const result = await this.fn(...args);
      this.onSuccess();
      return result as ReturnType<T>;
    } catch (error: unknown) {
      this.onFailure();
      
      // Re-throw the error unless circuit is open
      if (this.state === CircuitState.OPEN) {
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.name}`,
          CircuitState.OPEN
        );
      }
      
      throw error;
    }
  }

  /**
   * Check if a request can be executed
   */
  private canExecute(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      // Check if reset timeout has elapsed
      if (Date.now() - this.lastStateChange >= this.resetTimeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
        return true;
      }
      return false;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      return true;
    }

    return false;
  }

  /**
   * Handle a successful request
   */
  private onSuccess(): void {
    this.addWindowEntry(true);
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      logger.debug(`[CircuitBreaker] ${this.name}: Success count in HALF_OPEN: ${this.successCount}/${this.successThreshold}`);
      
      if (this.successCount >= this.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
        logger.info(`[CircuitBreaker] ${this.name}: Circuit CLOSED after ${this.successThreshold} successes`);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset consecutive failure count on success in CLOSED state
      this.failureCount = 0;
    }
    
    this.totalSuccesses++;
  }

  /**
   * Handle a failed request
   */
  private onFailure(): void {
    this.addWindowEntry(false);
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    logger.warn(`[CircuitBreaker] ${this.name}: Failure count: ${this.failureCount}/${this.failureThreshold}`);

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in HALF_OPEN immediately opens the circuit
      this.transitionTo(CircuitState.OPEN);
      logger.warn(`[CircuitBreaker] ${this.name}: Circuit OPENED after failure in HALF_OPEN`);
    } else if (this.state === CircuitState.CLOSED) {
      // Check sliding window failure rate first
      const failureRate = this.getFailureRate();
      
      if (failureRate >= this.failureRateThreshold && 
          this.getRequestsInWindow() >= this.minimumRequestsInWindow) {
        logger.info(`[CircuitBreaker] ${this.name}: Opening circuit due to high failure rate: ${failureRate.toFixed(2)}`);
        this.transitionTo(CircuitState.OPEN);
        this.startResetTimer();
      } else if (this.failureCount >= this.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
        logger.warn(`[CircuitBreaker] ${this.name}: Circuit OPENED after ${this.failureThreshold} consecutive failures`);
        this.startResetTimer();
      }
    }
    
    this.totalFailures++;
  }

  /**
   * Add an entry to the sliding window
   */
  private addWindowEntry(success: boolean): void {
    const now = Date.now();
    this.window.push({ timestamp: now, success });
    
    // Remove expired entries
    const cutoff = now - this.windowSize;
    const validEntries = this.window.filter(entry => entry.timestamp > cutoff);
    
    if (validEntries.length !== this.window.length) {
      this.window.splice(0, this.window.length - validEntries.length);
    }
  }

  /**
   * Get the current failure rate in the sliding window
   */
  private getFailureRate(): number {
    if (this.window.length === 0) {
      return 0;
    }
    
    const failures = this.window.filter(entry => !entry.success).length;
    return failures / this.window.length;
  }

  /**
   * Get the number of requests in the current window
   */
  private getRequestsInWindow(): number {
    const now = Date.now();
    const cutoff = now - this.windowSize;
    return this.window.filter(entry => entry.timestamp > cutoff).length;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) {
      return;
    }

    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    // Reset counters based on new state
    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === CircuitState.OPEN) {
      this.successCount = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successCount = 0;
    }

    logger.info(`[CircuitBreaker] ${this.name}: ${oldState} -> ${newState}`);
  }

  /**
   * Start the reset timer for OPEN -> HALF_OPEN transition
   */
  private startResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }

    this.resetTimer = setTimeout(() => {
      if (this.state === CircuitState.OPEN) {
        this.transitionTo(CircuitState.HALF_OPEN);
        logger.info(`[CircuitBreaker] ${this.name}: Transitioned to HALF_OPEN after ${this.resetTimeout}ms`);
      }
    }, this.resetTimeout);
  }

  /**
   * Manually reset the circuit breaker to CLOSED state
   */
  reset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    
    this.transitionTo(CircuitState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.window.length = 0;
    logger.info(`[CircuitBreaker] ${this.name}: Manually reset to CLOSED`);
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      failureRate: this.getFailureRate(),
      windowSize: this.windowSize,
      requestsInWindow: this.getRequestsInWindow(),
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Check if the circuit is closed (normal operation)
   */
  isClosed(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  /**
   * Check if the circuit is open (failing fast)
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  /**
   * Check if the circuit is half-open (testing recovery)
   */
  isHalfOpen(): boolean {
    return this.state === CircuitState.HALF_OPEN;
  }
}

/**
 * Create a circuit breaker for a specific operation
 */
export function createCircuitBreaker<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options?: CircuitBreakerOptions
): CircuitBreaker<T> {
  return new CircuitBreaker(fn, options);
}

/**
 * Global circuit breaker stats for all breakers
 */
const circuitBreakers = new Map<string, CircuitBreaker<(...args: unknown[]) => Promise<unknown>>>();

/**
 * Register a circuit breaker for monitoring
 */
export function registerCircuitBreaker(
  name: string,
  breaker: CircuitBreaker<(...args: unknown[]) => Promise<unknown>>
): void {
  circuitBreakers.set(name, breaker);
}

/**
 * Get stats for all registered circuit breakers
 */
export function getAllCircuitBreakerStats(): Map<string, CircuitBreakerStats> {
  const stats = new Map<string, CircuitBreakerStats>();
  
  for (const [name, breaker] of circuitBreakers) {
    stats.set(name, breaker.getStats());
  }
  
  return stats;
}

/**
 * Get a specific circuit breaker by name
 */
export function getCircuitBreaker(
  name: string
): CircuitBreaker<(...args: unknown[]) => Promise<unknown>> | undefined {
  return circuitBreakers.get(name);
}
