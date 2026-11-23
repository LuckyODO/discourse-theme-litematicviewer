# Discourse Litematic Viewer

将帖子中的 `.litematic` 上传附件显示为 **文件名 · 3D 预览 · 下载**。点击后在 Discourse 原生弹窗中旋转、缩放、查看分层和材料。渲染器与解析 worker 随主题组件安装，文件在访客浏览器内处理，**不依赖公共预览网站，也不需要额外部署服务或资源包**。

## 安装

1. 在 Discourse 管理后台的 `authorized extensions` 中添加 `litematic`（不带点）。按需要调整论坛原有的附件大小限制。
2. 进入主题管理，选择安装主题组件，使用仓库地址：
   `https://github.com/LuckyODO/discourse-theme-litematicviewer`
3. 将 **Litematic Viewer** 组件添加到正在使用的主题；多个可选主题需要分别添加。
4. 在帖子中上传 `.litematic` 文件。已有附件也会在下次打开帖子时自动识别，无需重新烘焙帖子。

最低目标版本为 **Discourse 2026.10.0-latest**，使用该版本的 `ui-kit` 弹窗接口。更旧版本需要升级或单独适配。安装时无需执行构建命令，仓库已包含构建后的资源。

## 预览范围

提供有颜色的基础方块模型，并对台阶、楼梯、栅栏等常见方块使用简化形状。可旋转、缩放、重置视角、按高度切层并查看材料数量，适合快速判断建筑结构。材料列表最多显示 200 种，并提示剩余种类数量。

支持 Litematic 格式版本 5–7。预览限制为：解压数据 128 MiB、区域总体积 400 万、可见方块 100 万、区域数 256、每轴跨度 2048 方块、网格面 20 万，以及 8192 种不同的方块状态模型。压缩文件另受下方大小设置与 64 MiB 硬上限约束。

预览**不使用 Minecraft 原版材质或资源包**，不显示实体，也不保证精确还原所有方块状态和游戏内效果。无法识别的方块以稳定颜色的立方体显示；部分模组方块可能按名称使用简化形状。需要精确材质、完整模型或游戏内放置时，请下载原文件并使用 Litematica。

## 设置

| 设置                   | 默认值 | 用途                                                    |
| ---------------------- | ------ | ------------------------------------------------------- |
| `enabled`              | `true` | 启用帖子附件预览                                        |
| `max_preview_size_mb`  | `32`   | 压缩附件预览上限，单位 MiB，范围 1–64；不限制原文件下载 |
| `load_timeout_seconds` | `90`   | 下载、解析和首次渲染的总超时，范围 15–300 秒            |
| `viewer_theme`         | `auto` | `auto` 跟随当前论坛主题，或指定 `light` / `dark`        |

界面提供简体中文和英文。2.0 版使用内置渲染器，无需填写查看器地址。

## 性能与附件权限

- 浏览帖子时只增强附件链接；点击预览才下载文件、加载渲染库并启动解析 worker。
- 解析在独立 worker 中完成；关闭或替换弹窗、离开当前主题、超时或失败时，取消下载并释放 worker、画布及渲染资源。
- 绘制按交互更新，限制像素密度和模型复杂度，避免持续占用 GPU。
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

渲染器和解析 worker 的源码由 esbuild 打包为 `assets/litematic-renderer.js` 与 `assets/litematic-worker.js`，通过 `about.json` 注册为主题资源。修改源码后应重新构建并提交产物；运行时不从 npm 或公共 CDN 下载依赖。

单元测试覆盖附件识别、解析限制、下载限额、超时和资源清理。独立浏览器测试在桌面和移动视口中强制执行真实 WebGL 渲染、像素和交互检查，不因缺少 WebGL 而跳过。

`spec/system/litematic_viewer_spec.rb` 在 Discourse 官方主题 CI 中使用实际存储的 gzip 附件，验证帖子增强、按需加载、原生弹窗、关闭与重开、失败下载和停用行为，并在论坛 CSP 下强制运行真实同源 worker 的解析与网格生成。弹窗测试在加载渲染库前独立检测浏览器 WebGL2 能力：支持时必须成功渲染；不支持时必须显示明确错误并保留下载、关闭和重开功能。官方 CI 容器的图形后端可能只能验证这一降级路径，完整真实渲染仍由上述独立浏览器测试强制验证。

部署到测试论坛后，请再用实际 S3/CDN、私有分类和社区常用投影检查附件读取与模型兼容性。

## 许可与参考

主题代码使用 MIT 许可。内置 Three.js 使用 MIT 许可，随构建产物保留许可声明。基础模型和配色由本项目实现；仓库不分发 Minecraft 材质或资源包。

- [Discourse 主题开发指南](https://meta.discourse.org/t/developing-discourse-themes-theme-components/93648)
- [Discourse Mermaid 组件的按需资源加载](https://github.com/discourse/discourse-mermaid-theme-component)
- [Discourse Graphviz 组件的同源 worker](https://github.com/discourse/discourse-graphviz-theme-component)
- [Three.js](https://github.com/mrdoob/three.js)

## English

A self-contained Discourse theme component that adds **3D preview** and **Download** controls to uploaded `.litematic` attachments. It loads its bundled renderer and parsing worker only when requested, then opens a native Discourse dialog. No public viewer, external resource pack, or additional hosting is required.

Add `litematic` to `authorized extensions`, install this repository as a theme component, and attach it to your active themes. Requires Discourse 2026.10.0-latest or newer. Previews use simplified colored geometry; entities and exact Minecraft textures are not included. Unknown blocks use colored cubes. Original downloads and attachment permissions remain intact.
