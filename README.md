# Discourse Litematic Viewer

将帖子中的 `.litematic` 上传附件显示为 **文件名 · 3D 预览 · 下载**。点击后在 Discourse 原生弹窗中旋转、缩放、查看分层和材料。渲染器、Minecraft 原版方块模型与材质、解析 worker 随主题组件安装，文件在访客浏览器内处理，**不依赖公共预览网站，也不需要额外部署服务或资源包地址**。

## 安装

1. 在 Discourse 管理后台的 `authorized extensions` 中添加 `litematic`（不带点）。按需要调整论坛原有的附件大小限制。
2. 进入主题管理，选择安装主题组件，使用仓库地址：
   `https://github.com/LuckyODO/discourse-theme-litematicviewer`
3. 将 **Litematic Viewer** 组件添加到正在使用的主题；多个可选主题需要分别添加。
4. 在帖子中上传 `.litematic` 文件。已有附件也会在下次打开帖子时自动识别，无需重新烘焙帖子。

最低目标版本为 **Discourse 2026.10.0-latest**，使用该版本的 `ui-kit` 弹窗接口。更旧版本需要升级或单独适配。安装时无需执行构建命令，仓库已包含构建后的资源。

## 预览范围

内置 **Minecraft Java 26.3 原版方块模型、方块状态与材质**。根据投影中的状态选择原版 JSON 模型，处理楼梯内外角、上下半部、栅栏连接、门的朝向与开关、铁轨转弯等形状；玻璃、染色玻璃和水使用半透明混合。可旋转、缩放、重置视角、按高度切层并查看材料数量。材料列表最多显示 200 种，并提示剩余种类数量。

特殊方块使用内置的原版实体材质和静态模型：单箱、双箱、陷阱箱、末影箱、铜箱、16 色站立与墙上旗帜、潜影盒、原版头颅、饰纹陶罐、钟和潮涌核心。床、告示牌与悬挂告示牌复用 26.3 的原版 JSON 模型。旗帜读取投影中的新旧格式图案（最多 16 层），陶罐读取四侧陶片数据；相同方块状态下的不同装饰分别保留。

附魔台包含静态展开的书本；末地传送门和末地折跃门使用原版星点纹理的静态表面，不模拟游戏内动态着色、视差或光束。

点击 **材料（种类数）** 打开可滚动面板，查看整个投影各方块的数量。统计不随切层变化，按投影中的方块格数计算，不包含箱子库存，也不是生存模式所需物品的换算清单。材料面板独立于 Discourse 的折叠内容样式；按 Esc 先收起面板，再次按下关闭预览。

支持 Litematic 格式版本 5–7。预览限制为：解压数据 128 MiB、区域总体积 400 万、可见方块 100 万、区域数 256、每轴跨度 2048 方块、方块实体数据 65,536 条、网格面总数 20 万（其中半透明面最多 65,536），以及 8192 种不同模型变体（含装饰）。压缩文件另受下方大小设置与 64 MiB 硬上限约束。

这是静态结构预览：动画材质仅使用首帧，草、树叶和水等使用固定染色，不还原游戏光照或生物群系颜色。流体表面按液位、相邻方块和含水状态生成，保留水源、流动及下落状态的形状，但不模拟流动或播放动画。半透明面随视角排序；相交透明面等复杂遮挡可能与游戏效果不同。

特殊模型保持静止：箱盖关闭、旗帜不摆动、潜影盒不展开、潮涌核心使用未激活形态。告示牌显示原版形状但不显示文字；玩家头颅使用内置默认皮肤，不访问皮肤服务器。无法识别的模组或未覆盖方块使用近似后备模型，界面会显示其方块数量；不显示生物等实体。模型与材质固定为 26.3 版，不保证还原其他游戏版本的全部状态。需要完整游戏效果或游戏内放置时，请下载原文件并使用 Litematica。

## 设置

| 设置                   | 默认值 | 用途                                                    |
| ---------------------- | ------ | ------------------------------------------------------- |
| `enabled`              | `true` | 启用帖子附件预览                                        |
| `max_preview_size_mb`  | `32`   | 压缩附件预览上限，单位 MiB，范围 1–64；不限制原文件下载 |
| `load_timeout_seconds` | `90`   | 下载、解析和首次渲染的总超时，范围 15–300 秒            |
| `viewer_theme`         | `auto` | `auto` 跟随当前论坛主题，或指定 `light` / `dark`        |

界面提供简体中文和英文。2.3 版内置原版普通与特殊方块模型、材质图集，无需填写查看器或材质包地址。

## 性能与附件权限

- 浏览帖子时只增强附件链接；点击预览才下载文件、加载渲染库和内置图集并启动解析 worker。
- 图集 PNG 字节作为 Base64 随渲染器脚本分发，在浏览器内解码，不请求外部材质图片。渲染脚本和 worker 使用论坛的同源主题资源路径。
- 解析在独立 worker 中完成；关闭或替换弹窗、离开当前主题、超时或失败时，取消下载并释放 worker、画布、纹理及图像解码资源。
- 绘制按交互更新，限制像素密度和模型复杂度，避免持续占用 GPU。
- 不透明面与半透明面分别批量绘制，视角变化时只更新半透明面的排序，不为每个玻璃或水方块创建单独绘制对象。
- 特殊方块与旗帜图案也合并进同一网格，不按方块创建独立 Mesh；相同外观复用有上限的模型缓存。方块实体只读取渲染所需的装饰字段，跳过库存、皮肤 URL 等无关数据。
- 下载过程中检查累计字节数；解压数据、投影体积、方块数和生成网格分别设有上限。超过上限时显示错误，保留下载入口。
- 保留原始附件节点和权限 URL，兼容 Discourse 短链接解析、无限滚动和帖子重新渲染。同源附件按当前访客权限读取；跨域存储需要允许论坛来源的 CORS 响应。
- 不写入 localStorage/IndexedDB，也不保留已关闭模型的解析结果。文件的 HTTP 缓存遵循论坛或对象存储的响应头。
- 下载按钮独立于预览；预览失败仍可下载原文件。跨域链接是否强制另存由存储服务的 `Content-Disposition` 决定。
- 仅增强主题帖子中的上传附件，不改写普通外链、代码块、编辑器草稿或聊天消息。

## 常见问题

**能下载，但预览无法读取附件**：下载导航与 JavaScript 读取具有不同跨域要求。若附件在 S3/R2/CDN，实际文件及重定向后的响应需要允许论坛域名读取。组件不会公开私有附件，也不会绕过其权限校验。

**提示无法使用 3D 图形**：使用支持 WebGL 的浏览器，并检查浏览器的硬件加速设置。预览不可用时仍可下载。

**提示投影过大或过于复杂**：压缩文件很小也可能包含巨大模型。预览上限用于控制浏览器内存和绘制成本，调整附件大小设置不会取消解压和模型复杂度限制。

**内置资源加载失败**：更新主题组件并检查 `/theme-javascripts/` 资源是否正常返回。组件使用 Discourse 默认允许的同源 worker，无需修改默认 CSP。若反向代理额外设置了 CSP，需要允许论坛自己的脚本、worker，以及实际附件来源的读取。

## 开发与验证

```sh
pnpm install
pnpm build:viewer
pnpm test
pnpm lint
pnpm exec playwright install chromium
pnpm test:browser
```

`node scripts/build-textures.mjs` 从仓库中的固定材质源生成图集、UV 元数据和嵌入 PNG 字节的 `renderer/generated/atlas-image.mjs`；添加 `--check` 可检查产物是否与源文件一致。原始图片字节保存在单个 `texture-source/26.3.json` 数据文件中，以满足 Discourse 的主题文件数量限制。出处与版本记录见 [texture-source/source.json](texture-source/source.json)。

`node scripts/build-models.mjs` 从 `model-source/26.3.json` 保存的原版 blockstates 与 block model JSON 字节生成 `renderer/generated/block-models.mjs`，同样支持 `--check`。出处、版本和版权说明见 [model-source/source.json](model-source/source.json) 与 [model-source/LICENSE.md](model-source/LICENSE.md)。构建全程使用仓库中的固定数据，无需联网。

`pnpm build:viewer` 会先重建图集与模型数据，再由 esbuild 将渲染器和解析 worker 打包为 `assets/litematic-renderer.js` 与 `assets/litematic-worker.js`，通过 `about.json` 注册为主题资源。修改源码、模型或材质后应重新构建并提交产物；运行时不从 npm、Mojang 或公共 CDN 下载依赖和资源。

单元测试覆盖附件识别、解析限制、模型状态、网格生成、透明面排序、下载限额、超时和资源清理。独立浏览器测试在桌面和移动视口中强制执行真实 WebGL 渲染、像素和交互检查，不因缺少 WebGL 而跳过。浏览器测试页面添加 `?showcase=1` 可加载包含楼梯、连接栅栏、门、铁轨、多层玻璃、水池及含水台阶的合成投影。

添加 `?special=1` 可查看箱子、旗帜图案、潜影盒、床、头颅、陶罐等特殊方块的合成投影。回归测试比较有无旗帜图案的实际画面，校验相机能容纳超出方块边界的模型，并在 Discourse 折叠样式下验证材料列表可读、滚动和键盘行为。

`spec/system/litematic_viewer_spec.rb` 在 Discourse 官方主题 CI 中使用实际存储的 gzip 附件，验证帖子增强、按需加载、原生弹窗、关闭与重开、失败下载和停用行为，并在论坛 CSP 下强制运行真实同源 worker 的解析与网格生成。弹窗测试在加载渲染库前独立检测浏览器 WebGL2 能力：支持时必须成功渲染；不支持时必须显示明确错误并保留下载、关闭和重开功能。官方 CI 容器的图形后端可能只能验证这一降级路径，完整真实渲染仍由上述独立浏览器测试强制验证。

部署到测试论坛后，请再用实际 S3/CDN、私有分类和社区常用投影检查附件读取与模型兼容性。

## 许可与参考

主题代码和 Three.js 使用 MIT 许可，随构建产物保留许可声明。Minecraft 原版材质、模型与方块状态资源的版权归 Mojang/Microsoft 所有，**不属于本项目 MIT 许可覆盖的代码**；出处与使用说明分别记录在 [texture-source/LICENSE.md](texture-source/LICENSE.md) 和 [model-source/LICENSE.md](model-source/LICENSE.md)。本项目不是 Minecraft 官方产品。

- [Discourse 主题开发指南](https://meta.discourse.org/t/developing-discourse-themes-theme-components/93648)
- [Discourse Mermaid 组件的按需资源加载](https://github.com/discourse/discourse-mermaid-theme-component)
- [Discourse Graphviz 组件的同源 worker](https://github.com/discourse/discourse-graphviz-theme-component)
- [Three.js](https://github.com/mrdoob/three.js)
- [deepslate 特殊模型几何与 UV 参考（MIT）](https://github.com/misode/deepslate/blob/main/src/render/SpecialRenderer.ts)，适配部分保留完整许可声明。

## English

A self-contained Discourse theme component that adds **3D preview** and **Download** controls to uploaded `.litematic` attachments. It loads its bundled renderer, Minecraft Java 26.3 vanilla block models, texture atlas, and parsing worker only when requested, then opens a native Discourse dialog. No public viewer, resource-pack URL, or additional hosting is required. Atlas PNG bytes are embedded in the renderer script and decoded locally.

Add `litematic` to `authorized extensions`, install this repository as a theme component, and attach it to your active themes. Requires Discourse 2026.10.0-latest or newer. Static JSON models follow blockstate properties; glass and water use sorted transparency, and fluid surfaces account for neighboring levels and waterlogging. Animated textures use their first frame, biome colors use fixed tints, and fluids do not simulate or animate. Version 2.3 also bundles static special models for chests, banners with saved patterns, shulker boxes, vanilla heads, decorated pots, bells and conduits; beds and signs use the original 26.3 JSON geometry. Sign text and remote player skins are not loaded. Chest lids remain closed and moving parts remain static. Unknown or unsupported blocks use approximate fallback models, with their count shown in the viewer. Mobs and other entities are not included. The Materials button opens a scrollable panel showing whole-schematic block counts, independent of layer selection and Discourse details styling. Original downloads and attachment permissions remain intact. Minecraft textures, models and blockstate resources retain Mojang/Microsoft copyright separately from the code's MIT license.
