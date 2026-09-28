# 李豆沙_Channel 非官方资料站

基于 Next.js 14（App Router）一体化站点：前端页面 + API Route 代理哔哩哔哩公开接口，数据统一存入 **PostgreSQL**（本地安装即可，零托管依赖），由每日同步任务写入，前端从数据库读取。

## 功能
- 首页 VUP 立绘循环展示（待提供素材）
- 直播状态实时挂件（开播红点 / 在线人数 / 一键进直播间，实时直连 B站）
- 数据看板：粉丝数、关注数、#李豆沙 标签投稿数
- **全站投稿深度统计**：全站与 #李豆沙 相关投稿的播放 / 点赞 / 投币 / 转发 / 收藏 / 评论，含逐年明细
- **李豆沙全部动态聚合**：在本站查看图文 / 视频 / 转发动态（需登录态）
- 歌单模块（整合自 lidousha.top，分类筛选 + 字母索引）

## 数据库（PostgreSQL）
数据存入 PostgreSQL，首次同步时自动建表（`lib/db.ts` 的 `ensureReady`），无需手动迁移。表：
- `video_stat`：每条投稿的全量数据（按年聚合的源头）
- `dyn`：动态
- `playlist_song`：歌单
- `snapshot`：每日粉丝/标签快照
- `live_session`：直播回放（时长 / 唱歌 / 游戏分类）

本地零依赖安装（Windows 示例，用 EDB 二进制包）：
1. 下载并解压 `postgresql-16.x-windows-x64-binaries.zip` 到 `C:\postgres\pg16`；
2. `initdb -D C:\postgres\data16 -U postgres --auth=trust`；
3. `pg_ctl -D C:\postgres\data16 -l logfile start`；
4. `createdb -U postgres lidousha`。

## 快速开始
```bash
npm install
# 先确保 PostgreSQL 已启动，并在 .env 配置 DATABASE_URL
npm run dev                 # http://localhost:3000
npm run sync               # 抓取并写入 PostgreSQL
```
`.env` 必填 `DATABASE_URL`（本地示例 `postgres://postgres@localhost:5432/lidousha`）；
可选 `BILI_COOKIE`（浏览器复制的完整 Cookie 字符串），用于同步"动态"与"直播回放"，
并提升投稿详情接口（`archive/stat`）通过率（未登录会被 -412 风控）。

## 数据同步（建议每日 cron / Vercel Cron 触发）
```bash
npm run sync                 # 同步全站投稿统计 + 粉丝/标签每日快照 + 动态 + 直播回放（需 BILI_COOKIE）
npm run seed:playlist        # 一次性把歌单写入 PostgreSQL（来自 data/playlist.json）
```
> 直播回放通过 UP 主整理的「直播回放」**合集**获取，端点 `api.bilibili.com/x/series/archives`
> （见 `lib/bilibili.ts` 的 `SERIES_ARCHIVES_API`）。B站原生 xlive 回放接口已失效；若回放为空请确认合集 ID（`LIVE_SERIES_ID`）。
> 强烈建议使用 **Cookie** 而非明文账号密码：Cookie 一行环境变量即可，且不要提交到仓库。

## 接口说明（实测）

> 权威文档参考：[bilibili-API-collect](https://github.com/bilibili-plugins/bilibili-api-collect)
> （即 SocialSisterYi/bilibili-API-collect 的镜像，含动态/直播/用户等接口子文档与 WBI 签名说明）。
> 本表为本项目**实际调用**的端点与鉴权方式，改动后请同步更新。

| 用途 | 端点 | 鉴权 | 说明 / 代码位置 |
|---|---|---|---|
| 直播开播状态 | `api.live.bilibili.com/room/v1/room/get_status_info_by_uids` | 免签 | 按 uid 批量查 `live_status`(0未开/1直播中/2轮播)/`online`/`title`，无风控，首选（`lib/bilibili.ts` getLiveStatus） |
| 直播间 HTML 兜底 | `https://live.bilibili.com/{roomId}` | 免签 | 解析 HTML 取 uid/状态，仅当上一个接口失败时用（getLiveStatusByRoom） |
| 弹幕服务器信息 | `api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo` | WBI | 返回 host/token，用于连接弹幕 WS（getDanmuInfo） |
| 直播信息流 (WS) | `wss://...broadcastlv.chat.bilibili.com/sub` | buvid3 + uid + key | 实时弹幕/礼物/SC，见 `scripts/live-monitor.ts`；需先 `finger/spi` 拿 buvid、用真实登录 uid 鉴权 |
| 大航海/粉丝团 | `api.live.bilibili.com/xlive/app-room/v1/guardTab/topList` | WBI | 舰长列表（参数 `ruid=UID`, `roomid=ROOM_ID`）（getGuardList） |
| 关系统计（粉丝） | `api.bilibili.com/x/relation/stat?vmid=` | 免签 | 粉丝/关注数（getFollowerStats） |
| 标签信息 | `api.bilibili.com/x/tag/info?tag_name=` | 免签 | `#李豆沙` 投稿数（getTagStats） |
| 投稿搜索 | `api.bilibili.com/x/web-interface/wbi/search/type` | WBI | 全站/标签投稿检索，可按 `pubtime_begin_s/end_s` 时间过滤（searchTagVideos） |
| 空间投稿列表 | `api.bilibili.com/x/space/wbi/arc/search` | WBI | 指定 mid 的投稿（getSpaceArchives / getChannelVideos） |
| 合集/系列稿件 | `api.bilibili.com/x/series/archives` | 免签 | 直播回放合集，**替代已失效的 xlive 回放接口**（SERIES_ARCHIVES_API） |
| 视频详情 | `api.bilibili.com/x/web-interface/view?bvid=` | 免签 | 播放/点赞/投币/转发/收藏/评论（替代被风控的 `archive/stat`）（getVideoInfo） |
| 动态列表 | `api.bilibili.com/x/polymer/web-dynamic/v1/feed/space` | WBI + SESSDATA | 本人/指定 UP 空间动态（getDynamics） |
| 动态详情 | `api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=` | SESSDATA | 取单条动态（opus）详情，用于立绘抓取（fetch-characters） |
| 评论（主楼） | `api.bilibili.com/x/v2/reply/wbi/main` | WBI | 动态/视频评论主楼（getVideoCommentMain） |
| 评论（子楼） | `api.bilibili.com/x/v2/reply/reply` | 免签 | 楼中楼回复 |
| 播放地址 | `api.bilibili.com/x/player/wbi/playurl` | WBI | 取视频流（含合并 durl），用于帧抽取（getPlayUrl） |
| 装扮（立绘） | `api.bilibili.com/x/garb/v2/mall/suit/detail?item_id=` | 免签 | 立绘装扮详情（fetch-garb） |
| 弹幕列表 | `api.bilibili.com/x/v1/dm/list.so?oid=` | 免签 | 按 cid 拉弹幕 XML（sync-danmaku） |
| 设备指纹 | `api.bilibili.com/x/frontend/finger/spi` | 免签 | 拿 `buvid3/buvid4`，部分接口风控需要（getBuvid） |
| 当前用户 | `api.bilibili.com/x/web-interface/nav` | 免签（登录态更全） | 校验 `SESSDATA` 是否有效（getNav） |
| 登录二维码生成 | `passport.bilibili.com/x/passport-login/web/qrcode/generate` | 特殊 | 后台扫码登录第一步 |
| 登录二维码轮询 | `passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=` | 特殊 | 轮询扫码状态，产出 Cookie/SESSDATA |
| 登录提交 | `api.bilibili.com/x/passport-login/web/login` | 特殊 | 账号密码登录（备选） |

### 动态接口注意事项（踩坑备忘）
- **必须用 `feed/space`，不要用 `feed/all`**。两者在 `bilibili-API-collect` 中分别对应「用户空间动态」与「获取动态列表」文档。
  `feed/all` 在服务器环境下常被风控降级（返回空），且其 `features` 含 `forwardListHidden` 会**隐藏转发类动态**，
  导致增量同步漏掉最新动态（曾导致任务 #78 “成功但没拿到最新”）。`feed/space` 同时返回普通/转发/置顶动态。
- `feed/space` 鉴权：已登录仅需有效 `SESSDATA`；未登录时**必须 WBI 签名**（`signWbi`）。`x-bili-locale-json` / `x-bili-device-req-json` 官方文档列为**非必须**，代码为稳妥已带上（可放 header 或 query）。
- 翻页用 `offset`（游标），`offset=''` 即第一页；不要用 `page` 参数。
- 第一页可能含置顶动态（时间较早），增量同步判断“是否已存在”需用**整页全部已存在即停**，不能“首条已存在即停”。
- `UID`（李豆沙）= `1703797642`，`ROOM_ID`（直播间）= `22966160`，**二者不同**，调用动态/直播接口时 host_mid/ruid 用 UID，roomid 用 ROOM_ID。

### 动态接口权威参数（来自 bilibili-api-collect 资料）
`feed/space` 与 `feed/all` 的官方文档要点（仓库 `docs/dynamic/space.md`、`docs/dynamic/all.md`）：

| 项目 | `feed/space`（用户空间动态） | `feed/all`（获取动态列表） |
|---|---|---|
| URL | `api.bilibili.com/x/polymer/web-dynamic/v1/feed/space`（另有 `desktop/v1/feed/space`） | `api.bilibili.com/x/polymer/web-dynamic/v1/feed/all` |
| 方法 | GET | GET |
| 登录态 | 非必须；推荐带 SESSDATA 规避风控 | **必须** SESSDATA（无有效 Cookie 返回 `code:-101` 未登录） |
| WBI 签名 | 未登录强制；登录非必须 | 文档未强制（建议带） |
| 关键参数 | `host_mid`(必需, UP主UID)、`offset`(翻页) | `host_mid`(新版可选, 指定UP主)、`offset`、`update_baseline`(拉新)、`features` |
| 转发动态 | **包含**（`DYNAMIC_TYPE_FORWARD`，带 `orig` 原动态） | `features` 含 `forwardListHidden` 控制是否隐藏转发列表 |
| 翻页 | `offset` 游标，`offset=''` 首页 | `offset` + `update_baseline` |

返回结构（`data.items[]`）：`basic`(评论/跳转)、`id_str`、`modules`(author/dynamic/stat/tag)、`type`(`DYNAMIC_TYPE_DRAW` 图文 / `AV` 视频 / `FORWARD` 转发)；转发类额外带 `orig`（原动态）。这正是最初"同步成功却拿不到最新动态"的根因：旧代码用 `feed/all`，在服务器环境无有效登录态时会降级/隐藏转发动态。

### 直播信息流接口（本地资料 `scripts/_msgstream.md`）
来自 bilibili-API-collect `docs/live/message_stream.md`，本项目弹幕/礼物/SC 实时监听据此实现（`scripts/live-monitor.ts`）：
- 认证秘钥：`GET api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id={真实房间id}` → 返回 `token` 与 `host_list`（`host`/`port`/`wss_port`）。最终 WS URI = `host:wss_port/sub`（详见本地资料文件）。
- 连接协议：先发**认证包**(op=7)，正文 `{uid, roomid, protover:3, platform:"web", type:2, key}`（uid 为真实登录 mid，游客填 0）→ 收认证回包(op=8) → 每 30s 发**心跳包**(op=2)；普通包 op=5（命令），心跳回包 op=3 含人气值。
- 常见命令 `cmd`：`DANMU_MSG`(弹幕)、`INTERACT_WORD`(进场/关注)、`SEND_GIFT`(送礼)、`COMBO_SEND`(连击)、`GUARD_BUY`(上舰)、`USER_TOAST_MSG`(上舰庆祝)、`SUPER_CHAT_MESSAGE`(SC)、`LIKE_INFO_V3_UPDATE`(点赞数)、`ROOM_REAL_TIME_MESSAGE_UPDATE`(粉丝数)、`PREPARING`(轮播/下播)、`ONLINE_RANK_V2`(高能榜) 等，完整字段见 `scripts/_msgstream.md`。

## 立绘素材
放入 `public/characters/` 并在 `lib/characters.ts` 填写 `src`（当前为渐变占位）；
也可从李豆沙的动态/空间中获取官方立绘（动态页已可展示含图动态）。

## 直播时长 / 唱歌 / 游戏时长统计
`sync` 步骤 4 会翻页拉取直播间"回放"列表（`live_session` 表），用每场的
`start_time / end_time` 累加得到总直播时长，并按标题关键词粗略归类唱歌 / 游戏。

注意两点限制：
1. **回放仅保留近期**：B站不会永久保存所有直播回放，因此统计覆盖的是"可获取的回放"，
   并非 2021 年至今全量；绝对值偏小属正常。
2. **接口路径可能变动**：B站原生 xlive 直播回放接口已失效，现改用 UP 主「直播回放」合集
   `api.bilibili.com/x/series/archives`（`lib/bilibili.ts` 的 `SERIES_ARCHIVES_API`）。若 `sync`
   日志提示回放为空，请确认合集 ID（`LIVE_SERIES_ID`）是否正确。

## 部署
推荐 Vercel / 任意 Node 服务 + 托管 PostgreSQL。用 Cron 每日触发 `npm run sync`
（Vercel 上配置 `BILI_SESSDATA` 环境变量）。前端读取走 PG 连接池，天然适配 Serverless。

> 非官方二创项目，数据来自公开接口，立绘版权归原作者所有。
