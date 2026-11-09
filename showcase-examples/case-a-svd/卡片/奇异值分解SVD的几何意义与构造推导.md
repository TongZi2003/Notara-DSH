---
type: card
learned: false
title: 奇异值分解SVD的几何意义与构造推导
tags: [线性代数, SVD, 几何意义, ATA推导, 正交对角化]
---
# 奇异值分解SVD的几何意义与构造推导

## 内容

**定理（奇异值分解，Singular Value Decomposition, SVD）**：对于任意实矩阵 $A \in \mathbb{R}^{m \times n}$（秩为 $r \le \min(m, n)$），必存在两个正交矩阵 $U = [u_1, \dots, u_m] \in \mathbb{R}^{m \times m}$（满足 $U^T U = I_m$）和 $V = [v_1, \dots, v_n] \in \mathbb{R}^{n \times n}$（满足 $V^T V = I_n$），以及分块对角矩阵 $\Sigma \in \mathbb{R}^{m \times n}$，使得：
$$A = U \Sigma V^T$$
其中：
1. $\Sigma$ 的主对角线前 $r$ 项为严格正实数 $\sigma_1 \ge \sigma_2 \ge \dots \ge \sigma_r > 0$，其余位置全为 $0$；对角元 $\sigma_i$ 称为矩阵 $A$ 的**奇异值（Singular Values）**；
2. $V$ 的列向量 $v_i \in \mathbb{R}^n$ 称为**右奇异向量**（满足 $A^T A v_i = \sigma_i^2 v_i$），$U$ 的列向量 $u_i \in \mathbb{R}^m$ 称为**左奇异向量**（满足 $A A^T u_i = \sigma_i^2 u_i$）；
3. 左右奇异向量通过线性映射直接耦合：
   $$A v_i = \sigma_i u_i \quad (1 \le i \le r), \qquad A v_i = 0 \quad (i > r)$$

<details>
<summary>查看原页</summary>

- 本地来源摘录：![[来源/SVD权威参考资料摘录.md]]

- 来源：[[来源/SVD权威参考资料摘录.md|SVD权威参考资料摘录]]
- 原始网页：<https://kexue.fm/archives/10407>

</details>

## 参考理解

### 1. 几何意义：任何矩阵变换都是“旋转 — 沿轴拉伸 — 旋转”

延续 [[卡片/特征值分解的局限与正交基旋转拉伸问题]] 中正交矩阵保长旋转的性质（满足 $Q^T Q = I$ 的方阵乘以向量只改变方向、不改变长度与夹角），把任意矩阵 $A \in \mathbb{R}^{m \times n}$ 对输入向量 $x \in \mathbb{R}^n$ 的乘法 $y = Ax$ 拆开写成括号嵌套形式：
$$y = A x = U \bigl(\Sigma (V^T x)\bigr)$$
观察输入空间 $\mathbb{R}^n$ 中的一个单位圆（或高维单位球面 $\|x\|_2 = 1$）依次经历的三步几何形变：

1. **第一步 $x' = V^T x$（输入空间旋转对齐）**：因为 $V$ 是 $n \times n$ 正交矩阵，其转置 $V^T$ 同样是正交矩阵。根据矩阵乘法行乘列法则，$V^T x$ 的第 $i$ 个分量是 $v_i^T x$，即把原向量 $x$ 投影到正交基 $\{v_1, \dots, v_n\}$ 上。在几何上，单位圆保持形状不变，仅发生一次旋转（或反射），使原本指向右奇异向量 $v_i$ 的方向对齐到标准坐标轴 $e_i$。
2. **第二步 $x'' = \Sigma x'$（沿坐标轴非均匀拉伸与维度调整）**：$\Sigma \in \mathbb{R}^{m \times n}$ 仅在对角线上有非负实数 $\sigma_1, \dots, \sigma_r$。乘以 $\Sigma$ 将第 $i$ 个坐标轴方向的长度直接乘以 $\sigma_i$ 倍（若 $i > r$ 则乘以 $0$ 压扁归零；若 $m > n$ 则补零嵌入更高维空间）。在几何上，单位圆被沿坐标轴方向拉伸为一个半轴长分别为 $\sigma_1, \sigma_2, \dots, \sigma_r$ 的标准椭圆（或超椭球）。
3. **第三步 $y = U x''$（输出空间旋转定向）**：$U$ 是 $m \times m$ 正交矩阵，将标准坐标轴 $e_i$ 旋转到左奇异向量 $u_i$ 的方向。在几何上，轴对齐的椭圆在 $\mathbb{R}^m$ 中发生刚体旋转，各主半轴最终指向 $u_1, \dots, u_r$，半轴长度保持为 $\sigma_1, \dots, \sigma_r$。

### 2. 代数构造推导：为什么教材都要从 $A^T A$ 开始？

许多教材一上来直接写“对 $A^T A$ 做正交对角化”，之所以要引入 $A^T A$，原因在于原矩阵 $A \in \mathbb{R}^{m \times n}$ 既不一定是方阵，左右两边又同时未知两个不同的正交矩阵 $U$ 和 $V$（在式子 $A = U \Sigma V^T$ 中直接求解有两个耦合未知量）。

为了消去其中一个未知正交矩阵（例如消去 $U$），最直接的矩阵乘法操作是利用正交矩阵满足 $U^T U = I_m$ 的性质，用 $A$ 的转置 $A^T$ 左乘 $A$。根据转置乘法法则 $(BCD)^T = D^T C^T B^T$，有 $A^T = (U \Sigma V^T)^T = V \Sigma^T U^T$，从而：
$$A^T A = (V \Sigma^T U^T)(U \Sigma V^T) = V \Sigma^T (U^T U) \Sigma V^T = V (\Sigma^T \Sigma) V^T$$
这一步乘法同时带来了三个极为优良的代数性质：
1. **自动变成实对称方阵**：无论原矩阵 $A$ 是什么形状的长方阵，乘积 $A^T A$ 必定是 $n \times n$ 方阵，且满足 $(A^T A)^T = A^T (A^T)^T = A^T A$。根据实对称矩阵谱定理，$A^T A$ 一定能被正交矩阵 $V$ 对角化！
2. **特征值自动非负（半正定性）**：若任取 $A^T A$ 的单位特征向量 $v_i$（满足 $A^T A v_i = \lambda_i v_i$ 且 $v_i^T v_i = 1$），在等式两边左乘行向量 $v_i^T$，得：
   $$\lambda_i = \lambda_i (v_i^T v_i) = v_i^T (A^T A v_i) = (A v_i)^T (A v_i) = \|A v_i\|_2^2 \ge 0$$
   这种对任意向量 $x$ 都满足 $x^T M x \ge 0$（特征值全为非负实数）的对称矩阵称为**半正定矩阵（Positive Semi-definite Matrix）**。因为 $\lambda_i = \|A v_i\|_2^2 \ge 0$，我们完全可以安全地对特征值开算术平方根，定义奇异值：
   $$\sigma_i = \sqrt{\lambda_i} = \|A v_i\|_2 \ge 0$$
3. **由 $v_i$ 直接定出左奇异向量 $u_i$（锁定正负号并自带正交性）**：
   对于前 $r$ 个严格大于零的奇异值 $\sigma_1 \ge \dots \ge \sigma_r > 0$，由于向量 $A v_i \in \mathbb{R}^m$ 的长度恰好等于 $\sigma_i$，直接将该向量除以它的长度 $\sigma_i$，就得到单位列向量：
   $$u_i = \frac{1}{\sigma_i} A v_i \quad (1 \le i \le r)$$
   立刻用矩阵乘法检验任意两个向量 $u_i, u_j$ 的内积：
   $$u_i^T u_j = \left(\frac{1}{\sigma_i} A v_i\right)^T \left(\frac{1}{\sigma_j} A v_j\right) = \frac{1}{\sigma_i \sigma_j} v_i^T (A^T A v_j) = \frac{\lambda_j}{\sigma_i \sigma_j} v_i^T v_j = \frac{\sigma_j^2}{\sigma_i \sigma_j} v_i^T v_j$$
   当 $i \neq j$ 时，因 $v_i \perp v_j$ 有 $v_i^T v_j = 0$，故 $u_i^T u_j = 0$；当 $i = j$ 时，因 $v_i^T v_i = 1$ 且 $\sigma_i^2 / \sigma_i^2 = 1$，故 $u_i^T u_i = 1$。这证明了由 $u_i = \frac{1}{\sigma_i} A v_i$ 算出的向量天然是一组标准正交向量，且严格满足 $A v_i = \sigma_i u_i$（若 $r < m$，只需在 $\mathbb{R}^m$ 中再补齐 $m-r$ 个与 $u_1, \dots, u_r$ 垂直的单位向量即可拼成完整的 $m \times m$ 正交矩阵 $U$）。

将这一整套推导落地为手算与秩 $k$ 近似的标准流程，见 [[卡片/由对称阵ATA特征分解求解SVD与秩k近似法]] 及配套算例 [[卡片/例题-二阶非方阵的SVD手算与秩1近似误差]]。

### 下次探讨

1. **符号失配陷阱验证**：若不通过 $u_i = \frac{1}{\sigma_i} A v_i$ 计算 $u_i$，而是单独去求对称阵 $A A^T$ 的单位特征向量来拼成 $U$，为什么乘出来的 $U \Sigma V^T$ 可能会把原矩阵 $A$ 的某些部分变成相反数？
2. **几何范数联系**：既然正交矩阵 $U$ 和 $V^T$ 都只做旋转、不改变向量长度，那么当输入向量 $x$ 在单位球面（$\|x\|_2 = 1$）上任意转动时，输出向量 $Ax$ 的最大可能长度 $\max_{\|x\|_2=1} \|Ax\|_2$ 等于哪一个奇异值？取到最大长度时的输入向量 $x$ 指向哪个方向？

## 学生理解
