---
type: source
title: SVD权威参考资料摘录
tags: [来源, 线性代数, SVD, 低秩近似]
---
# SVD 权威参考资料摘录

本资料由公开网络权威数学与机器学习讲义检索抓取并整理，供「奇异值分解（SVD）与低秩近似」专题拆卡与溯源使用。

## 来源一：科学空间（苏剑林）《低秩近似之路（二）：SVD》

- **原始链接**：<https://kexue.fm/archives/10407>
- **作者**：苏剑林（Scientific Spaces）

### 1. 奇异值分解的核心定义与几何意义

对于任意实矩阵 $\boldsymbol{M}\in\mathbb{R}^{n\times m}$，都可以找到如下形式的奇异值分解（SVD，Singular Value Decomposition）：
$$\boldsymbol{M} = \boldsymbol{U}\boldsymbol{\Sigma} \boldsymbol{V}^{\top}$$
其中 $\boldsymbol{U}\in\mathbb{R}^{n\times n},\boldsymbol{V}\in\mathbb{R}^{m\times m}$ 都是正交矩阵（满足 $\boldsymbol{U}^{\top}\boldsymbol{U}=\boldsymbol{I}_n, \boldsymbol{V}^{\top}\boldsymbol{V}=\boldsymbol{I}_m$），$\boldsymbol{\Sigma}\in\mathbb{R}^{n\times m}$ 是非负对角矩阵：
$$\boldsymbol{\Sigma}_{i,j} = \begin{cases}\sigma_i, & i = j \\ 0, & i \neq j\end{cases}$$
对角线元素默认从大到小排序，即 $\sigma_1\geq \sigma_2\geq\sigma_3\geq\cdots\geq 0$，这些对角线元素称为**奇异值（Singular Value）**。从数值计算角度看，可以只保留 $\boldsymbol{\Sigma}$ 中非零元素，将 $\boldsymbol{U},\boldsymbol{\Sigma},\boldsymbol{V}$ 的大小缩减到 $n\times r, r\times r, m\times r$（$r$ 是 $\boldsymbol{M}$ 的秩，称为紧凑型 SVD），保留完整的正交矩阵则更便于理论分析。

在二维平面或三维空间下，SVD 具有直观的几何意义。正交矩阵对应保持向量长度与夹角不变的旋转（或反射）变换，因此 $\boldsymbol{M}\boldsymbol{x}=\boldsymbol{U}\boldsymbol{\Sigma} \boldsymbol{V}^{\top}\boldsymbol{x}$ 意味着任何对列向量 $\boldsymbol{x}$ 的线性变换，都可以顺序分解为三个几何步骤：
1. **旋转（$\boldsymbol{V}^{\top}$）**：在输入空间中将标准坐标系旋转对齐到右奇异向量基 $\boldsymbol{v}_1, \dots, \boldsymbol{v}_m$；
2. **拉伸（$\boldsymbol{\Sigma}$）**：沿各个正交坐标轴方向分别按奇异值 $\sigma_i$ 进行非均匀伸缩（若 $\sigma_i=0$ 则在该维坍缩归零），将单位圆/单位球面变为轴对齐的椭圆/椭球；
3. **旋转（$\boldsymbol{U}$）**：在输出空间中将椭圆/椭球旋转到左奇异向量基 $\boldsymbol{u}_1, \dots, \boldsymbol{u}_n$ 决定的最终朝向。

### 2. 从谱定理到 $\boldsymbol{M}^{\top}\boldsymbol{M}$ 的构造性推导

- **实对称矩阵谱定理**：对于任意实对称矩阵 $\boldsymbol{S}\in\mathbb{R}^{m\times m}$（满足 $\boldsymbol{S}^{\top}=\boldsymbol{S}$），都存在正交矩阵 $\boldsymbol{V}$ 与实对角矩阵 $\boldsymbol{\Lambda}=\text{diag}(\lambda_1,\cdots,\lambda_m)$，使得 $\boldsymbol{S} = \boldsymbol{V}\boldsymbol{\Lambda} \boldsymbol{V}^{\top}$。实对称矩阵的特征值均为实数，且不同特征值对应的特征向量正交。
- **与谱分解的桥梁**：若 $\boldsymbol{M}=\boldsymbol{U}\boldsymbol{\Sigma} \boldsymbol{V}^{\top}$，则：
  $$\boldsymbol{M}^{\top}\boldsymbol{M} = \boldsymbol{V}\boldsymbol{\Sigma}^{\top} \boldsymbol{U}^{\top}\boldsymbol{U}\boldsymbol{\Sigma} \boldsymbol{V}^{\top} = \boldsymbol{V}(\boldsymbol{\Sigma}^{\top}\boldsymbol{\Sigma}) \boldsymbol{V}^{\top}$$
  $$\boldsymbol{M}\boldsymbol{M}^{\top} = \boldsymbol{U}\boldsymbol{\Sigma} \boldsymbol{V}^{\top}\boldsymbol{V}\boldsymbol{\Sigma}^{\top} \boldsymbol{U}^{\top} = \boldsymbol{U}(\boldsymbol{\Sigma}\boldsymbol{\Sigma}^{\top}) \boldsymbol{U}^{\top}$$
- **构造性存在证明与计算方法（避免左右特征向量符号失配）**：
  不能简单地对 $\boldsymbol{M}\boldsymbol{M}^{\top}$ 和 $\boldsymbol{M}^{\top}\boldsymbol{M}$ 分别独立做特征分解再直接拼起来，因为独立求出的单位特征向量允许相差一个 $\pm 1$ 符号，直接拼合未必满足 $\boldsymbol{M}\boldsymbol{v}_i = \sigma_i \boldsymbol{u}_i$。
  正确的构造方式是：设 $\text{rank}(\boldsymbol{M})=r$，先只对半正定对称矩阵 $\boldsymbol{M}^{\top}\boldsymbol{M}$ 做正交对角化 $\boldsymbol{M}^{\top}\boldsymbol{M} = \boldsymbol{V}\boldsymbol{\Lambda}\boldsymbol{V}^{\top}$，将特征值按 $\lambda_1 \ge \dots \ge \lambda_r > \lambda_{r+1} = \dots = \lambda_m = 0$ 排列。
  定义非零奇异值 $\sigma_i = \sqrt{\lambda_i}$（$1 \le i \le r$），并直接通过映射关系构造前 $r$ 个左奇异向量：
  $$\boldsymbol{u}_i = \frac{1}{\sigma_i}\boldsymbol{M}\boldsymbol{v}_i \quad (i=1,\dots,r)$$
  可严格验证这组向量满足标准正交性：
  $$\boldsymbol{u}_i^{\top}\boldsymbol{u}_j = \frac{1}{\sigma_i\sigma_j}\boldsymbol{v}_i^{\top}\boldsymbol{M}^{\top}\boldsymbol{M}\boldsymbol{v}_j = \frac{\lambda_j}{\sigma_i\sigma_j}\boldsymbol{v}_i^{\top}\boldsymbol{v}_j = \delta_{ij}$$
  对 $i > r$，由于 $\Vert \boldsymbol{M}\boldsymbol{v}_i\Vert^2 = \boldsymbol{v}_i^{\top}\boldsymbol{M}^{\top}\boldsymbol{M}\boldsymbol{v}_i = \lambda_i = 0$，必有 $\boldsymbol{M}\boldsymbol{v}_i = \boldsymbol{0}$。最后在 $\mathbb{R}^n$ 中将 $\{\boldsymbol{u}_1,\dots,\boldsymbol{u}_r\}$ 扩充为完整的标准正交基 $\{\boldsymbol{u}_1,\dots,\boldsymbol{u}_n\}$，即得 $\boldsymbol{M} = \boldsymbol{U}\boldsymbol{\Sigma}\boldsymbol{V}^{\top}$。

### 3. 矩阵范数与低秩近似证明

利用正交变换保持 Frobenius 范数与向量 2-范数不变的性质：
- **Frobenius 范数**：$\Vert \boldsymbol{M}\Vert_F^2 = \sum_{i,j} M_{ij}^2 = \Vert \boldsymbol{U}\boldsymbol{\Sigma} \boldsymbol{V}^{\top}\Vert_F^2 = \Vert \boldsymbol{\Sigma} \Vert_F^2 = \sum_{i=1}^{r}\sigma_i^2$。
- **谱范数（矩阵 2-范数）**：$\Vert \boldsymbol{M}\Vert_2 = \max_{\Vert \boldsymbol{x}\Vert_2 = 1} \Vert \boldsymbol{M}\boldsymbol{x}\Vert_2 = \max_{\Vert \boldsymbol{y}\Vert_2 = 1} \Vert \boldsymbol{\Sigma} \boldsymbol{y}\Vert_2 = \sigma_1$。

---

## 来源二：Wikipedia《Low-rank approximation》与 Eckart–Young–Mirsky 定理

- **原始链接**：<https://en.wikipedia.org/wiki/Low-rank_approximation>

### 1. 秩 1 外积展开（Dyadic Decomposition）

任意秩为 $r$ 的矩阵 $A \in \mathbb{R}^{m \times n}$ 的奇异值分解可改写为 $r$ 个秩 1 矩阵的加权和：
$$A = U \Sigma V^T = \sum_{i=1}^{r} \sigma_i u_i v_i^T$$
其中 $u_i \in \mathbb{R}^{m \times 1}$ 为第 $i$ 个左奇异向量，$v_i^T \in \mathbb{R}^{1 \times n}$ 为第 $i$ 个右奇异向量的转置，外积 $u_i v_i^T$ 是秩为 $1$ 且 Frobenius 范数与谱范数均为 $1$ 的基矩阵。

### 2. Eckart–Young–Mirsky 最优低秩近似定理

若需要在所有秩不超过 $k$（$1 \le k < r$）的矩阵 $B \in \mathbb{R}^{m \times n}$ 中寻找最接近原矩阵 $A$ 的近似矩阵，截断前 $k$ 项得到的矩阵：
$$A_k = \sum_{i=1}^{k} \sigma_i u_i v_i^T = U_{[:, :k]} \Sigma_{[:k, :k]} V_{[:, :k]}^T$$
同时在 Frobenius 范数与谱范数（2-范数）下达到全局最小误差：
1. **Frobenius 范数最小误差**：
   $$\min_{\text{rank}(B) \le k} \|A - B\|_F = \|A - A_k\|_F = \sqrt{\sum_{i=k+1}^{r} \sigma_i^2}$$
2. **谱范数（2-范数）最小误差**：
   $$\min_{\text{rank}(B) \le k} \|A - B\|_2 = \|A - A_k\|_2 = \sigma_{k+1}$$
3. **近似保留能量比例**：在 Frobenius 范数平方意义下，前 $k$ 项保留的信息（能量）占比为 $\dfrac{\sum_{i=1}^k \sigma_i^2}{\sum_{i=1}^r \sigma_i^2}$。
