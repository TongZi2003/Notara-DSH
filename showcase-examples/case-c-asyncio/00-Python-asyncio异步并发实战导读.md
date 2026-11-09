---
type: source
title: Python-asyncio异步并发实战导读
tags: [导读, Python, asyncio, 异步编程, 技能实践]
---
# Python `asyncio` 异步并发实战导读

本导读围绕**实用技能实践（第一梯度破冰 $\rightarrow$ 第二梯度独立破局）**编排。针对“熟悉普通 Python 同步函数与 `for` 循环，但对 `Event Loop`、`Coroutine`、`Task`、`await`、`gather` 概念混淆，且在 `async def` 中调用 `time.sleep(1)` / `requests.get()` 跑 5 个任务仍耗时 5 秒”的核心痛点，我们跳过底层 C 源码与低阶 `Future`/传输层协议，按**“建立单线程事件循环心智模型 $\rightarrow$ 辨析串行 `await` 与 `Task` 并发调度 $\rightarrow$ 诊断假并发报错并掌握多任务编排与阻塞卸载模式”**三步递进。

---

## 第一阶段：从同步调用栈到单线程事件循环（破冰 $0 \rightarrow 1$）

### 1. 核心问题与边界聚焦
在普通同步 Python 代码中，调用 `func()` 会立即进入函数体从头执行到底，遇到网络等待或 `time.sleep(1)` 时，当前线程只能原地空等。本阶段聚焦一个核心问题：**在不开启多线程的前提下，单个 Python 线程如何同时跟进多个 I/O 等待任务？`async def` 与 `await` 在底层究竟改变了什么执行规则？**（预计用时：20 分钟；取舍建议：聚焦 `asyncio.run`、协程对象与 `await` 挂起机制，暂不展开底层 `Future` 对象。）

### 2. 跨源卡片任务包
- [ ] 精读语言特性卡 [[卡片/事件循环EventLoop与await主动让出控制权机制|事件循环 EventLoop 与 await 主动让出控制权机制]]，对照普通同步函数调用栈，理清“协程函数（`async def`）”、“协程对象（Coroutine Object）”与“事件循环（Event Loop）”三者的分工。
- [ ] 在终端运行卡片中的最小示例，观察直接调用 `coro()` 不加 `await` 时触发的 `RuntimeWarning: coroutine ... was never awaited` 警告。

### 3. 教学目标
能够用自己的话向同伴解释：为什么调用 `async def` 函数不会立即执行函数体代码，以及 `await` 关键字在遇到 I/O 等待时如何将控制权交还给事件循环。

### 4. 本节足迹


---

## 第二阶段：跨越“写了 `await` 依然串行”的分水岭（从串行等待到并发调度）

### 1. 核心问题与边界聚焦
弄清 `await` 的挂起作用后，初学者最常踩的第二个坑是：在 `main()` 里连续写两行 `await say_after(1, 'A')` 和 `await say_after(2, 'B')`，发现总耗时仍然是 $1 + 2 = 3$ 秒。本阶段要彻底看清：**“临时创建协程对象并立即原地等待”与“先通过 `asyncio.create_task()` 将多个协程注册进事件循环就绪队列，再统一等待完成”在时间轴上的本质差异。**（预计用时：25 分钟。）

### 2. 跨源卡片任务包
- [ ] 研读语言特性卡 [[卡片/直接await协程对象与create_task并发调度的区别|直接 await 协程对象与 create_task 并发调度的区别]]，对比串行 `await`（3 秒）与 `create_task` 并发调度（2 秒）的执行时间轴，并注意事件循环对 `Task` 的弱引用回收防坑规则。
- [ ] 打开课堂交互白板 [[白板/asyncio事件循环调度推演.canvas|asyncio 事件循环调度推演]]，逐帧推演 `frames` 时间轴并完成 普通填空题 关键代码填空。

### 3. 教学目标
给定任意一段包含多个 `await` 与 `create_task` 的代码，能够准确画出第 0 秒、第 1 秒、第 2 秒各任务所处的状态（运行中 / 挂起等待 / 已完成），并算出总耗时。

### 4. 本节足迹


---

## 第三阶段：真假并发排错实战与工程编排模式（独立破局 $1 \rightarrow N$）

### 1. 核心问题与边界聚焦
回到你亲手试验遇到的痛点：在 `async def` 函数里写了 `time.sleep(1)` 和 `requests.get()`，即便用了 `asyncio.gather()` 并发跑 5 个任务，总耗时依然高达 5.02 秒。本阶段先解剖这一“假并发”事故现场，再提炼批量并发编排（`gather` vs `TaskGroup`）与遗留同步代码卸载（`asyncio.to_thread`）的标准工程模式。（预计用时：30 分钟。）

### 2. 跨源卡片任务包
- [ ] 剖析排错案例卡 [[卡片/案例-async函数内误用同步time.sleep与requests导致假并发的诊断与修复|案例：async 函数内误用同步 time.sleep 与 requests 导致假并发的诊断与修复]]，核对沙箱实测的 3 组对比输出（5.02s vs 1.00s vs 1.01s），在白板 [[白板/asyncio事件循环调度推演.canvas|asyncio 事件循环调度推演]] 完成阻塞诊断选择题。
- [ ] 掌握共性工程模式卡 [[卡片/异步并发任务编排与阻塞操作卸载模式|异步并发任务编排与阻塞操作卸载模式]]，理清 `asyncio.gather` 与 Python 3.11+ `asyncio.TaskGroup` 在异常取消上的权衡（Trade-off），以及 `asyncio.to_thread` 受限于 GIL 的适用边界。
- [ ] **独立微改造实操**：遮住案例卡参考代码，自己动手将一段含 5 次同步 `requests.get`（可用 `time.sleep(1)` 模拟）的 `for` 循环脚本，分别用“原生异步协程”和“`asyncio.to_thread` 线程卸载”两种方式改写为 1 秒内跑完的并发脚本。

### 3. 教学目标
面对真实项目中的慢接口或并发失效代码，能一眼识别出阻塞事件循环主线程的同步调用，并根据“能否更换第三方库、是否需要异常联动取消、属于 I/O 密集还是 CPU 密集”选出恰当的改造方案。

### 4. 本节足迹
