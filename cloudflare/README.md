# ATO Assistant Cloudflare 预览

Pages 发布静态页面。Pages Functions 通过同域 Service Binding 把登录和战役请求交给 Worker。每个账号的状态保存在 SQLite Durable Object，使用现有的战役分区和版本号。首次迁移可从主控台导入没有附件的战役 JSON。

当前支持注册、登录、退出、读取战役、按分区保存、原子导入和战役日志。英雄、泰坦资料和配装沿用本地版数据格式。预览期账号使用至少 8 个字符的密码，和便携版账号各自注册。第二屏、记录表图片附件、历史备份与回滚、战役简报和本机一键更新仍需迁移。

默认静态构建读取 Git 已跟踪的运行时文件。卡图通过构建时指定的图片目录单独接入。个人存档、资料包及 PHP 源文件排除在 Pages 产物之外。

## AIBP 在线战斗室

房主先在主控台登录并在英雄页准备参战名单。打开 AIBP，点「在线战斗室」，选择 1 至 4 位英雄开房。房间读取开战时军械库里的泰坦和装备，以及英雄的旧忆卡号和进度。通过「复制玩家邀请」邀请队友认领席位，「打开只读投屏」提供同步总览。角色凭据保存在当前浏览器，刷新可回到同一房间。

玩家可更新自己英雄的凶险、泰坦状态和装备使用数、掷骰，并和队友一起更新克拉托斯池。房主可以推进轮次或结束战斗。房间由独立的 SQLite Durable Object 保存，使用 WebSocket 推送，各设备上的 AIBP 敌方牌堆仍由房主的本机 AIBP 操作，房间结果暂不回写战役。

阿尔戈能力按卡背数字显示剩余次数；使用后横置，同一轮不能再次使用。房主点「下一轮 · 一键回正」推进轮次并回正能力卡，剩余次数不补满。本轮误操作可撤销。特殊标记类或无数字次数的卡仍按卡面处理。

房间版图以 AIBP 里的骇物和战斗布局为初始值。玩家可以移动自己英雄的泰坦，房主负责地形布置、骇物位置与朝向。骇物使用矢量俯视标记；移动高亮严格对齐整格，以左上占格为点击落点，悬停预览完整占格。房主切换的棋子和模式会实时镜像到「打开只读投屏」。本机 AIBP 的「版图投屏」使用已登录账号读取决战快照。

网页战斗室直接显示 Pages 发布的泰坦和装备卡图。轻点卡面可以放大。桌面素材库或安卓使用标准 `.atopack`。

Pages 构建会生成轻量入口 `aibp/room.html`，玩家邀请与只读链接自动使用它，旧链接也会跳转。该入口只载入战斗室和版图所需代码，脚本合并为带内容指纹的文件并长期缓存。主控台保持原有脚本执行顺序，合并连续脚本请求；卡图优先显示预览，点开放大时才请求原图。PHP 本地版沿用原入口和图片加载行为。轻量战斗室接入同一套术语转换；英文词库只在选择英文时加载。主控台首次读取存档中的语言选择后，会保存为当前浏览器的偏好，其他模块及已打开的页面随之同步。

## 本地运行

在本目录运行 `npm ci` 和 `npm run build:pages`。两个终端分别运行：

```sh
npm run dev:worker
npm run dev:pages
```

打开 [本地预览](http://127.0.0.1:8798/)。在本目录执行 `node smoke.mjs` 可以用独立测试账号验证登录、导入、并发写入拒绝和注销。它会创建一份合成战役。

## 发布顺序

先运行 `npx wrangler login`，核对账号后运行以下命令：

```sh
npm run build:pages
npm run deploy:worker
npx wrangler pages project create ato-moon-assistant --production-branch main
npm run deploy:pages
```

发布或更新已经提供卡图的站点时，在构建命令上显式指定原目录，避免下次部署漏掉图片：

```sh
ATO_CARD_ART_DIR="/path/to/图片" npm run build:pages
npm run deploy:pages
```

图片按项目相对路径发布。构建为 AIBP 和战斗室生成卡图索引，并检查单个文件和总文件数。补充泰坦卡图可放在 `aibp/images/titan-cards/<泰坦名称>.webp`，旧忆卡图可放在 `aibp/images/mnemos/<卡号>.jpg`。故事书整页扫描留在本地图片目录。

首次发布创建 Pages 项目，更新时跳过创建命令。先通过 `*.pages.dev` 地址验证页面和 `/api/health`、注册、登录及配装保存。确认准备切换域名后，在 Pages 添加 `moon.xuzizi.cn`，再在新网将 `moon` 的 CNAME 改到该 Pages 项目的默认地址。

[Pages Service Binding](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings) · [SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) · [Pages 子域名](https://developers.cloudflare.com/pages/configuration/custom-domains/#add-a-custom-subdomain)
