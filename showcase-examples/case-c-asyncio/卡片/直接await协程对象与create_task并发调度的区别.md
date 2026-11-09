---
type: card
title: 直接await协程对象与create_task并发调度的区别
tags: [Python, asyncio, 语言特性, Task, 并发调度]
---
# 直接 `await` 协程对象与 `create_task` 并发调度的区别

## 内容

Python 官方文档给出了两段极具代表性的对比代码。面对相同的 `say_after(delay, what)` 协程函数，写法 A 耗时 **3 秒**（串行），写法 B 耗时 **2 秒**（并发）：

```python
import asyncio
import time

async def say_after(delay, what):
    await asyncio.sleep(delay)
    print(what)

# 写法 A：直接连续 await 两个协程对象（总耗时 3 秒，串行执行）
async def main_serial():
    print(f"started at {time.strftime('%X')}")
    await say_after(1, 'hello')
    await say_after(2, 'world')
    print(f"finished at {time.strftime('%X')}")

# 写法 B：先用 asyncio.create_task() 包装为 Task 并发调度，再 await（总耗时 2 秒，并发执行）
async def main_concurrent():
    task1 = asyncio.create_task(say_after(1, 'hello'))
    task2 = asyncio.create_task(say_after(2, 'world'))

    print(f"started at {time.strftime('%X')}")
    await task1
    await task2
    print(f"finished at {time.strftime('%X')}")
```

**相关核心原语签名与官方警告**：
- `asyncio.create_task(coro, *, name=None, context=None)`：将协程对象 `coro` 包装为一个 `Task`（任务对象）并**立即注册到事件循环的就绪队列中排期执行**，返回该 `Task` 对象。
- **弱引用回收警告**：事件循环内部仅对 `Task` 保留弱引用（weak reference）。若不将 `create_task()` 的返回值赋给变量或存入集合，垃圾回收器（GC）可能在任务完成前随时将其销毁。

<details>
<summary>查看原页</summary>

- 来源：[[来源/Python官方asyncio核心文档摘录|Python官方asyncio核心文档摘录（Coroutines and Tasks）]]（<https://docs.python.org/3/library/asyncio-task.html#coroutines> 及 <https://docs.python.org/3/library/asyncio-task.html#creating-tasks>）

</details>

## 参考理解

### 1. 引入动机：为什么写了两个 `await` 还是花了 $1 + 2 = 3$ 秒？

在掌握了 [[卡片/事件循环EventLoop与await主动让出控制权机制|事件循环 EventLoop 与 await 主动让出控制权机制]] 后，很多学习者会写出写法 A：

```python
await say_after(1, 'hello')  # 第 1 行
await say_after(2, 'world')  # 第 2 行
```

运行后却惊讶地发现总耗时依然是 3 秒。原因在于：**在普通顺序语句中，`await` 关键字具有“原地挂起当前函数，直到右侧对象彻底跑完才往下走”的语义**。

在写法 A 中，当执行第 1 行 `await say_after(1, 'hello')` 时，`main_serial()` 立刻在原地挂起；**此时第 2 行代码根本还没有被执行到**，`say_after(2, 'world')` 这个协程对象连创建都还没创建，事件循环的就绪队列里没有任何其他任务可切。因此，事件循环只能干等第 1 个协程的 1 秒休眠结束并打印 `'hello'` 后，才回到 `main_serial()` 继续往下走到第 2 行，此时才创建并启动第 2 个协程的 2 秒休眠。两个休眠时间段在时间轴上首尾相接，总耗时自然是 $1 + 2 = 3$ 秒。

### 2. 定义拆解：`Coroutine Object`（冷蓝图）与 `Task`（已排期的热任务）

要让两个休眠计时器在**同一时刻（第 0 秒）**同时开始倒计时，就必须把“向事件循环登记启动任务”和“原地等待任务结果”这两个动作拆开。为此，`asyncio` 提供了 **任务对象（`asyncio.Task`）**：

- **裸协程对象（`say_after(1, 'hello')`）**：相当于一份尚未提交给调度器的“待办蓝图”。只有当代码直接 `await` 它，或者将它包装进 `Task` 时，它才会被推进。
- **任务对象（`asyncio.create_task(coro)`）**：一旦调用 `asyncio.create_task(coro)`，事件循环会立即将该协程包装为 `Task` 并排入就绪日程表（Schedule to run soon），无需等到 `await task` 这一行才启动；而 `create_task()` 本身是一个**非阻塞的同步调用**，登记完毕后立即返回 `task` 句柄，让外层函数继续往下执行下一行代码。

### 3. 执行时间轴逐秒对比（写法 A vs 写法 B）

对比写法 B（`main_concurrent`）在单线程事件循环中的真实推进过程（也可在课堂白板 [[白板/asyncio事件循环调度推演.canvas|asyncio 事件循环调度推演]] 的逐帧组件中直观查看）：

| 时间点 | 写法 A（连续直接 `await coro`） | 写法 B（先 `create_task` 再 `await task`） |
| :--- | :--- | :--- |
| **$t = 0\text{s}$** | 创建协程 1 并立即挂起 `main`；协程 1 开始 1s 倒计时。**协程 2 尚未创建**。 | 连续调用两次 `create_task`，`task1` 和 `task2` 均已排入就绪队列。随后执行 `await task1`，`main` 挂起让出控制权；事件循环在 $t = 0\text{s}$ 接连启动 `task1`（开始 1s 倒计时）和 `task2`（开始 2s 倒计时）。**此时两个计时器同时在后台倒数**。 |
| **$t = 1\text{s}$** | 协程 1 到期打印 `'hello'`，恢复 `main`；此时才创建协程 2 并开始 2s 倒计时。 | `task1` 到期打印 `'hello'` 并完成；`await task1` 立即解除挂起，往下执行到 `await task2`。此时 `task2` 的 2s 倒计时已经过去了 1 秒，仅剩最后 1 秒。 |
| **$t = 2\text{s}$** | 协程 2 仍在倒计时（还剩 1 秒）。 | `task2` 到期打印 `'world'`，`await task2` 完成，整个程序在 **2.00 秒**结束。 |
| **$t = 3\text{s}$** | 协程 2 到期打印 `'world'`，程序在 **3.00 秒**结束。 | — |

### 4. 高频防坑：弱引用垃圾回收（GC）陷阱

官方文档在 `Creating tasks` 章节特别标出了一个生产环境高频隐蔽 Bug：

```python
# 危险反例：未保存 create_task 的返回值引用！
asyncio.create_task(some_coro())
```

由于事件循环内部只对 `Task` 持有**弱引用（Weak Reference）**，如果外部没有任何变量指向这个 `Task` 对象，Python 的垃圾回收器（GC）一旦在 `some_coro()` 挂起等待 I/O 期间运行，就会判定该对象“无人使用”并将其直接销毁，导致任务执行到一半神秘消失。

- **需要等待结果时**：赋给变量（如 `task1 = asyncio.create_task(...)`）或直接交给 [[卡片/异步并发任务编排与阻塞操作卸载模式|异步并发任务编排与阻塞操作卸载模式]] 中的 `asyncio.TaskGroup` / `asyncio.gather()` 统一管理。
- **发起即不管的后台任务（Fire-and-forget）**：必须存入全局或外层 `set` 强引用集合，并通过完成回调自动清理：
  ```python
  background_tasks = set()
  task = asyncio.create_task(some_coro())
  background_tasks.add(task)
  task.add_done_callback(background_tasks.discard)
  ```

### 下次探讨

1. **时序微改预测**：在写法 B（`main_concurrent`）中，如果把 `task1 = asyncio.create_task(...)` 和 `task2 = asyncio.create_task(...)` 写好之后，故意不写 `await task1`，只写一行 `await task2`，那么 `'hello'` 会被打印出来吗？总耗时是几秒？如果反过来只写 `await task1` 不写 `await task2` 呢？
2. **写法对比**：如果在 `for` 循环中写成 `for i in range(5): await asyncio.create_task(say_after(1, i))`，这 5 个任务是并发执行（1 秒跑完）还是串行执行（5 秒跑完）？为什么？

## 学生理解
