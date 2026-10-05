# H2C Final Implementation Plan

## Goal

关闭同角multi-component未升级Sol及provider负例未评估两个gap，停在H2C。

## Scope and Contracts

只修改corner semantic owner及其回归测试，补独立开发validation入口与记录；按[Hybrid Delta](../../shape-matched-cover-hybrid-v1-spec.md)的H2C Final Acceptance。Corner policy固定0.30/0.30/0.60/3，prompt hybrid-corner-overlay-semantic/v1与schema不变。每角Luna≤1、Sol≤1，全source≤4/4/0；原full-frame/strict paths和PRODUCT_DISABLED保留。无mask/motion/shape/coverage/preview/proof v3/activation。

## Current and Target Behavior

当前Luna多singleton直接UNRESOLVED且组差异禁止Sol合并。目标将升级条件与最终unresolved条件分开：明确候选>1且Luna groups>1升级一次；纯grouping差异允许Sol resolve；明确class/decision冲突和任一显式motion仍fail closed。Sol最终多个独立组保留unsupported，UNKNOWN/risk/uncertain保留unresolved。

## Milestones

### 1. Bounded Semantic Fix

修改src/main/shape-cover-vision-corner-semantic.ts和tests/shape-cover-vision-corner.test.ts。先red复现split未升级；green验证Sol merge、separate、UNCERTAIN、分类冲突、partial、请求边界及provider清target。不修改prompt/provider算法。

### 2. Frozen Independent Development Validation

复用scripts/shape-cover-hybrid-corner-diagnostic.ts的既有M1/packet/connection/runtime，增加独立四case入口；不改旧run-once或continuation解释。请求前冻结原fixture字节、schema/prompt及model身份与construction语义。每case独占一次，provider错误记录未评估后继续其他独立case；未知结果不重发。real233s使用已有Luna语义receipt离线runtime replay，核对右上及partial、5 scope排除/36 UNKNOWN，零新real API。

### 3. Verification and Delivery

typecheck、policy中的hybrid-vision受影响测试、owned Harness/verify；最终稳定源码AOCI role维护并官方Verify/Check/Guide；Parent final diff与Risk Gate。记录四case实际结果及request counts、限制；只提交本任务文件/共享索引owned hunks，push upstream并核远端HEAD。旧失败记录不改写。

## Self Review

用户20项要求已映射到上述三个milestones；两个真实blocker均有可执行seam。spec变更仅固化当前任务已授权的语义与验收，不新增用户gate。按superpowers:writing-plans生成durable plan后返回Native Codex串行执行；Kimi只读调查私有不可变snapshot，不拥有实现或验收。
