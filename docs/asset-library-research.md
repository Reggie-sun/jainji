# Sticker and Font Library Research

## Scope

本文只评估可离线缓存并随应用打包的现成资产；未下载、安装依赖或改动运行时代码。结论以 FFmpeg 合成为目标：项目为叠加贴纸选择带透明通道的 PNG；SVG 先在受控构建步骤栅格化，避免把 SVG 解码能力当作运行时前提。FFmpeg 的 `image2` demuxer 可读取图像文件。[FFmpeg image2](https://ffmpeg.org/ffmpeg-formats.html#image2)

## Recommendation

首选 **Microsoft Fluent Emoji 的固定版本 3D PNG 子集**，用于“促销、爆款、购物、爱心、庆祝”等电商视频贴纸；它直接满足 PNG 合成路径，且仓库采用 MIT。MIT 允许使用、修改、分发和销售副本，但随分发副本或实质部分须保留版权及许可文本。[Microsoft repository](https://github.com/microsoft/fluentui-emoji) [MIT license](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/LICENSE)

固定到父会话已核验的 Git tree `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`；该完整 tree 的 3D PNG 路径共有 **3,145 个 PNG 文件（包含变体）**，并已确认有 Fire、Party popper、Red heart、Shopping bags/cart、Sparkles。集成时只选定产品清单中的文件，而非把该文件数解释为不同语义贴纸或全量打包。[Pinned GitHub tree](https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/1ffb34c752ecf5d402f04cfb4b392c77f57c54bc?recursive=1)

中文文字首选 **Noto Sans SC**（正文、价格、标签），必要时以 **Noto Serif SC** 做内容型标题。Noto 官方将两者列为简体中文变体；Noto CJK 提供多字重，且 Noto Sans CJK 有 variable font。[Noto usage guide](https://github.com/notofonts/noto-docs/blob/main/docs/website/use.md) 字体文件按 SIL OFL 1.1 可随软件打包和销售，但应附带版权与许可；不得单独销售字体。[Noto Sans SC OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt)

字体候选不只限于 Noto：**Noto Sans SC** 负责正文与价格，展示性短文案可按视觉需要从 Google Fonts 的 **ZCOOL KuaiLe**、**ZCOOL XiaoWei**、**Ma Shan Zheng** 中选择。三者的仓库原始许可均为 SIL OFL 1.1，随包规则同上；可作为标题/角标的设计候选。[ZCOOL KuaiLe OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/OFL.txt) [ZCOOL XiaoWei OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei/OFL.txt) [Ma Shan Zheng OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/OFL.txt)

## Comparison

| Library | 资源与 FFmpeg 适配 | 许可与打包结论 | 取舍 |
| --- | --- | --- | --- |
| Fluent Emoji | 3D PNG 可直接进入统一的透明 PNG 叠加资产路径。Microsoft 官方仓库为 emoji 集合，固定 tree 可锁定输入。 [repository](https://github.com/microsoft/fluentui-emoji) | MIT；将 `LICENSE` 与版权声明随所选资源一起打包。 [license](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/LICENSE) | **主方案**：视觉表达强、许可和离线分发最直接。 |
| OpenMoji | 官方 release 提供 production-ready 的 72×72、618×618 PNG 及 SVG；PNG 可直接用，SVG 需预转换。 [README](https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/README.md) | 图形为 CC BY-SA 4.0，要求署名；改编还涉及同许可传播义务。 [FAQ](https://github.com/hfg-gmuend/openmoji/blob/master/FAQ.md) | 不作为默认商业资产包；仅在产品接受 CC BY-SA 与可见署名时选用。 |
| Iconify | 以 IconifyJSON 保存图标集资料，不是预制 PNG；其 SVG/JSON 应在构建时挑选、导出并转为 PNG。 [icon-set format](https://iconify.design/docs/icons/icon-set-basics.html) | **不是统一的图标许可**：许可按 collection，不按单图标；`collections.json` / `info` 含 author 与 license，必须按所选 prefix 逐个记录与审核。 [license model](https://iconify.design/docs/icons/icon-set-basics.html) [package metadata](https://iconify.design/docs/icons/all.html) | 可作小型 UI 图标补充，不能以“Iconify MIT”或“一次许可”方式整体打包。 |
| Google Fonts / Noto + ZCOOL | 字体由文字渲染步骤使用；离线产品应缓存经审核的字体二进制，而非依赖 Google Fonts CDN。Google Fonts 的 Web API 是浏览器样式表加载机制。 [Google Fonts API](https://developers.google.com/fonts/docs/getting_started) | Noto Sans SC、ZCOOL KuaiLe、ZCOOL XiaoWei 与 Ma Shan Zheng 的所列文件均为 OFL；随包保留各自许可和版权文本。 [Noto OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt) [ZCOOL KuaiLe OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolkuaile/OFL.txt) [ZCOOL XiaoWei OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei/OFL.txt) [Ma Shan Zheng OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/OFL.txt) | **主字体方案**：`Noto Sans SC` 默认；增加上述标题及手写字体，按需下载供用户选择。 |
| LottieFiles（可选） | Lottie 是动画文件，不是 FFmpeg 的 PNG 贴纸输入；若引入，需另行确定渲染/逐帧预渲染链路。 | Lottie Simple License 允许商用和修改，但公开文件及其修改的显示、发布、表演或分发须受同一许可约束；不能将文件汇编为竞争服务。每个动画还应检查具体许可与创作者附加限制。 [license](https://lottiefiles.com/page/license) [licensing guidance](https://help.lottiefiles.com/animation-licensing-basics-) | 不纳入本次默认集成，除非产品明确接受其分发条款并需要动态动画。 |

## Packaging Plan

1. 维护受控 manifest：每个资产记录库名、固定版本/commit、上游路径、源 URL、许可标识、版权/署名文本、文件 SHA-256 与本地 PNG 路径。
2. 构建时将被选中的 SVG 转为固定尺寸、保留透明通道的 PNG；导出时使用缓存后的 PNG。Fluent 3D PNG 与 OpenMoji PNG 无需该转换步骤。[FFmpeg image2](https://ffmpeg.org/ffmpeg-formats.html#image2) [OpenMoji formats](https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/README.md)
3. 建议在发布/导出前下载选中资源到本地缓存，固定上游版本或 commit，并同时保存许可证与 notices；导出阶段使用该缓存，保证离线导出可复现。Iconify 的本地 icon-set 数据可按单 collection 使用。 [Iconify data](https://iconify.design/docs/icons/icon-data.html) [individual collections](https://iconify.design/docs/icons/json.html)
4. 字体只缓存需要的字重；Noto 官方也建议按实际语言选择字体与样式，避免加入过多字重。 [Noto web recommendations](https://github.com/notofonts/noto-docs/blob/main/docs/website/use.md)

## Future Consideration

动态 Lottie 动画是未来可选事项，不构成当前 PNG 贴纸集成的审批门槛；届时再确定渲染/逐帧预渲染路径，并按每项资产的许可与创作者附加限制评估。[LottieFiles licensing guidance](https://help.lottiefiles.com/animation-licensing-basics-)

## Verification

调研日期：2026-09-12。已浏览并采用 Microsoft、OpenMoji、Iconify、Google/Noto、FFmpeg 与 LottieFiles 的官方仓库、文档或许可证页面；每项事实在正文处链接到其一手来源。未执行下载、依赖安装、API 付费调用或代码检查。
