/**
 * Represents a factory that creates a promise-based task from a source value.
 * @template TSource The type of the source data.
 * @template TPromise The type of the value resolved by the task's promise.
 */
export interface FiberTaskFactory<TSource, TPromise> {
  /** The source data used to create the task. */
  readonly source: TSource;
  /** A factory function that takes the source and returns a promise. */
  readonly factory: (source: TSource) => Promise<TPromise>;
}

/**
 * A callback function to handle errors occurred during fiber task execution.
 * @template TSource The type of the source data.
 * @template TValue The type of the value resolved by the task's promise.
 * @param e The error that occurred.
 * @param fibers The Fibers instance where the error occurred.
 * @param reason The reason for the error. 'next' if it occurred during iteration, 'unknown' otherwise.
 * @returns A strategy for handling the error:
 * - 'stop': Ends the iteration successfully. Already running tasks may continue.
 * - 'skip': Ignores the error and continues with the next task.
 * - 'default': Re-throws the original exception and drops queued tasks.
 */
export type FiberErrorHandler<TSource, TValue> = (
  e: any,
  fibers: Fibers<TSource, TValue>,
  reason: 'next' | 'unknown'
) =>
  'stop' | 'skip' | 'default';

/**
 * Custom error class for Fiber-related errors.
 */
export class FiberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiberError";
  }
}

/**
 * A coroutine and microthreading library for TypeScript designed to manage
 * asynchronous operations and background tasks efficiently.
 *
 * Fibers allows you to control concurrency, handle errors gracefully,
 * and track the lifecycle of a set of asynchronous tasks.
 *
 * @template TSource The type of the source data for each task.
 * @template TValue The type of the value resolved by each task's promise.
 */
export class Fibers<TSource, TValue>
  // error even if code is valid...? --> // extends Promise<void>
  implements AsyncGenerator<TValue> {

  private static readonly emptyFunction: () => void = () => { };

  private readonly _runningTaskPool: Set<Promise<TValue>> = new Set();
  private readonly _finishedTaskPool: Set<Promise<TValue>> = new Set();

  private readonly _generator: Generator<FiberTaskFactory<TSource, TValue>>;

  private _isCompleted = false;
  private _isGeneratorConsuming = false;
  // start/stop flag is required to allow stop() to return active promise while stopping fibers.
  // ie., activeJob === undefined cannot be used in start()/stop() to determine fiber is started or not.
  private _allowBackgroundJobRunning = false;
  private _activeBackgroundJob: Promise<void> | undefined;

  private _isFailed = false;
  private _isResolvedOrRejected = false;

  // for callback receivers: fibers.promise.then(() => ...);
  private _fibersPromise: Promise<void>;
  private _callbackResolve: (value: void | PromiseLike<void>) => void;
  private _callbackReject: (reason?: any) => void;

  private constructor(concurrency: number, generator: Generator<FiberTaskFactory<TSource, TValue>>) {
    this.concurrency = concurrency;  // use setter to validate value

    this._generator = generator;

    let superResolve!: (value: void | PromiseLike<void>) => void;
    let superReject!: (reason?: any) => void;
    this._fibersPromise = new Promise<void>((resolve, reject) => {
      superResolve = resolve;
      superReject = reject;
    });
    this._callbackResolve = superResolve;
    this._callbackReject = superReject;
  }

  /**
   * User-defined state associated with this Fibers instance.
   * Useful for tracking or identifying fibers, especially when running in the background.
   */
  public state: unknown;

  /**
   * A promise that resolves when all tasks in the Fibers instance have completed,
   * or rejects if an error occurs and the error handler strategy is 'default'.
   *
   * @note DO NOT forget to call `start()` before `await`ing this promise to avoid indefinite waiting
   * if you are not iterating over the fibers with `for await...of`.
   */
  public get promise(): Promise<void> { return this._fibersPromise; }

  /**
   * A promise that automatically invokes `start()` before returning.
   * Use this as a fail-safe to avoid indefinite loops when awaiting the lifecycle promise.
   */
  public get promiseStart(): Promise<void> {
    this.start();
    return this._fibersPromise;
  }

  private b_concurrency: number = 1;
  /**
   * The maximum number of tasks that can run concurrently.
   * This value can be updated dynamically during execution.
   * @throws {FiberError} If the value is less than or equal to 0.
   */
  public get concurrency(): number { return this.b_concurrency; }
  public set concurrency(value: number) {
    if (value <= 0) {
      throw new FiberError(`Concurrency level must be greater than 0: ${value}`);
    }
    this.b_concurrency = value;
  };

  private b_errorHandler: FiberErrorHandler<TSource, TValue> | undefined;
  /**
   * Registers a custom error handler to control how the Fibers instance behaves when a task fails.
   * @param handler The error handler function, or `undefined` to use the default behavior.
   */
  public setErrorHandler(handler: FiberErrorHandler<TSource, TValue> | undefined): void {
    this.b_errorHandler = handler;
  }

  /** Returns `true` if the Fibers instance encountered an unhandled error and stopped. */
  public get failed(): boolean { return this._isFailed; };
  /** Returns `true` if the Fibers instance is currently running tasks in the background. */
  public get started(): boolean { return this._activeBackgroundJob !== undefined; };
  /** Returns `true` if all tasks have been processed (successfully or otherwise). */
  public get completed(): boolean { return this._isCompleted; };

  private async _runInBackground(): Promise<void> {
    try {
      do { }
      while (
        this._allowBackgroundJobRunning &&
        !this._isFailed &&
        !this._isCompleted &&
        !(await this.next()).done
      );
    }
    finally {
      this._allowBackgroundJobRunning = false;
      this._activeBackgroundJob = undefined;
    }
  }

  /**
   * Starts processing fiber tasks in the background.
   *
   * @returns A promise that resolves when all tasks are completed or the fibers are stopped.
   * @throws {FiberError} If called while the Fibers instance is being iterated over with `for await...of`.
   */
  public start(): Promise<void> {
    if (this._isGeneratorConsuming) {
      throw new FiberError("Cannot start while iterating over fibers");
    }

    if (this._isCompleted || this._isFailed) {
      return Promise.resolve();
    }

    if (this._activeBackgroundJob !== undefined) {
      return this._activeBackgroundJob;
    }

    this._allowBackgroundJobRunning = true;
    return (((this._activeBackgroundJob = this._runInBackground())));
  }

  /**
   * Signals the Fibers instance to stop queueing new tasks.
   * Already running tasks will continue to execute.
   *
   * @returns A promise that resolves when the active background process has finished.
   */
  public stop(): Promise<void> {
    this._allowBackgroundJobRunning = false;

    if (this._activeBackgroundJob !== undefined) {
      return this._activeBackgroundJob;
    }

    return Promise.resolve();
  }

  /// impl of AsyncGenerator ///////

  async next(...[__value_not_used]: [] | [any]): Promise<IteratorResult<TValue, any>> {
    // NOTE: async generator WON'T automatically call 'return method' (succeeded pass) on loop exit.
    //       --> return method is invoked only when break or return is called in caller site.
    //       --> i.e., return method cannot be used for resource cleanup. (or need to call explicitly)
    let loopFinished = false;
    let activeTask: Promise<TValue> | undefined = undefined;

    const runningPool = this._runningTaskPool;
    const finishedPool = this._finishedTaskPool;
    const taskSize = this.concurrency;
    const generator = this._generator;

    try {
      // always fill pool because this class allows changing concurrency level dynamically.
      while (runningPool.size < taskSize) {
        const { value: nextItem, done: generatorFinished } = generator.next();
        if (generatorFinished) {
          break;
        }

        activeTask = nextItem.factory(nextItem.source);
        const newTask = activeTask;

        runningPool.add(newTask);

        // DO NOT remove task from pool on finally event!
        // it may lost tracking unexpectedly!!
        newTask
          .then(
            () => finishedPool.add(newTask),
            () => finishedPool.add(newTask)
          );
      }

      if (runningPool.size !== 0) {
        // NOTE: 'for await...of' awaits the outer promise.
        //       but WON'T await internal promise so that here need to await the internal promise!

        // first, just wait for task completion here.
        // use try-catch to avoid jumping to outer catch before identifying finished task.
        try {
          await Promise.race(runningPool);
        } catch {
          // ignore race error here. identifying which task finished is required
          // to ensure it's removed from pool in finally block.
          // the error will be re-thrown by 'await activeTask' below.
        }

        // then, wait for finally event completion.
        while (finishedPool.size === 0) {
          // must create new promise instance everytime to achieve yielding.
          await Promise.resolve();

          // TODO: fail-safe for finally event fails (but, it's not public so no one can add event)
        }

        // ok, take finished task.
        const finishedTask = finishedPool.values().next().value;
        if (finishedTask !== undefined) {
          activeTask = finishedTask;
          return { value: await activeTask, done: false };
        }
      }
      else {
        loopFinished = true;
      }
    }
    catch (error) {
      switch (this.b_errorHandler?.(error, this, 'next')) {
        case 'stop':
          loopFinished = true;
          break;  // must return AFTER finally block.
        case 'skip':
          break;  // must return AFTER finally block.
        default:
          this._raiseErrorAndCleanup(error);
          throw error;
      }
    }
    finally {
      if (activeTask !== undefined) {
        runningPool.delete(activeTask);
        finishedPool.delete(activeTask);
      }

      if (loopFinished) {
        await this._resolveIfNotFailedAndCleanup();
      }
    }

    if (loopFinished) {
      return { value: undefined, done: true };
    }
    else {
      return this.next(__value_not_used);
    }
  }

  private _cleanup(): PromiseLike<void> {
    this._isCompleted = true;
    this._isGeneratorConsuming = false;

    this._allowBackgroundJobRunning = false;
    this._activeBackgroundJob = undefined;

    this._generator[Symbol.dispose]?.();
    this._runningTaskPool.clear();
    this._finishedTaskPool.clear();

    return Promise.resolve();
  }

  private async _resolveIfNotFailedAndCleanup(): Promise<void> {
    try {
      if (!this._isResolvedOrRejected) {
        this._isResolvedOrRejected = true;
        this._callbackResolve();
      }
    }
    finally {
      await this._cleanup();
    }
  }

  private async _raiseErrorAndCleanup(e: any): Promise<void> {
    this._isFailed = true;

    try {
      if (!this._isResolvedOrRejected) {
        this._isResolvedOrRejected = true;
        this._callbackReject(e);
      }
    }
    catch (other) {
      throw new AggregateError([other, e]);
    }
    finally {
      await this._cleanup();
    }
  }

  /// AsyncGenerator Requirements ///////

  [Symbol.asyncIterator](): AsyncGenerator<TValue, any, any> {
    if (this._activeBackgroundJob !== undefined) {
      throw new FiberError('Cannot iterate while generator is running in background');
    }

    this._isGeneratorConsuming = true;

    return this;
  }

  // called when error occurred in 'for await' loop in try-catch.
  async throw(e: any): Promise<IteratorResult<TValue, any>> {
    await this._raiseErrorAndCleanup(e);
    throw e;
  }

  // called only when break or return in 'for await' loop.
  // note that this method is NOT called if loop is successfully finished.
  async return(value: any | PromiseLike<any>): Promise<IteratorResult<TValue, any>> {
    await this._resolveIfNotFailedAndCleanup();
    return { value, done: true };
  }

  [Symbol.asyncDispose](): PromiseLike<void> {
    return this._cleanup();
  }

  /// factory ///////

  private static *_sequence<TResult>(start: number, end: number, step: number, factory: (index: number) => TResult): Generator<TResult> {
    // don't check step value to allow creating infinite sequence.
    for (let i = start; i < end; i += step) {
      yield factory(i);
    }
  }

  private static *_iterator<TSource, TResult>(items: Iterable<TSource>, factory: (item: TSource) => TResult): Generator<TResult> {
    for (const item of items) {
      yield factory(item);
    }
  }

  /**
   * Creates a Fibers instance that executes tasks based on a range of numbers.
   *
   * @template TResult The type of the value resolved by the task's promise.
   * @param concurrency The maximum number of concurrent tasks.
   * @param start The starting index (inclusive).
   * @param end The ending index (exclusive).
   * @param step The increment between indices.
   * @param factory A function that takes the current index and returns a promise for the task.
   * @returns A new Fibers instance.
   */
  public static for<TResult>(
    concurrency: number,
    start: number,
    end: number,
    step: number,
    factory: (index: number) => Promise<TResult>,
  ): Fibers<number, TResult> {
    return new Fibers(
      concurrency,
      this._sequence(
        start, end, step,
        (source) => ({ source, factory }),
      )
    );
  }

  /**
   * Creates a Fibers instance that executes tasks for each item in an iterable.
   *
   * @template TSource The type of the source data.
   * @template TResult The type of the value resolved by the task's promise.
   * @param concurrency The maximum number of concurrent tasks.
   * @param items An iterable collection of source data.
   * @param factory A function that takes an item and returns a promise for the task.
   * @returns A new Fibers instance.
   */
  public static forEach<TSource, TResult>(
    concurrency: number,
    items: Iterable<TSource>,
    factory: (item: TSource) => Promise<TResult>,
  ): Fibers<TSource, TResult> {
    return new Fibers(
      concurrency,
      this._iterator(
        items,
        (source) => ({ source, factory }),
      )
    );
  }

  /// delay ///////

  private static _createAbortError(): DOMException | Error {
    if (typeof DOMException === 'function') {
      return new DOMException('Aborted', 'AbortError');
    } else {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      return error;
    }
  }

  /**
   * Returns a promise that resolves after a specified delay.
   *
   * @param milliseconds The delay in milliseconds.
   * @param signal (Optional) An AbortSignal to cancel the delay.
   * @returns A promise that resolves when the delay has passed or rejects if aborted.
   */
  public static delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        return reject(this._createAbortError());
      }

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve();
      }, milliseconds);

      const onAbort = () => {
        cleanup();
        reject(this._createAbortError());
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
      };

      signal?.addEventListener('abort', onAbort);
    });
  }

  /**
   * Creates an AbortController that automatically aborts after a specified timeout.
   *
   * @param milliseconds The timeout in milliseconds.
   * @returns An AbortController instance.
   */
  public static timeout(milliseconds: number): AbortController {
    const ac = new AbortController();
    Fibers.delay(milliseconds, ac.signal).then(() => ac.abort(), Fibers.emptyFunction);
    return ac;
  }
}
