# Nova Launcher 本地 API 文档

启动器本质是一个本地 HTTP 服务（`server/index.mjs`）+ 一个桌面外壳（WebView2）。
界面上的每个动作都走下面这些接口。想写脚本、做二次开发，或者单纯想知道它背地里干了什么，看这一份就够了。

---

## 一、连接

| 项 | 值 |
|---|---|
| 地址 | `http://127.0.0.1:7420`（只监听回环，不对外） |
| 端口 | 默认 7420，可用环境变量 `NOVA_PORT` 改 |
| 协议 | HTTP/1.1，JSON 请求与响应 |
| 数据目录 | 默认 `./data`，可用 `NOVA_DATA_DIR` 改 |

### 鉴权：每个请求都要带令牌

服务启动时生成一个随机令牌（36 位十六进制），**只存在进程内存里，不落盘**。
所有 `/api/*` 请求必须带：

```
X-Nova-Token: <令牌>
```

没带或不匹配一律返回 `401`。

也可以用查询参数：`?t=<令牌>`。
这条专门给 `<img src>` 和 CSS 的 `url()` 用 —— 它们是浏览器自己发起的请求，
带不了自定义头。图标、截图、壁纸都走这条路，只认 header 的话界面上会全是空白。

令牌从哪来：

- **桌面外壳模式**（正常双击 exe）：外壳生成令牌 → 环境变量 `NOVA_TOKEN` 传给 Node → 同时拼进窗口 URL（`http://127.0.0.1:7420/?t=<令牌>`）→ 前端读出来存进 `sessionStorage`，然后把 `?t=` 从地址栏抹掉
- **命令行模式**（直接 `node server/index.mjs`）：没有外壳给令牌，服务会自己生成一个并**打印在控制台**，照着那行带 `?t=` 的地址打开即可
- 唯一的例外是 `/api/ping`（健康检查），它不需要令牌

### 还有一道 Host 校验

`Host` 头必须是 `127.0.0.1` / `localhost` / `[::1]`，否则 `403`。
这是挡 DNS rebinding 的 —— 攻击者把自己的域名解析到 127.0.0.1，浏览器发过来的请求 `Host` 还是他的域名。

### 统一响应格式

```jsonc
{ "ok": true,  ...业务字段 }              // 成功
{ "ok": false, "error": "人话错误信息" }   // 失败
```

HTTP 状态码：`200` 成功，`400` 参数问题，`401` 未授权，`403` Host 不合法，`404` 路由不存在，`409` 状态冲突，`500` 服务端异常，`502` 上游（Modrinth 等）出错。

### 一个 curl 例子

```bash
TOKEN=<从控制台复制>
curl -H "X-Nova-Token: $TOKEN" http://127.0.0.1:7420/api/status
```

---

## 二、密钥怎么存的

CurseForge 的 API Key 属于敏感信息，**不会明文落盘**：

| 环节 | 做法 |
|---|---|
| 落盘 | `config.json` 里存的是 `dpapi:v1:<base64>` 密文 |
| 加密 | Windows **DPAPI**（`ProtectedData`，CurrentUser 范围）—— 密钥由系统按当前用户托管，代码里没有任何硬编码密钥 |
| 回退 | DPAPI 不可用时用 AES-256-GCM，密钥由「机器名 + 用户名」派生（弱一些，但不至于明文） |
| 读取 | `core.mjs` 的 `loadConfig` 统一解密，业务代码拿到的永远是明文 |
| 返回前端 | `/api/config` 返回的是**打码值**（`$2a$1••••KCtK`），明文不出后端 |
| 迁移 | 老版本残留的明文配置会在首次加载时**自动加密迁移** |

查询当前用的是哪种后端：`GET /api/config/crypto`

---

## 三、端点总览

> 下表 `GET` 表示只读查询，`POST` 表示有副作用。带「任务」标记的接口会立刻返回一个 task，
> 真正的工作在后台跑，进度用 `GET /api/tasks/:id` 或轮询 `GET /api/tasks` 拿。

### 3.1 系统与状态

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/ping` | 健康检查，**不需要令牌** |
| GET | `/api/status` | 内存总量/可用、Java 列表、当前运行的游戏、数据目录 |
| GET | `/api/config` | 读配置（敏感字段已打码） |
| POST | `/api/config` | 写配置，body 是任意字段子集，返回合并后的完整配置 |
| GET | `/api/config/crypto` | 当前加密后端（`dpapi` / `aes`） |
| GET | `/api/about` | 开源归属声明（Markdown 原文） |
| GET | `/api/optimize?instance=` | 内存优化建议（只读分析） |
| POST | `/api/optimize/apply` | **手动内存优化**：清僵尸 Java 进程 + 压缩本启动器进程工作集 + 重算内存并写回实例。游戏运行时返回 `409` |
| POST | `/api/system/open` | 在资源管理器打开目录，body `{ target }`：`data`/`shared`/`cache`/`root`/`runtime`/`instances` |
| POST | `/api/system/open-url` | 用系统浏览器打开外链，body `{ url }`（只允许 http/https） |
| POST | `/api/system/clear-cache` | 清图标缓存 |
| GET | `/api/system/server-log` | 服务端最近输出 |

`POST /api/config` 常见字段：

```jsonc
{
  "source": "auto|mirror|official",     // 游戏文件下载源
  "downloadConcurrency": 12,            // 并发下载数
  "multiLink": true,                    // 多链路下载（官方与镜像错峰竞速）
  "chunked": false,                    // 双源分段并发（8MB+ 文件，实验性）
  "javaPath": "auto",
  "jvmPreset": "aikar|memsave|smooth|vanilla",
  "autoOptimize": true,                 // 启动时自动内存优化
  "autoInstallJava": true,
  "autoBackup": true,                   // 每日数据快照
  "curseforgeApiKey": "...",            // 会被加密后落盘
  "theme": "nova|custom-xxxxxxxxxx",
  "multiLink": true
}
```

`POST /api/optimize/apply` 返回：

```jsonc
{
  "ok": true,
  "instance": { "id": "...", "name": "..." },
  "before": { "memory": 3072, "jvmPreset": "aikar" },   // 优化前的内存分配
  "after":  { "memory": 1536, "jvmPreset": "memsave" },
  "changed": true,
  "tuned": { "memoryMb": 1536, "preset": "memsave", "notes": ["…决策理由…"] },

  "mem": {
    "before": { "totalMb": 7931, "freeMb": 887, "usedMb": 7044 },
    "after":  { "totalMb": 7931, "freeMb": 1140, "usedMb": 6791 },
    "freedMb": 249,                       // 可用内存实际变化
    "orphans": {                          // ① 僵尸进程（永久释放）
      "found": 0, "killed": 0, "freedMb": 0,
      "list": [{ "pid": 1234, "workingSetMb": 812.5 }]
    },
    "trimmed": {                          // ② 工作集压缩（暂时腾挪）
      "count": 30, "freedMb": 3681.2,
      "othersCount": 28,              // 其中属于其他应用的
      "othersFreedMb": 3544.4,
      "list": [{ "pid": 19704, "name": "node", "ours": true,
                 "beforeMb": 52.8, "afterMb": 0, "freedMb": 52.8 }]
    }
  }
}
```

`mem.orphans` 和 `mem.trimmed` 是两个不同性质的收益，界面上也分开报：
前者进程被结束了（真释放），后者只是把页面推给系统（进程还在，一忙又涨回来）。

压缩范围包含**其他应用**（按工作集从大到小，最多 40 个），但会跳过：
系统关键进程（csrss/wininit/lsass/services/dwm/svchost…）、
正在运行的游戏、所有 java/javaw、工作集 < 5 MB 的进程。
游戏运行时整个接口返回 409。

---

### 3.2 Java 运行时

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/java` | 检测到的所有 Java（路径、版本、位数、来源） |
| POST | `/api/java/check` | 校验某个路径是否是可用 Java，body `{ path }` |
| POST | `/api/java/install` | **任务**：下载安装指定大版本，body `{ major }`（8/17/21/22） |
| POST | `/api/java/install-missing` | **任务**：自动补齐当前实例需要的 Java |

---

### 3.3 游戏版本与加载器

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/versions` | Mojang 版本清单（磁盘缓存，快） |
| GET | `/api/versions/installed` | 本机已安装的版本 |
| POST | `/api/versions/install` | **任务**：装原版，body `{ id }` |
| POST | `/api/versions/install-loader` | **任务**：装加载器，body `{ mcVersion, loader, loaderVersion }` |
| POST | `/api/loaders` | 列出某版本可用的加载器版本，body `{ mcVersion, loader }` |
| POST | `/api/versions/delete` | 删版本，body `{ id }` |
| POST | `/api/versions/repair` | **任务**：增量补全缺失文件，body `{ id }` |

`loader` 取值：`fabric` / `forge` / `neoforge` / `quilt`。

---

### 3.4 实例

实例 = 一个独立的游戏目录（`data/instances/<id>/`），有自己的 mods / saves / config。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/instances` | 列出全部实例 |
| POST | `/api/instances` | **任务**：新建。① 用已装版本：`{ name, versionId }`；② 装新版本：`{ name, mcVersion, loader, loaderVersion }` |
| POST | `/api/instances/update` | 改实例字段（`name` / `memory` / `jvmPreset` / `autoOptimize` / `width` / `height` / `javaPath` / `extraJvmArgs` / `icon` / `notes`），body 含 `{ id, ...fields }` |
| POST | `/api/instances/delete` | 删实例（连同目录），body `{ id }` |
| POST | `/api/instances/duplicate` | 复制实例，body `{ id, name }` |
| POST | `/api/instances/change-loader` | **任务**：更换加载器，body `{ id, loader, loaderVersion }` |
| POST | `/api/instances/open` | 打开实例根目录，body `{ id }` |
| POST | `/api/instance/open-folder` | 打开实例下某个子目录，body `{ id, kind }`（`mods`/`saves`/`screenshots`/…） |
| GET | `/api/instance/size?instance=` | 实例占用体积 |

---

### 3.5 内容管理（模组 / 资源包 / 光影 / 数据包）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/content?instance=&kind=` | 列出内容，含从 jar 里读出的名称/版本/作者/加载器 |
| GET | `/api/content/preview?instance=&kind=&file=` | 详情面板数据（含中文名、官网/MC百科链接） |
| GET | `/api/content/deps?instance=` | **前置依赖检查**：读 jar 内真实依赖声明，返回缺失列表 |
| POST | `/api/content/deps/fix` | **任务**：一键补齐缺失前置 |
| POST | `/api/content/toggle` | 启用/禁用（改 `.disabled` 后缀），body `{ instance, kind, file }` |
| POST | `/api/content/delete` | 删除文件，body `{ instance, kind, file }` |
| POST | `/api/content/import` | 从本机导入，body `{ instance, kind, path }` |
| POST | `/api/content/upload` | **二进制上传**：body 是文件原始字节，文件名走头 `X-Filename`，query 带 `instance` 与 `kind` |

`kind` 取值：`mod` / `resourcepack` / `shader` / `datapack`。

`GET /api/content/deps` 返回：

```jsonc
{
  "ok": true,
  "scanned": 20,                    // 扫了几个 jar
  "provided": ["sodium", "jei", …], // 已提供的 modId
  "missing": [                       // 缺的（空数组=齐全）
    { "modId": "create", "range": "[6.0.7,)", "neededBy": ["xxx.jar"] }
  ]
}
```

---

### 3.6 内容搜索

**双源同时搜索（推荐）** —— Modrinth 和 CurseForge 一起查，合并成一份结果：

| 方法 | 路径 | 参数 |
|---|---|---|
| GET | `/api/search/all` | `query` `kind` `mcVersion` `loader` `offset` `limit` |

返回：

```jsonc
{
  "ok": true,
  "hits": [
    {
      "title": "Sodium", "id": "AANobbMI", "sourceKind": "modrinth",
      "downloads": 248980000, "cn": "钠", …,
      "alsoOn": ["curseforge"]        // 两边都有时会标出来
    }
  ],
  "total": 18511,                     // 两源命中数之和
  "sources": [                        // 每个源的状态，某个源挂了不影响另一个
    { "id": "modrinth",  "label": "Modrinth",  "ok": true, "total": 8511, "error": null },
    { "id": "curseforge","label": "CurseForge","ok": true, "total": 10000, "error": null }
  ],
  "queryInfo": { … }                  // 中文检索词转换信息
}
```

排序规则：先按「和关键词的匹配程度」分层（完全一致 > 前缀 > 包含 > 其他），
同层内**按来源交错**。不比下载量，因为两个平台的统计口径不同（CF 累计量普遍高一个数量级），
直接比会让一边把另一边全挤下去。

单源搜索：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mr/search` | 只查 Modrinth，参数同上 |
| GET | `/api/cf/search` | 只查 CurseForge，参数同上，需要 API Key |

### 3.6.1 Modrinth 项目

| 方法 | 路径 | 参数 | 说明 |
|---|---|---|---|
| GET | `/api/mr/search` | `query` `kind` `mcVersion` `loader` `offset` `limit` | 搜索。中文会自动转英文检索词，返回带 `cn`（中文名）与 `queryInfo` |
| GET | `/api/mr/versions` | `project` `mcVersion` `loader` | 某项目的可用版本 |
| GET | `/api/mr/project` | `project` | 项目详情（作者、简介、许可、链接） |
| POST | `/api/mr/install` | `{ instance, kind, project, versionId?, mcVersion, loader }` | **任务**：安装，装完会再核一次前置 |
| GET | `/api/translate` | `text` | 机器翻译（带磁盘缓存） |

`GET /api/mr/search` 返回里的 `hits[]` 关键字段：`id` `slug` `title` `cn` `description` `author` `downloads` `icon` `versions` `updated`，以及 `total`（总命中数，分页用）。

---

### 3.7 CurseForge 内容（需要 API Key）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/cf/status` | 配置状态与连通性（不返回 Key 本身，只给 `keyHint`） |
| GET | `/api/cf/search` | 参数同 Modrinth：`query` `kind` `mcVersion` `loader` `offset` `limit` |
| GET | `/api/cf/project` | 项目详情 |
| GET | `/api/cf/files` | 某项目的文件列表（按版本/加载器过滤） |
| POST | `/api/cf/install` | **任务**：安装指定文件 |

---

### 3.8 整合包

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/pack/install` | **任务**：装 Modrinth 整合包，body `{ projectSlug, versionId }` |
| POST | `/api/pack/upload` | **二进制上传** `.mrpack` / `.zip` |
| POST | `/api/pack/import-zip` | 导入本地 zip 整合包，body `{ path }` |
| POST | `/api/import/auto` | **二进制上传**：拖进窗口的文件，自动判断是存档/资源包/光影/数据包/整合包 |

整合包会**自动新建一个同名实例**再装进去。

---

### 3.9 存档

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/saves?instance=` | 存档列表 + `level.dat` 摘要（游戏模式/难度/天数…） |
| POST | `/api/saves/edit` | 改存档属性，body `{ instance, world, patch }`（`gameMode`/`difficulty`/`allowCommands`/`hardcore`/`levelName`/`dayTime`…），保存前自动备份 |
| POST | `/api/saves/import` | **二进制上传** 存档 zip |
| POST | `/api/saves/import-url` | 从 URL 导入，body `{ instance, url }` |
| POST | `/api/saves/export` | 导出为 zip，body `{ instance, world }` |
| POST | `/api/saves/export-file` | 导出到指定路径，body `{ instance, world, dest }` |
| POST | `/api/saves/backup` | 备份到 `saves-backup/`，body `{ instance, world }` |
| POST | `/api/saves/delete` | 删除存档，body `{ instance, world }` |

---

### 3.10 截图

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/screenshots?instance=` | 截图列表 |
| GET | `/api/screenshot/file?instance=&file=` | 取图片字节 |
| POST | `/api/screenshot/reveal` | 在资源管理器定位该文件 |
| POST | `/api/screenshots/delete` | 删除，body `{ instance, file }` |

---

### 3.11 启动与游戏进程

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/launch` | **任务**：启动游戏，body `{ id }`（实例 id）。启动前会补前置、选 Java、算内存 |
| POST | `/api/kill` | 强制结束正在运行的游戏 |
| GET | `/api/game/log?since=&instance=` | 增量拉取游戏日志，`since` 是上次拿到的 `t` |

---

### 3.12 任务队列

所有耗时操作（下载、安装、整合包、补前置…）都是 task。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tasks` | 全部任务（新→旧），含 `logs`（最近 60 行） |
| GET | `/api/tasks/:id` | 单个任务详情 |
| POST | `/api/tasks/cancel` | 取消，body `{ id }` |
| GET | `/api/downloads/history` | 下载历史 + 进行中的 |
| POST | `/api/downloads/clear-history` | 清空历史（不删文件） |

任务对象关键字段：`id` `type` `title` `status`（`running`/`done`/`failed`/`cancelled`）`percent` `done` `total` `bytes` `bytesTotal` `speed` `eta` `error` `result` `logs`。

---

### 3.13 主题与壁纸

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/themes` | 自定义主题列表 + 当前生效的 |
| POST | `/api/themes/import` | 导入主题，body `{ filename, text, apply }`（`.json` / `.html` / `.css`） |
| POST | `/api/themes/save` | 直接存一份，body `{ name, desc, vars, css, apply }` |
| POST | `/api/themes/delete` | 删除，body `{ id }` |
| GET | `/api/themes/sample` | 示例模板（JSON 与 HTML 各一份） |
| POST | `/api/themes/open` | 打开主题文件夹 |
| GET | `/api/wallpaper` | 当前壁纸设置 |
| POST | `/api/wallpaper/upload` | **二进制上传** 图片，文件名走 query `name` |
| POST | `/api/wallpaper/config` | 调参数，body `{ dim, opacity, blur, fit, pos }` |
| POST | `/api/wallpaper/clear` | 移除壁纸 |
| GET | `/api/wallpaper/file` | 取壁纸图片字节 |
| POST | `/api/wallpaper/open` | 打开壁纸文件夹 |

---

### 3.14 数据快照

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/backup/list` | 快照列表（文件名、大小、时间、原因） |
| POST | `/api/backup/now` | 立刻存一份，body `{ reason }` |
| POST | `/api/backup/restore` | 恢复。**先不带 `confirm` 调用可拿到计划**（dryRun），确认后带 `{ file, confirm: true }` |
| POST | `/api/backup/delete` | 删除快照，body `{ file }` |
| POST | `/api/backup/open` | 打开备份文件夹 |

快照内容：`config.json`、每个实例的 `instance.json` / `nova-sources.json` / `options.txt` / `servers.dat` /
`saves/`、`themes/`、当前壁纸。**不含**游戏本体、依赖库、模组 jar（那些能重下）。

快照分三类，轮转分开算：

| kind | 何时产生 | 保留 |
|---|---|---|
| `launch` | 每次启动游戏前（`launchBackup` 不是 `off` 时） | 最近 6 份 |
| `daily` | 每天第一次启动器 | 与其他共 10 份 |
| `manual` | 「立即备份」按钮 | 与其他共 10 份 |

`launch` 类是**单实例快照**（`scope` 字段是实例 id），只装那个实例的文件，
不塞 `config.json` / 主题 / 壁纸。文件名撞上同一秒时自动追加 `-1`、`-2` 序号。

---

### 3.14b 存储位置（数据目录 / 游戏目录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/system/data-dir` | 当前数据目录、默认目录、标记文件路径 |
| POST | `/api/system/data-dir` | 改数据目录，body `{ dir, migrate? }`。**要重启启动器生效** |
| POST | `/api/system/pick-dir` | 弹系统文件夹选择框，返回 `{ dir }`（浏览器拿不到真实路径，只能后端弹） |
| GET | `/api/system/game-dirs` | 所有游戏目录（默认的 + 额外挂的），每个带实例数 |
| POST | `/api/system/game-dirs` | body `{ action, dir }`：`add` / `remove` |

**移除游戏目录只是取消登记，不删任何文件** —— 加回来自动恢复。

`POST /api/instances` 支持 `rootDir` 指定实例建在哪个游戏目录，
必须是已登记的目录之一，否则报「这个目录还没添加成游戏目录」。

数据目录标记文件（`.nova-data-dir`）由外壳通过环境变量 `NOVA_MARKER` 指定位置：
安装版放在**安装根**而不是 `安装根\app` 里 —— 重装只会擦掉 `app`，标记留得住，
用户改过的路径不会因为升级一次就丢。升级时安装程序还会把旧位置（`app\` 里）的标记搬出来。

---

### 3.15 中文与搜索索引

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/i18n/dict` | 模组中文名词典（492 条） |
| GET | `/api/i18n/status` | CFPA 汉化包状态 |
| POST | `/api/i18n/install` | **任务**：一键装 CFPA 简体中文语言包 |
| GET | `/api/search/index/status` | 本地模糊搜索索引状态 |
| POST | `/api/search/index/build` | 重建索引 |
| GET | `/api/autotune?instance=` | 自动内存调优结果（不写回） |

---

### 3.16 代理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/proxy?url=` | 图片等外部资源代理（只允许 http/https，用于绕过防盗链与混合内容限制） |

---

## 四、注意

- **`/api/proxy` 和 `/api/system/open-url` 会发起外部请求 / 启动外部程序**，写脚本时别拿它们当通用工具使
- 二进制上传类接口（`content/upload`、`pack/upload`、`saves/import`、`import/auto`、`wallpaper/upload`）的 body **就是文件本身**，不要 JSON 包一层
- 任务类接口返回的是 task 而不是最终结果，调用方要自己轮询
- 令牌每次启动都变，**别把它写进脚本硬编码**，从控制台或窗口 URL 里取

---

## 五、自己动手试

```bash
# 1. 命令行起服务（会打印本次令牌）
node server/index.mjs

# 2. 复制控制台里的令牌，然后
TOKEN=xxxxxxxx
curl -H "X-Nova-Token: $TOKEN" http://127.0.0.1:7420/api/status

# 3. 看看实例
curl -H "X-Nova-Token: $TOKEN" http://127.0.0.1:7420/api/instances

# 4. 检查某个实例的前置是否齐全
curl -H "X-Nova-Token: $TOKEN" \
  "http://127.0.0.1:7420/api/content/deps?instance=<实例id>"
```
