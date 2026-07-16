from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from datetime import datetime
from typing import List
from pydantic import BaseModel
from jose import jwt, JWTError

from database.db import get_db, User, FriendRelation, ChatMessage
from utils.security import SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/chat", tags=["聊天模块"])

class HistoryRequest(BaseModel):
    token: str
    target_username: str

class MessageItem(BaseModel):
    sender_name: str
    sender_avatar: str = ""
    content: str
    message_type: int
    create_at: str

class HistoryResponse(BaseModel):
    code: int
    data: List[MessageItem]

@router.post("/history", response_model=HistoryResponse)
async def get_chat_history(req: HistoryRequest, db: Session = Depends(get_db)):
    # 1. 解析 token
    try:
        payload = jwt.decode(req.token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="无效 token")
    current_uid = payload.get("uid")
    if not current_uid:
        raise HTTPException(status_code=401, detail="token 缺少用户信息")

    # 2. 查询目标用户
    target_user = db.query(User).filter(User.username == req.target_username).first()
    if not target_user:
        raise HTTPException(status_code=400, detail="目标用户不存在")
    target_uid = target_user.id

    # 3. 校验好友关系（双向任一确认即可）
    is_friend = db.query(FriendRelation).filter(
        or_(
            and_(FriendRelation.user_id == current_uid, FriendRelation.friend_id == target_uid, FriendRelation.status == 1),
            and_(FriendRelation.user_id == target_uid, FriendRelation.friend_id == current_uid, FriendRelation.status == 1)
        )
    ).first()
    if not is_friend:
        raise HTTPException(status_code=400, detail="非好友关系，不能查看聊天记录")

    # 4. 将当前用户作为接收方且未读的消息全部标记为已读
    db.query(ChatMessage).filter(
        ChatMessage.receiver_id == current_uid,
        ChatMessage.sender_id == target_uid,
        ChatMessage.is_read == 0
    ).update({ChatMessage.is_read: 1})
    db.commit()

    # 5. 查询双方全部聊天记录（双向），按时间升序
    messages = db.query(ChatMessage).filter(
        or_(
            and_(ChatMessage.sender_id == current_uid, ChatMessage.receiver_id == target_uid),
            and_(ChatMessage.sender_id == target_uid, ChatMessage.receiver_id == current_uid)
        )
    ).order_by(ChatMessage.create_at.asc()).all()

    # 6. 组装返回数据
    # 获取所有涉及的用户名映射（避免多次查询）
    user_ids = set()
    for msg in messages:
        user_ids.add(msg.sender_id)
        user_ids.add(msg.receiver_id)
    users = db.query(User.id, User.username, User.avatar).filter(User.id.in_(user_ids)).all()
    user_map = {u.id: u.username for u in users}
    avatar_map = {u.id: u.avatar or "" for u in users}

    data = []
    for msg in messages:
        sender_name = user_map.get(msg.sender_id, "未知用户")
        data.append(MessageItem(
            sender_name=sender_name,
            sender_avatar=avatar_map.get(msg.sender_id, ""),
            content=msg.content,
            message_type=msg.message_type,
            create_at=msg.create_at.strftime("%Y-%m-%d %H:%M:%S")
        ))

    return HistoryResponse(code=200, data=data)