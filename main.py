from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from datetime import datetime
from typing import Optional
import asyncio
import json
import os
from jose import jwt, JWTError

# 数据库
from database.db import engine, get_db, SessionLocal, Base, User, FriendRelation, ChatMessage, ChatGroup, GroupMember, UploadResource
# 路由
from api.user import router as user_router
from api.friend import router as friend_router
from api.chat import router as chat_router
from api.group import router as group_router
from api.upload import router as upload_router
from api.conversation import router as conversation_router
# 工具
from utils.security import SECRET_KEY, ALGORITHM
from utils.ws_manager import manager
from utils.logger import get_logger

logger = get_logger("main")

# 初始化应用
app = FastAPI(title="聊天平台接口")

# CORS 跨域配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gzip 压缩（减少 ngrok 传输体积，加速远程访问）
app.add_middleware(GZipMiddleware, minimum_size=500)

# 确保上传目录存在
os.makedirs("static/uploads", exist_ok=True)

# 自动创建数据表（新增字段/新表会自动补充，不影响已有数据）
Base.metadata.create_all(bind=engine)

# 注册路由
app.include_router(user_router)
app.include_router(friend_router)
app.include_router(chat_router)
app.include_router(group_router)
app.include_router(upload_router)
app.include_router(conversation_router)

# 挂载静态文件目录
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    """根路径跳转到登录页"""
    return FileResponse("static/index.html")

# 同步数据库会话工具，通过 asyncio.to_thread 在后台线程执行，防止阻塞事件循环
def get_sync_db():
    """返回一个新的数据库会话，调用者负责关闭"""
    return SessionLocal()

# WebSocket 私聊端点
@app.websocket("/ws/chat")
async def websocket_chat_endpoint(websocket: WebSocket):
    # 1. 从 URL 参数获取 token
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008, reason="缺少 token")
        return

    # 2. 解析 token 获取当前用户
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        await websocket.close(code=1008, reason="无效 token")
        return
    uid = payload.get("uid")
    if not uid:
        await websocket.close(code=1008, reason="token 无效")
        return

    # 3. 接受 WebSocket 连接并注册到管理器
    await websocket.accept()
    await manager.connect(uid, websocket)

    # 获取当前用户名（用于后续推送）
    db = await asyncio.to_thread(get_sync_db)
    current_user = db.query(User).filter(User.id == uid).first()
    current_username = current_user.username if current_user else "未知"
    db.close()

    logger.info(f"[WS] 用户上线 uid={uid} username={current_username}")

    try:
        # 4. 循环接收消息（支持私聊 send_msg + 群聊 send_group_msg）
        while True:
            data = await websocket.receive_text()
            try:
                msg_data = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "msg": "消息格式无效，请使用 JSON"})
                continue

            msg_type = msg_data.get("type")
            content = msg_data.get("content", "")
            message_type = msg_data.get("message_type", 0)

            # ========== 私聊消息 ==========
            if msg_type == "send_msg":
                receiver_username = msg_data.get("receiver_username")
                if not receiver_username or not content:
                    await websocket.send_json({"type": "error", "msg": "缺少 receiver_username 或 content"})
                    continue

                db = await asyncio.to_thread(get_sync_db)
                try:
                    target_user = db.query(User).filter(User.username == receiver_username).first()
                    if not target_user:
                        await websocket.send_json({"type": "error", "msg": "目标用户不存在"})
                        continue

                    target_uid = target_user.id
                    if target_uid == uid:
                        await websocket.send_json({"type": "error", "msg": "不能给自己发送消息"})
                        continue

                    is_friend = db.query(FriendRelation).filter(
                        or_(
                            and_(FriendRelation.user_id == uid, FriendRelation.friend_id == target_uid, FriendRelation.status == 1),
                            and_(FriendRelation.user_id == target_uid, FriendRelation.friend_id == uid, FriendRelation.status == 1)
                        )
                    ).first()
                    if not is_friend:
                        await websocket.send_json({"type": "error", "msg": "你们不是好友，无法发送消息"})
                        continue

                    new_msg = ChatMessage(
                        sender_id=uid,
                        receiver_id=target_uid,
                        content=content,
                        is_read=0,
                        message_type=message_type,
                        create_at=datetime.now()
                    )
                    try:
                        db.add(new_msg)
                        db.commit()
                        db.refresh(new_msg)
                    except Exception:
                        db.rollback()
                        await websocket.send_json({"type": "error", "msg": "消息入库失败"})
                        continue

                    push_data = {
                        "type": "new_msg",
                        "sender_username": current_username,
                        "sender_id": uid,
                        "content": content,
                        "message_type": message_type,
                        "create_at": new_msg.create_at.strftime("%Y-%m-%d %H:%M:%S")
                    }
                    await manager.send_personal_msg(target_uid, push_data)

                    logger.info(f"[WS私聊] {current_username}({uid}) -> {receiver_username}({target_uid}): {content[:30]}")
                except Exception as e:
                    await websocket.send_json({"type": "error", "msg": f"消息发送失败: {str(e)}"})
                finally:
                    db.close()

            # ========== 群聊消息 ==========
            elif msg_type == "send_group_msg":
                group_id = msg_data.get("group_id")
                if not group_id or not content:
                    await websocket.send_json({"type": "error", "msg": "缺少 group_id 或 content"})
                    continue

                db = await asyncio.to_thread(get_sync_db)
                try:
                    # 校验群是否存在
                    group = db.query(ChatGroup).filter(ChatGroup.id == group_id).first()
                    if not group:
                        await websocket.send_json({"type": "error", "msg": "群聊不存在"})
                        continue

                    # 校验是否为群成员
                    is_member = db.query(GroupMember).filter(
                        GroupMember.group_id == group_id,
                        GroupMember.user_id == uid
                    ).first()
                    if not is_member:
                        await websocket.send_json({"type": "error", "msg": "你不是该群成员"})
                        continue

                    # 入库
                    new_msg = ChatMessage(
                        sender_id=uid,
                        group_id=group_id,
                        content=content,
                        is_read=0,
                        message_type=message_type,
                        create_at=datetime.now()
                    )
                    try:
                        db.add(new_msg)
                        db.commit()
                        db.refresh(new_msg)
                    except Exception:
                        db.rollback()
                        await websocket.send_json({"type": "error", "msg": "消息入库失败"})
                        continue

                    # 查询所有群成员
                    members = db.query(GroupMember.user_id).filter(
                        GroupMember.group_id == group_id
                    ).all()
                    member_ids = {m.user_id for m in members}

                    # 获取在线成员
                    online_members = manager.get_online_users() & member_ids

                    push_data = {
                        "type": "new_group_msg",
                        "group_id": group_id,
                        "sender_username": current_username,
                        "sender_id": uid,
                        "content": content,
                        "message_type": message_type,
                        "create_at": new_msg.create_at.strftime("%Y-%m-%d %H:%M:%S")
                    }

                    # 广播给在线群成员
                    await manager.send_group_msg(group_id, uid, online_members, push_data)

                    logger.info(f"[WS群聊] {current_username}({uid}) -> group({group_id}): {content[:30]} 送达{len(online_members & {uid})}/{len(online_members)}人")
                except Exception as e:
                    await websocket.send_json({"type": "error", "msg": f"群消息发送失败: {str(e)}"})
                finally:
                    db.close()

            # ========== 正在输入状态推送 ==========
            elif msg_type == "typing" or msg_type == "stop_typing":
                target_username = msg_data.get("target_username", "")
                if target_username:
                    db2 = await asyncio.to_thread(get_sync_db)
                    try:
                        target_user = db2.query(User).filter(User.username == target_username).first()
                        if target_user:
                            await manager.send_personal_msg(target_user.id, {
                                "type": msg_type,
                                "sender_username": current_username
                            })
                    finally:
                        db2.close()

            # ========== 标记已读（接收方打开会话时主动发送） ==========
            elif msg_type == "mark_read":
                target_username = msg_data.get("target_username", "")
                if target_username and manager.is_online(uid):
                    db2 = await asyncio.to_thread(get_sync_db)
                    try:
                        target_user = db2.query(User).filter(User.username == target_username).first()
                        if target_user:
                            # 只有接收方在线时才推送已读回执给发送方
                            await manager.send_personal_msg(target_user.id, {
                                "type": "read_receipt",
                                "reader_username": current_username
                            })
                    finally:
                        db2.close()

            # ========== 群聊标记已读 ==========
            elif msg_type == "group_mark_read":
                group_id = msg_data.get("group_id")
                if group_id and manager.is_online(uid):
                    db2 = await asyncio.to_thread(get_sync_db)
                    try:
                        members = db2.query(GroupMember.user_id).filter(GroupMember.group_id == group_id).all()
                        member_ids = {m.user_id for m in members}
                        online = manager.get_online_users() & member_ids
                        for mid in online:
                            if mid != uid:
                                await manager.send_personal_msg(mid, {
                                    "type": "group_read_update",
                                    "group_id": group_id,
                                    "reader_uid": uid,
                                    "reader_username": current_username
                                })
                    finally:
                        db2.close()

            # ========== 忽略未知消息类型（不报错） ==========

    except WebSocketDisconnect:
        # 连接断开，清理
        logger.info(f"[WS] 用户下线 uid={uid} username={current_username}")
        await manager.disconnect(uid)
    except Exception as e:
        # 其他异常，断开连接并清理
        logger.error(f"[WS] 异常断开 uid={uid} error={e}", exc_info=True)
        await manager.disconnect(uid)
        try:
            await websocket.close(code=1011, reason="内部错误")
        except Exception:
            pass

# 本地启动入口
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)