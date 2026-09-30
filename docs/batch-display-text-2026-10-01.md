# Batch Display Text Admission Repair

## Scope

修复批量制作入口未沿用模板展示文字开关、导致空价格禁用开始按钮的问题。用户明确要求先改代码、暂不更新软件，因为正在制作视频；本轮未安装、重启或操作运行中的应用，也未进行真实上传或模型请求。

## Cause And Behavior

批量输入与持久 job 原先都使用无条件必填文字 Schema，模板列表也没有投影已保存的逐素材文字开关。单项目制作的 canonical `AgentStartSchema` 已支持全关闭时不要求文字，批量入口却在读取模板之前拒绝空值。

批量输入和记录现在允许空文字，主进程读取模板后仍由原 `AgentStartSchema` 判定是否必填。校验使用去重后的实际素材顺序及本次条数；开启文字但未填写时，先于上传预检、目录创建和制作 session 拒绝。保留校验返回的规范化输入，全关闭时不向制作传递文字草稿。

模板列表投影有效逐素材开关，界面按本次条数解释必填状态：全关闭时文字栏禁用、提交空文字且保留手动草稿；任一实际素材开启时显示原共享文字校验提示。旧模板缺开关仍默认开启。投影仅用于界面，不进入制作授权请求；原项目不被改写，运行任务沿用冻结设置。

## Verification

- 修复前定向测试复现 5 个失败；修复后 4 个测试文件共 89 项通过，包括空文字记录恢复、模板不变、逐素材覆盖及本次条数截取、开启文字在制作与上传预检之前拒绝。
- `npm run build` 通过，包含 `npm run typecheck`、贴纸资源校验及 renderer/main/preload 构建。
- `node scripts/batch-display-text-smoke.mjs` 通过：实际 React 批量组件在隔离 Chrome 中验证关闭文字空输入可启动、增加条数包含开启素材后阻断、关闭时忽略非法保留草稿、旧模板仍必填、手填内容原样提交。两次启动均为 fixture API，真实制作启动为 0。
- Chrome MCP 在独立 fixture 页面完成关闭文字空值提交、开启素材缺文字阻断及混合模板手填提交检查；未连接用户应用或账号。
- 原项目 Harness 的定向 policy 投影通过：typecheck 与 89 项断言，0 skipped，完整测试文件发现一致，运行前后 workspace identity 一致。回执位于 `.agent/harness/runs/20260930T224657Z-05fcf6ec/receipt.json`。这不是全库 policy 验收。首次 Harness 因维护 AOCI 及其他窗口修改 stationary-envelope 文件而正确返回 `NOT_EVALUATED`；稳定后重跑得到上述结果。
- AOCI 当前完整机器批次恰含本轮 4 个源码对象，全部原子维护成功；Verify、Check 与 Guide 对齐。测试、smoke 脚本及本记录按现有 observe scope 处理。

## Delegation And Review

受管 Kimi 只读 mapping invocation `b1948ebe-4f7c-4b78-bb3a-1014d400d621` 返回 `PARSED`；canonical report SHA-256 为 `3a3c15f3d2d9f07308655f631abf86eb7dd008581ee51f8f4df0b572e9f5eb9d`。Parent 确认输入与记录必须一起允许空值、实际素材截取及 UI 投影缺口。mapping packet 没有包含 `agent.ts`，其新增重复 guard 建议未采用：现有 `AgentStartSchema` 已拥有对应准入，Parent 以源码及拒绝顺序测试验证。

稳定候选按 `SUBAGENTS.md` 判断为 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求本轮 implementation review；不涉及凭据、跨项目授权、自动恢复或不可逆状态变更；既有文字校验 authority 保留，空值记录写入与恢复、主进程拒绝顺序和真实组件交互均有可执行证据，无重大后果且仍待 adversarial review 补足的语义缺口。源码 SHA 与检查回执绑定在本机私有 evidence 的 `review-risk-gate.json`。

## Delivery Boundary

本轮证据证明源码准入与隔离界面行为。按用户要求，没有更新已安装软件，因此当前软件尚未包含本修复；本轮也不声明真实 FFmpeg 新成片、真实商业模型、平台上传或人工画面验收。完成本次制作后再安排安装验证。
