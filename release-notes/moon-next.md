# Moon fork 下一版候选（尚未发布）

本候选从 Moon 常驻小队主线继续整合，包含已提交的故事书加载/投屏降级修复；战斗修复与上游 v3.11.5 先行，随后完成配装兼容和服务端登升。本文件不表示正式站复测已通过。

## 改动

- 修复凶险为 0 时普通创伤抽取误报错误；卡文指定牌库的抽取不受影响。
- 移植上游 v3.11.5 神浆归类修正，神浆不再作为凡间资源参与谈判付款，并校验非法付款字段。
- 保留 Moon 英雄绑定配装作为实装数据源。上游四栏、针对配装和方案可以在英雄配装编辑器中选为模板；先填入草稿，保存时检查实际库存及并发修订，不覆盖原模板。
- 库存与英雄配装支持 `AJ0160@c2` 一类登升编号；名称显示登升循环，军械库分类和战斗室卡图按基础装备 ID 查询。独立战斗室卡图优先于基础卡图。
- 军械库新增登升入口。核心和装备在 Moon 的 CampaignAccount 同一数据库事务内更新，失败时一起回滚；服务端按实际装备确定核心故事集，并拒绝登升已分配的库存。
- 登升操作 ID 在请求前写入浏览器本地存储，重试及刷新页面复用原 ID；服务端持久收据确保响应丢失、并发重复请求或余额后来改变时，旧操作都不会再次扣费。

## 关键验证

2026-11-18 本地验证：

- 军械库、模板、客户端重试与神浆专项：170 项通过。
- 战斗规则：21 项通过。
- 本地 Worker HTTP：小队生命周期、战斗生命周期、登升均通过。登升覆盖成功后丢响应重试、5 个并发重复请求、库存/核心不足、已配装库存拒绝、跨档案与账号保护、收据 ID 不能换装备复用。
- 本地真实浏览器验收通过：从军械库执行一次登升后出现独立 C2 装备；选择上游模板并保存英雄配装成功，库存显示正确预占。
- Pages 构建及 Worker 部署 dry-run 通过。不包含本地官方卡图或故事正文；这些素材沿用既有部署提供方式，不纳入本次 Git 提交。
- 根目录全部 Node 测试的对照运行：改动前 1884 项、33 失败；加入第一批兼容测试后 1887 项、同样 33 失败，失败名称集合不变。随后新增的 3 项客户端/卡图测试单独通过。完整套件尚非全绿，已知失败涉及未随仓库提供的素材和既有断言，不能表述为“全量测试通过”。

可重复执行：

```sh
node --test tests/moon-loadout-compat.test.cjs tests/moon-ascension-client.test.cjs tests/technology-arsenal.test.cjs tests/exploration-card-options.test.cjs tests/negotiation-rules.test.cjs tests/structure-tech-client.test.cjs
cd cloudflare
node --test battle-rules.test.mjs
npm run build:pages
npx wrangler dev --config worker/wrangler.jsonc --port 8807 --local
# 在另一终端的 cloudflare 目录：
node smoke-ascension.mjs http://127.0.0.1:8807
node smoke-battle-rules.mjs http://127.0.0.1:8807
node smoke-battle-lobby.mjs http://127.0.0.1:8807
```

## 上线与 release 条件

- 先升级 Moon Worker，再部署 Pages。`gear_operations` 表由 Durable Object 初始化创建；收据和跨 section 更新在同一同步事务执行，不需要新的 DO 类型迁移。
- 原始 PHP/便携版后端尚未提供新登升 API。本改造针对 Moon Worker；其他分发平台发布前需明确其功能支持范围，不能只复制前端就宣称具备原子登升。
- 另一条线仍需通过正式域名“主控台普通读剧情 → 官方正文 → 选段 → 真实小队投屏切换”的端到端验收。
- 本地浏览器已验收模板导入和登升。部署后仍需在正式环境复核核心货舱记录格式与真实存档流程。
- 以上完成后，再确定 fork 版本号、更新发布说明、生成包并发布 GitHub release。本轮不创建 tag 或 release。

远端主线接入：战斗及神浆先行提交为 `6723396`，随后是配装兼容与原子登升提交 `9277aa8`。只更新 `someNewmoon/ATO_assistant`；未创建 release、tag 或执行生产部署。
