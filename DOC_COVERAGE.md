# Documentation Coverage Report

## Overall Check Result

The documentation in `README.md` (and its Japanese/Chinese translations) provides good coverage of the core features and common use cases of the `ts-fibers` library. Most public APIs are either explicitly documented with examples or mentioned in the advanced usage sections.

However, some properties and newer features (like `Symbol.asyncDispose`) are currently missing from the documentation.

## Detailed Result Follows

### Classes and Interfaces

| Component | Status | Notes |
| :--- | :--- | :--- |
| `Fibers` | Covered | Main class, documented through factory methods. |
| `FiberError` | Covered | Mentioned in the limitations section. |
| `FiberTaskFactory` | Not Covered | Exported interface, but not documented. |
| `FiberErrorHandler` | Covered | Documented via `setErrorHandler` examples. |

### `Fibers` Instance Members

| Member | Status | Notes |
| :--- | :--- | :--- |
| `state` | Covered | Documented in "Background Tasks & Error Handling". |
| `promise` | Covered | Documented in "Working with Promise". |
| `promiseStart` | Covered | Mentioned as a fail-safe property. |
| `concurrency` | Partial | Used in factory methods, but dynamic updates via setter are not documented. |
| `setErrorHandler()` | Covered | Well-documented with examples. |
| `failed` | Not Covered | Getter for failure state. |
| `started` | Not Covered | Getter for started state. |
| `completed` | Not Covered | Getter for completion state. |
| `start()` | Covered | Well-documented. |
| `stop()` | Covered | Well-documented. |
| `next()` | Covered | Documented via `for await...of` usage. |
| `[Symbol.asyncIterator]` | Covered | Documented via `for await...of` usage. |
| `throw()` | Covered | Implicitly handled by `for await...of`. |
| `return()` | Covered | Implicitly handled by `for await...of`. |
| `[Symbol.asyncDispose]` | Not Covered | Support for `await using` is not documented. |

### `Fibers` Static Methods

| Method | Status | Notes |
| :--- | :--- | :--- |
| `for()` | Covered | Well-documented in Quick Start. |
| `forEach()` | Covered | Well-documented in Quick Start. |
| `delay()` | Covered | Well-documented in its own section. |
