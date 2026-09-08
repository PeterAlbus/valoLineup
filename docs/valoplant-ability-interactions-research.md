# 技能落点、范围与引导路径

核验日期：2026-09-08。面向当前仓库的 29 位英雄、118 个技能条目和 13 张地图。

## 展示与编辑约定

地图保留现有点位和方法选择。选中的方法显示自己的技能范围；切换方法时同步切换示意。固定范围由技能参数和现有 target 计算，浏览或拖动点位不会因此产生新的存储字段。

方向性区域以现有标记作为区域锚点。编辑状态下，选中点位后，标记旁悬浮“编辑方向”按钮。进入后拖动箭头控制柄实时调整释放方向，方向键可微调，Shift + 方向键按 10° 调整。点击标记旁的“保存”写入草稿；“重置”清除方向预览，保存后移除字段；取消或 Esc 放弃本次设置。墙体以标记为中心，直线与前向区域从标记向指定方向展开。未设置方向时仅显示原有标记。

点击标记旁的“编辑路径”，从标记原位按住拖动。原位自动作为固定起点，路径沿指针轨迹连续延伸，地图显示一条曲线和一个终点标记，技能范围随终点移动。长度按整条曲线累计，到达最大移动距离时停止延伸；沿原路径回拖会收回末段，缩短后可继续绘制。松手后保留结果，可再次拖动终点继续调整；点击“重置”会清空路径并回到原位。

标记旁提供保存、重置和取消按钮。保存校验累计路径长度并写入当前方法的草稿。重置后直接保存会移除路径并恢复原位；取消或 Esc 恢复进入编辑前的结果。每个方法独立保存路径；共享原位存在路径时，该原位保持固定，重置路径后可重新移动。页面的“保存编辑”和导出仍处理整批草稿。

只描述一个落点及其几何生效范围。传送、位移、自身状态保留点位；震慑绊线保留现有点位。路径不模拟墙体、反弹、重力、寻路或多阶段技能。自动追踪不等于手动引导。手机端使用相同的范围和路径阅读方式，编辑入口沿用当前桌面限制。

## ValoPlant 实际交互

在 [ValoPlant](https://valoplant.gg/) 的匿名战术板上核验了：霞染的圆形烟雾、惊雷卷地的方向区域、哨戒炮台的方向表现、狂潮的曲线路径。可旋转的区域通过控制柄转向，狂潮允许绘制连续路径。引路之隼在所检查界面上只观察到技能图标，不能据此声称 ValoPlant 为所有手动引导技能都提供了路径编辑。

公开客户端的 [main.dart.js](https://valoplant.gg/main.dart.js) 同时包含逐地图缩放表和技能几何尺寸，可用于核对圆、长方形、墙线及技能覆盖情况。它的装置外圈有些代表与英雄的工作距离，须与探测半径区分。

## 地图距离换算

当前图片使用游戏小地图的完整归一化画布。地图元数据来自 [Valorant API 地图数据](https://valorant-api.com/v1/maps)，其中 xMultiplier 和 yMultiplier 的绝对值一致。游戏坐标每 100 单位对应 1 米；实现使用绝对 multiplier × 100，获得每米对应的归一化地图长度。

公式：

- 地图上的范围半径 = 技能半径（米）× mapUnitsPerMeter。
- 显示半径（像素）= 上述归一化半径 × 当前地图画布边长 × 缩放倍率。
- 路径长度（米）= 从原位开始依次经过路径采样坐标的累计长度 ÷ mapUnitsPerMeter。
- 视角旋转与平移统一作用于地图及技能图层，存储坐标始终为未旋转的原始坐标。

| 地图 | 每米归一化长度 | 1024 图上每米像素 | ValoPlant 地图系数 |
| --- | ---: | ---: | ---: |
| 亚海悬城 | 0.007 | 7.1680 | 1.19 |
| 源工重镇 | 0.0059 | 6.0416 | 1 |
| 隐世修所 | 0.0075 | 7.6800 | 1.28 |
| 霓虹町 | 0.0078 | 7.9872 | 1.33 |
| 森寒冬港 | 0.0072 | 7.3728 | 1.23 |
| 微风岛屿 | 0.007 | 7.1680 | 1.16 |
| 裂变峡谷 | 0.0078 | 7.9872 | 1.345 |
| 深海明珠 | 0.0078 | 7.9872 | 1.24 |
| 莲华古城 | 0.0072 | 7.3728 | 1.3 |
| 日落之城 | 0.0078 | 7.9872 | 1.25 |
| 幽邃地窟 | 0.0081 | 8.2944 | 1.35 |
| 盐海矿镇 | 0.007 | 7.1680 | 1.13 |
| 天枢云阙 | 0.0075 | 7.6800 | 1.23 |

ValoPlant 使用 1000 单位的自行绘制地图，不是当前图片的同一坐标系。对 13 张地图的轮廓匹配得到约 0.938–1.032 的整体比例差异，部分地图还有 90° 或 270° 朝向差异。轮廓匹配在 1024 画布上的平均误差约 6–15 像素，不能把这种近似拟合当成游戏级精度。实现使用上表的游戏地图比例。

交叉核验示例：源工重镇空投烟幕半径 4.15 米，归一化直径 0.04897，与 ValoPlant 的 0.05 接近；寻敌箭半径 30 米，对应直径 0.354，ValoPlant 为 0.336，约相差 5%。狂潮当前最大长度 60 米，对应 0.354，ValoPlant 路径上限为 0.375，约相差 6%。这些差异说明它适合核验形状与数量级，不能替代技能参数。狂潮 60 米来自 [Riot 12.02 更新说明](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-12-02/)。

## 全英雄交付清单

固定范围无需填写额外资料。“方向”与“路径”只有主动设置后才产生 effect 字段；同一技能在路径终点也可能具有固定范围。当前清单包含 46 个固定范围技能、23 个方向技能、8 个手动引导技能，共 77 个；其余 41 个技能维持点位。

| 英雄 | 固定范围 / 装置侦查 | 可设置方向 / 墙体 | 可设置引导路径 | 保持点位 |
| --- | --- | --- | --- | --- |
| 星礈 | 新星脉冲、星云/消散、重力之阱 | 星界形态/宇宙分裂 | — | 星界形态 |
| 铁臂 | — | 山崩地陷、剧震余波、惊雷卷地 | — | 闪点爆破 |
| 炼狱 | 燃烧榴弹、空投烟幕、振奋信标、天基光束 | — | — | — |
| 尚勃勒 | 贵宾限行 | — | — | 金牌猎头、闪转自如、孤高火力 |
| 暮蝶 | 整蛊、霞染 | — | — | 虹吸、化蝶 |
| 零 | 赛博囚笼 | — | — | 战术监控、震慑绊线、神经取析 |
| 钢锁 | 重力捕网 | 声感陷阱、阻域屏障、断魂索道 | — | — |
| 黑梦 | 幽爪、诡眼 | 夜临 | 黯兽 | — |
| 盖可 | 炫晕光波、嗨爆全场、无敌超鲨终点 | 顽皮搭档 | 无敌超鲨 | — |
| 海神 | 海盾、乱涌 | 怒涛 | 狂潮 | — |
| 壹决 | — | 稳态剥离、绝对屏障、决斗通牒 | — | 战斗心流 |
| 捷风 | 瞬云 | — | — | 凌空、逐风、飓刃、飘移 |
| K/O | 零点嗅探、碎片溢出 | — | — | 闪存过载、无效命令 |
| 奇乐 | 自动哨兵、纳米蜂群、全面封锁 | 哨戒炮台 | — | — |
| 迷核 | 声波帷幕、电音脉冲 | 音脉强袭 | — | 共振谐律 |
| 霓虹 | 闪电弹球 | 高速通道 | — | 充能疾驰、超限暴走 |
| 幽影 | 黑瘴 | 暗魇 | — | 践影、离魂 |
| 不死鸟 | 火热手感 | — | 火冒三丈 | 闪光曲球、再火一回 |
| 雷兹 | 彩雷飞溅、花车巡游、晚安焰火 | — | — | 惊喜翻腾 |
| 芮娜 | — | — | — | 噬尽、逐散、睥睨、女皇旨令 |
| 贤者 | 薄冰 | 玉城 | — | 逢春、再起 |
| 斯凯 | 辟林之虎终点、愈生之息 | — | 辟林之虎、引路之隼 | 追猎之灵 |
| 猎枭 | 雷击箭、寻敌箭 | 狂猎之怒 | 枭型无人机 | — |
| 钛狐 | 特快专递、精准投放、潜袭爬虫终点 | 末日审判 | 潜袭爬虫 | — |
| 禁灭 | 裂变残片、噬源体 | — | — | 涡流折跃、完全进化 |
| 蝰蛇 | 瘴云、蛇吻、蝰腹 | 毒幕 | — | — |
| 维斯 | 剃刀藤蔓、铁棘禁园 | 裁断 | — | 弧光玫瑰 |
| 幻棱 | 光棱闪爆 | 时光修罗场 | — | 光速飞跃、溯流回光 |
| 夜露 | — | — | — | 攻其不备、不请自来、出其不意、神鬼不觉 |

## 当前几何参数

下表为实现中的平面示意尺寸。忽略高度及地形遮挡，范围不构成游戏内命中判定。技能资料以 [Riot 英雄说明](https://playvalorant.com/en-us/agents/) 核对交互类型，以逐技能资料中的游戏文件 / 官方补丁标注核对尺寸。

参数中的近似值有独立依据：薄冰采用 ValoPlant 的归一化直径 0.076 ÷ 2 ÷ 源工重镇比例 0.0059，得到圆形外包络半径约 6.44 米；绝对屏障采用其图形横向宽度 0.375 × 0.08 ÷ 0.0059，约 5.1 米；顽皮搭档前向长度采用其图形半长 0.07 ÷ 2 ÷ 0.0059，约 6 米，震荡张角使用 [Riot 9.08 的 65°](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-9-08/)。这些是几何规划参考，不能当作游戏内精确命中判定。声波帷幕、蝰腹和怒涛使用技能资料的估测尺寸；线状屏障的示意厚度仅用于显示。

| 英雄 · 技能 | 当前平面参数 | 参数参考 |
| --- | --- | --- |
| 星礈 · 新星脉冲 | 半径 4.75 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Nova_Pulse) |
| 星礈 · 星云/消散 | 半径 4.75 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Nebula_/_Dissipate) |
| 星礈 · 重力之阱 | 半径 4.75 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Gravity_Well) |
| 星礈 · 星界形态/宇宙分裂 | 贯穿地图的直线 | [技能参数](https://valorant.fandom.com/wiki/Cosmic_Divide) |
| 铁臂 · 山崩地陷 | 长 56 米，宽 8 米 | [技能参数](https://valorant.fandom.com/wiki/Fault_Line) |
| 铁臂 · 剧震余波 | 长 10 米，宽 6 米 | [技能参数](https://valorant.fandom.com/wiki/Aftershock) |
| 铁臂 · 惊雷卷地 | 长 32 米，宽 18 米 | [技能参数](https://valorant.fandom.com/wiki/Rolling_Thunder) |
| 炼狱 · 燃烧榴弹 | 半径 4.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Incendiary) |
| 炼狱 · 空投烟幕 | 半径 4.15 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Sky_Smoke) |
| 炼狱 · 振奋信标 | 半径 6 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Stim_Beacon) |
| 炼狱 · 天基光束 | 半径 9 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Orbital_Strike) |
| 尚勃勒 · 贵宾限行 | 半径 10 米（探测范围） | [技能参数](https://valorant.fandom.com/wiki/Trademark) |
| 暮蝶 · 整蛊 | 半径 4 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Meddle) |
| 暮蝶 · 霞染 | 半径 4.15 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Ruse) |
| 零 · 赛博囚笼 | 半径 3.72 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Cyber_Cage) |
| 钢锁 · 声感陷阱 | 长 9 米，宽 8 米 | [技能参数](https://valorant.fandom.com/wiki/Sonic_Sensor) |
| 钢锁 · 重力捕网 | 半径 6.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/GravNet) |
| 钢锁 · 阻域屏障 | 两条交叉屏障，各长 20 米 | [技能参数](https://valorant.fandom.com/wiki/Barrier_Mesh) |
| 钢锁 · 断魂索道 | 长 40 米，宽 6 米 | [技能参数](https://valorant.fandom.com/wiki/Annihilation) |
| 黑梦 · 幽爪 | 半径 6.58 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Seize) |
| 黑梦 · 诡眼 | 半径 30 米（侦查范围） | [技能参数](https://valorant.fandom.com/wiki/Haunt) |
| 黑梦 · 黯兽 | 引导距离25 米 | [技能参数](https://valorant.fandom.com/wiki/Prowler) |
| 黑梦 · 夜临 | 长 40 米，宽 20 米 | [技能参数](https://valorant.fandom.com/wiki/Nightfall) |
| 盖可 · 顽皮搭档 | 半径 6 米，65°（几何近似） | [技能参数](https://valorant.fandom.com/wiki/Wingman) |
| 盖可 · 炫晕光波 | 半径 45 米（探测范围） | [技能参数](https://valorant.fandom.com/wiki/Dizzy) |
| 盖可 · 嗨爆全场 | 半径 6.2 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Mosh_Pit) |
| 盖可 · 无敌超鲨 | 引导距离67.32 米；终点半径 5 米 | [技能参数](https://valorant.fandom.com/wiki/Thrash) |
| 海神 · 狂潮 | 引导距离60 米 | [技能参数](https://valorant.fandom.com/wiki/High_Tide) |
| 海神 · 海盾 | 半径 4.6 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Cove) |
| 海神 · 乱涌 | 半径 6 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Storm_Surge) |
| 海神 · 怒涛 | 长 34 米，宽 21 米（资料估测值） | [技能参数](https://valorant.fandom.com/wiki/Reckoning) |
| 壹决 · 稳态剥离 | 长 34.875 米，宽 6 米 | [技能参数](https://valorant.fandom.com/wiki/Undercut) |
| 壹决 · 绝对屏障 | 长 5.1 米，宽 0.4 米（几何近似） | [ValoPlant 几何](https://valoplant.gg/main.dart.js) |
| 壹决 · 决斗通牒 | 长 36 米，宽 15 米 | [技能参数](https://valorant.fandom.com/wiki/Kill_Contract) |
| 捷风 · 瞬云 | 半径 3.35 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Cloudburst) |
| K/O · 零点嗅探 | 半径 15 米（侦查范围） | [技能参数](https://valorant.fandom.com/wiki/ZERO/point) |
| K/O · 碎片溢出 | 半径 4 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/FRAG/ment) |
| 奇乐 · 自动哨兵 | 半径 5.5 米（探测范围） | [技能参数](https://valorant.fandom.com/wiki/Alarmbot) |
| 奇乐 · 哨戒炮台 | 100° 视野方向，延伸至地图边界 | [技能参数](https://valorant.fandom.com/wiki/Turret) |
| 奇乐 · 纳米蜂群 | 半径 4.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Nanoswarm) |
| 奇乐 · 全面封锁 | 半径 32.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Lockdown) |
| 迷核 · 声波帷幕 | 半径 4.72 米（生效范围）（资料估测值） | [技能参数](https://valorant.fandom.com/wiki/Waveform) |
| 迷核 · 电音脉冲 | 半径 5.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/M-pulse) |
| 迷核 · 音脉强袭 | 半径 40 米，60° | [技能参数](https://valorant.fandom.com/wiki/Bassquake) |
| 霓虹 · 闪电弹球 | 半径 5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Relay_Bolt) |
| 霓虹 · 高速通道 | 长 46.5 米，宽 3.5 米 | [技能参数](https://valorant.fandom.com/wiki/Fast_Lane) |
| 幽影 · 暗魇 | 长 25 米，宽 8.6 米 | [技能参数](https://valorant.fandom.com/wiki/Paranoia) |
| 幽影 · 黑瘴 | 半径 4.1 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Dark_Cover) |
| 不死鸟 · 火热手感 | 半径 4.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Hot_Hands) |
| 不死鸟 · 火冒三丈 | 引导距离24 米 | [技能参数](https://valorant.fandom.com/id/wiki/Blaze) |
| 雷兹 · 彩雷飞溅 | 半径 5.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Paint_Shells) |
| 雷兹 · 花车巡游 | 半径 6 米（爆炸范围） | [技能参数](https://valorant.fandom.com/wiki/Boom_Bot) |
| 雷兹 · 晚安焰火 | 半径 7 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Showstopper) |
| 贤者 · 薄冰 | 半径 6.44 米（生效范围）（几何近似） | [ValoPlant 几何](https://valoplant.gg/main.dart.js) |
| 贤者 · 玉城 | 长 10.4 米，宽 1.5 米 | [技能参数](https://valorant.fandom.com/wiki/Barrier_Orb) |
| 斯凯 · 辟林之虎 | 引导距离45 米；终点半径 3.5 米（实测参考值） | [距离测量参考](https://yatoyablog.com/game/valorant-skill-data/) |
| 斯凯 · 引路之隼 | 引导距离36 米 | [技能参数](https://valorant.fandom.com/wiki/Guiding_Light) |
| 斯凯 · 愈生之息 | 半径 18 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Regrowth) |
| 猎枭 · 雷击箭 | 半径 4 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Shock_Bolt) |
| 猎枭 · 寻敌箭 | 半径 30 米（侦查范围） | [技能参数](https://valorant.fandom.com/wiki/Recon_Bolt) |
| 猎枭 · 枭型无人机 | 引导距离31 米（实测参考值） | [距离测量参考](https://yatoyablog.com/game/valorant-skill-data/) |
| 猎枭 · 狂猎之怒 | 长 66 米，宽 3.52 米 | [技能参数](https://valorant.fandom.com/wiki/Hunter%27s_Fury) |
| 钛狐 · 特快专递 | 半径 5.25 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Special_Delivery) |
| 钛狐 · 精准投放 | 半径 4.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Guided_Salvo) |
| 钛狐 · 潜袭爬虫 | 引导距离暂定 30 米；终点半径 16 米 | 距离由产品设定；[脉冲范围](https://valorant.fandom.com/wiki/Stealth_Drone) |
| 钛狐 · 末日审判 | 长 32 米，宽 12 米 | [技能参数](https://valorant.fandom.com/wiki/Armageddon) |
| 禁灭 · 裂变残片 | 半径 6.58 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Chokehold) |
| 禁灭 · 噬源体 | 半径 18 米（拦截范围） | [技能参数](https://valorant.fandom.com/wiki/Interceptor) |
| 蝰蛇 · 瘴云 | 半径 4.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Poison_Cloud) |
| 蝰蛇 · 毒幕 | 长 60 米，宽 0.3 米 | [技能参数](https://valorant.fandom.com/wiki/Toxic_Screen) |
| 蝰蛇 · 蛇吻 | 半径 4.5 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Snake_Bite) |
| 蝰蛇 · 蝰腹 | 半径 9 米（生效范围）（资料估测值） | [技能参数](https://valorant.fandom.com/wiki/Viper%27s_Pit) |
| 维斯 · 裁断 | 长 12 米，宽 1 米 | [技能参数](https://valorant.fandom.com/wiki/Shear) |
| 维斯 · 剃刀藤蔓 | 半径 6.25 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Razorvine) |
| 维斯 · 铁棘禁园 | 半径 28 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Steel_Garden) |
| 幻棱 · 光棱闪爆 | 半径 6 米（生效范围） | [技能参数](https://valorant.fandom.com/wiki/Saturate) |
| 幻棱 · 时光修罗场 | 长 36 米，宽 13.5 米 | [技能参数](https://valorant.fandom.com/wiki/Convergent_Paths) |

已核验的引导长度：黯兽按未锁定目标时 10 米/秒 × 2.5 秒计 25 米；引路之隼按 18 米/秒 × 2 秒计 36 米；无敌超鲨按 11.22 米/秒 × 6 秒计 67.32 米，只体现受控行进，不叠加最终扑击。火冒三丈采用 24 米的长度参考。枭型无人机约 31 米、辟林之虎约 45 米来自实测资料，时间分别与当前 7 秒、6 秒一致。潜袭爬虫按当前批准的暂定值 30 米设置路径上限，后续可按实测校准。瞬云仅显示烟雾生效范围。

## 可选字段与保存协议

target 保存标记原位。连续路径独立存入当前方法的 effect 字段，地图主标记显示在终点：

```json
{"effect":{"type":"direction","angle":90}}
```

angle 为原始地图中向右 0°、向下 90°的顺时针角度，范围 [0,360)。

```json
{"effect":{"type":"path","points":[{"x":0.55,"y":0.53},{"x":0.6,"y":0.5}]}}
```

target 是拖动开始时标记原位，effect.points 按顺序保存连续轨迹采样坐标，最后一个坐标为终点。坐标范围均为 [0,1]；读取时校验技能支持的类型及累计路径长度上限。轨迹只作为一条曲线显示，编辑入口位于终点。重置并保存时移除 effect，主标记回到 target。共享原位的其他方法保持各自的数据与显示。切换技能会清除原技能的方向或路径配置。

继续使用现有 v4/v5 编辑包及本地库：普通新增与修改使用 v4，包含删除时使用 v5。固定范围不触发数据迁移。新增字段由完整记录的快照、图层合并、保存和导出保留。旧记录不含 effect 时仍合法。

## 验证范围

已通过 `pnpm test`、`pnpm run lint`、`pnpm run build`、完整 `pnpm run test:browser` 及最终方向/路径浏览器专项回归。

验证覆盖旧记录无字段读取、固定范围不写入数据、方向与路径的 v4/v5 ZIP 往返、CLI 导入 YAML 与构建保留字段、路径长度上限、固定原位、曲线累计长度、到达上限停止延伸与沿线回拖缩短、悬浮保存/重置/取消、同一落点多方法独立展示、视角旋转、保存刷新恢复、手机阅读以及重置重拖与独立方法保存。

潜袭爬虫的 30 米是当前批准的暂定路径上限，后续按可靠资料或游戏实测校准。火冒三丈、枭型无人机、辟林之虎的长度来自上表标明的近似参考资料。
