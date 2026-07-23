# 🏗 ARCHITECTURE.md — 聊天平台架构文档

---

## 一、整体架构

```
┌──────────────────────────────────────────────────────────┐
│                        浏览器                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ index.html│ │login.html│ │chat.html │ │  localStorage│ │
│  │(Landing)  │ │(登录注册) │ │(主聊天页) │ │  (本地偏好)  │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘ │
│       │              │            │                        │
│       └──────────────┴─────┬──────┘                       │
│                            │ Fetch API + WebSocket         │
└────────────────────────────┼──────────────────────────────┘
                             │
┌────────────────────────────┼──────────────────────────────┐
│                     FastAPI 应用层                          │
│                            │                               │
│  ┌─────────────────────────┴──────────────────────────┐   │
│  │                   main.py                           │   │
│  │  · CORS + GZip 中间件                               │   │
│  │  · 静态文件挂载 (StaticFiles)                        │   │
│  │  · 路由注册 (6 个 Router)                            │   │
│  │  · WebSocket 端点 (/ws/chat)                        │   │
│  │  · 页面路由 (/ + /login)                            │   │
│  └──────┬──────────────────────────────────┬──────────┘   │
│         │                                  │               │
│  ┌──────┴──────┐                    ┌──────┴──────┐       │
│  │  api/ (HTTP) │                    │  WebSocket   │       │
│  │             │                    │  Handler     │       │
│  │ · user      │                    │              │       │
│  │ · friend    │                    │ · send_msg   │       │
│  │ · chat      │                    │ · group_msg  │       │
│  │ · group     │                    │ · typing     │       │
│  │ · upload    │                    │ · mark_read  │       │
│  │ · conv      │                    │ · sys_notify │       │
│  └──────┬──────┘                    └──────┬──────┘       │
│         │                                  │               │
│  ┌──────┴──────────────────────────────────┴──────┐       │
│  │                   utils/                         │       │
│  │  · security.py  — JWT + 密码 + 表情包           │       │
│  │  · ws_manager.py — WebSocket 连接池 + 广播       │       │
│  │  · logger.py    — 日志系统                      │       │
│  └──────┬─────────────────────────────────────────┘       │
└─────────┼───────────────────────────────────────────────┘
          │
┌─────────┴───────────────────────────────────────────────┐
│                     数据层                                │
│  ┌────────────────────┐   ┌────────────────────────┐    │
│  │   database/db.py    │   │  database/models/       │    │
│  │   · 7 张核心表      │   │  · chat.py (3 张表)     │    │
│  │   · 引擎 + 会话     │   │  · friend.py (2 张表)   │    │
│  │   · Base 基类       │   │                         │    │
│  └─────────┬──────────┘   └──────────┬──────────────┘    │
│            │                         │                    │
│            └──────────┬──────────────┘                    │
│                       │                                   │
│              ┌────────┴────────┐                          │
│              │   MySQL 8.0     │                          │
│              │  chat_system    │                          │
│              │  (12 张表)      │                          │
│              └─────────────────┘                          │
└──────────────────────────────────────────────────────────┘
```

---

## 二、数据库设计

### 2.1 表关系总览（12 张表）

```
user ───┬─ friend_relation ─── user (自引用，好友关系)
        │
        ├─ friend_remark (好友备注)
        ├─ friend_mute_setting (好友免打扰)
        │
        ├─ chat_message (私聊/群聊消息，receiver_id 或 group_id 二选一)
        │
        ├─ chat_group (群主 owner_id → user.id)
        │       │
        │       ├─ group_member (群成员)
        │       ├─ group_event (群事件日志)
        │       ├─ group_join_request (入群申请)
        │       └─ group_mute_setting (群免打扰)
        │
        └─ upload_resource (上传文件记录)
```

### 2.2 核心表字段详情

#### `user` — 用户表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INT PK | 用户 ID，自增 |
| `username` | VARCHAR(50) UNIQUE | 用户名 |
| `password` | VARCHAR(255) | bcrypt 加密密码 |
| `avatar` | VARCHAR(255) | 头像 URL |
| `status_message` | VARCHAR(50) | 个性状态 |
| `create_at` | DATETIME | 注册时间 |

#### `chat_message` — 消息表（核心）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | BIGINT PK | 消息 ID |
| `sender_id` | INT | 发送者 |
| `receiver_id` | INT NULL | 私聊接收者（群聊时为空） |
| `group_id` | INT NULL | 群聊 ID（私聊时为空） |
| `content` | TEXT | 消息内容 |
| `message_type` | SMALLINT | 0=文本 1=图片 2=文件 3=表情 |
| `is_read` | SMALLINT | 0=未读 1=已读 |
| `is_delete` | SMALLINT | 0=正常 1=已撤回 |
| `create_at` | DATETIME | 发送时间 |

**设计要点**：私聊和群聊共用同一张 `chat_message` 表，通过 `receiver_id` 和 `group_id` 区分。`receiver_id` 非空表示私聊，`group_id` 非空表示群聊。

#### `chat_group` — 群聊表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INT PK | 群 ID |
| `group_name` | VARCHAR(100) | 群名称 |
| `owner_id` | INT | 群主 UID |
| `admin_ids` | JSON | 管理员 UID 列表 |
| `avatar` | VARCHAR(255) | 群头像 URL |
| `announcement` | TEXT | 群公告 |
| `join_mode` | SMALLINT | 0=自由加入 1=需验证 |
| `is_disband` | SMALLINT | 0=正常 1=已解散 |

#### `group_member` — 群成员表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INT PK | 记录 ID |
| `group_id` | INT FK | 群 ID |
| `user_id` | INT | 用户 ID |
| `role` | SMALLINT | 0=普通 1=管理员 2=群主 |
| `mute_until` | DATETIME NULL | 禁言截止时间 |
| `is_quit` | SMALLINT | 0=在群 1=已退群 |

#### `friend_relation` — 好友关系表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INT PK | 记录 ID |
| `user_id` | INT | 发起方 |
| `friend_id` | INT | 接收方 |
| `status` | SMALLINT | 0=待同意 1=好友 2=拒绝 |

### 2.3 扩展模型表（`database/models/`）

| 文件 | 表名 | 说明 |
|------|------|------|
| `chat.py` | `group_event` | 群事件日志（踢人/禁言/设管理等） |
| `chat.py` | `group_join_request` | 入群申请记录 |
| `chat.py` | `group_mute_setting` | 群消息免打扰（用户+群维度） |
| `friend.py` | `friend_remark` | 好友备注（服务端存储） |
| `friend.py` | `friend_mute_setting` | 好友消息免打扰 |

---

## 三、WebSocket 通信协议

### 3.1 连接建立

```
ws://127.0.0.1:8000/ws/chat?token={JWT_TOKEN}
```

连接流程：
1. 从 URL 参数提取 `token`
2. JWT 解码获取 `uid`
3. 接受 WebSocket 连接，注册到 `ConnectionManager`
4. 进入消息循环

### 3.2 消息类型

#### 客户端 → 服务端

| type | 说明 | 参数 |
|------|------|------|
| `send_msg` | 私聊消息 | `receiver_username`, `content`, `message_type` |
| `send_group_msg` | 群聊消息 | `group_id`, `content`, `message_type` |
| `typing` | 正在输入 | `target_username` |
| `stop_typing` | 停止输入 | `target_username` |
| `mark_read` | 标记已读（私聊） | `target_username` |
| `group_mark_read` | 标记已读（群聊） | `group_id` |
| `group_sys_notify` | 群管理系统通知 | `group_id`, `notify_type`, `target_name`, etc. |

#### 服务端 → 客户端

| type | 说明 | 携带数据 |
|------|------|----------|
| `new_msg` | 新私聊消息 | `sender_username`, `sender_id`, `content`, `message_type`, `create_at` |
| `new_group_msg` | 新群聊消息 | `group_id`, `sender_username`, `sender_id`, `content`, `message_type`, `create_at` |
| `typing` | 对方正在输入 | `sender_username` |
| `stop_typing` | 对方停止输入 | `sender_username` |
| `read_receipt` | 已读回执 | `reader_username` |
| `group_read_update` | 群消息已读更新 | `group_id`, `reader_uid`, `reader_username` |
| `group_sys_notify` | 群系统通知 | `group_id`, `notify_type`, `operator_name`, `target_name`, `desc` |
| `error` | 错误消息 | `msg` |

### 3.3 群管理系统通知类型

| notify_type | 说明 |
|-------------|------|
| `kick` | 踢出成员 |
| `mute` | 禁言成员 |
| `unmute` | 解除禁言 |
| `set_admin` | 设为管理员 |
| `revoke_admin` | 撤销管理员 |
| `rename` | 修改群名 |
| `transfer_owner` | 转让群主 |
| `disband` | 解散群 |
| `update_announcement` | 更新群公告 |
| `join` | 新成员加入 |
| `leave` | 成员退出 |

---

## 四、鉴权流程

```
┌──────┐     POST /user/login      ┌──────────┐
│ 客户端 │ ─────────────────────────→ │  FastAPI  │
│      │ ←── JWT Token ──────────── │          │
│      │    (24h 有效期)             │          │
│      │                            │          │
│      │  任意 API 请求              │          │
│      │  Header/Body 带 token       │          │
│      │ ─────────────────────────→ │          │
│      │                    ┌───────┴─────────┐
│      │                    │ get_current_user │
│      │                    │ _from_token()    │
│      │                    │ · jwt.decode()   │
│      │                    │ · 提取 uid       │
│      │                    │ · 失败→401       │
│      │                    └───────┬─────────┘
│      │ ←── 业务数据 ──────────────┘          │
└──────┘                                      │
```

- JWT Payload：`{"uid": user_id, "exp": 24小时后}`
- 签名算法：HS256
- 密钥来源：`.env` 的 `JWT_SECRET_KEY` 或内置默认值
- 所有模块通过 `get_current_user_from_token(token)` 统一鉴权

---

## 五、WebSocket 连接管理

`utils/ws_manager.py` — `ConnectionManager` 单例：

```
active_connections: Dict[int, WebSocket]
     │
     └─ uid → WebSocket 映射
        · connect(uid, ws)     — 上线注册（取代旧连接）
        · disconnect(uid)      — 下线清理
        · is_online(uid)       — 在线检查
        · send_personal_msg()  — 一对一推送
        · send_group_msg()     — 群聊广播（排除发送者）
        · broadcast_to_group() — 群事件广播（包括操作者）
```

线程安全通过 `asyncio.Lock` 保证。

---

## 六、前端架构

### 6.1 页面路由

| 页面 | 文件 | 入口 |
|------|------|------|
| Landing Page | `static/index.html` | `/` |
| 登录/注册 | `static/login.html` | `/login` |
| 主聊天页 | `static/chat.html` | 登录后跳转 |

### 6.2 JS 模块划分

```
api.js (HTTP 层)
  ├─ UserAPI      — 注册/登录/改密/改头像
  ├─ FriendAPI    — 好友 CRUD
  ├─ GroupAPI     — 群聊 CRUD
  ├─ ChatAPI      — 聊天历史
  ├─ ConvAPI      — 会话列表
  └─ apiUpload()  — 文件上传
      │
      ├──→ ui.js (UI 控制层)
      │      ├─ 会话列表渲染
      │      ├─ 消息气泡渲染 + 虚拟滚动
      │      ├─ 右键菜单（会话/消息）
      │      ├─ 弹窗管理（好友资料/群成员/表情）
      │      ├─ 图片预览/文件下载
      │      └─ 输入框 + 发送逻辑
      │
      ├──→ ws.js (实时通信层)
      │      ├─ 自动连接/断线重连 (3s)
      │      ├─ 消息分发 (onMessage 回调)
      │      └─ sendPrivate() / sendGroup()
      │
      └──→ emoji.js (表情层)
             └─ emojiReplace() 文本→emoji 转换
```

### 6.3 localStorage 数据

| Key | 类型 | 内容 |
|-----|------|------|
| `access_token` | string | JWT 令牌 |
| `my_username` | string | 当前用户名 |
| `pinned_convs` | JSON Array | 置顶会话 ID 列表 |
| `muted_convs` | JSON Array | 免打扰会话 ID 列表 |
| `deleted_convs` | JSON Array | 已删除会话 ID 列表 |
| `friend_notes` | JSON Object | 好友备注（逐步迁移到服务端） |

---

## 七、数据流示意

### 7.1 私聊消息全流程

```
发送者 A                               接收者 B
────────                              ────────
输入消息
  │
  ├─→ ws.js sendPrivate()
  │     │
  │     └─→ WS: {"type":"send_msg", "receiver_username":"B", "content":"hi"}
  │              │
  │     ┌────────┴────────────────────────────┐
  │     │         服务端 main.py               │
  │     │                                      │
  │     │  1. 校验 token → uid                 │
  │     │  2. 查 receiver 是否存在             │
  │     │  3. 校验是否互为好友                  │
  │     │  4. chat_message 入库                │
  │     │  5. manager.send_personal_msg(B, msg)│
  │     │                                      │
  │     └────────┬────────────────────────────┘
  │              │
  │              └─→ WS: {"type":"new_msg", "sender_username":"A", ...}
  │                                                       │
  │                                              B 的 ws.js onMessage
  │                                                       │
  │                                              ui.js 渲染新气泡
  │                                                       │
  └─→ (自己的消息已通过本地立即渲染显示)
```

### 7.2 群聊消息广播流程

```
发送者                                  群成员们
───────                                ─────────
  │
  ├─→ WS: {"type":"send_group_msg", "group_id":1, "content":"hi"}
  │
  │     服务端：
  │     1. 校验群存在 + 未解散
  │     2. 校验是群成员 + 未退群
  │     3. 检查禁言状态
  │     4. chat_message 入库
  │     5. 查所有群成员 → 取在线集合 → 排除发送者
  │     6. 逐个推送 new_group_msg
  │              │
  │              ├─→ 成员 X (在线) ✓
  │              ├─→ 成员 Y (在线) ✓
  │              └─→ 成员 Z (离线) ✗ (下次上线通过历史记录获取)
```

---

## 八、安全设计

| 层面 | 措施 |
|------|------|
| **传输** | 密码 bcrypt 加盐，永不存明文 |
| **认证** | JWT 24h 过期，所有接口强制鉴权 |
| **私聊** | 仅好友间可发消息（WebSocket 层校验） |
| **群聊** | 仅群成员可发消息，禁言检查 |
| **群管理** | 踢人/禁言/设管理等操作需群主或管理员权限 |
| **消息撤回** | 仅发送者本人 + 2 分钟内 |
| **文件上传** | 限制类型和大小（图片 10MB / 文件 50MB） |
| **跨域** | CORS 开放（开发阶段），可按需收紧 |
| **数据库** | 密码 URL 编码防特殊字符注入 |

---

## 九、关键设计决策

| 决策 | 理由 |
|------|------|
| 私聊+群聊共用 `chat_message` 表 | 简化查询，`receiver_id` 和 `group_id` 互斥即可区分 |
| HTTP API + WebSocket 双通道 | HTTP 负责 CRUD（好友、群管理），WS 负责实时消息推送 |
| `asyncio.to_thread` 包装同步 DB 操作 | 防止 SQLAlchemy 同步查询阻塞事件循环 |
| 前端零框架 | 降低复杂度，无构建工具依赖，直接修改即生效 |
| `Base.metadata.create_all` 自动建表 | 简化部署，新增字段/表在启动时自动补充 |
| 服务端存储备注+免打扰 | 从 localStorage 迁移到数据库，支持跨设备同步 |

---

## 十、部署架构

```
                    Internet
                       │
              ┌────────┴────────┐
              │  cloudflared     │
              │  (trycloudflare) │
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │  Uvicorn :8000   │
              │  FastAPI App     │
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │  MySQL :3306     │
              │  chat_system     │
              └─────────────────┘
```

- **单机部署**：Uvicorn + MySQL 同机
- **公网访问**（可选）：cloudflared tunnel 生成临时 HTTPS 域名
- **生产建议**：Nginx 反向代理 + HTTPS + Gunicorn 多 worker
