[![npm](https://img.shields.io/npm/v/ts-fibers.svg)](https://www.npmjs.com/package/ts-fibers)
[![npm-publish](https://github.com/sator-imaging/ts-fibers/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/sator-imaging/ts-fibers/actions/workflows/npm-publish.yml)
&nbsp;
[![DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/sator-imaging/ts-fibers)

[🇺🇸 English](./README.md)
&nbsp; ❘ &nbsp;
[🇯🇵 日本語版](./README.ja.md)
&nbsp; ❘ &nbsp;
[🇨🇳 简体中文版](./README.zh-CN.md)





# `ts-fibers`：TypeScript 微线程库

`ts-fibers` 是一个强大且高效的 TypeScript **协程/微线程库**，旨在帮助您管理异步操作和长时间运行的任务，同时避免 CPU 使用率飙升或过多的内存分配。它利用 TypeScript 的 `Generator` 和 `AsyncGenerator` 特性，对任务执行提供精细控制，使您的应用程序响应更迅速，资源更友好。


## ✨ 主要特性

*   **并发控制：** 轻松管理并发任务的执行级别。
*   **高效操作：** 利用原生的 `Generator` 和 `AsyncGenerator` 优化性能。
*   **后台任务执行：** (实验性) 在后台运行 Fiber 任务，释放主线程。
*   **有序结果：** 按照任务完成的顺序获取结果，并可选择跟踪原始任务上下文。
*   **健壮的错误处理：** 为您的 Fiber 任务定义自定义错误处理策略。
*   **Promise 集成：** 与标准 JavaScript Promise 无缝集成，用于任务生命周期管理。
*   **模块支持：** 支持 `ESM`、`CJS` 和 `UMD`。





# ⚡ 快速开始

`ts-fibers` 提供了两种主要的工厂方法来创建 Fibers 实例：`Fibers.forEach` 用于数组枚举，`Fibers.for` 用于顺序操作。


## 数组枚举 (`Fibers.forEach`)

使用 `Fibers.forEach` 并发处理数组元素。

```ts
import { Fibers } from 'ts-fibers';

// 示例：从提供的 URL 并发下载，并发级别为 5
const fibers = Fibers.forEach(
  5,     // 最大并发任务数
  urls,  // 要迭代的数组
  async (url) => {
    return await downloadAsync(url);
  }
);

// 使用 `for await...of` 迭代已完成的任务
for await (const downloadedData of fibers) {
  console.log(`下载完成：${downloadedData.title}`);
}
```


## 顺序操作 (`Fibers.for`)

当您需要迭代一个数字范围时，使用 `Fibers.for`，类似于 `for` 循环。

```ts
import { Fibers } from 'ts-fibers';

// 示例：并发下载 310 个文件，并发级别为 5
const fibers = Fibers.for(
  5,          // 最大并发任务数
  0, 310, 1,  // 起始索引、结束索引（不包含）和步长
  async (index) => {
    return await downloadAsync(`https://...${index}.bin`);
  }
);

// 使用 `for await...of` 迭代已完成的任务
for await (const downloadedData of fibers) {
  console.log(`下载完成：${downloadedData.title}`);
}
```





# 💡 高级用法

## 使用源信息跟踪任务进度

`Fibers` 按照任务完成的顺序返回已完成的任务。然而，有时原始源索引或数组元素对于进一步处理至关重要。您可以轻松地将此源信息打包到 Fibers 任务的结果中。

```ts
import { Fibers } from 'ts-fibers';

const fibers = Fibers.for(concurrency, startIndex, endIndex, step,
  async (index) => {
    const value = await fooAsync(index);

    // 💡 将索引与结果打包以允许跟踪任务
    return { index, value };
  });

for await (const result of fibers) {
  if (result.index === 1) continue;
  console.log(`${result.index}: ${result.value}`);
}

// 迭代顺序可能不是按索引顺序的，但任务索引始终被跟踪
// 3: delta
// 0: alpha
// 2: charlie
```


## 后台任务与错误处理 (实验性)

> [!WARNING]
> 此功能为实验性功能，可能会发生变化。在生产环境中使用时请谨慎。

Fibers 后台任务在主线程上执行。这允许您“即发即忘”任务，异步管理它们的生命周期和错误。

```ts
import { Fibers } from 'ts-fibers';

const fibers = Fibers.for(concurrency, startIndex, endIndex, step,
  async (index) => {
    if (someCondition(index)) throw new Error(`Error for task ${index}`);
    return await backgroundTask(index);
  }
);

// 为 fibers 设置一个状态以在后台跟踪任务
fibers.state = 'background job #1';

// 注册错误处理器
fibers.setErrorHandler((e, fibersInstance, reason) => {
  if (fibersInstance.state) console.error(`Error in ${fibersInstance.state}: ${e.message}`);

  // 决定如何处理错误：'skip'（跳过）、'stop'（停止）或 'default'（重新抛出）
  // 在这里，如果任务来自 'background job #1'，我们跳过它，否则重新抛出
  return fibersInstance.state === 'background job #1' ? 'skip' : 'default';
});

// 为整个 fibers 生命周期注册 promise 回调
fibers.promise
  .then(() => console.log('Background fibers completed successfully!'))
  .catch(err => console.error('Background fibers encountered an unhandled error:', err.message))
  .finally(() => console.log('Background fibers process finished.'));

// 准备在后台启动 fibers（即发即忘）
fibers.start();

// 您可以在特定时间或条件下停止 fibers
// 注意：stop() 不会暂停正在运行（已排队）的任务；它只是停止排队新任务
setTimeout(() => {
  console.log('3 秒后停止后台 fibers...');
  fibers.stop();
}, 3000);
```

### 错误处理策略

当 Fiber 任务失败时，您可以通过从错误处理器返回以下策略之一来控制 `Fibers` 实例的行为：

- **`default`**：`for await...of` 循环抛出原始异常。请注意，已排队的 fiber 任务可能会在后台继续运行。
- **`skip`**：跳过失败的 fiber 任务，`Fibers` 实例继续执行下一个任务而不抛出异常。
- **`stop`**：`Fibers` 实例立即停止，防止排队新任务。已经在运行的任务可能会继续运行。请注意，`for await...of` 循环会成功结束。


## 使用 `Promise`

Fibers 实例通过 `.promise` 属性提供一个 `Promise<void>` 句柄，允许您为整个 Fibers 生命周期使用标准的 `then`、`catch` 和 `finally` 回调。

> [!NOTE]
> 生成的 promise 句柄是针对 `Fibers` 实例本身的，**而不是**针对 Fibers 中正在运行的各个任务的 promise。

```ts
import { Fibers } from 'ts-fibers';

const fibers = Fibers.for(...);

// 为 fibers 的生命周期注册回调
fibers.promise
  .then(...)
  .catch(...)
  .finally(...);

// 启动 fibers
const startPromise = fibers.start();
  // startPromise 将在 stop() 或 fibers 完成时解析
  // 即 `await fibers.start()` 等同于 `await fibers.promise`

// 当停止时，当然不会调用 promise 回调
const stopPromise = fibers.stop();
  // stopPromise 将在当前排队的 fibers 任务完成时解析

// 如果您不等待，任务可能仍在后台运行
await stopPromise;

// 重新启动 fibers 并等待完成，无需 'for await...of'
fibers.start();
await fibers.promise;
  // 注意：有一个故障安全属性 '.promiseStart'，它将调用 start()
  // 自动避免因等待已停止的 fibers 而导致的无限循环

// promise 回调被调用！！
```


## `start()` 和 `for await...of` 的限制

一旦在 Fibers 实例上调用 `start()`，尝试在同一实例上使用 `for await...of` 将抛出 `FiberError`，直到 fibers 完成或明确停止。相反，在 `for await...of` 循环中调用 `start()` 也会抛出 `FiberError`。

```ts
import { Fibers, FiberError } from 'ts-fibers';

const fibers = Fibers.forEach(...);

// 场景 1：调用 start() 后使用 for await...of
fibers.start();
for await (const result of fibers) { } // 抛出 FiberError

// 场景 2：在 for await...of 内部调用 start()
for await (const result of fibers) {
  fibers.start(); // 抛出 FiberError
}
```





# ⏱️ `Fibers.delay`

一个简单的辅助方法，用于等待指定的毫秒数，类似于 `setTimeout`，但集成了 `Promise` 和 `AbortController`。

```ts
import { Fibers } from 'ts-fibers';

console.log('等待 1 秒...');

await Fibers.delay(1000);
console.log('1 秒过去了！');

// 使用 AbortController 取消延迟
const ac = new AbortController();

console.log('启动一个 5 秒计时器，但会在 1 秒后中止...');

const timer = Fibers.delay(5000, ac);
timer.finally(() => console.log('已完成或已中止'));

setTimeout(() => {
  ac.abort();  // 立即停止计时器！
  console.log('计时器已中止！');
}, 1000);
```





# 🤝 贡献

我们欢迎贡献！