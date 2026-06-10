import { describe, it, expect, vi } from 'vitest';
import { Fibers } from '../src/index';

describe('Fibers concurrency and error handling', () => {
  it('should handle "skip" strategy with concurrency > 1 (Fibers.for)', async () => {
    const processed: number[] = [];
    const factory = async (index: number) => {
      if (index === 2) {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Test error - skip');
      }
      processed.push(index);
      await new Promise(resolve => setTimeout(resolve, 20));
      return index;
    };

    const fibers = Fibers.for(3, 0, 5, 1, factory);
    fibers.setErrorHandler((e) => {
      if (e.message === 'Test error - skip') return 'skip';
      return 'default';
    });

    const results: number[] = [];
    for await (const result of fibers) {
      results.push(result);
    }

    expect(processed.sort()).toEqual([0, 1, 3, 4]);
    expect(results.sort()).toEqual([0, 1, 3, 4]);
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false);
  });

  it('should handle "stop" strategy with concurrency > 1 (Fibers.for)', async () => {
    const processed: number[] = [];
    const factory = async (index: number) => {
      if (index === 2) {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Test error - stop');
      }
      // Index 3 and 4 might start before index 2 fails due to concurrency 3
      processed.push(index);
      await new Promise(resolve => setTimeout(resolve, 50));
      return index;
    };

    const fibers = Fibers.for(3, 0, 10, 1, factory);
    fibers.setErrorHandler((e) => {
      if (e.message === 'Test error - stop') return 'stop';
      return 'default';
    });

    const results: number[] = [];
    try {
        for await (const result of fibers) {
            results.push(result);
        }
    } catch (e) {
        // Should not throw
    }

    // Since concurrency is 3:
    // 0, 1, 2 start.
    // 2 fails at 10ms.
    // 0, 1 are still running.
    // Error handler returns 'stop'.
    // No more tasks should be pulled from generator (3, 4, ... won't start).
    // Already running tasks (0, 1) might continue and be yielded if they finish before/during next() calls.
    // BUT in current implementation, if stop is returned, loopFinished = true, and it returns {done: true}.

    expect(results.length).toBeLessThan(10);
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false);
  });

  it('should handle "skip" strategy with concurrency > 1 (Fibers.forEach)', async () => {
    const items = [0, 1, 2, 3, 4];
    const processed: number[] = [];
    const factory = async (item: number) => {
      if (item === 2) {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Test error - skip');
      }
      processed.push(item);
      await new Promise(resolve => setTimeout(resolve, 20));
      return item;
    };

    const fibers = Fibers.forEach(3, items, factory);
    fibers.setErrorHandler((e) => {
      if (e.message === 'Test error - skip') return 'skip';
      return 'default';
    });

    const results: number[] = [];
    for await (const result of fibers) {
      results.push(result);
    }

    expect(processed.sort()).toEqual([0, 1, 3, 4]);
    expect(results.sort()).toEqual([0, 1, 3, 4]);
    expect(fibers.completed).toBe(true);
    expect(fibers.failed).toBe(false);
  });

  it('should handle "default" strategy with concurrency > 1', async () => {
    const processed: number[] = [];
    const factory = async (index: number) => {
      if (index === 2) {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Test error - default');
      }
      processed.push(index);
      await new Promise(resolve => setTimeout(resolve, 50));
      return index;
    };

    const fibers = Fibers.for(3, 0, 5, 1, factory);
    // Suppress vitest unhandled rejection
    fibers.promise.catch(() => { });

    // default error handler

    const results: number[] = [];
    let caughtError: any = null;
    try {
      for await (const result of fibers) {
        results.push(result);
      }
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError.message).toBe('Test error - default');
    expect(fibers.failed).toBe(true);
    expect(fibers.completed).toBe(true);
  });
});
