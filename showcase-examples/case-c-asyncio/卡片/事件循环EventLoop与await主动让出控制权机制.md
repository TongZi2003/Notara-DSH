---
type: card
title: 事件循环EventLoop与await主动让出控制权机制
tags: [Python, asyncio, 语言特性, 事件循环, 协程]
---
# 事件循环 EventLoop 与 `await` 主动让出控制权机制

## 内容

在 Python `asyncio`（Python 3.7+）中，使用 `async def` 声明协程，并通过 `asyncio.run()` 启动事件循环驱动其执行：

```python
import asyncio

async def main():
    print("hello")
    await asyncio.sleep(1)
    print("world")

# 1. 直接调用 async def 函数只会返回协程对象，函数体代码一行也不会执行：
coro = main()
print(coro)  # <coroutine object main at 0x...>
coro.close() # 关闭未等待的协程以避免 RuntimeWarning

# 2. 必须交给 asyncio.run() 启动事件循环来驱动执行：
asyncio.run(main())
# 输出：
# hello
# （等待 1 秒）
# world
```

**相关核心原语签名**：
- `asyncio.run(coro, *, debug=None)`：创建新的事件循环，运行传入的顶层协程 `coro`，并在执行完毕后关闭事件循环。
- `await <awaitable>`：挂起当前协程的执行，等待右侧的可等待对象（Awaitable）完成，期间将单线程控制权交还给事件循环。
- `await asyncio.sleep(delay, result=None)`：挂起当前任务 `delay` 秒，允许事件循环在此期间切换执行其他已就绪的任务。

<details>
<summary>查看原页</summary>

- 来源：[[来源/Python官方asyncio核心文档摘录|Python官方asyncio核心文档摘录（Coroutines and Tasks）]]（<https://docs.python.org/3/library/asyncio-task.html#coroutines>）

</details>

## 参考理解

### 1. 引入动机：同步调用栈在 I/O 等待时的空转瓶颈

在你熟悉的普通 Python 同步编程中，当用 `def` 定义函数并用 `for` 循环连续调用 5 次 `requests.get()` 时，Python 依赖操作系统的**同步函数调用栈**：主线程进入第 1 次请求函数后，必须原地等待远程服务器返回响应（例如耗时 1 秒），期间 CPU 处于闲置空等状态，随后的第 2～5 次请求只能排队干等，5 次请求总耗时必然累加为 5 秒。

为了在**同一个线程内**消除这种“干等网络响应时的 CPU 闲置”，Python 引入了 `asyncio` 异步协作模型：当某一项操作需要等待外部 I/O（如等待网络响应或定时器到期）时，当前执行流可以主动暂停并保存现场，让同一个主线程转去发起或处理其他已经准备好的任务。

### 2. 定义拆解与关键限定词：协程函数、协程对象与可等待对象

官方文档严格区分了以下三个初学者最易混淆的语法实体：

1. **协程函数（Coroutine function）**：使用 `async def` 关键字定义的函数（如上例中的 `async def main():`）。
2. **协程对象（Coroutine object）**：调用协程函数（写下 `main()`）所返回的对象。
   - **与普通同步函数的核心差异**：调用普通的 `def func()` 会立即将函数压入调用栈并从第一行代码开始执行；而调用 `async def main()` **仅会在内存中构造并返回一个保存了代码与初始状态的“协程对象”**，函数体内部的 `print("hello")` 此时完全不会执行。如果只写 `main()` 而不把它交给事件循环或 `await`，Python 会在对象销毁时发出 `RuntimeWarning: coroutine 'main' was never awaited` 警告。
3. **可等待对象（Awaitable）**：凡是可以写在 `await` 关键字右侧的对象统称为可等待对象。`asyncio` 中共有三类主要的可等待对象：**协程对象（Coroutine）**、**任务对象（`Task`）** 与底层的 **期物对象（`Future`）**。普通的同步函数返回值或 `time.sleep(1)` 均不属于可等待对象，不能放在 `await` 右侧。

### 3. 底层运作与控制流转移：事件循环（Event Loop）与 `await` 挂起机制

如果把普通的同步执行比作“一条道走到黑的单行线”，那么 **事件循环（Event Loop）** 就是运行在当前唯一主线程上的**总调度器（无限循环的调度中心）**。它维护着“当前可立即执行”与“正在等待外部事件（如网络数据到达、计时器到期）”的任务清单。

以 `asyncio.run(main())` 的执行时间轴为例，控制权的流转包含四个步骤：

1. **启动与接管**：`asyncio.run(main())` 在主线程创建一个事件循环，并将 `main()` 返回的协程对象注册进去开始驱动执行，打印出 `"hello"`。
2. **`await` 触发挂起（Suspend）与让出控制权**：执行到 `await asyncio.sleep(1)` 时，当前协程向事件循环注册一个“1 秒后唤醒我”的定时器事件，随即**主动挂起（暂停）自身**，把保存了当前执行行号的现场留在原地，并将主线程的控制权交还给事件循环。
3. **事件循环调度其他任务**：在接下来的 1 秒等待期内，主线程并未卡死；只要事件循环的就绪队列里还有其他已注册的任务（参见 [[卡片/直接await协程对象与create_task并发调度的区别|直接 await 协程对象与 create_task 并发调度的区别]]），事件循环就会立即切过去执行它们。
4. **事件就绪与恢复执行（Resume）**：1 秒计时到期后，事件循环检测到该等待事件已完成，将 `main` 协程重新标记为就绪，从刚才 `await` 暂停的位置往下恢复执行，打印出 `"world"`。特殊地，`await asyncio.sleep(0)` 常用于在耗时较长的协程中主动暂停 0 秒，把控制权短暂让给事件循环去执行其他排队任务。

### 4. 高频防坑与关联脉络

- **防坑必查 1（忘记 `await` 导致代码静默未执行）**：在 `async def` 内部调用另一个异步函数（如 `asyncio.sleep(1)` 或异步网络请求）时，若漏写左侧的 `await`，该调用只会凭空生成一个未使用的协程对象，既不会等待，也不会执行其内部逻辑。
- **防坑必查 2（混用同步阻塞调用）**：`await` 只有在遇到原生支持异步挂起的可等待对象时才能把控制权交还给事件循环；若在协程内写下 `time.sleep(1)`，主线程会被操作系统直接挂起，事件循环也随之停摆（详见排错案例 [[卡片/案例-async函数内误用同步time.sleep与requests导致假并发的诊断与修复|案例：async 函数内误用同步 time.sleep 与 requests 导致假并发的诊断与修复]]）。
- **下游延伸**：单靠 `await` 只能实现“当前协程暂停并让出控制权”，若事件循环里总共只注册了一个任务，让出控制权后也无事可做。要让多个协程真正同时处于等待倒计时状态，需要结合 [[卡片/直接await协程对象与create_task并发调度的区别|直接 await 协程对象与 create_task 并发调度的区别]] 与 [[卡片/异步并发任务编排与阻塞操作卸载模式|异步并发任务编排与阻塞操作卸载模式]]。

### 下次探讨

1. **边界追问**：如果在一个 `async def` 函数内部包含一段完全不包含 `await` 的 `for i in range(10**8):` 纯计算循环，此时事件循环还能切换到其他协程吗？如何在不开启多线程的情况下让这段长循环定期把控制权让给其他协程？
2. **报错预测**：如果尝试在代码里写 `await time.sleep(1)`，Python 解释器会报什么类型的错误？为什么？

## 学生理解
