# 💬 ChatPlatform — 简易聊天平台

一个基于 **FastAPI + WebSocket + 原生前端** 的实时聊天应用，支持私聊、群聊、表情、文件上传等功能，前端采用微信风格设计。

---

## ✨ 功能特性

| 模块 | 功能 |
|------|------|
| **用户系统** | 注册、登录、JWT 鉴权（24h 有效期） |
| **好友系统** | 搜索用户、发送申请、同意/拒绝、好友列表、备注、免打扰 |
| **私聊** | 实时消息、文本/图片/文件/表情、消息撤回（2min）、已读回执、输入状态 |
| **群聊** | 创建群、邀请成员、群公告、管理员、禁言、踢人、退群/解散、入群验证 |
| **会话列表** | 私聊+群聊聚合、按时间排序、未读计数、置顶、免打扰 |
| **文件上传** | 图片（≤10MB）+ 文件（≤50MB），JPG/PNG/PDF/Word/Excel/PPT |
| **表情系统** | 6 款内置表情 + 自定义表情面板 |
| **头像系统** | 用户头像 + 群头像，全平台可见 |
| **Landing Page** | Unicorn Studio WebGL 动画背景 + 玻璃拟态设计 |

---

## 🚀 快速开始

### 环境要求

- Python 3.10+
- MySQL 8.0
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)（可选，用于公网访问）

### 1. 克隆并进入项目

```bash
git clone <repo-url>
cd chatplatform
```

### 2. 创建虚拟环境

```bash
python -m venv venv
venv\Scripts\activate      # Windows
# source venv/bin/activate  # macOS / Linux
```

### 3. 安装依赖

```bash
pip install fastapi uvicorn sqlalchemy pymysql python-jose passlib bcrypt python-dotenv python-multipart
```

### 4. 配置数据库

编辑 `.env` 文件：

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=chat_system
```

确保 MySQL 中已创建 `chat_system` 数据库（表会在首次启动时自动创建）。

### 5. 启动服务

**Windows — 一键启动：**

双击 `start_server.bat`，自动完成：
1. 数据库迁移检查
2. 启动后端（`127.0.0.1:8000`）
3. 启动 Cloudflare Tunnel（生成公网 URL）

**手动启动：**

```bash
# 数据库迁移
python migrate_db.py

# 启动服务
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### 6. 访问

| 地址 | 说明 |
|------|------|
| `http://127.0.0.1:8000/` | Landing Page |
| `http://127.0.0.1:8000/login` | 登录/注册页 |
| `http://127.0.0.1:8000/docs` | API 自动文档（Swagger） |

---

## 📁 项目结构

```
chatplatform/
├── main.py                    # 应用入口：FastAPI + WebSocket + 路由注册
├── .env                       # 数据库连接配置
├── start_server.bat           # Windows 一键启动脚本
├── migrate_db.py              # 数据库迁移脚本
├── requirements.txt           # Python 依赖
│
├── database/
│   ├── db.py                  # SQLAlchemy 引擎 + 7 张核心表模型
│   └── models/
│       ├── chat.py            # 群事件/入群申请/群免打扰（3 张表）
│       └── friend.py          # 好友备注/好友免打扰（2 张表）
│
├── api/
│   ├── user.py                # 注册/登录/改密码/改头像/改状态
│   ├── friend.py              # 好友申请/处理/列表/搜索/备注/免打扰
│   ├── chat.py                # 私聊历史记录
│   ├── group.py               # 群创建/邀请/列表/成员/管理/解散
│   ├── upload.py              # 文件/图片上传
│   └── conversation.py        # 会话列表聚合
│
├── utils/
│   ├── security.py            # JWT/密码加密/表情包数据
│   ├── ws_manager.py          # WebSocket 连接管理器
│   └── logger.py              # 日志系统（控制台 + 文件轮转）
│
├── static/
│   ├── index.html             # Landing Page（WebGL 动画背景）
│   ├── login.html             # 登录/注册页（数字生命体 SVG 交互）
│   ├── chat.html              # 主聊天页（微信风格双栏布局）
│   ├── css/
│   │   ├── style.css          # 聊天页全局样式（微信绿 #07C160）
│   │   ├── landing.css        # Landing Page 样式
│   │   └── auth.css           # 登录页样式
│   ├── js/
│   │   ├── api.js             # HTTP 接口封装
│   │   ├── ws.js              # WebSocket 客户端
│   │   ├── ui.js              # 聊天页全部交互逻辑
│   │   ├── emoji.js           # 表情映射与渲染
│   │   ├── landing.js         # Landing Page 交互
│   │   ├── galaxy-bg.js       # 星系背景动画
│   │   └── auth-interact.js   # 登录页 SVG 交互动画
│   └── uploads/               # 用户上传文件存储
│
└── logs/
    └── app.log                # 运行日志
```

---

## 🛠 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **Web 框架** | FastAPI 0.100+ | 异步 HTTP + WebSocket，自动生成 /docs |
| **ASGI** | Uvicorn | 异步服务器，支持热重载 |
| **数据库** | MySQL 8.0 + SQLAlchemy 2.0 | ORM 映射，连接池 20 |
| **认证** | JWT (python-jose) | HS256，24h 有效期 |
| **密码** | passlib + bcrypt | 加盐哈希 |
| **实时通信** | FastAPI WebSocket | 私聊推送 + 群聊广播 |
| **前端** | 原生 HTML/CSS/JS | 零框架，零构建工具 |
| **隧道** | cloudflared | 公网访问（可选） |

---

## 🔌 API 概览

| 模块 | 路径前缀 | 接口数 | 说明 |
|------|----------|--------|------|
| 用户 | `/user` | 5 | 注册、登录、改密、改头像、改状态 |
| 好友 | `/friend` | 8 | 申请、处理、列表、搜索、备注、免打扰 |
| 聊天 | `/chat` | 1 | 私聊历史记录 |
| 群聊 | `/group` | 12 | 创建、管理、成员、入群验证、禁言、解散 |
| 上传 | `/upload` | 1 | 文件/图片上传 |
| 会话 | `/conversation` | 1 | 聚合会话列表 |
| WebSocket | `/ws/chat` | 1 | 实时消息推送 |

完整 API 文档见 `http://127.0.0.1:8000/docs`（启动后访问）。

---

## 🎨 设计系统

- **主色调**：微信绿 `#07C160`
- **聊天页**：纯白极简 + 绿色气泡（自己）+ 白色气泡（对方）+ CSS 三角尾巴
- **Landing Page**：Unicorn Studio WebGL 粒子动画 + 玻璃拟态卡片
- **登录页**：SVG 数字生命体角色 + 眼睛跟踪鼠标 + 输入框交互动画

---

## ⚠️ 注意事项

- 所有接口需要通过 JWT token 鉴权（注册/登录除外）
- 私聊消息仅好友之间可发送
- 上传文件保存在 `static/uploads/` 按日期分目录
- 前端使用 `localStorage` 存储置顶/免打扰/已删除会话等本地偏好
- 消息撤回仅限发送后 2 分钟内
- 群管理操作（踢人/禁言/设管理）需要群主或管理员权限
