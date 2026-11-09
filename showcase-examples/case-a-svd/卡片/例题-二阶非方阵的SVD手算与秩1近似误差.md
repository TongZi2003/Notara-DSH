---
type: exercise
title: 例题-二阶非方阵的SVD手算与秩1近似误差
tags: [线性代数, SVD, 低秩近似, 手算推导]
summary: "求 3×2 实矩阵的奇异值分解、最佳秩 1 近似矩阵，并核算 Frobenius 与谱范数误差。"
---
# 例题-二阶非方阵的SVD手算与秩1近似误差

## 内容

已知 $3 \times 2$ 实矩阵（秩为 $2$ 的非方阵）：
$$A = \begin{bmatrix} 3 & 2 \\ 2 & 3 \\ 2 & -2 \end{bmatrix}$$
请完成以下计算与推导：
1. 求矩阵 $A$ 的奇异值 $\sigma_1, \sigma_2$，并写出完整的奇异值分解 $A = U \Sigma V^T$（其中 $U \in \mathbb{R}^{3 \times 3}, \Sigma \in \mathbb{R}^{3 \times 2}, V \in \mathbb{R}^{2 \times 2}$）；
2. 将 $A$ 表示为秩 1 外积展开形式 $A = \sigma_1 u_1 v_1^T + \sigma_2 u_2 v_2^T$，求 $A$ 的最佳秩 1 近似矩阵 $A_1$；
3. 直接计算残差矩阵 $E = A - A_1$ 的 Frobenius 范数 $\|A - A_1\|_F$ 与谱范数 $\|A - A_1\|_2$，验证其与 Eckart–Young–Mirsky 定理给出之理论误差完全一致，并求出秩 1 近似保留的能量占比。

<details>
<summary>查看原页</summary>

- 本地来源摘录：![[来源/SVD权威参考资料摘录.md]]

- 来源：[[来源/SVD权威参考资料摘录.md|SVD权威参考资料摘录]]（结合经典教材非方阵标准算例与 Python 精确验算整理）
- 原始网页：<https://kexue.fm/archives/10407>、<https://en.wikipedia.org/wiki/Low-rank_approximation>

</details>

## 参考理解

### 1. 题设阻碍与突破口形成（为什么这样想）

本题给定的矩阵 $A \in \mathbb{R}^{3 \times 2}$ 行数为 $3$、列数为 $2$，属于非方阵，无法直接列写方阵特征方程 $\det(\lambda I - A) = 0$（详见 [[卡片/特征值分解的局限与正交基旋转拉伸问题]]）。

从目标 $A = U \Sigma V^T$ 反推突破口：两边利用 $U^T U = I_3$ 消去未知的三阶正交阵 $U$，可得 $A^T A = V (\Sigma^T \Sigma) V^T$——这就把“求非方阵奇异值与右奇异向量”转化成了熟悉的实对称方阵正交对角化问题。再观察维度：$A$ 的列数 $n = 2 < m = 3$，若构造 $A A^T$ 将得到 $3 \times 3$ 矩阵（需解三次特征方程），而构造 $A^T A$ 只得到 $2 \times 2$ 实对称矩阵（只需解二次特征方程，计算量最小）；求出单位正交的 $v_1, v_2$ 后，再由 $A v_i = \sigma_i u_i$ 直接定出左奇异向量方向，避免分别求两侧特征向量导致正负号失配（详见 [[卡片/由对称阵ATA特征分解求解SVD与秩k近似法]]）。

### 2. 分步推演与完整解答

#### 第一步：构造 $2 \times 2$ 对称半正定阵 $A^T A$ 并求奇异值

根据矩阵转置与乘法法则计算 $A^T A$：
$$A^T A = \begin{bmatrix} 3 & 2 & 2 \\ 2 & 3 & -2 \end{bmatrix} \begin{bmatrix} 3 & 2 \\ 2 & 3 \\ 2 & -2 \end{bmatrix} = \begin{bmatrix} 3^2+2^2+2^2 & 3\times 2+2\times 3+2\times(-2) \\ 2\times 3+3\times 2+(-2)\times 2 & 2^2+3^2+(-2)^2 \end{bmatrix} = \begin{bmatrix} 17 & 8 \\ 8 & 17 \end{bmatrix}$$
求解 $A^T A$ 的特征方程 $\det(\lambda I_2 - A^T A) = 0$：
$$\det\begin{bmatrix} \lambda - 17 & -8 \\ -8 & \lambda - 17 \end{bmatrix} = (\lambda - 17)^2 - 8^2 = 0 \implies \lambda - 17 = \pm 8$$
按从大到小顺序排列特征值，得 $\lambda_1 = 25, \lambda_2 = 9$。由 [[卡片/奇异值分解SVD的几何意义与构造推导]] 中 $\sigma_i = \sqrt{\lambda_i}$ 的定义，求得两个非零奇异值：
$$\sigma_1 = \sqrt{25} = 5, \qquad \sigma_2 = \sqrt{9} = 3$$
将 $\sigma_1, \sigma_2$ 填入与原矩阵 $A$ 同维度的 $3 \times 2$ 分块对角矩阵 $\Sigma$：
$$\Sigma = \begin{bmatrix} 5 & 0 \\ 0 & 3 \\ 0 & 0 \end{bmatrix}$$

#### 第二步：求 $A^T A$ 的单位正交特征向量，构造右奇异矩阵 $V$

1. 对 $\lambda_1 = 25$，解齐次线性方程组 $(25 I_2 - A^T A)x = \begin{bmatrix} 8 & -8 \\ -8 & 8 \end{bmatrix}\begin{bmatrix} x_1 \\ x_2 \end{bmatrix} = \begin{bmatrix} 0 \\ 0 \end{bmatrix}$，得 $x_1 = x_2$。取非零解 $[1, 1]^T$，除以自身模长 $\sqrt{1^2 + 1^2} = \sqrt{2}$ 完成**单位化**，得到第一右奇异向量：
   $$v_1 = \frac{1}{\sqrt{2}} \begin{bmatrix} 1 \\ 1 \end{bmatrix}$$
2. 对 $\lambda_2 = 9$，解齐次线性方程组 $(9 I_2 - A^T A)x = \begin{bmatrix} -8 & -8 \\ -8 & -8 \end{bmatrix}\begin{bmatrix} x_1 \\ x_2 \end{bmatrix} = \begin{bmatrix} 0 \\ 0 \end{bmatrix}$，得 $x_1 = -x_2$。取非零解 $[1, -1]^T$ 并除以模长 $\sqrt{2}$，得到第二右奇异向量：
   $$v_2 = \frac{1}{\sqrt{2}} \begin{bmatrix} 1 \\ -1 \end{bmatrix}$$
拼成 $2 \times 2$ 正交矩阵 $V = [v_1, v_2]$：
$$V = \begin{bmatrix} \frac{1}{\sqrt{2}} & \frac{1}{\sqrt{2}} \\ \frac{1}{\sqrt{2}} & -\frac{1}{\sqrt{2}} \end{bmatrix}$$

#### 第三步：利用耦合关系 $u_i = \frac{1}{\sigma_i} A v_i$ 构造左奇异矩阵 $U$

为保证左右奇异向量符号严格对齐，直接将 $v_1, v_2$ 代入 $u_i = \frac{1}{\sigma_i} A v_i$：
1. 计算 $u_1$（对应 $\sigma_1 = 5$）：
   $$u_1 = \frac{1}{5} A v_1 = \frac{1}{5\sqrt{2}} \begin{bmatrix} 3 & 2 \\ 2 & 3 \\ 2 & -2 \end{bmatrix} \begin{bmatrix} 1 \\ 1 \end{bmatrix} = \frac{1}{5\sqrt{2}} \begin{bmatrix} 5 \\ 5 \\ 0 \end{bmatrix} = \frac{1}{\sqrt{2}} \begin{bmatrix} 1 \\ 1 \\ 0 \end{bmatrix}$$
2. 计算 $u_2$（对应 $\sigma_2 = 3$）：
   $$u_2 = \frac{1}{3} A v_2 = \frac{1}{3\sqrt{2}} \begin{bmatrix} 3 & 2 \\ 2 & 3 \\ 2 & -2 \end{bmatrix} \begin{bmatrix} 1 \\ -1 \end{bmatrix} = \frac{1}{3\sqrt{2}} \begin{bmatrix} 1 \\ -1 \\ 4 \end{bmatrix}$$
3. 补齐第三列单位正交向量 $u_3 \in \mathbb{R}^3$：要求 $u_3$ 同时与 $u_1, u_2$ 垂直（即 $u_1^T u_3 = 0, u_2^T u_3 = 0$）。由 $u_1^T u_3 = 0$ 得第一分量与第二分量互为相反数，设 $u_3 = c [a, -a, b]^T$；再代入 $u_2^T u_3 = 0$ 得 $a - (-a) + 4b = 0 \implies 2a + 4b = 0$，取 $a = 2, b = -1$，除以模长 $\sqrt{2^2 + (-2)^2 + (-1)^2} = 3$，得：
   $$u_3 = \frac{1}{3} \begin{bmatrix} 2 \\ -2 \\ -1 \end{bmatrix}$$
因此完整的 $3 \times 3$ 正交矩阵 $U = [u_1, u_2, u_3]$ 及奇异值分解为：
$$A = U \Sigma V^T = \begin{bmatrix} \frac{1}{\sqrt{2}} & \frac{1}{3\sqrt{2}} & \frac{2}{3} \\ \frac{1}{\sqrt{2}} & -\frac{1}{3\sqrt{2}} & -\frac{2}{3} \\ 0 & \frac{4}{3\sqrt{2}} & -\frac{1}{3} \end{bmatrix} \begin{bmatrix} 5 & 0 \\ 0 & 3 \\ 0 & 0 \end{bmatrix} \begin{bmatrix} \frac{1}{\sqrt{2}} & \frac{1}{\sqrt{2}} \\ \frac{1}{\sqrt{2}} & -\frac{1}{\sqrt{2}} \end{bmatrix}$$

#### 第四步：求最佳秩 1 近似矩阵 $A_1$ 并核验范数误差

将 $A$ 写为两个秩 1 外积矩阵之和：
$$A = \sigma_1 u_1 v_1^T + \sigma_2 u_2 v_2^T$$
根据 Eckart–Young–Mirsky 定理，最佳秩 1 近似矩阵 $A_1$ 即为保留第一大奇异值 $\sigma_1 = 5$ 的外积项：
$$A_1 = \sigma_1 u_1 v_1^T = 5 \cdot \left(\frac{1}{\sqrt{2}}\begin{bmatrix} 1 \\ 1 \\ 0 \end{bmatrix}\right) \left(\frac{1}{\sqrt{2}}\begin{bmatrix} 1 & 1 \end{bmatrix}\right) = \frac{5}{2} \begin{bmatrix} 1 & 1 \\ 1 & 1 \\ 0 & 0 \end{bmatrix} = \begin{bmatrix} 2.5 & 2.5 \\ 2.5 & 2.5 \\ 0 & 0 \end{bmatrix}$$
计算残差矩阵 $E = A - A_1$（恰好等于被截断的第二项 $\sigma_2 u_2 v_2^T$）：
$$E = A - A_1 = \begin{bmatrix} 3 - 2.5 & 2 - 2.5 \\ 2 - 2.5 & 3 - 2.5 \\ 2 - 0 & -2 - 0 \end{bmatrix} = \begin{bmatrix} 0.5 & -0.5 \\ -0.5 & 0.5 \\ 2 & -2 \end{bmatrix}$$
直接按定义核算残差矩阵的 Frobenius 范数误差（所有元素平方和开方）：
$$\|A - A_1\|_F = \sqrt{0.5^2 + (-0.5)^2 + (-0.5)^2 + 0.5^2 + 2^2 + (-2)^2} = \sqrt{0.25 \times 4 + 4 + 4} = \sqrt{9} = 3$$
这与定理给出的理论公式 $\sqrt{\sum_{i=2}^2 \sigma_i^2} = \sigma_2 = 3$ 完全吻合；同时谱范数误差为 $\|A - A_1\|_2 = \sigma_2 = 3$。
原矩阵的总能量（Frobenius 范数平方）为 $\|A\|_F^2 = \sigma_1^2 + \sigma_2^2 = 25 + 9 = 34$，因此秩 1 近似矩阵 $A_1$ 保留的能量占比为：
$$\frac{\sigma_1^2}{\sigma_1^2 + \sigma_2^2} = \frac{25}{25 + 9} = \frac{25}{34} \approx 73.53\%$$

### 3. 方法适用条件与失效边界

- **零奇异值处耦合公式 $u_i = \frac{1}{\sigma_i} A v_i$ 失效**：该式要求 $\sigma_i > 0$。本题第三列 $u_3$ 对应零奇异值空间（或当原矩阵秩亏出现 $\lambda_i = 0$ 时），除以 $\sigma_i$ 无意义，必须改解左零空间方程 $A^T u = 0$（等价于与已有 $u_1, \dots, u_r$ 正交）并做 Gram–Schmidt 标准正交化；在紧凑 SVD 或低秩近似中零奇异值项恒为零，无需额外存储 $u_3$。
- **重特征值时特征向量不再自动正交**：本题 $\lambda_1 = 25 \ne \lambda_2 = 9$，故 $v_1, v_2$ 天然正交；一旦 $A^T A$ 出现重特征值（如正交阵标量倍 $A^T A = c I$），同一特征子空间内任取的两组线性无关解未必正交，直接归一化后拼入 $V$ 会破坏 $V^T V = I$，必须先在同一特征子空间内做正交化。
- **最佳秩 1 近似的唯一性条件**：Eckart–Young–Mirsky 定理给出唯一最佳秩 $k$ 近似矩阵的前提是严格不等式 $\sigma_k > \sigma_{k+1}$。本题 $\sigma_1 = 5 > \sigma_2 = 3$，因此 $A_1$ 唯一；若题目矩阵满足 $\sigma_1 = \sigma_2$，任意在 $\operatorname{span}\{v_1, v_2\}$ 上取单位方向截断的秩 1 矩阵具有相同最小误差，最佳秩 1 近似不再唯一。

### 下次探讨

1. **转置变换变式**：若将本题矩阵取转置，令 $B = A^T = \begin{bmatrix} 3 & 2 & 2 \\ 2 & 3 & -2 \end{bmatrix} \in \mathbb{R}^{2 \times 3}$，无需重新解特征方程，请直接写出 $B$ 的奇异值分解 $B = \tilde{U} \tilde{\Sigma} \tilde{V}^T$ 以及 $B$ 的最佳秩 1 近似矩阵 $B_1$。
2. **近似唯一性边界**：如果将本题矩阵第三行改为 $\begin{bmatrix} 0 & 0 \end{bmatrix}$，即 $C = \begin{bmatrix} 3 & 2 \\ 2 & 3 \\ 0 & 0 \end{bmatrix}$，此时两个奇异值分别变为 $\sigma_1 = 5, \sigma_2 = 1$，秩 1 近似保留的能量占比会提升到多少？为什么？

## 学生理解
