import { describe, it, expect, vi } from 'vitest';
import { FiberError, Fibers } from '../src/index';

describe('Fibers.delay', () => {
  it('should resolve after the specified milliseconds', async () => {
    vi.useFakeTimers();
    const promise = Fibers.delay(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('should reject with AbortError if signal is already aborted', async () => {
    const abortController = new AbortController();
    abortController.abort();
    const promise = Fibers.delay(1000, abortController);
    await expect(promise).rejects.toHaveProperty('name', 'AbortError');
  });

  it('should reject with AbortError if signal is aborted during delay', async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const promise = Fibers.delay(1000, abortController);
    vi.advanceTimersByTime(50);
    abortController.abort();
    await expect(promise).rejects.toHaveProperty('name', 'AbortError');
    vi.useRealTimers();
  });

  it('should clear timeout if aborted', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const abortController = new AbortController();
    const promise = Fibers.delay(1000, abortController);
    abortController.abort();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();

    await expect(promise).rejects.toHaveProperty('name', 'AbortError');
  });
});

describe('Fibers concurrency level validation', () => {
  it('should throw an error if concurrency level is 0 for Fibers.for', () => {
    const factory = async (index: number) => index;
    expect(() => Fibers.for(0, 0, 1, 1, factory)).toThrow(new FiberError('Concurrency level must be greater than 0: 0'));
  });

  it('should throw an error if concurrency level is negative for Fibers.for', () => {
    const factory = async (index: number) => index;
    expect(() => Fibers.for(-1, 0, 1, 1, factory)).toThrow(new FiberError('Concurrency level must be greater than 0: -1'));
  });

  it('should throw an error if concurrency level is 0 for Fibers.forEach', () => {
    const items = ['a'];
    const factory = async (item: string) => item;
    expect(() => Fibers.forEach(0, items, factory)).toThrow(new FiberError('Concurrency level must be greater than 0: 0'));
  });

  it('should throw an error if concurrency level is negative for Fibers.forEach', () => {
    const items = ['a'];
    const factory = async (item: string) => item;
    expect(() => Fibers.forEach(-1, items, factory)).toThrow(new FiberError('Concurrency level must be greater than 0: -1'));
  });

  it('should throw an error if concurrency level is set to 0 after instantiation', () => {
    const factory = async (index: number) => index;
    const fibers = Fibers.for(1, 0, 1, 1, factory);
    expect(() => { fibers.concurrency = 0; }).toThrow(new FiberError('Concurrency level must be greater than 0: 0'));
  });

  it('should throw an error if concurrency level is set to negative after instantiation', () => {
    const factory = async (index: number) => index;
    const fibers = Fibers.for(1, 0, 1, 1, factory);
    expect(() => { fibers.concurrency = -1; }).toThrow(new FiberError('Concurrency level must be greater than 0: -1'));
  });

  it('should validate value after setting concurrency level', () => {
    const factory = async (index: number) => index;
    const fibers = Fibers.for(1, 0, 1, 1, factory);
    expect(fibers.concurrency).toBe(1); // Initial value

    fibers.concurrency = 5;
    expect(fibers.concurrency).toBe(5);

    fibers.concurrency = 10;
    expect(fibers.concurrency).toBe(10);
  });
});

describe('Fibers.for', () => {
  it('should create a Fibers instance and process tasks', async () => {
    const results: number[] = [];
    const factory = async (index: number) => {
      results.push(index);
      return index * 2;
    };

    const mock = vi.fn();
    const fibers = Fibers.for(2, 0, 5, 1, factory); // concurrency 2, 0 to 4, step 1
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    for await (const result of fibers) {
      // The loop will continue until all tasks are processed
    }

    expect(results.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(fibers.completed).toBe(true);
    expect(fibers.started).toBe(false);
    expect(fibers.failed).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should respect concurrency limit', async () => {
    const runningTasks = new Set<number>();
    let maxConcurrency = 0;

    const factory = async (index: number) => {
      runningTasks.add(index);
      maxConcurrency = Math.max(maxConcurrency, runningTasks.size);
      await new Promise(resolve => setTimeout(resolve, 10)); // Simulate async work
      runningTasks.delete(index);
      return index;
    };

    const mock = vi.fn();
    const fibers = Fibers.for(3, 0, 10, 1, factory); // concurrency 3
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    for await (const result of fibers) {
      // Consume results
    }

    expect(maxConcurrency).toBeLessThanOrEqual(3);
    expect(fibers.completed).toBe(true);
    expect(fibers.started).toBe(false);
    expect(fibers.failed).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should process tasks using start() and await fibers.promise', async () => {
    const results: number[] = [];
    const factory = async (index: number) => {
      results.push(index);
      return index * 2;
    };

    const mock = vi.fn();
    const fibers = Fibers.for(2, 0, 5, 1, factory); // concurrency 2, 0 to 4, step 1
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    fibers.start();
    expect(fibers.started).toBe(true);

    await fibers.promise;

    expect(results.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(fibers.completed).toBe(true);
    expect(fibers.started).toBe(false);
    expect(fibers.failed).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should throw FiberError if start() is called before for await...of', async () => {
    const factory = async (index: number) => index * 2;

    const mock = vi.fn();
    const fibers = Fibers.for(2, 0, 1, 1, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    const promise = (async () => {
      fibers.start();
      expect(fibers.started).toBe(true);
      for await (const result of fibers) {
        // This should throw an error
      }
    })();
    await expect(promise).rejects.toThrow(new FiberError('Cannot iterate while generator is running in background'));

    // After the error, the fibers should be completed and failed
    await fibers.promise;
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false); // next() throws but fibers is completed by start()
    expect(fibers.started).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should throw FiberError if start() is called inside for await...of', async () => {
    const factory = async (index: number) => index * 2;

    const mock = vi.fn();
    const fibers = Fibers.for(2, 0, 5, 1, factory); // Use a range that allows at least one iteration before throwing
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    const promise = (async () => {
      for await (const result of fibers) {
        // Call start() inside the loop. This should cause the *next* iteration to throw.
        fibers.start();
        expect(fibers.started).toBe(true);
      }
    })();
    await expect(promise).rejects.toThrow(new FiberError('Cannot start while iterating over fibers'));

    // After the error, the fibers should be completed and failed
    await fibers.promise;
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false); // next() throws but fibers is completed by start()
    expect(fibers.started).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });
});

describe('Fibers.forEach', () => {
  it('should create a Fibers instance and process tasks from an iterable', async () => {
    const items = ['a', 'b', 'c'];
    const results: string[] = [];
    const factory = async (item: string) => {
      results.push(item);
      return item.toUpperCase();
    };

    const mock = vi.fn();
    const fibers = Fibers.forEach(1, items, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    for await (const result of fibers) {
      // The loop will continue until all tasks are processed
    }

    expect(results.sort()).toEqual(['a', 'b', 'c']);
    expect(fibers.completed).toBe(true);
    expect(fibers.started).toBe(false);
    expect(fibers.failed).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should handle empty iterable', async () => {
    const items: string[] = [];
    const results: string[] = [];
    const factory = async (item: string) => {
      results.push(item);
      return item.toUpperCase();
    };

    const mock = vi.fn();
    const fibers = Fibers.forEach(1, items, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    for await (const result of fibers) {
      // Should not enter loop body
    }

    expect(results).toEqual([]);
    expect(fibers.completed).toBe(true);
    expect(fibers.started).toBe(false);
    expect(fibers.failed).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should process tasks from an iterable using start() and await fibers.promise', async () => {
    const items = ['a', 'b', 'c'];
    const results: string[] = [];
    const factory = async (item: string) => {
      results.push(item);
      return item.toUpperCase();
    };

    const mock = vi.fn();
    const fibers = Fibers.forEach(1, items, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    fibers.start();
    expect(fibers.started).toBe(true);

    await fibers.promise;

    expect(results.sort()).toEqual(['a', 'b', 'c']);
    expect(fibers.completed).toBe(true);
    expect(fibers.started).toBe(false);
    expect(fibers.failed).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should throw FiberError if start() is called before for await...of (forEach)', async () => {
    const items = ['a'];
    const factory = async (item: string) => item.toUpperCase();

    const mock = vi.fn();
    const fibers = Fibers.forEach(1, items, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    const promise = (async () => {
      fibers.start();
      expect(fibers.started).toBe(true);
      for await (const result of fibers) {
        // This should throw an error
      }
    })();
    await expect(promise).rejects.toThrow(new FiberError('Cannot iterate while generator is running in background'));

    // After the error, the fibers should be completed and failed
    await fibers.promise;
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false); // next() throws but fibers is completed by start()
    expect(fibers.started).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should throw FiberError if start() is called inside for await...of (forEach)', async () => {
    const items = ['a', 'b', 'c']; // Use multiple items to allow at least one iteration before throwing
    const factory = async (item: string) => item.toUpperCase();

    const mock = vi.fn();
    const fibers = Fibers.forEach(1, items, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    const promise = (async () => {
      for await (const result of fibers) {
        // Call start() inside the loop. This should cause the *next* iteration to throw.
        fibers.start();
        expect(fibers.started).toBe(true);
      }
    })();
    await expect(promise).rejects.toThrow(new FiberError('Cannot start while iterating over fibers'));

    // After the error, the fibers should be completed and failed
    await fibers.promise;
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false); // next() throws but fibers is completed by start()
    expect(fibers.started).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });
});

describe('Fibers error handling', () => {
  it('should stop processing tasks when error handler returns "stop"', async () => {
    const processed: number[] = [];
    const factory = async (index: number) => {
      if (index === 2) {
        throw new Error('Test error - stop');
      }
      processed.push(index);
      return index;
    };

    const mock = vi.fn();
    const fibers = Fibers.for(1, 0, 5, 1, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    fibers.setErrorHandler((e, f, reason) => {
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe('Test error - stop');
      expect(reason).toBe('next');
      return 'stop';
    });

    for await (const result of fibers) {
      // The loop will continue until all tasks are processed or stopped
    }

    // Expect tasks before the error to be processed, and no tasks after
    expect(processed).toEqual([0, 1]);
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false);
    expect(fibers.started).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should skip erroneous tasks when error handler returns "skip"', async () => {
    const processed: number[] = [];
    const factory = async (index: number) => {
      if (index === 2) {
        throw new Error('Test error - skip');
      }
      processed.push(index);
      return index;
    };

    const mock = vi.fn();
    const fibers = Fibers.for(1, 0, 5, 1, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    fibers.setErrorHandler((e, f, reason) => {
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe('Test error - skip');
      expect(reason).toBe('next');
      return 'skip';
    });

    for await (const result of fibers) {
      // Consume results
    }

    // Expect tasks before and after the error to be processed, but not the erroneous one
    expect(processed).toEqual([0, 1, 3, 4]);
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false);
    expect(fibers.started).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should re-throw error and mark fibers as failed when error handler returns "default" or is not set', async () => {
    const processed: number[] = [];
    const factory = async (index: number) => {
      if (index === 2) {
        throw new Error('Test error - default');
      }
      processed.push(index);
      return index;
    };

    const mock = vi.fn();
    const fibers = Fibers.for(1, 0, 5, 1, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    fibers.setErrorHandler((e, f, reason) => {
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe('Test error - default');
      expect(reason).toBe('next');
      return 'default'; // Explicitly return default
    });

    const promiseCatch = fibers.promise.catch((e) => {
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe('Test error - default');
      // console.log('Test error - default (catch)');
    });
    const promise = (async () => {
      for await (const result of fibers) {
        // This should throw
      }
    })();
    await expect(promise).rejects.toThrow('Test error - default');
    await promiseCatch;

    // Expect tasks before the error to be processed
    expect(processed).toEqual([0, 1]);
    expect(fibers.completed).toBe(true); // Fibers should be completed even if failed
    expect(fibers.failed).toBe(true); // Fibers should be marked as failed
    expect(fibers.started).toBe(false); // Should not be started after error

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });

  it('should re-throw error and mark fibers as failed when no error handler is set', async () => {
    const processed: number[] = [];
    const factory = async (index: number) => {
      if (index === 2) {
        throw new Error('Test error - no handler');
      }
      processed.push(index);
      return index;
    };

    const mock = vi.fn();
    const fibers = Fibers.for(1, 0, 5, 1, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    // No error handler set

    const promiseCatch = fibers.promise.catch((e) => {
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toBe('Test error - no handler');
      // console.log('Test error - no handler (catch)');
    });
    const promise = (async () => {
      try {
        for await (const result of fibers) {
          // This should throw
        }
      }
      catch (e: any) {
        await promiseCatch;
        throw e;
      }
    })();
    await expect(promise).rejects.toThrow('Test error - no handler');

    // Expect tasks before the error to be processed
    expect(processed).toEqual([0, 1]);
    expect(fibers.completed).toBe(true); // Fibers should be completed even if failed
    expect(fibers.failed).toBe(true); // Fibers should be marked as failed
    expect(fibers.started).toBe(false); // Should not be started after error

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });
});

describe('Fibers sequential call combinations', () => {
  describe('Fibers.for combinations', () => {
    it('verifies no re-processing when started and awaited multiple times', async () => {
      const results: number[] = [];
      const factory = async (index: number) => {
        results.push(index);
        return index;
      };
      const mock = vi.fn();
      const fibers = Fibers.for(1, 0, 1, 1, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      // First start and await
      await fibers.promiseStart;
      expect(results).toEqual([0]);
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      // Reset results for second attempt
      results.length = 0;

      // Second start and await
      await fibers.promiseStart;
      expect(results).toEqual([]); // No new tasks should be processed
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });

    it('verifies no re-processing when started and awaited, then iterated with for await...of', async () => {
      const results: number[] = [];
      const factory = async (index: number) => {
        results.push(index);
        return index;
      };
      const mock = vi.fn();
      const fibers = Fibers.for(1, 0, 1, 1, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      // First start and await
      await fibers.promiseStart;
      expect(results).toEqual([0]);
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      // Reset results for second attempt
      results.length = 0;

      // Attempt iteration with for await...of
      for await (const result of fibers) {
        results.push(result);
      }
      expect(results).toEqual([]); // No new tasks should be processed
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });

    it('verifies no error when start() is called after for await...of completes', async () => {
      const factory = async (index: number) => index;
      const mock = vi.fn();
      const fibers = Fibers.for(1, 0, 1, 1, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      for await (const _ of fibers) {
        // Consume the fiber
      }
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      // Calling start() again should not throw and should not restart
      await fibers.promiseStart;
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });

    it('verifies no re-iteration when for await...of is called multiple times', async () => {
      const results: number[] = [];
      const factory = async (index: number) => {
        results.push(index);
        return index;
      };
      const mock = vi.fn();
      const fibers = Fibers.for(1, 0, 1, 1, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      for await (const _ of fibers) {
        // First iteration
      }
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      const secondResults: number[] = [];
      for await (const result of fibers) {
        secondResults.push(result);
      }

      expect(results).toEqual([0]); // Only the first iteration should have processed tasks
      expect(secondResults).toEqual([]); // Second iteration should yield nothing
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });

    it('verifies no error when start() is called multiple times', async () => {
      const factory = async (index: number) => index;
      const mock = vi.fn();
      const fibers = Fibers.for(1, 0, 1, 1, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      fibers.start();
      expect(fibers.started).toBe(true); // Ensure it's started
      expect(fibers.completed).toBe(false); // Not completed yet
      expect(fibers.failed).toBe(false); // Not failed yet

      // Calling start() again should not throw and should not change state
      fibers.start();
      expect(fibers.started).toBe(true); // Should still be started
      expect(fibers.completed).toBe(false); // Not completed yet
      expect(fibers.failed).toBe(false); // Not failed yet

      await fibers.promiseStart;
      expect(fibers.completed).toBe(true); // Should still be completed
      expect(fibers.started).toBe(false); // Should not be started again
      expect(fibers.failed).toBe(false); // Should still be false

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });
  });

  describe('Fibers.forEach combinations', () => {
    it('verifies no re-processing when started and awaited multiple times (forEach)', async () => {
      const results: string[] = [];
      const items = ['a'];
      const factory = async (item: string) => {
        results.push(item);
        return item;
      };
      const mock = vi.fn();
      const fibers = Fibers.forEach(1, items, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      // First start and await
      await fibers.promiseStart;
      expect(results).toEqual(['a']);
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      // Reset results for second attempt
      results.length = 0;

      // Second start and await
      await fibers.promiseStart;
      expect(results).toEqual([]); // No new tasks should be processed
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });

    it('verifies no re-processing when started and awaited, then iterated with for await...of (forEach)', async () => {
      const results: string[] = [];
      const items = ['a'];
      const factory = async (item: string) => {
        results.push(item);
        return item;
      };
      const mock = vi.fn();
      const fibers = Fibers.forEach(1, items, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      // First start and await
      await fibers.promiseStart;
      expect(results).toEqual(['a']);
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      // Reset results for second attempt
      results.length = 0;

      // Attempt iteration with for await...of
      for await (const result of fibers) {
        results.push(result);
      }
      expect(results).toEqual([]); // No new tasks should be processed
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });

    it('verifies no error when start() is called after for await...of completes (forEach)', async () => {
      const items = ['a'];
      const factory = async (item: string) => item;
      const mock = vi.fn();
      const fibers = Fibers.forEach(1, items, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      for await (const _ of fibers) {
        // Consume the fiber
      }
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      // Calling start() again should not throw and should not restart
      await fibers.promiseStart;
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });

    it('verifies no re-iteration when for await...of is called multiple times (forEach)', async () => {
      const results: string[] = [];
      const items = ['a'];
      const factory = async (item: string) => {
        results.push(item);
        return item;
      };
      const mock = vi.fn();
      const fibers = Fibers.forEach(1, items, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      for await (const _ of fibers) {
        // First iteration
      }
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      const secondResults: string[] = [];
      for await (const result of fibers) {
        secondResults.push(result);
      }

      expect(results).toEqual(['a']); // Only the first iteration should have processed tasks
      expect(secondResults).toEqual([]); // Second iteration should yield nothing
      expect(fibers.completed).toBe(true);
      expect(fibers.started).toBe(false);
      expect(fibers.failed).toBe(false);

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });

    it('verifies no error when start() is called multiple times (forEach)', async () => {
      const items = ['a'];
      const factory = async (item: string) => item;
      const mock = vi.fn();
      const fibers = Fibers.forEach(1, items, factory);
      const finallyPromise = fibers.promise.finally(mock);

      expect(fibers.started).toBe(false);
      expect(fibers.completed).toBe(false);
      expect(fibers.failed).toBe(false);

      fibers.start();
      expect(fibers.started).toBe(true); // Ensure it's started
      expect(fibers.completed).toBe(false); // Not completed yet
      expect(fibers.failed).toBe(false); // Not failed yet

      // Calling start() again should not throw and should not change state
      fibers.start();
      expect(fibers.started).toBe(true); // Should still be started
      expect(fibers.completed).toBe(false); // Not completed yet
      expect(fibers.failed).toBe(false); // Not failed yet

      await fibers.promiseStart;
      expect(fibers.completed).toBe(true); // Should still be completed
      expect(fibers.started).toBe(false); // Should not be started again
      expect(fibers.failed).toBe(false); // Should still be false

      await finallyPromise;
      expect(mock.mock.calls.length).toBe(1);
    });
  });
});

describe('Fibers start/stop', () => {
  it('should restart a stopped fibers and process new tasks', async () => {
    const results: number[] = [];
    const factory = async (index: number) => {
      results.push(index);
      return index;
    };

    const concurrency = 7;
    const arraySize = 310;
    const expected = Array.from({ length: arraySize }, (_, i) => i);

    const mock = vi.fn();
    const fibers = Fibers.for(concurrency, 0, arraySize, 1, factory);
    const finallyPromise = fibers.promise.catch(() => { /* to suppress unhandled rejection */ }).finally(mock);

    expect(fibers.started).toBe(false);
    expect(fibers.completed).toBe(false);
    expect(fibers.failed).toBe(false);

    fibers.start();
    expect(fibers.started).toBe(true); // After calling start()
    expect(fibers.completed).toBe(false); // Not completed yet
    expect(fibers.failed).toBe(false); // Not failed yet

    await fibers.stop();
    expect(results).not.toEqual(expected);
    expect(fibers.started).toBe(false); // After stopping
    expect(fibers.completed).toBe(false); // Not completed yet (stopped mid-way)
    expect(fibers.failed).toBe(false); // Not failed yet

    await fibers.promiseStart;

    expect(results).toEqual(expected);
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false);
    expect(fibers.started).toBe(false);

    await finallyPromise;
    expect(mock.mock.calls.length).toBe(1);
  });
});
