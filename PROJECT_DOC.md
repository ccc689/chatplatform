# 聊天平台 — 完整项目文档

---

## 目录结构

```
chatplatform/
├── main.py                    # 项目入口：FastAPI 应用、WebSocket、路由注册、静态文件
├── .env                       # 数据库连接配置
├── database/
│   └── db.py                  # SQLAlchemy 引擎、会话工厂、全部 6 张数据表模型
├── api/
│   ├── user.py                # 注册 / 登录
│   ├── friend.py              # 好友申请 / 处理 / 列表 / 搜索
│   ├── chat.py                # 私聊历史记录
│   ├── group.py               # 群聊创建 / 邀请 / 列表 / 成员 / 历史 / 退出
│   ├── upload.py              # 文件 / 图片上传
│   └── conversation.py        # 会话列表（私聊+群聊聚合，按时间排序）
├── utils/
│   ├── security.py            # JWT 生成/解析、密码加密/校验、表情包数据
│   ├── ws_manager.py          # WebSocket 连接管理器（私聊+群聊广播）
│   └── logger.py              # 全局日志系统（控制台 + 文件）
├── static/
│   ├── index.html             # 登录 / 注册页面
│   ├── chat.html              # 主聊天页面（两栏布局）
│   ├── css/
│   │   └── style.css          # 全局样式（微信绿风格）
│   └── js/
│       ├── api.js             # HTTP 接口封装
│       ├── ws.js              # WebSocket 客户端
│       ├── ui.js              # 页面交互逻辑
│       └── emoji.js           # 表情包数据
└── logs/
    └── app.log                # 运行日志
```

---

# 第一部分：后端

---

## 一、技术栈

| 组件 | 技术 | 用途 |
|------|------|------|
| Web 框架 | FastAPI 0.100+ | 异步接口、WebSocket、自动生成 /docs 文档 |
| ASGI 服务器 | Uvicorn | 异步启动、热重载 |
| 数据库 | MySQL 8.0 | 持久化存储 |
| ORM | SQLAlchemy 2.0 | 模型映射、会话管理 |
| 身份认证 | JWT (python-jose) | 7 天登录有效期 |
| 密码加密 | passlib [bcrypt] | 加盐哈希 |
| 实时通讯 | FastAPI WebSocket | 私聊/群聊实时推送 |
| 文件上传 | FastAPI UploadFile | 图片/文件传输 |

---

## 二、数据库模型（database/db.py）

一**个文件**包含全部 6 张表，共用同一个 `Base = declarative_base()`。

| 表名 | 模型类 | 字段 |
|------|--------|------|
| `user` | `User` | `id`、`username`、`password`、`avatar`、`create_at` |
| `friend_relation` | `FriendRelation` | `id`、`user_id`、`friend_id`、`status`（0待同意/1好友/2拒绝）、`create_at` |
| `chat_message` | `ChatMessage` | `id`(BIGINT)、`sender_id`、`receiver_id`(私聊时可空)、`group_id`(群聊时可空)、`content`、`is_read`、`is_delete`、`message_type`(0文本/1图片/2文件/3表情)、`create_at` |
| `chat_group` | `ChatGroup` | `id`、`group_name`、`owner_id`、`create_at` |
| `group_member` | `GroupMember` | `id`、`group_id`、`user_id`、`create_at` |
| `upload_resource` | `UploadResource` | `id`、`user_id`、`file_name`、`save_path`、`file_size`、`create_at` |

**关键规则**：所有时间字段统一命名 `create_at`，表由 `Base.metadata.create_all(bind=engine)` 在启动时自动创建。

---

## 三、全部后端接口

### 用户模块（api/user.py）— `prefix="/user"`

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | `/user/register` | 注册 | `{"username":"", "password":""}` |
| POST | `/user/login` | 登录，返回 JWT | `{"username":"", "password":""}` |

### 好友模块（api/friend.py）— `prefix="/friend"`

| 方法 | 路径 | 说明 | 请求体 / 参数 |
|------|------|------|--------|
| POST | `/friend/apply` | 发起好友申请 | `{"token":"", "friend_username":""}` |
| GET | `/friend/apply/list` | 收到的申请列表 | `?token=xxx` |
| POST | `/friend/apply/deal` | 处理申请（operate:1同意/其他拒绝） | `{"token":"", "apply_id":1, "operate":1}` |
| GET | `/friend/list` | 好友列表（按用户名排序） | `?token=xxx` |
| GET | `/friend/search` | 搜索用户（模糊匹配） | `?token=xxx&keyword=xxx` |

### 聊天模块（api/chat.py）— `prefix="/chat"`

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | `/chat/history` | 查看私聊历史（同时标记已读） | `{"token":"", "target_username":""}` |

### 群聊模块（api/group.py）— `prefix="/group"`

| 方法 | 路径 | 说明 | 请求体 / 参数 |
|------|------|------|--------|
| POST | `/group/create` | 创建群聊（群名空则自动生成） | `{"token":"", "group_name":""}` |
| GET | `/group/list` | 我的群列表 | `?token=xxx` |
| GET | `/group/members` | 群成员列表 | `?token=xxx&group_id=1` |
| POST | `/group/join` | 邀请好友入群（群主操作） | `{"token":"", "group_id":1, "friend_username":""}` |
| POST | `/group/history` | 群聊历史消息 | `{"token":"", "group_id":1}` |
| POST | `/group/leave` | 退出群聊 | `{"token":"", "group_id":1}` |

### 文件上传模块（api/upload.py）— `prefix="/upload"`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/upload/file` | 上传图片(JPG/PNG ≤10MB)或文件(PDF/Word/Excel/PPT ≤50MB)，返回文件 URL |

### 会话列表（api/conversation.py）— `prefix="/conversation"`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/conversation/list` | 返回所有会话（私聊+群聊），按最后消息时间倒序，带未读数 |

### 鉴权方式

所有接口通过 **共享函数** `get_current_user_from_token(token)`（定义在 `utils/security.py`）解析 JWT：

```python
# 任何新接口中加入这一行即可鉴权
current_uid = get_current_user_from_token(token)
```

Token 构建：`{"uid": user_id, "exp": 7天后}`，所有模块统一读取 `payload.get("uid")`。

---

## 四、WebSocket 通信协议

### 连接

```
ws://127.0.0.1:8000/ws/chat?token={JWT_TOKEN}
```

### 私聊消息

```json
// 发送
{"type": "send_msg", "receiver_username": "张三", "content": "你好", "message_type": 0}

// 接收
{"type": "new_msg", "sender_username": "李四", "sender_id": 2, "content": "你好", "message_type": 0, "create_at": "2026-07-15 14:30:00"}
```

### 群聊消息

```json
// 发送
{"type": "send_group_msg", "group_id": 1, "content": "大家好", "message_type": 0}

// 接收
{"type": "new_group_msg", "group_id": 1, "sender_username": "张三", "sender_id": 1, "content": "大家好", "message_type": 0, "create_at": "2026-07-15 14:30:00"}
```

### message_type 枚举

| 值 | 含义 |
|----|------|
| 0 | 文本消息 |
| 1 | 图片（content 为文件 URL） |
| 2 | 文件（content 为文件 URL） |
| 3 | 表情（content 为表情标记如 `[smile]`） |

---

## 五、关键后端代码位置速查

| 想要... | 改哪个文件 | 具体位置 |
|---------|-----------|---------|
| 新增 API 接口 | `api/` 下新建 `.py` 文件 | 然后在 `main.py` 中 `from api.xxx import router` + `app.include_router(xxx_router)` |
| 新增数据库表 | `database/db.py` | 在最后添加新的 `class Xxx(Base):` 模型类 |
| 修改 JWT 有效期 | `utils/security.py` | `ACCESS_TOKEN_EXPIRE_MINUTES = 10080` |
| 修改密码加密方式 | `utils/security.py` | `pwd_context = CryptContext(...)` |
| 新增表情包 | `utils/security.py` | `EMOJI_MAP` 字典，以及前端 `static/js/emoji.js` |
| 改日志级别/输出位置 | `utils/logger.py` | `LOG_DIR`、`RotatingFileHandler` 参数 |
| 改 WebSocket 消息处理 | `main.py` | `websocket_chat_endpoint` 函数的 while 循环 |
| 改连接池大小 | `database/db.py` | `create_engine(..., pool_size=20, max_overflow=10)` |

---

# 第二部分：前端

---

## 六、技术选型

| 技术 | 说明 |
|------|------|
| 纯原生 HTML/CSS/JS | 不引入任何框架（React/Vue/jQuery），零构建工具 |
| Fetch API | 调用后端 HTTP 接口 |
| 原生 WebSocket | 维持实时连接，断线 3 秒自动重连 |
| localStorage | 存储 token、置顶/免打扰/备注/已删除会话等本地状态 |
| CSS 无预处理 | 纯 CSS，微信绿色调 `#07C160` |

---

## 七、前端页面结构

### 登录/注册页（index.html）

- 纯白底 + 角落淡绿光晕
- 切换 Tab：登录 / 注册
- 输入框：无边框，仅底部灰线，聚焦变绿
- 登录按钮：纯 `#07C160` 绿色
- 登录成功后：token 存入 localStorage → 跳转 chat.html

### 主聊天页（chat.html）— 两栏极简布局

```
┌──────────────┬─────────────────────────────┐
│              │  聊天对象名        [+] [···] │
│  用户信息    │─────────────────────────────│
│  ────────   │                             │
│  搜索会话    │   消息气泡区域               │
│  ────────   │   (绿色=自己, 白色=对方)     │
│              │                             │
│  会话列表    │                             │
│  · 张三     │                             │
│  · 群聊     │─────────────────────────────│
│  · 李四     │  😊 [____输入框____] 🖼 📎 发送│
│  · ...      │                             │
└──────────────┴─────────────────────────────┘
```

**交互入口一览**：

| 操作 | 方式 |
|------|------|
| 打开私聊 | 点击左侧会话条目 |
| 会话右键菜单 | 右键点击会话条目 → 置顶/免打扰/删除 |
| 添加好友 | 右上角 `+` → 「添加好友」→ 搜索→发送申请→查看申请列表 |
| 发起群聊 | 右上角 `+` → 「发起群聊」→ 多选好友→创建 |
| 好友资料 | 聊天顶部 `···` → 查看资料/设置备注 |
| 群成员 | 聊天顶部 `···` → 查看成员，双击成员开私聊 |
| 消息右键 | 右键气泡 → 复制/撤回（2分钟内自己的消息） |
| 图片预览 | 点击图片 → 全屏预览 |
| 文件下载 | 点击文件链接 → 浏览器下载 |
| 表情 | 底部 😊 → 弹出 6 款表情面板 |
| 输入发送 | Enter 发送，Shift+Enter 换行 |
| 退出登录 | 左上角「退出」→ 确认弹窗 |

---

## 八、前端文件职责

| 文件 | 职责 |
|------|------|
| `index.html` | 登录/注册页面的 DOM 结构，内含登录/注册的 form 提交逻辑 |
| `chat.html` | 主聊天页面的 DOM 结构（左栏+右区域+全部弹窗+右键菜单+浮窗） |
| `style.css` | 全局样式：布局、配色、圆角、阴影、动画、弹窗、上下文菜单、响应式 |
| `api.js` | 封装全部 HTTP 请求：`UserAPI`、`FriendAPI`、`GroupAPI`、`ChatAPI`、`ConvAPI`、`apiUpload()` |
| `ws.js` | WebSocket 客户端：`chatSocket` 对象，提供 `sendPrivate()`、`sendGroup()`、`connect()` |
| `ui.js` | 全部 UI 交互逻辑：会话渲染、消息气泡、右键菜单、加号菜单、好友资料、备注、撤回、弹窗控制 |
| `emoji.js` | 6 款表情的映射表 `EMOJI_MAP`，提供 `emojiReplace()` 函数 |

---

## 九、前端数据存储（localStorage）

| Key | 类型 | 内容 |
|-----|------|------|
| `access_token` | string | JWT 登录令牌 |
| `my_username` | string | 当前登录用户名 |
| `pinned_convs` | JSON Array | 置顶会话 ID 列表 `["private_张三","group_1"]` |
| `muted_convs` | JSON Array | 免打扰会话 ID 列表 |
| `deleted_convs` | JSON Array | 已删除的会话 ID 列表（本地隐藏） |
| `friend_notes` | JSON Object | 好友备注 `{"张三":"三哥","李四":""}` |

所有这些数据仅在浏览器本地存储，后端不知道。

---

## 十、后端如何提供前端页面

在 `main.py` 中：

```python
# 挂载静态文件
app.mount("/static", StaticFiles(directory="static"), name="static")

# 根路径重定向
@app.get("/")
async def root():
    return FileResponse("static/index.html")
```

用户访问 `http://127.0.0.1:8000/` → 加载 `static/index.html` → 登录后跳转 `static/chat.html`。

---

# 第三部分：如何添加新功能

---

## 场景 1：新增一个后端接口（例如「修改密码」）

1. 在 `api/` 下新建文件（或在已有的 `api/user.py` 中添加）：
```python
# api/user.py 中新增
@router.post("/change_password")
def change_password(body: ChangePwdReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(body.token)
    user = db.query(User).filter(User.id == current_uid).first()
    # ... 验旧密码、设新密码 ...
    return {"code": 200, "msg": "密码修改成功"}
```
2. 前端 `api.js` 中添加：
```javascript
UserAPI.changePassword = function(oldPwd, newPwd) {
    return apiPost("/user/change_password", {
        token: getToken(), old_password: oldPwd, new_password: newPwd
    });
};
```
3. 前端 `ui.js` 中添加触发逻辑（如加个按钮）。

---

## 场景 2：新增一张数据库表（例如「朋友圈动态」）

1. 在 `database/db.py` 末尾添加新模型：
```python
class Moment(Base):
    __tablename__ = "moment"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    content = Column(Text)
    create_at = Column(DateTime, default=datetime.now)
```
2. 重启服务 → `Base.metadata.create_all(bind=engine)` 自动创建新表。
3. 按「场景 1」的方式新增对应的 API 和前端代码。

---

## 场景 3：新增一个前端页面（例如「个人设置页」）

1. 新建 `static/settings.html`：
```html
<!DOCTYPE html>
<html><head><link rel="stylesheet" href="/static/css/style.css"></head>
<body>
  <h2>个人设置</h2>
  ...
  <script src="/static/js/api.js"></script>
</body></html>
```
2. 从 chat.html 添加导航链接跳转到这个页面。
3. 后端无需改动。

---

## 场景 4：添加新表情包

1. 后端 `utils/security.py`：在 `EMOJI_MAP` 字典中添加 `"[laugh]": "😂"`
2. 前端 `static/js/emoji.js`：在 `EMOJI_MAP` 中添加相同条目
3. 重启服务即可。

---

## 场景 5：修改前端配色

只改 `static/css/style.css` 中的颜色变量区（全文件搜索 `#07C160` 替换为新主色即可）。后端完全不受影响。

---

## 关键原则

| 原则 | 说明 |
|------|------|
| **后端不碰前端** | 所有 UI 改动只需改 `static/` 目录 |
| **前端不碰后端** | 所有 API/数据库改动只需改 `api/`、`database/`、`utils/` |
| **一张表一个模型** | 新数据表全部定义在 `database/db.py` 中，共享同一个 `Base` |
| **一个模块一个文件** | 每个功能模块在 `api/` 下独立一个 `.py` 文件，通过 `router` 注册 |
| **鉴权复用** | 所有接口共用 `get_current_user_from_token(token)` |
| **日志复用** | 所有模块共用 `from utils.logger import get_logger` |
