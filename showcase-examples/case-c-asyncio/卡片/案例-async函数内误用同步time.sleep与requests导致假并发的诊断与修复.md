---
type: card
title: 案例-async函数内误用同步time.sleep与requests导致假并发的诊断与修复
tags: [Python, asyncio, 实战排错, 假并发, 阻塞诊断]
---
# 案例：`async` 函数内误用同步 `time.sleep` 与 `requests` 导致假并发的诊断与修复

## 内容

### 问题现场还原

在尝试将 5 个耗时 1 秒的接口请求（或延时任务）改写为 `asyncio` 异步并发时，编写了如下代码（使用 `time.sleep(1.0)` 模拟同步 `requests.get()` 的 1 秒网络等待），并调用 `asyncio.gather` 期望在 1 秒内并发跑完：

```python
import asyncio
import time

async def bad_async_worker(task_id: int) -> str:
    print(f"[{time.perf_counter() - t0:.2f}s] bad_async_worker({task_id}) start")
    time.sleep(1.0)  # 或调用同步 requests.get(url)
    print(f"[{time.perf_counter() - t0:.2f}s] bad_async_worker({task_id}) end")
    return f"task-{task_id} ok"

async def main():
    global t0
    t0 = time.perf_counter()
    await asyncio.gather(*(bad_async_worker(i) for i in range(1, 6)))
    print(f"Total elapsed: {time.perf_counter() - t0:.2f}s")

asyncio.run(main())
```

### 沙箱实测异常输出（5 个任务耗时 5.02 秒，完全串行）

```text
=== Case 1: async def 内误用 time.sleep(1.0) + asyncio.gather (5个任务) ===
[0.00s] bad_async_worker(1) start
[1.01s] bad_async_worker(1) end
[1.01s] bad_async_worker(2) start
[2.01s] bad_async_worker(2) end
[2.01s] bad_async_worker(3) start
[3.01s] bad_async_worker(3) end
[3.01s] bad_async_worker(4) start
[4.01s] bad_async_worker(4) end
[4.01s] bad_async_worker(5) start
[5.02s] bad_async_worker(5) end
Total elapsed: 5.02s
```

**核心疑问**：外层已经加了 `async def`，也用了 `await asyncio.gather(...)` 把 5 个任务一起提交了，为什么第 2 个任务必须等第 1 个任务的 1.01 秒彻底跑完才打印 `start`，总耗时依然是 5.02 秒？

<details>
<summary>查看原页</summary>

- 来源：[[来源/Python官方asyncio核心文档摘录|Python官方asyncio核心文档摘录（Coroutines and Tasks）]]（<https://docs.python.org/3/library/asyncio-task.html#sleeping> 及 <https://docs.python.org/3/library/asyncio-task.html#running-in-threads>）

</details>

## 参考理解

### 1. 根因诊断：是谁卡死了单线程事件循环？

对照 [[卡片/事件循环EventLoop与await主动让出控制权机制|事件循环 EventLoop 与 await 主动让出控制权机制]]，我们先追踪 `Case 1` 在第 $0.00\text{s}$ 时的真实执行流：

1. `asyncio.gather` 的确在 $t = 0.00\text{s}$ 时把 5 个协程对象全部包装成了 `Task`（参见 [[卡片/直接await协程对象与create_task并发调度的区别|直接 await 协程对象与 create_task 并发调度的区别]]），排进了事件循环的就绪队列：`[Task-1, Task-2, Task-3, Task-4, Task-5]`。
2. 事件循环在唯一的主线程上率先唤醒 `Task-1`，打印出 `[0.00s] bad_async_worker(1) start`。
3. **致命阻塞发生点**：下一行执行到了 `time.sleep(1.0)`（或同步的 `requests.get()`）。
   - **为什么没有切换？** 在单线程协作式并发中，事件循环本身也运行在这同一个主线程里。只有当当前任务执行到 `await <非阻塞可等待对象>`、主动挂起自身并把 CPU 控制权退还给事件循环时，事件循环才有机会去唤醒排在后面的 `Task-2`。
   - **实际发生了什么？** `time.sleep(1.0)` 与 `requests.get()` 属于**操作系统线程级的同步阻塞调用**。调用它们时，Python 解释器直接向操作系统申请**让当前整个 Python 主线程原地休眠或阻塞等待 1 秒钟**，期间完全不经过 `await` 挂起协议，主线程控制权始终被 `Task-1` 独占。由于事件循环就在这个主线程里，主线程睡着了，事件循环也跟着彻底停摆，排在就绪队列里的 `Task-2`～`Task-5` 根本无人调度，只能等到 $1.01\text{s}$ 主线程醒来、`Task-1` 执行完毕退出后，事件循环才能启动 `Task-2`。

简言之：**给函数套上 `async def` 外壳并不会把内部的同步阻塞代码自动变成非阻塞操作；只要在协程内部调用了阻塞主线程的同步函数，单线程事件循环就会在原地被锁死。**

### 2. 两种标准修复方案与沙箱实测验证

根据 [[卡片/异步并发任务编排与阻塞操作卸载模式|异步并发任务编排与阻塞操作卸载模式]]，修复该问题共有两条标准路径，以下为 Python 3 沙箱实测代码与真实输出对比：

#### 修复路径 A（首选）：替换为原生异步 API（`await asyncio.sleep` / `httpx.AsyncClient`）

将阻塞整个线程的 `time.sleep(1.0)` 替换为挂起当前协程并让出控制权的 `await asyncio.sleep(1.0)`（若是网络请求，则将 `requests.get` 替换为 `await client.get`）：

```python
async def good_async_worker(task_id: int) -> str:
    print(f"[{time.perf_counter() - t0:.2f}s] good_async_worker({task_id}) start")
    await asyncio.sleep(1.0)  # 非阻塞挂起当前协程，立即把控制权交还给事件循环
    print(f"[{time.perf_counter() - t0:.2f}s] good_async_worker({task_id}) end")
    return f"task-{task_id} ok"
```

**沙箱实测输出（总耗时从 5.02s 降至 1.00s）**：

```text
=== Case 2: 改用 await asyncio.sleep(1.0) + asyncio.gather (5个任务) ===
[0.00s] good_async_worker(1) start
[0.00s] good_async_worker(2) start
[0.00s] good_async_worker(3) start
[0.00s] good_async_worker(4) start
[0.00s] good_async_worker(5) start
[1.00s] good_async_worker(1) end
[1.00s] good_async_worker(2) end
[1.00s] good_async_worker(3) end
[1.00s] good_async_worker(4) end
[1.00s] good_async_worker(5) end
Total elapsed: 1.00s
```

- **时序核对**：可以看到 5 个任务在 `[0.00s]` 毫秒级内接连打印 `start`（每个任务一走到 `await asyncio.sleep(1.0)` 就立刻挂起让出主线程，事件循环当即启动下一个任务），5 个 1 秒倒计时在后台完全重叠，1.00 秒后同时到期返回。

#### 修复路径 B（兼容遗留同步库）：使用 `await asyncio.to_thread()` 卸载到工作线程

若项目必须调用无法改写的同步函数（如现有的 `sync_http_mock` 或第三方同步 SDK），使用 `asyncio.to_thread` 将其扔到后台工作线程池执行，避免阻塞事件循环所在的唯一主线程：

```python
def sync_http_mock(task_id: int) -> str:
    time.sleep(1.0)  # 保持原有同步阻塞实现不变
    return f"task-{task_id} ok"

async def thread_offload_worker(task_id: int) -> str:
    print(f"[{time.perf_counter() - t0:.2f}s] thread_offload_worker({task_id}) start")
    res = await asyncio.to_thread(sync_http_mock, task_id)  # 卸载至后台线程并挂起当前协程
    print(f"[{time.perf_counter() - t0:.2f}s] thread_offload_worker({task_id}) end")
    return res
```

**沙箱实测输出（总耗时同样降至 1.01s）**：

```text
=== Case 3: 使用 asyncio.to_thread 卸载同步阻塞函数 (5个任务) ===
[0.00s] thread_offload_worker(1) start
[0.00s] thread_offload_worker(2) start
[0.00s] thread_offload_worker(3) start
[0.00s] thread_offload_worker(4) start
[0.01s] thread_offload_worker(5) start
[1.01s] thread_offload_worker(4) end
[1.01s] thread_offload_worker(5) end
[1.01s] thread_offload_worker(3) end
[1.01s] thread_offload_worker(2) end
[1.01s] thread_offload_worker(1) end
Total elapsed: 1.01s
```

### 3. 排错自检核对单（下次写 `async def` 必查两项）

每当写完一个 `async def` 协程却发现并发耗时等于各任务耗时之和时，按顺序核查以下两处：

1. **查内部阻塞点**：协程函数体内部（含其调用的子函数）是否混入了 `time.sleep()`、`requests.*`、同步 `open()` 大文件读写或同步数据库驱动？若有，必须改为原生异步库或包裹 `await asyncio.to_thread(func, *args)`。
2. **查外部调度方式**：外层调用处是否写成了在 `for` 循环里逐个 `await worker(i)`（参见 [[卡片/直接await协程对象与create_task并发调度的区别|直接 await 协程对象与 create_task 并发调度的区别]]）？若是，需改为 `asyncio.gather` 或 `asyncio.TaskGroup` 批量并发调度。

### 下次探讨

1. **观察细节追问**：对比上面 `Case 2` 和 `Case 3` 的实测输出，为什么 `Case 2` 结束时打印顺序严格是 `1, 2, 3, 4, 5`，而 `Case 3`（使用 `to_thread`）结束时打印顺序变成了 `4, 5, 3, 2, 1`？尽管打印顺序不同，`await asyncio.gather(...)` 最终返回的列表元素顺序会乱吗？
2. **开启事件循环慢回调检测**：在实际项目中，如果某个第三方函数内部暗藏了一个耗时 0.5 秒的同步阻塞操作，如何开启 `asyncio.run(main(), debug=True)` 让 Python 自动在终端报警指出是哪个协程卡住了事件循环？

## 学生理解
