[![npm](https://img.shields.io/npm/v/ts-fibers.svg)](https://www.npmjs.com/package/ts-fibers)
[![npm-publish](https://github.com/sator-imaging/ts-fibers/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/sator-imaging/ts-fibers/actions/workflows/npm-publish.yml)
&nbsp;
[![DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/sator-imaging/ts-fibers)

[🇺🇸 English](./README.md)
&nbsp; ❘ &nbsp;
[🇯🇵 日本語版](./README.ja.md)
&nbsp; ❘ &nbsp;
[🇨🇳 简体中文版](./README.zh-CN.md)





# `ts-fibers`: TypeScript向けマイクロスレッディング

`ts-fibers`は、TypeScript向けの強力で効率的な**コルーチン/マイクロスレッディング**ライブラリです。CPU使用率の急上昇や過剰なメモリ割り当てを引き起こすことなく、非同期操作や長時間実行タスクを管理できるように設計されています。TypeScriptの`Generator`および`AsyncGenerator`機能を活用して、タスク実行をきめ細かく制御し、アプリケーションの応答性とリソース効率を向上させます。


## ✨ 主な機能

*   **並行処理制御:** 並行タスク実行のレベルを簡単に管理できます。
*   **効率的な操作:** ネイティブの`Generator`および`AsyncGenerator`を使用した最適化されたパフォーマンス。
*   **バックグラウンドタスク実行:** (実験的) メインスレッドを解放し、Fiberタスクをバックグラウンドで実行します。
*   **順序付けられた結果:** タスクが完了した順序で結果を取得し、元のタスクコンテキストを追跡するオプションもあります。
*   **堅牢なエラー処理:** Fiberタスクのカスタムエラー処理戦略を定義します。
*   **Promise統合:** 標準のJavaScript Promiseとシームレスに統合し、タスクのライフサイクルを管理します。
*   **モジュールサポート:** `ESM`、`CJS`、`UMD`がサポートされています。





# ⚡ クイックスタート

`ts-fibers`は、Fibersインスタンスを作成するための2つの主要なファクトリメソッドを提供します。配列の列挙には`Fibers.forEach`を、シーケンシャルな操作には`Fibers.for`を使用します。


## 配列の列挙 (`Fibers.forEach`)

`Fibers.forEach`を使用して、配列の要素を並行して処理します。

```ts
import { Fibers } from 'ts-fibers';

// 例: 指定されたURLから並行してダウンロード（並行レベル5）
const fibers = Fibers.forEach(
  5,     // 最大並行タスク数
  urls,  // イテレートする配列
  async (url) => {
    return await downloadAsync(url);
  }
);

// `for await...of`を使用して完了したタスクをイテレート
for await (const downloadedData of fibers) {
  console.log(`Download completed: ${downloadedData.title}`);
}
```


## シーケンシャルな操作 (`Fibers.for`)

`for`ループと同様に、数値の範囲をイテレートする必要がある場合は`Fibers.for`を使用します。

```ts
import { Fibers } from 'ts-fibers';

// 例: 310個のファイルを並行してダウンロード（並行レベル5）
const fibers = Fibers.for(
  5,          // 最大並行タスク数
  0, 310, 1,  // 開始インデックス、終了インデックス（排他的）、ステップ
  async (index) => {
    return await downloadAsync(`https://...${index}.bin`);
  }
);

// `for await...of`を使用して完了したタスクをイテレート
for await (const downloadedData of fibers) {
  console.log(`Download completed: ${downloadedData.title}`);
}
```





# 💡 高度な使用法

## ソース情報によるジョブの進捗状況の追跡

`Fibers`は、完了したタスクを完了した順序で返します。しかし、元のソースインデックスや配列要素がさらなる処理に不可欠な場合があります。このソース情報をFibersタスクの結果に簡単に含めることができます。

```ts
import { Fibers } from 'ts-fibers';

const fibers = Fibers.for(concurrency, startIndex, endIndex, step,
  async (index) => {
    const value = await fooAsync(index);

    // 💡 ジョブを追跡できるように、インデックスを結果に含める
    return { index, value };
  });

for await (const result of fibers) {
  if (result.index === 1) continue;
  console.log(`${result.index}: ${result.value}`);
}

// イテレーションの順序はインデックス順ではないかもしれませんが、ジョブインデックスは常に追跡されます
// 3: delta
// 0: alpha
// 2: charlie
```


## バックグラウンドタスクとエラー処理 (実験的)

> [!WARNING]
> この機能は実験的であり、変更される可能性があります。本番環境での使用は注意してください。

Fibersのバックグラウンドタスクはメインスレッドで実行されます。これにより、タスクを「起動して忘れる」ことができ、そのライフサイクルとエラーを非同期で管理できます。

```ts
import { Fibers }s from 'ts-fibers';

const fibers = Fibers.for(concurrency, startIndex, endIndex, step,
  async (index) => {
    if (someCondition(index)) throw new Error(`Error for task ${index}`);
    return await backgroundTask(index);
  }
);

// ジョブをバックグラウンドで追跡するために、fibersの状態を設定
fibers.state = 'background job #1';

// エラーハンドラを登録
fibers.setErrorHandler((e, fibersInstance, reason) => {
  if (fibersInstance.state) console.error(`Error in ${fibersInstance.state}: ${e.message}`);

  // エラーの処理方法を決定: 'skip'、'stop'、または 'default'（再スロー）
  // ここでは、'background job #1'からのタスクであればスキップし、そうでなければ再スロー
  return fibersInstance.state === 'background job #1' ? 'skip' : 'default';
});

// 全体のFibersライフサイクルに対するPromiseコールバックを登録
fibers.promise
  .then(() => console.log('Background fibers completed successfully!'))
  .catch(err => console.error('Background fibers encountered an unhandled error:', err.message))
  .finally(() => console.log('Background fibers process finished.'));

// バックグラウンドでfibersを開始する準備ができました（起動して忘れる）
fibers.start();

// 一定時間または条件後にfibersを停止できます
// 注: stop()は実行中の（キューに入れられた）タスクを中断しません。新しいタスクのキューイングを停止するだけです
setTimeout(() => {
  console.log('Stopping background fibers after 3 seconds...');
  fibers.stop();
}, 3000);
```

### エラー処理戦略

Fiberタスクが失敗した場合、エラーハンドラーから以下の戦略のいずれかを返すことで、`Fibers`インスタンスの動作を制御できます。

- **`default`**: `for await...of`ループは元の例外をスローします。キュー内の残りのタスクは破棄されますが、すでに実行中のタスクは実行を継続する場合があります。
- **`skip`**: 失敗したFiberタスクはスキップされ、`Fibers`インスタンスは例外をスローせずに次のタスクを続行します。
- **`stop`**: `Fibers`インスタンスは直ちに停止し、新しいタスクのキューイングを防止します。すでに実行中のタスクは実行を継続する場合があります。`for await...of`ループは正常に終了することに注意してください。


## `Promise`の操作

Fibersインスタンスは、`.promise`プロパティを介して`Promise<void>`ハンドルを提供し、全体のFibersライフサイクルに対して標準の`then`、`catch`、`finally`コールバックを使用できます。

> [!NOTE]
> 結果のPromiseハンドルは、Fibers内で実行されている個々のジョブのPromiseではなく、`Fibers`インスタンス自体に対するものです。

```ts
import { Fibers } from 'ts-fibers';

const fibers = Fibers.for(...);

// fibersのライフサイクルに対するコールバックを登録
fibers.promise
  .then(...)
  .catch(...)
.finally(...);

// fibersを開始
const startPromise = fibers.start();
  // startPromiseはstop()時、またはfibersが完了したときに解決されます
  // つまり、`await fibers.start()`は`await fibers.promise`と同じです

// 停止した場合、もちろんPromiseコールバックは呼び出されません
const stopPromise = fibers.stop();
  // stopPromiseは、現在キューに入れられているfibersタスクが完了したときに解決されます

// awaitしない場合、タスクはバックグラウンドで実行され続ける可能性があります
await stopPromise;

// fibersを再起動し、'for await...of'なしで完了を待つ
fibers.start();
await fibers.promise;
  // 注: 停止したfibersを待機することによって引き起こされる無限ループを避けるために、
  // start()を自動的に呼び出すフェイルセーフプロパティ'.promiseStart'があります

// Promiseコールバックが呼び出されます！
```


## `start()`と`for await...of`の制限

Fibersインスタンスで`start()`が呼び出されると、同じインスタンスで`for await...of`を使用しようとすると、fibersが完了するか明示的に停止されるまで`FiberError`がスローされます。逆に、`for await...of`ループ内で`start()`を呼び出しても`FiberError`がスローされます。

```ts
import { Fibers, FiberError } from 'ts-fibers';

const fibers = Fibers.forEach(...);

// シナリオ1: start()を呼び出してからfor await...ofを使用
fibers.start();
for await (const result of fibers) { } // FiberErrorをスロー

// シナリオ2: for await...of内でstart()を呼び出す
for await (const result of fibers) {
  fibers.start(); // FiberErrorをスロー
}
```





# ⏱️ `Fibers.delay`

`setTimeout`に似ていますが、`Promise`と`AbortController`の統合を備えた、指定されたミリ秒数待機するためのシンプルなヘルパーメソッドです。

```ts
import { Fibers } from 'ts-fibers';

console.log('Waiting for 1 second...');

await Fibers.delay(1000);
console.log('1 second passed!');

// AbortControllerと連携して遅延をキャンセル
const ac = new AbortController();

console.log('Starting a 5-second timer, but will abort after 1 second...');

const timer = Fibers.delay(5000, ac);
timer.finally(() => console.log('finished or aborted'));

setTimeout(() => {
  ac.abort();  // タイマーを即座に停止！
  console.log('Timer aborted!');
}, 1000);
```





# 🤝 貢献

貢献を歓迎します！