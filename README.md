# Discourse Litematic Viewer

将帖子中的 `.litematic` 上传附件自动显示为 **文件名 · 3D 预览 · 下载**。点击预览后，在 Discourse 原生弹窗中旋转、缩放、查看分层及材料。无需改写帖子，也无需安装后端插件。

## 安装

1. 在 Discourse 管理后台的 `authorized extensions` 设置中添加 `litematic`（不带点）。按需要调整论坛原有的附件大小限制。
2. 进入主题管理，选择安装主题组件，使用仓库地址：
   `https://github.com/LuckyODO/discourse-theme-litematicviewer`
3. 将 **Litematic Viewer** 组件添加到论坛正在使用的主题。若有多个可选主题，需要分别添加。
4. 在帖子中上传一个 `.litematic` 文件。已发布的附件在下次打开帖子时也会自动识别，不需要重新烘焙帖子。

最低目标版本为 **Discourse 2026.10.0-latest**，使用该版本的 `ui-kit` 弹窗接口。更旧的 Discourse 版本需要先升级或单独适配，不能直接更改最低版本号后假定兼容。

## 默认查看器与自托管

默认嵌入 [LitematicWebViewer](https://github.com/Gudu-Z/LitematicWebViewer) 的公共服务 `https://lwv.loafing.club/index.html`，无需额外部署。**主题组件自身不包含 Minecraft 渲染器和资源包**；默认服务的可用性和模型兼容性由上游决定。

论坛前端按当前访客权限读取附件，再通过验证来源、窗口和随机会话标识的 `postMessage` 将文件内容交给查看器。附件 URL、论坛登录 Cookie 和令牌不会作为消息发送给查看器。文件内容会由配置的查看器代码在访客浏览器中处理，因此请只配置受信任的服务；私有社区可将 `viewer_url` 改为自己控制的地址。

自托管时，`viewer_url` 应指向支持 **`litematic-preview-v1`** 协议的完整查看器入口，例如 `https://viewer.example.com/index.html` 或 `https://viewer.example.com/litematic/`。它不是任意 3D 查看器的 URL；必须支持 `ready/configure/load/loading/loaded/error/close-request/active` 消息和 Blob/File 输入。上游的 `?v=` 不是版本锁定；自托管请自己固定并验证部署版本。

本仓库独立实现协议适配，不复制或打包上游查看器代码、材质或模型。自托管及再分发上游资源时，请先确认其许可。

## 设置

| 设置                   | 默认值         | 用途                                                    |
| ---------------------- | -------------- | ------------------------------------------------------- |
| `enabled`              | `true`         | 启用帖子附件预览                                        |
| `viewer_url`           | 公共查看器地址 | 可替换为兼容协议的自托管查看器                          |
| `max_preview_size_mb`  | `32`           | 压缩附件预览上限，单位 MiB，范围 1–64；不限制原文件下载 |
| `load_timeout_seconds` | `90`           | 下载、查看器初始化及首次渲染的总超时，范围 15–300 秒    |
| `viewer_theme`         | `auto`         | `auto` 跟随系统，或指定 `light` / `dark`                |

提供简体中文、英文界面；查看器语言根据论坛页面语言选择中文或英文。固定深色/浅色主题可以相应设置 `viewer_theme`。

## 性能与行为

- 浏览帖子时只增强附件链接，不下载投影、不创建 iframe、不加载渲染库。
- 点击后才读取附件和加载查看器，同时只有一个原生预览弹窗。
- 关闭、替换弹窗、离开当前主题、超时或失败时，取消下载并移除 iframe、计时器和事件监听。标签页隐藏时通知查看器暂停绘制。
- 帖子无限滚动和重新渲染不会重复添加按钮；保留原始附件节点，使 Discourse 的短链接解析与权限路径继续有效。
- 下载过程中检查实际累计字节数，即使服务器没有或错误地提供 `Content-Length`，仍会执行大小上限。
- 检查 gzip 文件头后才传递文件。解压、格式解析、方块数量和渲染内存限制由查看器负责；压缩文件很小也可能包含巨大模型。
- 组件不写入 localStorage/IndexedDB，也不保留已关闭模型的解析结果；附件的 HTTP 缓存遵循服务器响应头和浏览器缓存策略。
- 下载按钮始终独立于查看器，预览失败仍可下载。跨域下载是否强制另存由对象存储的 `Content-Disposition` 决定。
- 仅识别主题帖子中的上传附件；不改写普通外链、代码块、编辑器草稿或聊天消息。

## 常见问题

**能下载，但预览提示无法读取附件**：浏览器下载导航与 JavaScript 读取具有不同跨域要求。若文件在 S3/R2/CDN，需允许论坛域名读取文件响应，重定向后的响应也要满足 CORS。保留私有附件原有的权限校验，组件不会将它们公开。

**查看器一直加载或超时**：检查 `viewer_url` 的可达性，以及浏览器控制台是否报告 iframe 被 CSP 阻止。如果反向代理设置了额外的 CSP，需在 `frame-src` 中允许查看器域名，在 `connect-src` 中允许实际附件域名。自托管查看器的 `frame-ancestors` / `X-Frame-Options` 也不能禁止论坛嵌入。不需要关闭 Discourse 的 CSP。

**大文件、模组方块或某些版本无法显示**：组件负责附件接入，不保证查看器支持所有 Minecraft 版本、实体和资源包。先用小型原版投影验证集成，再测试社区常用文件；无法预览时下载原文件。

## 开发与验证

```sh
pnpm install
pnpm test
pnpm lint
pnpm exec playwright install chromium
pnpm test:browser
```

`pnpm test` 检查附件识别、原始链接保留、重复装饰、消息来源校验、下载限额、超时和清理。浏览器测试使用独立测试页加载生产模块，覆盖真实 iframe 通信；该测试页不代替完整 Discourse 测试。

`spec/system/litematic_viewer_spec.rb` 在 Discourse 官方主题 CI 中验证实际帖子和原生弹窗。外部查看器和附件响应使用模拟服务，测试无需依赖公共查看器在线。

安装到测试论坛后，还应使用实际 S3/CDN、私有分类以及社区常用的大小投影检查存储和模型兼容性。支持通过 `LIVE_VIEWER=1 pnpm test:browser` 运行公共查看器烟雾测试（需要网络/WebGL，具体命令见浏览器测试配置）。

## English

A Discourse theme component that turns uploaded `.litematic` attachments into a filename, **3D preview** button, and separate **Download** link. Preview opens in a native Discourse dialog only on demand. The original attachment node and its permission URL are preserved. Preview downloads are size-limited and cancellable; closing the dialog destroys the isolated iframe and its resources.

Add `litematic` to `authorized extensions`, install this repository as a theme component, and attach it to your active themes. Requires Discourse 2026.10.0-latest or newer. The default renderer is the public LitematicWebViewer service; configure a trusted self-hosted v1-compatible viewer via `viewer_url` if desired. No renderer or Minecraft assets are bundled. Private-file content is processed by the configured viewer in the visitor's browser; credentials and attachment URLs are not passed to it.

## 参考

- [Discourse Theme Developer Guides](https://meta.discourse.org/t/developing-discourse-themes-theme-components/93648)
- [LitematicWebViewer embedding documentation](https://github.com/Gudu-Z/LitematicWebViewer/blob/main/README.en.md)

主题代码沿用官方模板的 MIT 许可。该许可不涵盖外部查看器或 Minecraft 资源。
