# Toy JS SDK 1.7.0 接入分析

> 文档性质：项目内技术参考，并记录当前项目已经使用的 SDK 能力。
> 分析依据：用户提供的《Toy JS SDK 能力清单》，版本 1.7.0，更新时间 2026-08-27。  
> 原始文档：[Toy JS SDK 能力清单 1.7.0](./references/toy-js-sdk-1.7.0.md)。接口签名、参数和示例以该版本化快照为准。  
> 更新条件：SDK 版本、加载地址、接口签名、环境支持或平台隐私规则变化时，应重新核对并更新本文。

## 结论

Toy JS SDK 是运行在 Toy 页面中的浏览器端桥接 SDK，用于让页面调用 B站 App 或 Web 环境提供的能力。它与 `toy` CLI 分工不同：CLI 负责作品发布、更新、审核、查询和视频绑定，JS SDK 负责作品打开后的页面交互。

SDK 通过远程脚本加载，加载成功后暴露全局 `window.toy`。文档没有提供 npm 包、ES Module 入口或 TypeScript 类型包。除 `onContainerChange` 同步返回取消监听函数外，其余方法均返回 Promise。当前页面已经加载该脚本，并为实际使用的 `isSupport` 与 `navigate` 建立了最小 TypeScript 类型边界。

对 ValoLineup 当前产品形态最有价值的能力是：

1. `isSupport`：在调用平台能力前检测当前环境是否支持。
2. `navigate`：用 BV 号在 B站环境中打开教学视频。
3. `share` / `getQrCode`：分享当前 Toy 内的页面状态或生成二维码。
4. `onContainerChange` / `getContainerState` / `setContainerMode`：在 B站 App 内适配安全区、横竖屏和沉浸模式，适合地图型界面。
5. `getCloudStorage` / `setCloudStorage`：保存登录用户在当前 Toy 下的少量偏好或进度。

SDK 不能替代当前项目的 Lineup 内容存储和编辑机制：云存储按“登录用户 + Toy”隔离，容量为每个 Toy 最多 128 个键值对，单个 value 不超过 1024 字节；它不适合作为所有访问者共享的 Lineup 数据源。当前 `content/*.yaml` 是地图、英雄和 Lineup 内容的权威来源。页面编辑只在浏览器中形成草稿，导出的 ZIP 编辑包由开发者通过仓库 CLI 导入。

## SDK 与发布工具的边界

| 能力 | Toy JS SDK | `toy` CLI |
| --- | --- | --- |
| 页面运行时调用 B站能力 | 是 | 否 |
| 发布或更新静态页面包 | 否 | 是 |
| 生成发布预览、提交审核 | 否 | 是 |
| 查询作品列表和访问统计 | 否 | 是 |
| 页面内读取用户资料 | 是 | 否 |
| 页面内用户云存储和排行榜 | 是 | 否 |
| 将 B站视频绑定到 Toy 作品 | 否 | 是 |
| 从 Toy 页面跳转到一个 B站视频 | 是，使用 `navigate` | 否 |
| App 横竖屏、沉浸和安全区 | 是 | 否 |

“视频绑定”和“视频跳转”不是同一能力。CLI 的视频绑定会改变视频页与 Toy 的线上关联；SDK 的 `navigate` 只在用户操作页面时发起一次导航。

## 接入契约

在 HTML `<head>` 中加载：

```html
<script src="https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js"></script>
```

加载后通过全局对象调用：

```js
const supported = await window.toy.isSupport('getQrCode')
if (supported) {
  const { base64 } = await window.toy.getQrCode()
  document.querySelector('#qr').src = base64
}
```

当前 TypeScript/React 接入遵守以下工程事实：

- SDK 只能从浏览器客户端代码访问，服务端渲染阶段不能读取 `window`。
- 文档未提供类型声明，项目只为用到的 `isSupport` 与 `navigate` 声明最小的 `window.toy` 类型。
- 本地开发、普通浏览器和 B站 App 的能力不同，不能以“脚本加载成功”代替能力判断。
- 每次调用 App 专属能力前都应执行 `isSupport`；不支持时 Promise 会 reject。
- 所有 SDK 错误带 `[ToySDK]` 前缀，调用点应使用 `try/catch` 处理。
- `navigate`、摄像头和麦克风请求必须由用户手势触发，不能在页面加载后自动执行。

本文不复制完整上游实现，也不把推断出的 TypeScript 类型当成 SDK 官方契约。真正接入时，应以对应版本的 SDK 文档和运行时行为为准。

## 能力索引

### 环境与导航

| 方法 | B站 App | Web | 关键约束 |
| --- | --- | --- | --- |
| `isSupport(ability)` | 支持 | 支持 | 返回 `Promise<boolean>`；能力名称必须来自 SDK 定义列表 |
| `navigate(req)` | 支持 | 支持 | 必须由用户手势触发；支持 video、space、search、opus、tribee、toy |
| `closeBrowser()` | 支持 | 不支持 | 关闭当前 App WebView |

`navigate` 接收页面类型、资源 ID 和可选的字符串参数。打开教学视频时应传 `type: 'video'` 和 BV 号，而不是任意网页 URL。

### 保存、分享和二维码

| 方法 | B站 App | Web | 关键约束 |
| --- | --- | --- | --- |
| `saveImageToAlbum(req)` | 支持 | 不支持 | `url` 与 `base64Data` 二选一，同时传时优先 `url` |
| `share(req)` | 支持 | 不支持 | 只接受当前 Toy 内的相对 path，不能传外部完整 URL 或 `../` 越界路径 |
| `getQrCode(req?)` | 支持 | 支持 | 只能生成当前 Toy 内页面的二维码，不能编码任意文本 |

`saveImageToAlbum` 的 `base64Data` 上限是 5,242,880 个字符，包含 data URL 前缀和空白，不是解码后的图片字节数。文档建议为体验将字符串控制在 2M 以内；更大的图片应优先传 URL。Web 端保存图片应使用浏览器标准下载能力。

`getQrCode` 不传参数时指向当前 Toy 的 `index.html`。可选 `path` 使用与 `share` 相同的当前 Toy 内路径规则；`size` 必须是 80 到 1024 之间的整数，默认 320。返回的 `base64` 是完整 PNG data URL，可直接赋给 `img.src`。

### 用户、作者与视频数据

| 方法 | 登录/确认要求 | 返回内容 |
| --- | --- | --- |
| `getUserProfile()` | 没有有效授权时需由用户操作触发平台确认 | 头像、昵称，以及 OpenID 模式下的 `toyOpenId` |
| `getAuthorProfile()` | 获取当前 Toy 作者公开资料 | 作者公开资料、账号统计、稿件数、充电聚合、粉丝勋章配置 |
| `getAuthorVideos(req)` | 只返回当前作者参与且可见的视频 | 1–50 个 aid/bvid 对应的视频公开信息 |
| `getAuthorRelation()` | 校验登录态，不触发资料确认 | 当前用户对作者的关注、老粉、粉丝勋章和包月充电状态 |
| `getVideoUserActions(req)` | 校验登录态，不触发资料确认 | 当前用户对作者视频的点赞、投币和收藏状态 |

隐私边界：

- SDK 不向 Toy 提供 UID、MID、登录令牌、用户确认挑战值或可用于跨 Toy 识别的真实账号信息。
- `toyOpenId` 是当前登录用户在当前 Toy 内的稳定假名标识，只能用于当前 Toy 内关联数据。
- `toyOpenId` 不是鉴权凭证，不得写入埋点或公开日志。
- `getAuthorProfile` 不允许指定其他作者 ID，只能读取当前 Toy 作者。
- `getAuthorVideos` 每次接收 1–50 项，每项只能包含 aid 或 bvid；SDK 会去重并保留首次出现顺序。
- `getVideoUserActions` 的 `aids` 与 `videos` 二选一，不能同时传或同时省略。

文档的环境表将这些能力标为 App/Web 均支持，同时特别说明外部手机浏览器在作者关系和视频互动场景下可能返回 `unsupported` 并引导打开 B站 App。实际接入不能把“Web 支持”理解为所有外部浏览器条件下都必然可用。

### 用户云存储

| 方法 | 作用 |
| --- | --- |
| `setCloudStorage(items)` | 批量 upsert，同 key 覆盖旧值 |
| `getCloudStorage(keys?)` | 读取指定 key；不传或传空数组时读取全部可见 key |
| `removeCloudStorage(keys)` | 批量删除指定 key |

数据按“登录用户 + 当前 Toy”双维度隔离，并跟随登录态跨设备持久化。调用需要用户已登录，但不会触发用户资料确认弹窗。

容量和格式限制：

- 单个 Toy 最多 128 个 key-value。
- key 只能包含字母、数字、下划线和短横线，最长 128 字节。
- key 不能以 `__` 开头；这一前缀由平台保留。
- value 必须是字符串，最长 1024 字节。
- 对象需要由页面自行 `JSON.stringify` 和 `JSON.parse`。
- 写入和删除失败会 reject，必须处理异常。

适合存储：用户上次选择的地图、攻守视角、已收藏点位 ID 或少量学习进度。

不适合存储：完整地图数据、全部 Lineup 记录、图片、共享内容元数据或浏览器导出的编辑包。

### 排行榜

| 方法 | 登录要求 | 作用 |
| --- | --- | --- |
| `submitScore(req)` | 需要登录；首次提交前平台进行用户数据确认 | 提交某一榜位的绝对分数，只保留历史最高分 |
| `getRankList(req?)` | 游客可读 | 读取指定榜位和周期的前 N 名 |
| `getMyRank(req?)` | 需要登录 | 查询当前用户是否上榜、名次和分数 |

排行榜规则：

- 按“Toy + 榜位 + 周期”隔离。
- `board` 固定为 1、2、3，含义由作品自行定义，默认 1。
- `period` 为 `all`、`month`、`week`、`day`，默认永久总榜 `all`。
- 分数必须是整数，范围为 -16,777,216 到 16,777,215，允许 0 和负数。
- `submitScore` 传入的是绝对分数，不是增量；低于历史最高分时不会覆盖。
- 排名从高到低，同分时先达到该分数者靠前，名次不并列。
- `getRankList` 的 `limit` 最大不超过 100，超出时使用后端默认。
- `getMyRank` 必须通过 `ranked` 判断是否上榜，不能用 score 是否为 0 判断。

ValoLineup 当前没有计分模型，因此排行榜能力与当前核心浏览、编辑流程没有直接关系。

### 摄像头和麦克风

| 方法 | B站 App | Web | 关键约束 |
| --- | --- | --- | --- |
| `requestCamera(options?)` | 支持 | 支持 | 必须由用户手势触发；`facingMode` 为 user 或 environment |
| `requestMicrophone()` | 支持 | 支持 | 必须由用户手势触发，不接收参数 |
| `stopMedia(stream)` | 支持 | 支持 | 使用结束后必须调用，停止所有轨道并释放设备 |

两个申请方法返回浏览器原生 `MediaStream`，仍受系统权限和设备状态影响。获得媒体流不代表页面可以忽略原生资源生命周期；离开使用场景时必须显式调用 `stopMedia`。

ValoLineup 当前以浏览已有 Lineup 和上传本地图片为主，没有实时拍摄或录音需求，因此无需为当前功能接入媒体能力。

### App 容器状态与显示模式

| 方法 | B站 App | Web | 作用 |
| --- | --- | --- | --- |
| `onContainerChange(listener)` | 支持 | 不支持 | 监听设备、视口、安全区、方向和沉浸状态变化 |
| `getContainerState()` | 支持 | 不支持 | 主动读取一次当前容器状态 |
| `setContainerMode(req)` | 支持 | 不支持 | 原子请求更新方向和沉浸状态 |

`ToyContainerState` 包含：

- `deviceType`：phone、tablet、desktop 或 unknown。
- `viewport`：以 CSS px 表示的可用尺寸。
- `safeArea`：安全区边距。
- `orientation`：portrait 或 landscape。
- `immersive`：是否为沉浸模式。
- `changedFields`：监听回调中标识本次变化字段；主动读取时恒为空数组。

`onContainerChange` 是唯一不返回 Promise 的方法。它立即返回取消监听函数，注册后先收到一次完整状态，后续只在状态改变时收到通知。

`setContainerMode` 接收可选的 `orientation` 和 `immersive`，未传字段保持当前值；两个字段都不传会报 `invalid_param`。`orientation: 'auto'` 表示跟随系统。

需要注意：`setContainerMode` 的 Promise resolve 只表示请求调用结束，不表示目标状态已经生效。正确的确认方式是先注册 `onContainerChange`，再请求切换，并等待监听状态与目标一致。没有收到状态变化时，不能宣称切换成功。文档还指出手机不支持“横屏且非沉浸”的组合。

地图是 ValoLineup 的主交互区域，因此横屏、沉浸和安全区适配具有明确价值；但接入时不能只发出横屏请求，还要根据实际回调重新计算页面布局。

## 当前项目适用性分析

### 教学视频跳转

当前 Lineup 数据使用可选 `videoBvid` 直接保存 B站视频 BV 号，不保存完整 URL。用户点击“教学视频”后，页面先调用 `isSupport('navigate')`，确认支持后再调用 `navigate({ type: 'video', id: videoBvid })`。SDK 未加载、能力不受支持或调用失败时，页面显示错误信息，地图浏览不受影响。

### 分享某个 Lineup

`share` 和 `getQrCode` 只能分享当前 Toy 内的相对路径。当前页面的地图、英雄和 Lineup 选择主要保存在客户端状态中，没有形成稳定的可复制页面地址。

如果未来要分享“某张地图的某个 Lineup”，必须先让该选择可由 URL 恢复，例如使用受控的 query 或 hash。否则 SDK 只能分享 Toy 首页，接收者无法自动打开同一个点位。

### 用户偏好和学习进度

云存储适合记录少量、按用户隔离且允许跨设备恢复的数据。例如：

- 上次选择的地图或视角。
- 收藏的少量 Lineup ID。
- 已学习或已练习的点位 ID。

这些属于用户状态，不是 Lineup 内容本身。所有公共点位仍由仓库中的 YAML 维护和构建。

### 静态页面编辑模式

项目不依赖写入接口。编辑模式把坐标、BV 号、新点位和待上传图片保存在当前浏览器页面中；用户点击“导出编辑包”后下载一个 ZIP。开发者在仓库运行 `npm run content:import-edits -- /path/to/package.zip`，CLI 会逐条合并新增内容，并用每条已有 Lineup 的修改前快照检测并发冲突。冲突 Lineup 会被跳过，其他内容继续导入。

Toy 云存储不参与这条内容维护链路。它没有共享内容管理、图片对象存储或仓库写回能力，不能作为编辑包导入的替代品。

## 当前接入范围

页面当前只接入教学视频跳转所需的能力：

1. 在 HTML 中加载 Toy SDK。
2. 为 `window.toy.isSupport` 与 `window.toy.navigate` 声明最小类型。
3. 由教学视频按钮的点击事件直接触发能力检测和 BV 视频跳转。
4. 捕获 SDK 加载、能力检测和跳转错误，并在页面内提示。

分享、二维码、容器控制、云存储、排行榜、用户资料、作者关系和媒体采集没有当前产品需求，不属于页面现有行为。

## 接入验收条件

当前 SDK 接入需要验证以下行为：

- SDK 脚本失败或 `window.toy` 不存在时，页面核心地图浏览仍可使用。
- `navigate` 调用前先经过 `isSupport('navigate')`。
- SDK Promise rejection 被页面捕获并显示为错误信息。
- `navigate` 只从真实的教学视频按钮点击触发。
- B站 App 与 Web 环境分别完成测试，不能只在本地浏览器中验证。

## 方法总表

SDK 1.7.0 共记录 23 个方法：

1. `isSupport`
2. `navigate`
3. `saveImageToAlbum`
4. `share`
5. `getQrCode`
6. `closeBrowser`
7. `getUserProfile`
8. `getAuthorProfile`
9. `getAuthorVideos`
10. `getAuthorRelation`
11. `getVideoUserActions`
12. `setCloudStorage`
13. `getCloudStorage`
14. `removeCloudStorage`
15. `submitScore`
16. `getRankList`
17. `getMyRank`
18. `requestCamera`
19. `requestMicrophone`
20. `stopMedia`
21. `onContainerChange`
22. `getContainerState`
23. `setContainerMode`
