"""
会话列表模块
- 返回当前用户的所有私聊 + 群聊会话
- 按最后一条消息时间倒序排列
- 显示未读消息数量
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func
from typing import List

from database.db import get_db, User, FriendRelation, ChatMessage, ChatGroup, GroupMember
from utils.security import get_current_user_from_token
from utils.logger import get_logger

router = APIRouter(prefix="/conversation", tags=["会话列表"])
logger = get_logger("conversation")


@router.get("/list")
def get_conversation_list(token: str, db: Session = Depends(get_db)):
    """获取所有会话（私聊 + 群聊），按最后消息时间倒序"""
    current_uid = get_current_user_from_token(token)
    conversations = []

    # ========== 1. 私聊会话 ==========
    # 查询所有互为好友的用户
    friends_records = db.query(FriendRelation).filter(
        or_(
            and_(FriendRelation.user_id == current_uid, FriendRelation.status == 1),
            and_(FriendRelation.friend_id == current_uid, FriendRelation.status == 1)
        )
    ).all()

    friend_ids = set()
    for fr in friends_records:
        friend_ids.add(fr.friend_id if fr.user_id == current_uid else fr.user_id)

    # 对每个好友，查最后一条私聊消息和未读数
    for fid in friend_ids:
        friend = db.query(User).filter(User.id == fid).first()
        if not friend:
            continue

        # 最后一条消息
        last_msg = db.query(ChatMessage).filter(
            ChatMessage.group_id == None,
            or_(
                and_(ChatMessage.sender_id == current_uid, ChatMessage.receiver_id == fid),
                and_(ChatMessage.sender_id == fid, ChatMessage.receiver_id == current_uid)
            )
        ).order_by(ChatMessage.create_at.desc()).first()

        # 未读消息数（对方发给我的未读消息）
        unread = db.query(ChatMessage).filter(
            ChatMessage.group_id == None,
            ChatMessage.sender_id == fid,
            ChatMessage.receiver_id == current_uid,
            ChatMessage.is_read == 0
        ).count()

        # 好友的个性状态
        friend_status = friend.status_message or ""

        conversations.append({
            "type": "private",
            "target_id": fid,
            "name": friend.username,
            "last_msg": last_msg.content if last_msg else "",
            "last_time": last_msg.create_at.strftime("%Y-%m-%d %H:%M:%S") if last_msg and last_msg.create_at else "",
            "last_time_sort": last_msg.create_at.strftime("%Y%m%d%H%M%S") if last_msg and last_msg.create_at else "0",
            "unread": unread,
            "status_message": friend_status
        })

    # ========== 2. 群聊会话 ==========
    my_groups = db.query(GroupMember).filter(GroupMember.user_id == current_uid).all()
    for member in my_groups:
        group = db.query(ChatGroup).filter(ChatGroup.id == member.group_id).first()
        if not group:
            continue

        # 最后一条群消息
        last_msg = db.query(ChatMessage).filter(
            ChatMessage.group_id == group.id,
            ChatMessage.is_delete == 0
        ).order_by(ChatMessage.create_at.desc()).first()

        conversations.append({
            "type": "group",
            "target_id": group.id,
            "name": group.group_name,
            "last_msg": last_msg.content if last_msg else "",
            "last_time": last_msg.create_at.strftime("%Y-%m-%d %H:%M:%S") if last_msg and last_msg.create_at else "",
            "last_time_sort": last_msg.create_at.strftime("%Y%m%d%H%M%S") if last_msg and last_msg.create_at else "0",
            "unread": 0,
            "status_message": ""
        })

    # ========== 3. 排序 ==========
    conversations.sort(key=lambda x: x["last_time_sort"], reverse=True)

    # 移除排序辅助字段
    for c in conversations:
        del c["last_time_sort"]

    logger.info(f"会话列表查询 uid={current_uid} count={len(conversations)}")
    return {"code": 200, "data": conversations}
