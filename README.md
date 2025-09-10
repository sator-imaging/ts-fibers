[![npm](https://img.shields.io/npm/v/ts-fibers.svg)](https://www.npmjs.com/package/ts-fibers)



# ts-fibers: Microthreading for TypeScript

`ts-fibers` is a powerful and efficient coroutine/microthreading library for TypeScript, designed to help you manage asynchronous operations and long-running tasks without causing CPU usage spikes or excessive memory allocation. It leverages TypeScript's `Generator` and `AsyncGenerator` features to provide fine-grained control over task execution, making your applications more responsive and resource-friendly.


## ✨ Key Features

* **Concurrency Control:** Easily manage the level of concurrent task execution.
* **Efficient Operations:** Optimized performance using native `Generator` and `AsyncGenerator`.
* **Background Task Execution:** (Experimental) Run Fiber tasks in the background, freeing up the main thread.
* **Ordered Results:** Get results back in the order they complete, with options to track original task context.
* **Robust Error Handling:** Define custom error handling strategies for your Fiber tasks.
* **Promise Integration:** Seamlessly integrate with standard JavaScript Promises for task lifecycle management.
* **Module Support:** `ESM`, `CJS` and `UMD` are supported.





# ⚡ Quick Start

`ts-fibers` provides two primary factory methods for creating Fibers instances: `Fibers.forEach` for array enumeration and `Fibers.for` for sequential operations.

```bash
# 🚀 Installation
npm install ts-fiber
```


## Array Enumeration (`Fibers.forEach`)

Use `Fibers.forEach` to process elements of an array concurrently.

```ts
import { Fibers } from 'ts-fibers';

// Example: Download from provided urls concurrently, with a concurrency level of 5
const fibers = Fibers.forEach(
  5,     // Maximum concurrent tasks
  urls,  // Array to iterate over
  async (url) => {
    return await downloadAsync(url);
  }
);

// iterate through completed tasks using `for await...of`
for await (const downloadedData of fibers) {
  console.log(`Download completed: ${downloadedData.title}`);
}
```


## Sequential Operations (`Fibers.for`)

Use `Fibers.for` when you need to iterate over a range of numbers, similar to a `for` loop.

```ts
import { Fibers } from 'ts-fibers';

// Example: Download 310 files concurrently, with a concurrency level of 5
const fibers = Fibers.for(
  5,          // Maximum concurrent tasks
  0, 310, 1,  // Start index, End index (exclusive) and Step
  async (index) => {
    return await downloadAsync(`https://...${index}.bin`);
  }
);

// iterate through completed tasks using `for await...of`
for await (const downloadedData of fibers) {
  console.log(`Download completed: ${downloadedData.title}`);
}
```





# 💡 Advanced Usage

## Tracking Job Progress with Source Information

`Fibers` returns finished tasks in order as they complete. However, sometimes the original source index or array element is crucial for further processing. You can easily pack this source information into your Fibers task's result.

```ts
import { Fibers } from 'ts-fibers';

const fibers = Fibers.for(concurrency, startIndex, endIndex, step,
  async (index) => {
    const value = await fooAsync(index);

    // 💡 Pack index with result to allow tracking job
    return { index, value };
  });

for await (const result of fibers) {
  if (result.index === 1) continue;
  console.log(`${result.index}: ${result.value}`);
}

// The iteration order may not be sequential by index, but the job index is always tracked
// 3: delta
// 0: alpha
// 2: charlie
```


## Background Tasks & Error Handling (Experimental)

> [!WARNING]
> This feature is experimental and subject to change. Use with caution in production environments.

Fibers background tasks are executed on the main thread. This allows you to "fire and forget" tasks, managing their lifecycle and errors asynchronously.

```ts
import { Fibers } from 'ts-fibers';

const fibers = Fibers.for(concurrency, startIndex, endIndex, step,
  async (index) => {
    if (someCondition(index)) throw new Error(`Error for task ${index}`);
    return await backgroundTask(index);
  }
);

// Set a state for the fibers to track the job in the background
fibers.state = 'background job #1';

// Register an error handler
fibers.setErrorHandler((e, fibersInstance, reason) => {
  if (fibersInstance.state) console.error(`Error in ${fibersInstance.state}: ${e.message}`);

  // Decide how to handle the error: 'skip', 'stop', or 'default' (re-throw)
  // Here, we skip the task if it's from 'background job #1', otherwise re-throw
  return fibersInstance.state === 'background job #1' ? 'skip' : 'default';
});

// Register promise callbacks for the overall fibers lifecycle
fibers.promise
  .then(() => console.log('Background fibers completed successfully!'))
  .catch(err => console.error('Background fibers encountered an unhandled error:', err.message))
  .finally(() => console.log('Background fibers process finished.'));

// Ready to start the fibers in the background (fire and forget)
fibers.start();

// You can stop the fibers after a certain time or condition
// Note: stop() won't suspend running (queued) tasks; it just stops queueing new tasks
setTimeout(() => {
  console.log('Stopping background fibers after 3 seconds...');
  fibers.stop();
}, 3000);
```


## Working with `Promise`

Fibers instances provide a `Promise<void>` handle via the `.promise` property, allowing you to use standard `then`, `catch`, and `finally` callbacks for the overall Fibers lifecycle.

> [!NOTE]
> The resulting promise handle is for the `Fibers` instance itself, **NOT** for the individual promises of the running jobs within the Fibers.

```ts
import { Fibers } from 'ts-fibers';

const fibers = Fibers.for(concurrency, startIndex, endIndex, step, async (index) => {
  return await fooAsync(index);
});

// Register callbacks for the fibers' lifecycle
fibers.promise
  .then(...)
  .catch(...)
  .finally(...);

// Start the fiber
const startPromise = fibers.start();
  // *startPromise will be resolved on stop() or when fibers is completed
  // ie. `await fibers.start()` is same to `await fibers.promise`

// When stopped, of course, promise callbacks are NOT invoked
const stopPromise = fibers.stop();
  // *stopPromise will be resolved when currently-queued fibers tasks are completed

// If you don't await, tasks may still be running in the background
await stopPromise;

// Restart fibers and wait for completion without 'for await...of'
fibers.start();
await fibers.promise;
  // Note: There is a fail-safe property '.promiseStart' that will invoke start()
  // automatically to avoid an indefinitely loop caused by awaiting a stopped fiber

// promise callbacks are invoked!!
```


## `start()` and `for await...of` Limitations

Once `start()` is called on a Fibers instance, attempting to use `for await...of` on the same instance will throw a `FiberError` until the fibers is completed or explicitly stopped. Conversely, calling `start()` within a `for await...of` loop will not throw immediately but will cause subsequent `for await...of` iterations to fail.

```ts
import { Fibers, FiberError } from 'ts-fibers';

const fibers = Fibers.forEach(...);

// Scenario 1: Calling start() then using for await...of
fibers.start();
for await (const result of fibers) { } // Throws FiberError

// Scenario 2: Calling start() inside for await...of
for await (const result of fibers) {
  // Subsequent iterations of 'for await...of' will fail due to the fibers being started
  fibers.start(); // This won't throw immediately
}
```





# ⏱️ `Fibers.delay`

A simple helper method to wait for a specified number of milliseconds, similar to `setTimeout` but with `Promise` and `AbortController` integration.

```ts
import { Fibers } from 'ts-fibers';

console.log('Waiting for 1 second...');

await Fibers.delay(1000);
console.log('1 second passed!');

// Work with AbortController to cancel the delay
const ac = new AbortController();

console.log('Starting a 5-second timer, but will abort after 1 second...');

const timer = Fibers.delay(5000, ac);
timer.promise.finally(() => console.log('finished or aborted'));

setTimeout(() => {
  ac.abort();  // Stop timer immediately!
  console.log('Timer aborted!');
}, 1000);
```





# 🤝 Contributing

We welcome contributions!
