# Lineup 更新包 v4：兼容性基线

> 本文保留 v4 基线定义。当前实现继续读取 v4，并通过 [v5 删除及 WebP 扩展](edit-package-v5.md) 增加能力；普通编辑仍可导出 v4。

本次有意不支持旧 v3 包。自 v4 起，后续功能必须保留读取 v4 的能力；优先增添可选字段，不改变既有字段语义。若确需新的不兼容版本，必须提供显式迁移/兼容读取与回归测试，不得仅修改版本常量。未知版本目前明确拒绝，不能静默按当前版本解释。

## ZIP 结构

根目录 `manifest.json`（UTF-8）加所有变更后点位引用的图片。即使图片来自仓库或其他包，也必须内嵌，确保包重排、删除后仍可独立显示。

```json
{
  "format": "valo-lineup-edit-package",
  "version": 4,
  "packageId": "9bfe614f-e03f-4f1f-aee0-90bf58f533ba",
  "revision": 1,
  "createdAt": "2026-09-05T00:00:00.000Z",
  "updatedAt": "2026-09-05T00:00:00.000Z",
  "author": { "name": "编辑者昵称", "source": "toy" },
  "changes": { "added": [], "updated": [] },
  "uploadedAssets": []
}
```

- `packageId`：UUID，标识一个持续编辑的包；重复编辑不重新生成 ID。浏览器重复导入同 ID 替换原位置，即使人为选择了旧修订版也按所选包覆盖。
- `revision`：正整数，标记修订；保存新变更递增，已保存内容直接导出保持原修订号。未保存导出为下一修订，不改变已保存数据。
- `createdAt` / `updatedAt`：ISO 8601 UTC，包首次创建/本次修订时间；仓库应用时间另记 `appliedAt`。
- `author`：本次修订编辑人；每个点位另有 `uploader`，表示原上传者，普通修改不更改上传者。
- `changes.added`：完整 Lineup 快照数组。
- `changes.updated`：`{id, before, after}` 数组，三处 ID 必须相同；同包内 ID 不得重复出现，`before` 为该编辑累计层首次修改前快照，`after` 为最新完整快照。v4 不定义删除操作。
- `uploadedAssets`：`{key, lineupId, kind, alt, mimeType, size, sha256}` 数组。清单必须恰好覆盖所有 `added` 和 `after` 的图片，不包含仅 `before` 引用的图片；路径、所属点位、分区和 alt 必须与快照一致。

## Lineup / 上传者

Lineup 必填字段：`id, mapId, agentId, abilityId, uploader, title, side, area, videoBvid, target, instructions, media`。与仓库共享校验器：`src/package-model.mjs`。

- `id` 不随修改变化；新建使用地图、英雄和随机标识组合。目标坐标为原始地图的 `[0,1]` 归一化坐标，与浏览时攻守旋转无关。
- `side` 为 `attack | defense`；`target` 为 `{groupId,x,y}`；`media` 为 `{stance:[],aim:[],effect:[]}`，条目为 `{key,alt}`。
- `videoBvid` 为空字符串或合法 12 位 BV 号；操作说明最长 1000 字符。
- `uploader` / `author` 为 `{name, source, toyOpenId?, bilibiliUid?}`。`source` 为 `toy | curated | local`。`toy` 表示通过 SDK 获得的资料；`curated` 表示仓库人工归属；`local` 为离线导入来源，UI 明示未认证。
- `getUserProfile()` 只在用户点击编辑时调用，经 `isSupport` 检查。SDK 未提供 UID/MID，因此不生成 `bilibiliUid`；该可选字段仅保留已有明确 UID 的归属，例如 PeterAlbus / 2003822。OpenID 模式关闭时允许无 `toyOpenId`。不保存头像、登录令牌或其他鉴权信息。
- `toyOpenId` 只用于当前 Toy 的点位归属；不显示在界面、终端日志或埋点，不用于跨 Toy 识别。导出 ZIP 包含归属资料，分享前应知悉它会随包传递；数据不构成签名或服务器认证，不能作为访问控制依据。

## 校验与存储

图片路径仅允许 `lineups/<所属点位ID>/<文件名>.png|jpg|jpeg|webp`，拒绝绝对路径、路径穿越、反斜线和嵌套目录。新上传图片使用随机文件名。PNG/JPEG/WebP 魔数、扩展名、MIME、解压大小与 SHA-256 必须吻合。单张最多 12 MiB，ZIP 及图片解压总量最多 128 MiB，清单最多 8 MiB、500 张图片；地图/英雄/技能需存在。多余 ZIP 文件不落盘、不执行。

浏览器先完整校验包再应用，忽略 `before` 做整条记录覆盖；`updated` 指向不存在的 ID 时也加入。层顺序严格为仓库 → 排序后的包 → 手动编辑。不因共享目标坐标分歧拒绝浏览器包，各点位按自己的真实坐标显示。

localStorage 键为 `valo-lineup:v4:<部署路径>`，结构 `{version:1,token,packages:Manifest[],manual:Manifest|null}`。`manual` 只有一个，不混入包列表。IndexedDB 数据库为 `<localStorage键>:images`，版本 1，`blobs` store 按 SHA-256 保存 Blob。图片先完成事务，localStorage 元数据后提交；失败不覆盖旧清单。支持时使用 Web Locks 跨标签页串行提交，另用 token 检测过期写入。提交后在锁内回收无引用图片；不支持 Web Locks 的环境保守保留无引用图片，避免跨标签页误删。突然中断可能留下未引用图片，不影响可见资料。

仓库导入通过 `before` 做乐观冲突检测，新增 ID 已占用、快照冲突、图片同路径不同内容及共享坐标不一致时跳过相关点位。每次有实际应用的变更才在 `content/history.json` 追加 `{id,packageId,revision,appliedAt,author,mapIds,lineupIds,added,updated}`。该 author 是包提供者，不是执行命令的操作系统用户。历史、点位和新增图片一起提交，捕获失败时一起回滚；相同内容再次导入不写空历史。

## 扩展原则

校验器保留记录和清单中的未知附加字段。未来新增可选元数据应提供默认行为；需要改变合并语义的操作不得偷偷塞进扩展字段。为 v4 固定样例保留导入、层叠、持续编辑、图片完整性及历史回归测试。存储结构版本与 ZIP 版本独立，浏览器升级迁移必须先保留旧数据再提交新数据。
