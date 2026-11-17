# ATO Assistant Cloudflare 预览

Pages 发布静态页面。Pages Functions 通过同域 Service Binding 把登录和战役请求交给 Worker。每个账号的状态保存在 SQLite Durable Object，使用现有的战役分区和版本号。首次迁移可从主控台导入没有附件的战役 JSON。

当前支持注册、登录、退出、读取战役、按分区保存、原子导入和战役日志。英雄、泰坦资料和配装沿用本地版数据格式。预览期账号使用至少 8 个字符的密码，和便携版账号各自注册。第二屏、记录表图片附件、历史备份与回滚、战役简报和本机一键更新仍需迁移。

静态构建仅取 Git 已跟踪的运行时文件。个人存档、未跟踪的素材包以及 PHP 文件都排除在 Pages 产物之外。素材需要取得发布权限后再单独接入。

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

首次发布创建 Pages 项目，更新时跳过创建命令。先通过 `*.pages.dev` 地址验证页面和 `/api/health`、注册、登录及配装保存。确认准备切换域名后，在 Pages 添加 `moon.xuzizi.cn`，再在新网将 `moon` 的 CNAME 改到该 Pages 项目的默认地址。

[Pages Service Binding](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings) · [SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) · [Pages 子域名](https://developers.cloudflare.com/pages/configuration/custom-domains/#add-a-custom-subdomain)
