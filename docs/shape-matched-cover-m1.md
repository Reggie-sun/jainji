---
title: Shape-Matched Cover M1 Media Evidence
status: partial-evidence-production-gate-open
date: 2026-09-24
spec: shape-matched-cover-spec.md
plan: shape-matched-cover-plan.md
---

# Scope

本记录只评估 M1 的源像素 mask 可行性，不是自动覆盖的生产准入或成片验收。没有调用产品 Agent、付费模型或 `delogo`，没有切换正式 renderer。`scripts/shape-cover-mask-probe.py` 是本机实验探针：它只输出候选和拒绝原因，`CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW` **不是 PASS**。

# Reproduction

本机源文件按以下命令重新解码；原视频文件不随仓库提交。命令输出保存在 `/tmp/jianji-cover-m1-20260924/`，每个目录有 `result.json`。探针依赖本机 Python 的 `opencv-python`、`numpy`、`Pillow`，不属于应用运行依赖。

```bash
python3 scripts/shape-cover-mask-probe.py --source '/home/reggie/电商/肥皂/素材/竞品详情-抖音电商罗盘 (1).mp4' --roi 590,0,130,90 --start-frame 420 --end-frame 510 --sample-every 2 --edge-sheet-every 1 --output /tmp/jianji-cover-m1-20260924/static-14-17-train
python3 scripts/shape-cover-mask-probe.py --source '/home/reggie/电商/肥皂/素材/竞品详情-抖音电商罗盘 (1).mp4' --roi 590,0,130,90 --edge-sheet-every 699 --output /tmp/jianji-cover-m1-20260924/static-full
python3 scripts/shape-cover-mask-probe.py --source '/home/reggie/电商/舒鼻膏/素材/竞品详情-抖音电商罗盘 - 2026-09-21T231539.682.mp4' --roi 0,0,130,90 --output /tmp/jianji-cover-m1-20260924/no-sticker
python3 scripts/shape-cover-mask-probe.py --source '/home/reggie/电商/肥皂/素材/竞品详情-抖音电商罗盘 (1).mp4' --roi 590,0,130,90 --sample-every 6990 --output /tmp/jianji-cover-m1-20260924/insufficient
python3 scripts/shape-cover-mask-probe.py --source '/home/reggie/电商/滴耳康/素材/竞品详情-抖音电商罗盘 - 2026-09-15T234612.828.mp4' --roi 530,0,190,150 --output /tmp/jianji-cover-m1-20260924/shape-change
python3 scripts/shape-cover-mask-probe.py --source '/home/reggie/电商/舒鼻膏/素材/竞品详情-抖音电商罗盘 - 2026-09-21T231540.008.mp4' --roi 570,0,150,110 --edge-sheet-every 134 --output /tmp/jianji-cover-m1-20260924/holdout-bear2
```

ROI 是人工指出的粗搜索区域，不来自保存的覆盖框；候选形状直接从原帧像素的时间稳定性重建。探针取最大通道时间标准差 `<20` 的最大八连通块，向外扩 3 个源像素，并使用腐蚀后的内部核心检查所有解码帧。`40` 的核心平均最大通道差、`1000` 像素的连通块下限只是本次开发样本的实验门槛，不能作为生产通用阈值。开发原片的完整 SHA-256 是 `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`，54577917 字节；留出熊图原片的完整 SHA-256 是 `2df04f9929df499311bc9c6ac16371cbed35d308cefaba5edab09861ea9bc267`，15015790 字节。

# Observations

| Case | Reproducible result | Human evidence and decision |
| --- | --- | --- |
| 肥皂原片 `a18f7e4e…c0bf`，720×1280、30 fps、time base `1/15360`，帧 `[420,510)` 即 14–17 秒 | 45 个交替建模帧产生源坐标 bbox `[628,1,709,60)`、3259 个标记像素；单独用全部 90 帧重建得到相同 bitset。90 帧核心检查最大均差 8.709。首末原帧 PTS 为 `215040`、`260608`；半开结束 PTS 为 `261120`。 | 查看 `static-14-17-train/edge-contact-sheet.png` 的全部 90 个原帧：旧标主体、尖端、白色描边始终落在紫色 mask 边界内，跨蓝天、肤色和深色背景未见形变或消失。**该短 segment 的候选可作为 M2 mask 事实的开发样本**；此判断只覆盖所查 90 帧，不等于全片批准。 |
| 同一原片全部 6990 帧 | 每秒取 1 帧建模得 bbox `[627,0,711,61)`、3540 像素；6990 帧核心均差最大 28.174。此较宽候选包含上述短 segment mask 和先前 3 秒实验 mask 的全部像素。 | `static-full/edge-contact-sheet.png` 仅显示 10 个间隔时点；全片可见边界和出现/消失区间没有逐帧审阅。**不把 `[0,233s)` 登记为可信源事实**。旧实验 mask 只用于独立包含关系对照，没有被导入候选。 |
| 舒鼻膏左上无贴纸区域 `70a4b7fd…092b5` | `NO_STABLE_COMPONENT`。 | 原帧无目标旧贴纸，拒绝。 |
| 滴耳康右上变化区域 `f1403fbf…b36c` | `NO_STABLE_COMPONENT`。 | 原帧图形/场景随时间变化，不能给一个静态形状，拒绝。 |
| 肥皂原片每 6990 帧只取一个证据帧 | `INSUFFICIENT_TIME_EVIDENCE`。 | 单帧不能建立出现时段和静态性，拒绝。 |
| 留出素材：舒鼻膏熊图 `2df04f99…c267` | 核心检测提出 bbox `[656,17,705,70)`、1928 像素，1342 帧核心均差最大 4.983。 | 查看 `holdout-bear2/edge-contact-sheet.png`：粉色爱心位于候选 mask 外且在时间中移动。候选只覆盖静止的熊，遗漏同一旧贴纸的可见贡献，**人工拒绝整段静态 mask**。这也说明单靠内部核心稳定性不能自动放行。 |
| 留出素材：肥皂小金标和橙标 | 分别以 `NO_SIZED_STABLE_COMPONENT` 拒绝，最大稳定块只有 192、353 像素。 | 有可见小图案，但开发门槛不覆盖这一类；不得把拒绝写成“无贴纸”或降低门槛后追认留出样本。 |

短 segment 候选文件为 `static-14-17-train/candidate-mask.bitset`：`bitpack-lsb-row-major-v1`，行优先、每字节低位先行、尾部填充位为零，bbox 半开、源像素 1:1，共 598 字节，SHA-256 为 `7bfde65db7230effcfad882d9b48c045fa8c02a961bcd224092ec761a2253838`。PNG 只供观看；源事实应校验 bitset 长度恰为 `ceil(width × height / 8)`、尾部位、bbox、标记数及摘要。拟给 M2 的硬上限为单边 512 源像素、总计 262144 像素、编码最多 32768 字节；超过即 `UNSAFE`，不得降采样或退回矩形。身份继续使用既有 `SourceIdentity`，mask 不能只按文件名或此表的简写 hash 复用。

# M1 Decision

真实原片的一个连续静态短 segment 已能建立源空间保守候选，并在全部 90 帧做了人工边缘核查；无贴纸、证据不足、变化图形和视觉证据反驳自动候选均有可重复的拒绝结果。**M1 尚未收敛到可进入 M2 的生产合同**：第二个留出静态样本被移动爱心否决，小图案超出当前门槛；还缺独立的、确认为静态且可建立 mask 的留出样本，用来验证边缘保守性和冻结扩张的半径、面积及宽高上限。现有 1.8 秒星形通过率不能代替该留出验证。按 plan 保持正式白底路径及规则，继续 M1 样本采集；不得先实现或启用轮廓 renderer。
