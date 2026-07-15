"""
群聊模块接口
- 创建群聊
- 我的群列表
- 群成员列表
- 邀请好友入群（群主操作）
- 群聊历史消息
- 退出群聊
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from pydantic import BaseModel
from typing import List
from datetime import datetime

from database.db import get_db, User, FriendRelation, ChatMessage, ChatGroup, GroupMember
from utils.security import get_current_user_from_token
from utils.logger import get_logger

router = APIRouter(prefix="/group", tags=["群聊模块"])
logger = get_logger("group")


# ==================== 请求模型 ====================

class GroupCreateReq(BaseModel):
    token: str
    group_name: str = ""  # 群名称，为空时自动拼接成员名


class GroupInviteReq(BaseModel):
    token: str
    group_id: int
    friend_username: str


class GroupHistoryReq(BaseModel):
    token: str
    group_id: int


class GroupLeaveReq(BaseModel):
    token: str
    group_id: int


# ==================== 响应模型 ====================

class MessageItem(BaseModel):
    sender_name: str
    content: str
    message_type: int
    create_at: str


# ==================== 接口实现 ====================

@router.post("/create")
def create_group(req: GroupCreateReq, db: Session = Depends(get_db)):
    """创建群聊，自动将创建者加入群成员"""
    current_uid = get_current_user_from_token(req.token)

    # 群名称为空时使用默认名称
    group_name = req.group_name.strip() if req.group_name.strip() else f"群聊{datetime.now().strftime('%m%d%H%M')}"

    # 创建群
    new_group = ChatGroup(group_name=group_name, owner_id=current_uid)
    db.add(new_group)
    db.flush()  # 获取 group_id

    # 将群主加入成员表
    member = GroupMember(group_id=new_group.id, user_id=current_uid)
    db.add(member)
    db.commit()
    db.refresh(new_group)

    logger.info(f"群聊创建成功 group_id={new_group.id} group_name={group_name} owner_uid={current_uid}")
    return {"code": 200, "msg": "群聊创建成功", "group_id": new_group.id, "group_name": group_name}


@router.get("/list")
def get_group_list(token: str, db: Session = Depends(get_db)):
    """获取当前用户所在的全部群聊"""
    current_uid = get_current_user_from_token(token)

    # 查询用户加入的所有群
    memberships = db.query(GroupMember.group_id).filter(
        GroupMember.user_id == current_uid
    ).subquery()

    groups = db.query(ChatGroup).filter(ChatGroup.id.in_(memberships)).order_by(ChatGroup.create_at.desc()).all()

    data = [
        {
            "group_id": g.id,
            "group_name": g.group_name,
            "owner_id": g.owner_id,
            "create_at": g.create_at.strftime("%Y-%m-%d %H:%M:%S") if g.create_at else ""
        }
        for g in groups
    ]
    return {"code": 200, "data": data}


@router.get("/members")
def get_group_members(token: str, group_id: int, db: Session = Depends(get_db)):
    """获取群成员列表"""
    current_uid = get_current_user_from_token(token)

    # 验证群存在
    group = db.query(ChatGroup).filter(ChatGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")

    # 查询所有成员
    members = db.query(GroupMember, User.username).join(
        User, GroupMember.user_id == User.id
    ).filter(GroupMember.group_id == group_id).all()

    data = [
        {
            "user_id": member.user_id,
            "username": username,
            "is_owner": member.user_id == group.owner_id,
            "join_at": member.create_at.strftime("%Y-%m-%d %H:%M:%S") if member.create_at else ""
        }
        for member, username in members
    ]
    return {"code": 200, "data": data}


@router.post("/join")
def invite_member(req: GroupInviteReq, db: Session = Depends(get_db)):
    """邀请好友入群（仅群主可操作）"""
    current_uid = get_current_user_from_token(req.token)

    # 验证群存在
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")

    # 仅群主可邀请
    if group.owner_id != current_uid:
        raise HTTPException(status_code=403, detail="仅群主可邀请成员")

    # 查找目标用户
    target = db.query(User).filter(User.username == req.friend_username).first()
    if not target:
        raise HTTPException(status_code=400, detail="该用户不存在")

    # 验证是否为好友
    is_friend = db.query(FriendRelation).filter(
        or_(
            and_(FriendRelation.user_id == current_uid, FriendRelation.friend_id == target.id, FriendRelation.status == 1),
            and_(FriendRelation.user_id == target.id, FriendRelation.friend_id == current_uid, FriendRelation.status == 1)
        )
    ).first()
    if not is_friend:
        raise HTTPException(status_code=400, detail="只能邀请好友入群")

    # 验证是否已在群中
    exist = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id,
        GroupMember.user_id == target.id
    ).first()
    if exist:
        raise HTTPException(status_code=400, detail="该用户已在群中")

    # 加入群
    member = GroupMember(group_id=req.group_id, user_id=target.id)
    db.add(member)
    db.commit()

    logger.info(f"邀请入群 group_id={req.group_id} inviter_uid={current_uid} new_uid={target.id}")
    return {"code": 200, "msg": f"已将 {target.username} 拉入群聊"}


@router.post("/history")
def get_group_history(req: GroupHistoryReq, db: Session = Depends(get_db)):
    """获取群聊历史消息"""
    current_uid = get_current_user_from_token(req.token)

    # 验证群存在
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")

    # 验证是否为群成员
    is_member = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id,
        GroupMember.user_id == current_uid
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="你不是该群成员")

    # 查询群消息，按时间升序
    messages = db.query(ChatMessage).filter(
        ChatMessage.group_id == req.group_id,
        ChatMessage.is_delete == 0
    ).order_by(ChatMessage.create_at.asc()).all()

    # 获取所有发送者用户名
    user_ids = set(msg.sender_id for msg in messages)
    users = db.query(User.id, User.username).filter(User.id.in_(user_ids)).all()
    user_map = {u.id: u.username for u in users}

    data = []
    for msg in messages:
        data.append({
            "sender_name": user_map.get(msg.sender_id, "未知用户"),
            "sender_id": msg.sender_id,
            "content": msg.content,
            "message_type": msg.message_type,
            "create_at": msg.create_at.strftime("%Y-%m-%d %H:%M:%S") if msg.create_at else ""
        })

    logger.info(f"查询群聊历史 group_id={req.group_id} uid={current_uid} count={len(data)}")
    return {"code": 200, "data": data}


@router.post("/leave")
def leave_group(req: GroupLeaveReq, db: Session = Depends(get_db)):
    """退出群聊"""
    current_uid = get_current_user_from_token(req.token)

    # 验证群存在
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")

    # 群主不能退群（可以解散，此处简化处理：群主可退群，但退出后群无群主）
    member = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id,
        GroupMember.user_id == current_uid
    ).first()
    if not member:
        raise HTTPException(status_code=400, detail="你不在该群中")

    db.delete(member)
    db.commit()

    logger.info(f"退出群聊 group_id={req.group_id} uid={current_uid}")
    return {"code": 200, "msg": "已退出群聊"}
