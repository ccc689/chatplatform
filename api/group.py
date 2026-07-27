"""
群聊模块接口 — 完整群管理（三级权限：群主 > 管理员 > 普通成员）
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta

from database.db import get_db, User, FriendRelation, ChatMessage, ChatGroup, GroupMember
from database.models.chat import GroupEvent, GroupJoinRequest, GroupMuteSetting
from utils.security import get_current_user_from_token
from utils.ws_manager import manager
from utils.logger import get_logger

router = APIRouter(prefix="/group", tags=["群聊模块"])
logger = get_logger("group")


# ==================== 权限辅助函数 ====================

def _get_member_role(group_id: int, user_id: int, group: ChatGroup, db: Session) -> str:
    """返回用户在该群的角色: 'owner' | 'admin' | 'member' | None(不在群)"""
    if group.owner_id == user_id:
        return "owner"
    admin_ids = group.admin_ids or []
    if user_id in admin_ids:
        return "admin"
    member = db.query(GroupMember).filter(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
        GroupMember.is_quit == 0
    ).first()
    if member:
        return "member"
    return None


def _check_role(role: str, required: str) -> bool:
    """权限等级: owner=3, admin=2, member=1"""
    levels = {"owner": 3, "admin": 2, "member": 1}
    return levels.get(role, 0) >= levels.get(required, 0)


def _log_event(db: Session, group_id: int, event_type: str, operator_id: int, target_id: int = None, extra_info: str = ""):
    """记录群事件日志"""
    ev = GroupEvent(
        group_id=group_id,
        event_type=event_type,
        operator_id=operator_id,
        target_id=target_id,
        extra_info=extra_info
    )
    db.add(ev)


def _get_user_map(db: Session, user_ids: set) -> dict:
    """批量获取用户ID->用户名映射"""
    if not user_ids:
        return {}
    users = db.query(User.id, User.username).filter(User.id.in_(user_ids)).all()
    return {u.id: u.username for u in users}


# ==================== 请求模型 ====================

class GroupCreateReq(BaseModel):
    token: str
    group_name: str = ""


class GroupOpReq(BaseModel):
    """通用群操作请求（需要操作权限的接口）"""
    token: str
    group_id: int


class GroupMemberOpReq(BaseModel):
    """对成员操作（踢人/禁言/设置管理员）"""
    token: str
    group_id: int
    target_uid: int


class GroupMuteReq(BaseModel):
    token: str
    group_id: int
    target_uid: int
    duration: str = "5m"  # 5m/30m/2h/forever


class GroupTransferReq(BaseModel):
    token: str
    group_id: int
    new_owner_uid: int


class GroupUpdateReq(BaseModel):
    token: str
    group_id: int
    group_name: Optional[str] = None
    avatar: Optional[str] = None
    announcement: Optional[str] = None
    join_mode: Optional[int] = None


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


class GroupApplyDealReq(BaseModel):
    token: str
    request_id: int
    operate: int  # 1同意 0拒绝


# ==================== 接口实现 ====================

# ---------- 创建群聊 ----------
@router.post("/create")
def create_group(req: GroupCreateReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    group_name = req.group_name.strip() if req.group_name.strip() else f"群聊{datetime.now().strftime('%m%d%H%M')}"

    new_group = ChatGroup(
        group_name=group_name,
        owner_id=current_uid,
        admin_ids=[]
    )
    db.add(new_group)
    db.flush()

    member = GroupMember(group_id=new_group.id, user_id=current_uid, role=2)  # 群主=role 2
    db.add(member)
    _log_event(db, new_group.id, "join", current_uid, current_uid)
    db.commit()
    db.refresh(new_group)

    logger.info(f"群聊创建成功 group_id={new_group.id} group_name={group_name} owner_uid={current_uid}")
    return {"code": 200, "msg": "群聊创建成功", "group_id": new_group.id, "group_name": group_name}


# ---------- 群列表 ----------
@router.get("/list")
def get_group_list(token: str, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(token)
    memberships = db.query(GroupMember.group_id).filter(
        GroupMember.user_id == current_uid,
        GroupMember.is_quit == 0
    ).subquery()
    groups = db.query(ChatGroup).filter(
        ChatGroup.id.in_(memberships),
        ChatGroup.is_disband == 0
    ).order_by(ChatGroup.create_at.desc()).all()

    data = [{
        "group_id": g.id, "group_name": g.group_name, "owner_id": g.owner_id,
        "admin_ids": g.admin_ids or [], "avatar": g.avatar or "",
        "join_mode": g.join_mode if g.join_mode is not None else 1,
        "create_at": g.create_at.strftime("%Y-%m-%d %H:%M:%S") if g.create_at else ""
    } for g in groups]
    return {"code": 200, "data": data}


# ---------- 群成员列表（按角色分层） ----------
@router.get("/members")
def get_group_members(token: str, group_id: int, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(token)
    group = db.query(ChatGroup).filter(ChatGroup.id == group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    members = db.query(GroupMember, User.username, User.avatar).join(
        User, GroupMember.user_id == User.id
    ).filter(GroupMember.group_id == group_id, GroupMember.is_quit == 0).all()

    my_role = _get_member_role(group_id, current_uid, group, db)
    if my_role is None:
        raise HTTPException(status_code=403, detail="你不是该群成员")

    data = []
    for member, username, avatar in members:
        role = _get_member_role(group_id, member.user_id, group, db)
        is_muted = member.mute_until and member.mute_until > datetime.now()
        data.append({
            "user_id": member.user_id, "username": username, "avatar": avatar or "",
            "role": role, "is_muted": is_muted,
            "mute_until": member.mute_until.strftime("%Y-%m-%d %H:%M:%S") if is_muted else None,
            "join_at": member.create_at.strftime("%Y-%m-%d %H:%M:%S") if member.create_at else ""
        })

    # 排序: 群主 > 管理员 > 普通成员
    role_order = {"owner": 0, "admin": 1, "member": 2}
    data.sort(key=lambda x: role_order.get(x["role"], 3))
    return {"code": 200, "data": data, "my_role": my_role}


# ---------- 邀请好友入群（统一流程：邀请 → 被邀请者同意 → 入群） ----------
@router.post("/join")
def invite_member(req: GroupInviteReq, db: Session = Depends(get_db)):
    """邀请好友入群。无论 join_mode 是什么，都需要被邀请者同意后才能入群。
    join_mode=0(自由加入): 邀请直接等待被邀请者同意(status=3)
    join_mode=1(需验证):   邀请需管理员审批(status=0)，审批通过(status=3)后被邀请者同意
    """
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    my_role = _get_member_role(req.group_id, current_uid, group, db)
    if my_role is None:
        raise HTTPException(status_code=403, detail="你不是该群成员")

    target = db.query(User).filter(User.username == req.friend_username).first()
    if not target:
        raise HTTPException(status_code=400, detail="该用户不存在")

    # 验证是否为好友关系
    is_friend = db.query(FriendRelation).filter(
        or_(
            and_(FriendRelation.user_id == current_uid, FriendRelation.friend_id == target.id, FriendRelation.status == 1),
            and_(FriendRelation.user_id == target.id, FriendRelation.friend_id == current_uid, FriendRelation.status == 1)
        )
    ).first()
    if not is_friend:
        raise HTTPException(status_code=400, detail="只能邀请好友入群")

    exist = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == target.id, GroupMember.is_quit == 0
    ).first()
    if exist:
        raise HTTPException(status_code=400, detail="该用户已在群内")

    # 检查是否有待处理的邀请
    req_exist = db.query(GroupJoinRequest).filter(
        GroupJoinRequest.group_id == req.group_id,
        GroupJoinRequest.applicant_id == target.id,
        GroupJoinRequest.status.in_([0, 3])
    ).first()
    if req_exist:
        raise HTTPException(status_code=400, detail="已有待处理的入群邀请")

    inviter_name = db.query(User.username).filter(User.id == current_uid).scalar() or "未知"

    if group.join_mode == 1:
        # 需验证模式：status=0 等待管理员审批
        jr = GroupJoinRequest(group_id=req.group_id, applicant_id=target.id, inviter_id=current_uid, status=0)
        db.add(jr)
        db.commit()
        # 通知管理员有新的入群申请
        try:
            admin_ids = set(group.admin_ids or [])
            admin_ids.add(group.owner_id)
            online_admins = manager.get_online_users() & admin_ids
            for aid in online_admins:
                if aid != current_uid:
                    manager.notify_user(aid, {
                        "type": "group_sys_notify", "group_id": req.group_id,
                        "notify_type": "invite_pending", "operator_name": inviter_name,
                        "target_name": target.username,
                        "desc": f"{inviter_name} 邀请了 {target.username} 入群，等待审批"
                    })
        except Exception:
            pass
        logger.info(f"入群邀请(需审批) group_id={req.group_id} inviter={inviter_name} target={target.username}")
        return {"code": 200, "msg": "入群邀请已发送，等待管理员审批通过后由被邀请者确认"}
    else:
        # 自由加入模式：status=3 直接等待被邀请者同意
        jr = GroupJoinRequest(group_id=req.group_id, applicant_id=target.id, inviter_id=current_uid, status=3)
        db.add(jr)
        db.commit()
        # 实时通知被邀请者
        try:
            manager.notify_user(target.id, {
                "type": "group_sys_notify", "group_id": req.group_id,
                "notify_type": "invite", "operator_name": inviter_name,
                "target_name": target.username,
                "desc": f"{inviter_name} 邀请你加入群聊「{group.group_name}」"
            })
        except Exception:
            pass
        logger.info(f"入群邀请(自由加入) group_id={req.group_id} inviter={inviter_name} target={target.username}")
        return {"code": 200, "msg": f"已向 {target.username} 发送入群邀请，等待对方同意"}


# ---------- 群历史消息 ----------
@router.post("/history")
def get_group_history(req: GroupHistoryReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    is_member = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == current_uid, GroupMember.is_quit == 0
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="你不是该群成员")

    messages = db.query(ChatMessage).filter(
        ChatMessage.group_id == req.group_id, ChatMessage.is_delete == 0
    ).order_by(ChatMessage.create_at.asc()).all()

    user_ids = set(msg.sender_id for msg in messages)
    user_map = _get_user_map(db, user_ids)
    # 获取头像映射
    users = db.query(User.id, User.avatar).filter(User.id.in_(user_ids)).all()
    avatar_map = {u.id: u.avatar or "" for u in users}

    data = [{
        "sender_name": user_map.get(msg.sender_id, "未知用户"),
        "sender_id": msg.sender_id,
        "sender_avatar": avatar_map.get(msg.sender_id, ""),
        "content": msg.content,
        "message_type": msg.message_type,
        "create_at": msg.create_at.strftime("%Y-%m-%d %H:%M:%S") if msg.create_at else ""
    } for msg in messages]

    logger.info(f"查询群聊历史 group_id={req.group_id} uid={current_uid} count={len(data)}")
    return {"code": 200, "data": data}


# ---------- 退出群聊 ----------
@router.post("/leave")
def leave_group(req: GroupLeaveReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    if group.owner_id == current_uid:
        raise HTTPException(status_code=400, detail="群主不能退群，请先转让群主或解散群聊")

    member = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == current_uid, GroupMember.is_quit == 0
    ).first()
    if not member:
        raise HTTPException(status_code=400, detail="你不在该群中")

    member.is_quit = 1
    # 如果退出者是管理员，从admin_ids移除
    admin_ids = group.admin_ids or []
    if current_uid in admin_ids:
        admin_ids.remove(current_uid)
        group.admin_ids = admin_ids
    _log_event(db, req.group_id, "leave", current_uid, current_uid)
    db.commit()
    logger.info(f"退出群聊 group_id={req.group_id} uid={current_uid}")
    return {"code": 200, "msg": "已退出群聊"}


# ========== 群主专属接口 ==========

# ---------- 转让群主 ----------
@router.post("/transfer")
def transfer_owner(req: GroupTransferReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    if group.owner_id != current_uid:
        raise HTTPException(status_code=403, detail="仅群主可转让群主")

    # 新群主必须是管理员
    admin_ids = group.admin_ids or []
    if req.new_owner_uid not in admin_ids:
        raise HTTPException(status_code=400, detail="只能转让给群管理员")

    # 验证新群主在群内
    target_member = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == req.new_owner_uid, GroupMember.is_quit == 0
    ).first()
    if not target_member:
        raise HTTPException(status_code=400, detail="目标用户不在群中")

    old_owner = group.owner_id
    # 转让: 旧群主降为管理员，新群主升为群主
    if old_owner not in admin_ids:
        admin_ids.append(old_owner)
    admin_ids.remove(req.new_owner_uid)
    group.owner_id = req.new_owner_uid
    group.admin_ids = admin_ids

    # 更新 role
    old_owner_member = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == old_owner
    ).first()
    if old_owner_member:
        old_owner_member.role = 1  # 降为管理员
    target_member.role = 2  # 升为群主

    _log_event(db, req.group_id, "transfer_owner", current_uid, req.new_owner_uid)
    db.commit()

    user_map = _get_user_map(db, {old_owner, req.new_owner_uid})
    logger.info(f"转让群主 group_id={req.group_id} {user_map.get(old_owner)} -> {user_map.get(req.new_owner_uid)}")
    return {"code": 200, "msg": "群主转让成功"}


# ---------- 解散群聊 ----------
@router.post("/disband")
def disband_group(req: GroupOpReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    if group.owner_id != current_uid:
        raise HTTPException(status_code=403, detail="仅群主可解散群聊")

    group.is_disband = 1
    _log_event(db, req.group_id, "disband", current_uid)
    db.commit()
    logger.info(f"群聊已解散 group_id={req.group_id} uid={current_uid}")
    return {"code": 200, "msg": "群聊已解散"}


# ---------- 添加/撤销管理员 ----------
@router.post("/admin/set")
def set_admin(req: GroupMemberOpReq, db: Session = Depends(get_db)):
    """将普通成员设为管理员"""
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    if group.owner_id != current_uid:
        raise HTTPException(status_code=403, detail="仅群主可设置管理员")

    if req.target_uid == group.owner_id:
        raise HTTPException(status_code=400, detail="群主已是最高权限")

    target = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == req.target_uid, GroupMember.is_quit == 0
    ).first()
    if not target:
        raise HTTPException(status_code=400, detail="目标用户不在群中")

    admin_ids = group.admin_ids or []
    if req.target_uid in admin_ids:
        raise HTTPException(status_code=400, detail="该用户已是管理员")

    admin_ids.append(req.target_uid)
    group.admin_ids = admin_ids
    target.role = 1
    _log_event(db, req.group_id, "set_admin", current_uid, req.target_uid)
    db.commit()

    logger.info(f"设置管理员 group_id={req.group_id} target_uid={req.target_uid}")
    return {"code": 200, "msg": "已设为管理员"}


@router.post("/admin/revoke")
def revoke_admin(req: GroupMemberOpReq, db: Session = Depends(get_db)):
    """撤销管理员权限"""
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    if group.owner_id != current_uid:
        raise HTTPException(status_code=403, detail="仅群主可撤销管理员")

    admin_ids = group.admin_ids or []
    if req.target_uid not in admin_ids:
        raise HTTPException(status_code=400, detail="该用户不是管理员")

    admin_ids.remove(req.target_uid)
    group.admin_ids = admin_ids

    target = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == req.target_uid
    ).first()
    if target:
        target.role = 0

    _log_event(db, req.group_id, "revoke_admin", current_uid, req.target_uid)
    db.commit()

    logger.info(f"撤销管理员 group_id={req.group_id} target_uid={req.target_uid}")
    return {"code": 200, "msg": "已撤销管理员权限"}


# ========== 群主 & 管理员共有接口 ==========

# ---------- 移出群成员 ----------
@router.post("/kick")
def kick_member(req: GroupMemberOpReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    my_role = _get_member_role(req.group_id, current_uid, group, db)
    if not _check_role(my_role, "admin"):
        raise HTTPException(status_code=403, detail="权限不足")

    target_role = _get_member_role(req.group_id, req.target_uid, group, db)
    if target_role is None:
        raise HTTPException(status_code=400, detail="目标用户不在群中")
    if _check_role(target_role, "admin"):
        raise HTTPException(status_code=400, detail="不能踢出管理员或群主")
    if req.target_uid == current_uid:
        raise HTTPException(status_code=400, detail="不能踢出自己")

    target = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == req.target_uid
    ).first()
    target.is_quit = 1
    _log_event(db, req.group_id, "kick", current_uid, req.target_uid)
    db.commit()

    logger.info(f"移出群成员 group_id={req.group_id} target_uid={req.target_uid} by={current_uid}")
    return {"code": 200, "msg": "已移出群聊"}


# ---------- 禁言/解除禁言 ----------
@router.post("/mute")
def mute_member(req: GroupMuteReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    my_role = _get_member_role(req.group_id, current_uid, group, db)
    if not _check_role(my_role, "admin"):
        raise HTTPException(status_code=403, detail="权限不足")

    target_role = _get_member_role(req.group_id, req.target_uid, group, db)
    if target_role is None:
        raise HTTPException(status_code=400, detail="目标用户不在群中")
    if _check_role(target_role, "admin"):
        raise HTTPException(status_code=400, detail="不能禁言管理员或群主")

    # 计算禁言截止时间
    duration_map = {"5m": 5, "30m": 30, "2h": 120, "forever": 525600}  # forever=365天
    minutes = duration_map.get(req.duration, 5)
    mute_until = datetime.now() + timedelta(minutes=minutes)

    target = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == req.target_uid
    ).first()
    target.mute_until = mute_until
    _log_event(db, req.group_id, "mute", current_uid, req.target_uid, req.duration)
    db.commit()

    logger.info(f"禁言 group_id={req.group_id} target_uid={req.target_uid} duration={req.duration}")
    return {"code": 200, "msg": f"已禁言{req.duration}", "mute_until": mute_until.strftime("%Y-%m-%d %H:%M:%S")}


@router.post("/unmute")
def unmute_member(req: GroupMemberOpReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    my_role = _get_member_role(req.group_id, current_uid, group, db)
    if not _check_role(my_role, "admin"):
        raise HTTPException(status_code=403, detail="权限不足")

    target = db.query(GroupMember).filter(
        GroupMember.group_id == req.group_id, GroupMember.user_id == req.target_uid
    ).first()
    if not target:
        raise HTTPException(status_code=400, detail="目标用户不在群中")

    target.mute_until = None
    _log_event(db, req.group_id, "unmute", current_uid, req.target_uid)
    db.commit()

    logger.info(f"解除禁言 group_id={req.group_id} target_uid={req.target_uid}")
    return {"code": 200, "msg": "已解除禁言"}


# ---------- 可邀请好友列表 ----------
@router.get("/invitable_friends")
def get_invitable_friends(token: str, group_id: int, db: Session = Depends(get_db)):
    """返回当前用户可邀请入群的好友列表（排除已在群内或已有待处理邀请的好友）"""
    current_uid = get_current_user_from_token(token)
    records = db.query(FriendRelation).filter(
        ((FriendRelation.user_id == current_uid) | (FriendRelation.friend_id == current_uid)),
        FriendRelation.status == 1
    ).all()
    friend_ids = set()
    for rel in records:
        fid = rel.friend_id if rel.user_id == current_uid else rel.user_id
        friend_ids.add(fid)
    in_group = db.query(GroupMember.user_id).filter(
        GroupMember.group_id == group_id, GroupMember.is_quit == 0
    ).all()
    in_group_ids = {m.user_id for m in in_group}
    pending = db.query(GroupJoinRequest.applicant_id).filter(
        GroupJoinRequest.group_id == group_id,
        GroupJoinRequest.status.in_([0, 3])
    ).all()
    pending_ids = {p.applicant_id for p in pending}
    available = friend_ids - in_group_ids - pending_ids
    users = db.query(User.id, User.username, User.avatar).filter(
        User.id.in_(available)
    ).order_by(User.username.asc()).all()
    data = [{"user_id": u.id, "username": u.username, "avatar": u.avatar or ""} for u in users]
    return {"code": 200, "data": data}


# ---------- 修改群资料 ----------
@router.post("/update")
def update_group(req: GroupUpdateReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    group = db.query(ChatGroup).filter(ChatGroup.id == req.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    my_role = _get_member_role(req.group_id, current_uid, group, db)
    if not _check_role(my_role, "admin"):
        raise HTTPException(status_code=403, detail="权限不足")

    changed = []
    if req.group_name is not None and req.group_name.strip():
        old_name = group.group_name
        group.group_name = req.group_name.strip()
        changed.append("群名称")
        _log_event(db, req.group_id, "rename", current_uid, extra_info=f"{old_name}->{group.group_name}")
    if req.avatar is not None:
        group.avatar = req.avatar
        changed.append("群头像")
    if req.announcement is not None:
        group.announcement = req.announcement
        changed.append("群公告")
    if req.join_mode is not None and req.join_mode in [0, 1]:
        group.join_mode = req.join_mode
        changed.append("入群模式")

    db.commit()
    msg = f"已更新: {', '.join(changed)}" if changed else "无变更"
    logger.info(f"修改群资料 group_id={req.group_id} uid={current_uid} changed={changed}")
    return {"code": 200, "msg": msg}


# ---------- 入群申请处理 ----------
@router.get("/apply/list")
def get_join_requests(token: str, group_id: int, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(token)
    group = db.query(ChatGroup).filter(ChatGroup.id == group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")

    my_role = _get_member_role(group_id, current_uid, group, db)
    if not _check_role(my_role, "admin"):
        raise HTTPException(status_code=403, detail="权限不足")

    requests = db.query(GroupJoinRequest).filter(
        GroupJoinRequest.group_id == group_id, GroupJoinRequest.status == 0
    ).order_by(GroupJoinRequest.create_at.desc()).all()

    user_ids = set()
    for r in requests:
        user_ids.add(r.applicant_id)
        if r.inviter_id:
            user_ids.add(r.inviter_id)
    user_map = _get_user_map(db, user_ids)

    data = [{
        "request_id": r.id,
        "applicant_name": user_map.get(r.applicant_id, "未知"),
        "inviter_name": user_map.get(r.inviter_id, "") if r.inviter_id else "",
        "create_at": r.create_at.strftime("%Y-%m-%d %H:%M:%S")
    } for r in requests]
    return {"code": 200, "data": data}


@router.post("/apply/deal")
def deal_join_request(req: GroupApplyDealReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(req.token)
    jr = db.query(GroupJoinRequest).filter(GroupJoinRequest.id == req.request_id).first()
    if not jr:
        raise HTTPException(status_code=404, detail="申请不存在")

    group = db.query(ChatGroup).filter(ChatGroup.id == jr.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    my_role = _get_member_role(jr.group_id, current_uid, group, db)
    if not _check_role(my_role, "admin"):
        raise HTTPException(status_code=403, detail="权限不足")

    jr.status = 1 if req.operate == 1 else 2

    if req.operate == 1:
        exist = db.query(GroupMember).filter(
            GroupMember.group_id == jr.group_id, GroupMember.user_id == jr.applicant_id, GroupMember.is_quit == 0
        ).first()
        if not exist:
            member = GroupMember(group_id=jr.group_id, user_id=jr.applicant_id, role=0)
            db.add(member)
            _log_event(db, jr.group_id, "join", current_uid, jr.applicant_id)

    db.commit()
    return {"code": 200, "msg": "已同意入群申请" if req.operate == 1 else "已拒绝入群申请"}


# ---------- 群公告查询 ----------
@router.get("/announcement")
def get_announcement(token: str, group_id: int, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(token)
    group = db.query(ChatGroup).filter(ChatGroup.id == group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")
    is_member = db.query(GroupMember).filter(
        GroupMember.group_id == group_id, GroupMember.user_id == current_uid, GroupMember.is_quit == 0
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="你不是该群成员")
    return {"code": 200, "data": {"announcement": group.announcement or ""}}


# ---------- 群事件日志 ----------
@router.get("/events")
def get_group_events(token: str, group_id: int, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(token)
    group = db.query(ChatGroup).filter(ChatGroup.id == group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")

    # 验证是否为群成员
    is_member = db.query(GroupMember).filter(
        GroupMember.group_id == group_id, GroupMember.user_id == current_uid, GroupMember.is_quit == 0
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="你不是该群成员")

    events = db.query(GroupEvent).filter(
        GroupEvent.group_id == group_id
    ).order_by(GroupEvent.create_at.desc()).limit(50).all()

    user_ids = set()
    for ev in events:
        user_ids.add(ev.operator_id)
        if ev.target_id:
            user_ids.add(ev.target_id)
    user_map = _get_user_map(db, user_ids)

    event_text = {
        "kick": "被管理员移出群聊", "mute": "被禁言", "unmute": "禁言已解除",
        "set_admin": "被设为管理员", "revoke_admin": "管理员权限被撤销",
        "rename": "修改了群名称", "transfer_owner": "转让了群主",
        "disband": "群聊已解散", "join": "加入了群聊", "leave": "退出了群聊"
    }

    data = [{
        "event_type": ev.event_type,
        "operator_name": user_map.get(ev.operator_id, "未知"),
        "target_name": user_map.get(ev.target_id, "") if ev.target_id else "",
        "desc": _format_event_desc(ev, user_map, event_text),
        "create_at": ev.create_at.strftime("%m-%d %H:%M") if ev.create_at else ""
    } for ev in events]
    return {"code": 200, "data": data}


def _format_event_desc(ev, user_map, event_text):
    op = user_map.get(ev.operator_id, "未知")
    tg = user_map.get(ev.target_id, "") if ev.target_id else ""
    base = event_text.get(ev.event_type, ev.event_type)
    if ev.event_type == "mute":
        return f"{tg} {base}（{ev.extra_info or ''}）"
    return f"{op} {base}" + (f" {tg}" if tg else "") + (f": {ev.extra_info}" if ev.extra_info and ev.event_type == "rename" else "")


# ---------- 群免打扰 ----------
@router.post("/mute_setting")
def set_group_mute(token: str, group_id: int, is_muted: int = 1, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(token)
    # 验证群存在且用户为成员
    is_member = db.query(GroupMember).filter(
        GroupMember.group_id == group_id, GroupMember.user_id == current_uid, GroupMember.is_quit == 0
    ).first()
    if not is_member:
        raise HTTPException(status_code=403, detail="你不是该群成员")
    setting = db.query(GroupMuteSetting).filter(
        GroupMuteSetting.group_id == group_id, GroupMuteSetting.user_id == current_uid
    ).first()
    if setting:
        setting.is_muted = is_muted
    else:
        setting = GroupMuteSetting(group_id=group_id, user_id=current_uid, is_muted=is_muted)
        db.add(setting)
    db.commit()
    return {"code": 200, "msg": "已设置免打扰" if is_muted else "已关闭免打扰"}


@router.get("/mute_setting")
def get_group_mute_setting(token: str, group_id: int, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(token)
    setting = db.query(GroupMuteSetting).filter(
        GroupMuteSetting.group_id == group_id, GroupMuteSetting.user_id == current_uid
    ).first()
    return {"code": 200, "is_muted": setting.is_muted if setting else 0}


# ========== 邀请处理（被邀请者视角） ==========

class InviteDealReq(BaseModel):
    token: str
    invite_id: int
    operate: int  # 1=同意 0=拒绝


@router.get("/invite/list")
def get_my_invites(token: str, db: Session = Depends(get_db)):
    """获取我被邀请入群的列表"""
    current_uid = get_current_user_from_token(token)
    invites = db.query(GroupJoinRequest).filter(
        GroupJoinRequest.applicant_id == current_uid,
        GroupJoinRequest.status.in_([0, 3])
    ).order_by(GroupJoinRequest.create_at.desc()).all()

    user_ids = set()
    group_ids = set()
    for inv in invites:
        if inv.inviter_id:
            user_ids.add(inv.inviter_id)
        group_ids.add(inv.group_id)
    user_map = _get_user_map(db, user_ids)
    groups = db.query(ChatGroup.id, ChatGroup.group_name).filter(ChatGroup.id.in_(group_ids)).all()
    group_map = {g.id: g.group_name for g in groups}

    data = [{
        "invite_id": inv.id, "group_id": inv.group_id,
        "group_name": group_map.get(inv.group_id, ""),
        "inviter_name": user_map.get(inv.inviter_id, "") if inv.inviter_id else "",
        "status": inv.status,
        "can_accept": inv.status == 3,
        "create_at": inv.create_at.strftime("%Y-%m-%d %H:%M:%S") if inv.create_at else ""
    } for inv in invites]
    return {"code": 200, "data": data}


@router.get("/invite/count")
def get_invite_count(token: str, db: Session = Depends(get_db)):
    """获取待处理的入群邀请数量"""
    current_uid = get_current_user_from_token(token)
    count = db.query(GroupJoinRequest).filter(
        GroupJoinRequest.applicant_id == current_uid,
        GroupJoinRequest.status.in_([0, 3])
    ).count()
    return {"code": 200, "count": count}


@router.post("/invite/deal")
def deal_invite(req: InviteDealReq, db: Session = Depends(get_db)):
    """被邀请者处理入群邀请（同意/拒绝）"""
    current_uid = get_current_user_from_token(req.token)
    inv = db.query(GroupJoinRequest).filter(
        GroupJoinRequest.id == req.invite_id, GroupJoinRequest.applicant_id == current_uid
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="邀请不存在")
    if inv.status != 3:
        raise HTTPException(status_code=400, detail="该邀请尚未通过审批，无法处理")

    group = db.query(ChatGroup).filter(ChatGroup.id == inv.group_id, ChatGroup.is_disband == 0).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在或已解散")

    if req.operate == 1:
        exist = db.query(GroupMember).filter(
            GroupMember.group_id == inv.group_id, GroupMember.user_id == current_uid, GroupMember.is_quit == 0
        ).first()
        if exist:
            inv.status = 1; db.commit()
            raise HTTPException(status_code=400, detail="你已在群内")
        inv.status = 1
        member = GroupMember(group_id=inv.group_id, user_id=current_uid, role=0)
        db.add(member)
        _log_event(db, inv.group_id, "join", current_uid, current_uid)
        db.commit()
        # 广播新成员入群通知给所有群成员
        try:
            new_member_name = db.query(User.username).filter(User.id == current_uid).scalar() or "未知"
            member_rows = db.query(GroupMember.user_id).filter(
                GroupMember.group_id == inv.group_id, GroupMember.is_quit == 0
            ).all()
            member_ids = {m.user_id for m in member_rows}
            online = manager.get_online_users() & member_ids
            for mid in online:
                manager.notify_user(mid, {
                    "type": "group_sys_notify", "group_id": inv.group_id,
                    "notify_type": "join", "operator_name": new_member_name,
                    "target_name": new_member_name,
                    "desc": f"{new_member_name} 加入了群聊"
                })
        except Exception: pass
        return {"code": 200, "msg": f"已加入群聊「{group.group_name}」"}
    else:
        inv.status = 2
        db.commit()
        return {"code": 200, "msg": "已拒绝入群邀请"}
