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
from database.db import engine, get_db, SessionLocal, Base, User, FriendRelation, ChatMessage, ChatGroup, GroupMember, UploadResource, LoginAttempt
from database.models.chat import GroupEvent, GroupJoinRequest, GroupMuteSetting
from database.models.friend import FriendRemark, FriendMuteSetting
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
    """根路径 — 产品 Landing Page"""
    return FileResponse("static/index.html")


@app.get("/login")
async def login_page():
    """登录/注册页面"""
    return FileResponse("static/login.html")

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
                        "id": str(new_msg.id),
                        "sender_username": current_username,
                        "sender_id": uid,
                        "content": content,
                        "message_type": message_type,
                        "create_at": new_msg.create_at.strftime("%Y-%m-%d %H:%M:%S")
                    }
                    await manager.send_personal_msg(target_uid, push_data)

                    # 回声给发送者：带上数据库 ID，用于撤回等操作
                    await websocket.send_json({
                        "type": "msg_sent_ack",
                        "temp_key": msg_data.get("temp_key", ""),
                        "message_id": str(new_msg.id)
                    })

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
                    # 校验群是否存在且未解散
                    group = db.query(ChatGroup).filter(ChatGroup.id == group_id).first()
                    if not group:
                        await websocket.send_json({"type": "error", "msg": "群聊不存在"})
                        continue
                    if group.is_disband == 1:
                        await websocket.send_json({"type": "error", "msg": "群聊已解散"})
                        continue

                    # 校验是否为群成员且未退群
                    is_member = db.query(GroupMember).filter(
                        GroupMember.group_id == group_id,
                        GroupMember.user_id == uid,
                        GroupMember.is_quit == 0
                    ).first()
                    if not is_member:
                        await websocket.send_json({"type": "error", "msg": "你不是该群成员"})
                        continue

                    # 检查是否被禁言
                    if is_member.mute_until and is_member.mute_until > datetime.now():
                        await websocket.send_json({
                            "type": "error",
                            "msg": f"你已被管理员禁言，截止 {is_member.mute_until.strftime('%m-%d %H:%M')}"
                        })
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

                    # 查询所有群成员（含已退群的也能收到历史消息，但推送只给在群成员）
                    members = db.query(GroupMember.user_id).filter(
                        GroupMember.group_id == group_id,
                        GroupMember.is_quit == 0
                    ).all()
                    member_ids = {m.user_id for m in members}

                    # 获取在线成员
                    online_members = manager.get_online_users() & member_ids

                    push_data = {
                        "type": "new_group_msg",
                        "id": str(new_msg.id),
                        "group_id": group_id,
                        "sender_username": current_username,
                        "sender_id": uid,
                        "content": content,
                        "message_type": message_type,
                        "create_at": new_msg.create_at.strftime("%Y-%m-%d %H:%M:%S")
                    }

                    # 广播给在线群成员
                    await manager.send_group_msg(group_id, uid, online_members, push_data)

                    # 回声给发送者：带上数据库 ID
                    await websocket.send_json({
                        "type": "msg_sent_ack",
                        "temp_key": msg_data.get("temp_key", ""),
                        "message_id": str(new_msg.id)
                    })

                    logger.info(f"[WS群聊] {current_username}({uid}) -> group({group_id}): {content[:30]} 送达{len(online_members)}人")
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

            # ========== 群管理系统通知广播 ==========
            elif msg_type == "group_sys_notify":
                gid = msg_data.get("group_id")
                notify_type = msg_data.get("notify_type", "")
                if gid and notify_type:
                    db2 = await asyncio.to_thread(get_sync_db)
                    try:
                        # 验证发送者是该群管理员或群主
                        group = db2.query(ChatGroup).filter(
                            ChatGroup.id == gid, ChatGroup.is_disband == 0
                        ).first()
                        if not group:
                            continue
                        is_owner = group.owner_id == uid
                        is_admin = is_owner or (group.admin_ids and uid in (group.admin_ids or []))
                        if not is_admin:
                            logger.warning(f"[WS群管理] 拒绝未授权通知 uid={uid} group_id={gid} notify_type={notify_type}")
                            continue

                        members = db2.query(GroupMember.user_id).filter(
                            GroupMember.group_id == gid, GroupMember.is_quit == 0
                        ).all()
                        member_ids = {m.user_id for m in members}
                        online = manager.get_online_users() & member_ids
                        notify_data = {
                            "type": "group_sys_notify",
                            "group_id": gid,
                            "notify_type": notify_type,
                            "operator_name": current_username,
                            "operator_id": uid,
                            "target_name": msg_data.get("target_name", ""),
                            "target_id": msg_data.get("target_id", 0),
                            "desc": msg_data.get("desc", ""),
                            "create_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        }
                        count = await manager.broadcast_to_group(gid, online, notify_data)
                        logger.info(f"[WS群管理] {notify_type} group_id={gid} operator={current_username} 送达{count}人")
                    finally:
                        db2.close()

            # ========== 撤回消息 ==========
            elif msg_type == "recall_msg":
                message_id = msg_data.get("message_id")
                target_username = msg_data.get("target_username", "")
                if not message_id or not target_username:
                    await websocket.send_json({"type": "error", "msg": "缺少 message_id 或 target_username"})
                    continue

                db = await asyncio.to_thread(get_sync_db)
                try:
                    target_user = db.query(User).filter(User.username == target_username).first()
                    if not target_user:
                        await websocket.send_json({"type": "error", "msg": "目标用户不存在"})
                        continue

                    msg = db.query(ChatMessage).filter(
                        ChatMessage.id == message_id, ChatMessage.sender_id == uid, ChatMessage.is_delete == 0
                    ).first()
                    if not msg:
                        await websocket.send_json({"type": "error", "msg": "消息不存在或已撤回"})
                        continue

                    # 检查3分钟内
                    if msg.create_at:
                        elapsed = (datetime.now() - msg.create_at).total_seconds()
                        if elapsed > 180:
                            await websocket.send_json({"type": "error", "msg": "超过3分钟，无法撤回"})
                            continue

                    msg.is_delete = 1
                    db.commit()

                    # 通知对方撤回
                    recall_data = {
                        "type": "msg_recalled",
                        "message_id": str(message_id),
                        "sender_username": current_username,
                        "target_username": target_username
                    }
                    await manager.send_personal_msg(target_user.id, recall_data)
                    # 也通知自己（多端同步）
                    await manager.send_personal_msg(uid, recall_data)

                    logger.info(f"[WS撤回] {current_username} 撤回了发给 {target_username} 的消息 msg_id={message_id}")
                except Exception as e:
                    await websocket.send_json({"type": "error", "msg": f"撤回失败: {str(e)}"})
                finally:
                    db.close()

            # ========== 用户上线注册（在线状态实时同步） ==========
            elif msg_type == "register":
                db3 = await asyncio.to_thread(get_sync_db)
                try:
                    # 查找该用户的所有在线好友，广播 online 状态
                    records = db3.query(FriendRelation).filter(
                        ((FriendRelation.user_id == uid) | (FriendRelation.friend_id == uid)),
                        FriendRelation.status == 1
                    ).all()
                    friend_ids = set()
                    for rel in records:
                        fid = rel.friend_id if rel.user_id == uid else rel.user_id
                        friend_ids.add(fid)
                    online_friends = manager.get_online_users() & friend_ids
                    # 更新自己的在线状态为 1
                    me = db3.query(User).filter(User.id == uid).first()
                    if me:
                        me.online_status = 1
                        db3.commit()
                    push = {"type": "status_update", "user_id": uid, "online": True}
                    logger.info(f"[WS register] uid={uid} 上线, 好友={list(friend_ids)}, 在线好友={list(online_friends)}, 广播: {push}")
                    for fid in online_friends:
                        await manager.send_personal_msg(fid, push)
                except Exception as e:
                    logger.error(f"[WS register] 失败: {e}")
                finally:
                    db3.close()

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