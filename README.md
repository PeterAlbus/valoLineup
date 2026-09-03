# ValoLineup

ValoLineup 是一个纯静态的《无畏契约》Lineup 图鉴。地图、英雄和点位内容来自仓库中的 YAML，构建时生成浏览器数据；运行中的页面不依赖服务端接口。

## 本地运行

环境要求：Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

生产静态文件输出到 `dist/`：

```bash
npm run build
```

Vite 使用相对资源路径，`dist/` 可以作为完整静态目录交给 Toy CLI 预览和发布。

## 编辑 Lineup

页面中的“编辑点位”会在当前浏览器页面内创建草稿。可以拖动点位、添加站位图、瞄点图和效果图，也可以新增 Lineup 并填写对应地图、英雄、技能与可选的 B站 BV 号。页面不会直接修改仓库。

完成编辑后点击“导出编辑包”。浏览器会下载 `valo-lineup-edits-*.zip`，其中包含新增 Lineup、每条修改前后的快照和本次新增图片。刷新或关闭页面会丢失尚未导出的草稿。

## 导入编辑包

开发者拿到 ZIP 后，在最新仓库内容上运行：

```bash
npm run content:import-edits -- /absolute/path/to/valo-lineup-edits-YYYYMMDD-HHmmss.zip
```

CLI 会把编辑包逐条合并到当前仓库。不同用户基于同一版本并行编辑不同 Lineup 时，各自的包可以按任意顺序导入。它会校验：

- 编辑包格式；
- 地图、英雄、技能和点位引用；
- 每条已有 Lineup 的修改前后快照；
- 图片路径、格式、大小和 SHA-256；
- B站视频字段是否为完整 BV 号。

新增 Lineup 使用随机唯一 ID，会直接合并。修改已有 Lineup 时，仓库记录与编辑包的修改前快照一致才会应用；如果仓库记录已经变化，该 Lineup 会被列为冲突并跳过，包里的其他新增和无冲突修改仍会继续导入。重复导入同一个包时，已经等于修改后快照的 Lineup 会被识别为已应用。

CLI 会在终端逐条列出跳过的冲突及原因。共享同一个地图落点的多种方法共用一组坐标；如果该组中出现并发冲突，相关坐标修改会作为同一个落点整体跳过，避免地图上的同组方法产生不一致坐标。

可应用内容全部通过校验后，CLI 才会更新 `content/lineups.yaml`、写入 `public/lineups/` 图片并重新生成 `src/data/content.json`。若校验或构建失败，已经写入的本次变更会回滚。

## 内容维护命令

```bash
npm run content:build
npm run content:import -- /absolute/path/to/lineups.md
npm run content:import-agents -- /path/PublicContentCatalog.json /path/catalog-assets
npm test
npm run lint
```

`content:import` 是保留的单次 Markdown 导入口；正常开发和构建只读取 `content/*.yaml`，不会重新导入 Markdown。
