---
type: source
title: Python官方asyncio核心文档摘录（Coroutines and Tasks）
url: https://docs.python.org/3/library/asyncio-task.html
tags: [Python, asyncio, 官方文档, 异步编程]
---
# Python 官方 `asyncio` 核心文档摘录（Coroutines and Tasks）

- **权威来源 URL**：<https://docs.python.org/3/library/asyncio-task.html>
- **对应章节**：The Python Standard Library $\rightarrow$ Networking and Interprocess Communication $\rightarrow$ `asyncio` — Asynchronous I/O $\rightarrow$ Coroutines and Tasks

---

## 1. Coroutines（协程）与两种核心概念区分

使用 `async/await` 语法声明的协程（Coroutines）是编写 `asyncio` 应用程序的标准方式。文档在 `Awaitables` 章节中特别强调“coroutine”一词涵盖两个紧密关联但处于不同阶段的概念：

1. **协程函数（Coroutine function）**：使用 `async def` 语法定义的函数；
2. **协程对象（Coroutine object）**：调用 `async def` 函数后返回的对象。

**关键运行规则**：直接调用协程函数（如 `main()` 或 `nested()`）仅会创建并返回一个协程对象，不会使其被调度执行：

```python
>>> import asyncio

>>> async def main():
...     print('hello')
...     await asyncio.sleep(1)
...     print('world')

>>> main()
<coroutine object main at 0x1053bb7c8>
```

若在代码中直接调用 `nested()` 而不加 `await`，Python 会抛出 `RuntimeWarning: coroutine 'nested' was never awaited`，且函数体内的代码一行也不会执行。

### 驱动协程执行的三种官方机制

1. **`asyncio.run(main())`**：启动事件循环并运行顶层入口协程 `main()`；
2. **在协程对象前使用 `await`（顺序等待）**：以下代码先等待 1 秒打印 `"hello"`，随后**再等待 2 秒**打印 `"world"`，总耗时 3 秒（串行执行）：
   ```python
   import asyncio
   import time

   async def say_after(delay, what):
       await asyncio.sleep(delay)
       print(what)

   async def main():
       print(f"started at {time.strftime('%X')}")
       await say_after(1, 'hello')
       await say_after(2, 'world')
       print(f"finished at {time.strftime('%X')}")

   asyncio.run(main())
   # started at 17:13:52 -> hello -> world -> finished at 17:13:55 (耗时 3 秒)
   ```
3. **使用 `asyncio.create_task()` 将协程包装为 `Task` 并发调度**：
   ```python
   async def main():
       task1 = asyncio.create_task(say_after(1, 'hello'))
       task2 = asyncio.create_task(say_after(2, 'world'))

       print(f"started at {time.strftime('%X')}")
       await task1
       await task2
       print(f"finished at {time.strftime('%X')}")
   # started at 17:14:32 -> hello -> world -> finished at 17:14:34 (耗时 2 秒)
   ```

---

## 2. Awaitables（可等待对象）

能够在 `await` 表达式中使用的对象称为**可等待对象（Awaitable object）**。`asyncio` 中有三类主要的可等待对象：

1. **Coroutines（协程对象）**：由 `async def` 函数调用产生，可在其他协程中被 `await`；
2. **Tasks（任务对象）**：用于并发调度协程。当协程通过 `asyncio.create_task()` 包装为 `Task` 后，该协程会自动被排入事件循环并尽快并发执行；
3. **Futures（期物对象）**：代表异步操作最终结果的底层可等待对象，日常业务代码通常无需直接手动实例化 `Future`。

---

## 3. Creating Tasks（创建任务）与弱引用回收防坑

### `asyncio.create_task(coro, *, name=None, context=None)`

将 `coro` 协程包装为一个 `Task` 并调度其执行。

> **官方文档重要警告（Important - 强引用保持）**：
> 必须保存 `create_task()` 返回结果的引用，以防任务在执行中途消失。事件循环内部仅对 `Task` 保留**弱引用（weak references）**。如果一个 `Task` 对象没有在外部变量或容器中被引用，垃圾回收器（GC）可能在任务完成前的任意时刻将其销毁。
> 对于“发起即不管（fire-and-forget）”的后台任务，官方标准模式是将其存入集合并在完成回调中移除：
> ```python
> background_tasks = set()
> for i in range(10):
>     task = asyncio.create_task(some_coro(param=i))
>     background_tasks.add(task)
>     task.add_done_callback(background_tasks.discard)
> ```

---

## 4. Sleeping（异步休眠与让出控制权）

### `async asyncio.sleep(delay, result=None)`

- 暂停当前任务 `delay` 秒；若提供了 `result`，则在休眠结束时将其返回给调用方。
- **`sleep()` 总是会挂起（suspend）当前正在运行的任务，从而允许事件循环切换到其他已就绪的任务执行。**
- 将 `delay` 设为 `0` 提供了一个优化路径，用于让长时间运行的函数主动让出控制权，避免单个协程长时间独占事件循环。

---

## 5. Task Groups（任务组）与 Running Tasks Concurrently（并发运行任务）

### （1）`class asyncio.TaskGroup`（Python 3.11+ 结构化并发）

提供结合任务创建与可靠等待的异步上下文管理器：

```python
async def main():
    async with asyncio.TaskGroup() as tg:
        task1 = tg.create_task(some_coro(...))
        task2 = tg.create_task(another_coro(...))
    print(f"Both tasks have completed now: {task1.result()}, {task2.result()}")
```

- `async with` 退出时会自动等待组内所有任务完成，并持有每个任务的强引用。
- **异常联动取消保证**：只要组内任一任务抛出非 `CancelledError` 的异常，`TaskGroup` 会立即自动取消组内其余尚未完成的任务，待全部收尾后将异常汇总为 `ExceptionGroup` 抛出。

### （2）`awaitable asyncio.gather(*aws, return_exceptions=False)`

并发运行 `aws` 序列中的可等待对象（若传入的是协程对象，会自动包装为 `Task` 调度），按传入顺序返回结果列表：

```python
L = await asyncio.gather(
    factorial("A", 2),
    factorial("B", 3),
    factorial("C", 4),
)
```

- **`return_exceptions=False`（默认）**：第一个抛出的异常会立即向上传播给等待 `gather()` 的调用方，但**其余仍在运行的任务不会被自动取消**，会继续在后台运行。
- **`return_exceptions=True`**：异常对象会被视为普通返回值存入结果列表，不会中断其他任务。

---

## 6. Running in Threads（在独立线程中运行阻塞 I/O）

### `async asyncio.to_thread(func, /, *args, **kwargs)`（Python 3.9+）

在独立的工作线程中异步运行同步函数 `func`，返回一个可被 `await` 的协程：

```python
def blocking_io():
    print(f"start blocking_io at {time.strftime('%X')}")
    time.sleep(1)  # 模拟同步文件读写或 requests.get 等阻塞 I/O
    print(f"blocking_io complete at {time.strftime('%X')}")

async def main():
    print(f"started main at {time.strftime('%X')}")
    await asyncio.gather(
        asyncio.to_thread(blocking_io),
        asyncio.sleep(1)
    )
    print(f"finished main at {time.strftime('%X')}")
```

- **核心用途**：若在协程中直接调用 `blocking_io()`（含 `time.sleep()` 或同步 `requests.get()`），会直接阻塞事件循环所在的整个主线程，导致并发失效。通过 `asyncio.to_thread()` 将其卸载到后台线程执行，事件循环主线程即可在等待期间继续调度其他协程。
- **GIL 边界说明**：受限于 Python 全局解释器锁（GIL），`asyncio.to_thread()` 主要用于将 **I/O 密集型（IO-bound）** 同步阻塞函数转化为非阻塞等待；对于纯 Python 的 CPU 密集型计算（未释放 GIL），线程卸载无法突破单核计算瓶颈。
