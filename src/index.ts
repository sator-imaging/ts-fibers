export interface FiberTaskFactory<TSource, TPromise> {
  readonly source: TSource;
  readonly factory: (source: TSource) => Promise<TPromise>;
}

export type FiberErrorHandler<TSource, TValue> = (
  e: any,
  fibers: Fibers<TSource, TValue>,
  reason: 'next' | 'unknown'
) =>
  'stop' | 'skip' | 'default';

export class FiberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiberError";
  }
}

/*
  TODO: make Fibers thenable(awaitable) by adding then() method
        --> `await fibers` to start fibers automatically before returning promise
        --> obsolete .promiseStart property (mark with deprecated tag)

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2>;

  * no change introduced since first available: lib.es2015.promise.d.ts

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
   * @description
   * This property can be used for any purpose you desired.
   * (ex. set identifier for tracking fibers that running in background)
   */
  public state: unknown;

  /**
   * @description
   * DO NOT forget to call `start()` before `await` to avoid indefinite loop.
   */
  public get promise(): Promise<void> { return this._fibersPromise; }

  /**
   * @description
   * Automatically invoke `start()` before getting value.
   */
  public get promiseStart(): Promise<void> {
    this.start();
    return this._fibersPromise;
  }

  private b_concurrency: number = 1;
  public get concurrency(): number { return this.b_concurrency; }
  public set concurrency(value: number) {
    if (value <= 0) {
      throw new FiberError(`Concurrency level must be greater than 0: ${value}`);
    }
    this.b_concurrency = value;
  };

  private b_errorHandler: FiberErrorHandler<TSource, TValue> | undefined;
  public setErrorHandler(handler: FiberErrorHandler<TSource, TValue> | undefined): void {
    this.b_errorHandler = handler;
  }

  public get failed(): boolean { return this._isFailed; };
  public get started(): boolean { return this._activeBackgroundJob !== undefined; };
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
          .catch(Fibers.emptyFunction)  // this is NOT required but required to suppress vitest!
          .finally(() => finishedPool.add(newTask));
      }

      if (runningPool.size !== 0) {
        // NOTE: 'for await...of' awaits the outer promise.
        //       but WON'T await internal promise so that here need to await the internal promise!

        // first, just wait for task completion here
        await Promise.race(runningPool);

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

  public static delay(milliseconds: number, ac?: AbortController): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (ac?.signal.aborted) {
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
        ac?.signal.removeEventListener('abort', onAbort);
      };

      ac?.signal.addEventListener('abort', onAbort);
    });
  }
}
