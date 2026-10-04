# Qianchuan Plan Material Cleanup Record

## Scope And Authorization

用户选择 A：将计划内审核不通过、生态审核不通过（选项不存在时跳过）、审核通过可优化的删除加入简辑。最新要求为一次一起勾选三类、一次提交筛选，再逐页批量删除。本轮仅实现软件和只读平台验证，没有真实删除确认，没有保存或扩大现有定时授权。

## Implementation

复用 [DouyinUploadService](../src/main/douyin-upload-service.ts) 和 [QianchuanAccountSettings](../src/main/qianchuan-account-settings.ts) 的互斥、编辑锁、目标冻结、generation、取消及排空。新增 [计划页面适配](../src/main/qianchuan-plan-material-page.ts) 和 [计划删除意图 owner](../src/main/qianchuan-plan-materials.ts)，不形成新的上传或定时生命周期。

手动清理与视频库清空入口独立；每日清空只有明确勾选并保存后才增加计划三类清理，旧配置保持视频库范围。新请求包含预期 advertiserId 和 adId；换计划后旧授权拒绝执行。

页面核查可见账号、计划、同一主文档、精确合并筛选响应及逐行状态/素材 ID。普通审核通过和未审核保留。每批确认前独占同步持久意图；结果未知或进展无法核对时停止，已有未知意图在重启和重新调用时仍阻断确认。保留原视频、本地上传账本和防重传屏障。

## Verification

- 上传域 360 项测试通过；新增计划页面/意图 tests 覆盖一起筛选、可选生态项、普通通过保留、失败响应、身份漂移、文档替换、选择污染、取消和未知结果。账号、原服务及每日定时 tests 覆盖 expectedAdId、原互斥/排空、组合顺序和旧范围兼容。
- typecheck 和 build 通过。完整 owned Harness `20261004T165818Z-50a9cda6` 为 PASS，回执重验 `20261004T170350Z-ddfcf68b` 为 PASS。证据以本轮 source identities 与 scope 为准。
- Chrome MCP 隔离 React fixture：取消不调用清理；手动确认提交计划模式及双 ID；定时勾选保存绑定预期计划。该 fixture 使用假 Desktop API，不代表真实删除。
- 当前生产页面适配在账号 `1876024170199244`、计划 `1876036593854788` 上执行 open/filter/read：三类一起勾选，一次提交，响应总数 63，当前页 10；真实删除 0。诊断页关闭，原上传页面保留。真实删除弹窗仅观察并取消。
- AOCI 本轮 11 个 indexed 对象完成机器完整批次维护；Verify、Check、Guide 对齐。tests 和 docs 按现有 observe role 处理，不扩张索引。

## Review Decision

Risk Gate 为 KIMI_REVIEW_REQUIRED：页面/请求范围误认后点击不可恢复的删除确认，可删除普通通过或其他计划素材并影响投放。真实删除本轮不执行，动态页面与异步请求仍存在语义验证缺口；受管只读 adversarial review 对这些边界提供独立检查。Parent 负责证据核查、findings 裁决和最终 diff。

R1 invocation `00298d83-21df-4cd3-9d0b-337c55cf058d`，seal `ff99161f7bdfb8860230ab7fa445858a450e80353af70e6a6d14366acb8c0d92`。已核对 deep route、Docker containment、六次认证 `k3/max` 请求、完整必需源码读取、artifact hash 和无候选漂移。没有确认的阻断项；`PARSED` 或 reviewer verdict 不单独作验收。

Parent 裁决：崩溃残留 operation lock 的提示不友好属低风险可用性限制，保留人工核查恢复；确认点击前已持久化但随后失败仍保留 gate，是有意保守设计，不能由本程序未点击推断其他浏览器 actor 未确认；视频库清理抛异常导致漏报计划结果的条件假设由现有 catch/finally 捕获路径反证，不需语义修改。每项与真实证据和当前 source identities 绑定，无需追加争取共识的复审。

## Limits And Recording

真实删除完成、真实缺生态选项商品和 Windows 均未验收。平台 DOM 或请求合同变化会拒绝执行，而不是猜测或扩大范围。没有自动清除未知删除意图的恢复入口，需先人工核查。

进程崩溃可能遗留 `${advertiserId}.operation.lock`，会阻断后续清理；必须确认原清理已停止并人工核查后处理该锁。浏览器其他 actor 在最后检查与确认间改变页面的固有风险仍存在，工程测试和审查不证明真实删除验收。

已评估 repository session-record/capture routing；未发现专用 capture Skill，本记录保存本轮实现、live 只读证据和剩余验收边界。其他会话 dirty 文件及共享 AOCI 的其他对象保留。
