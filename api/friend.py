"""
好友模块接口
- 发起好友申请
- 查看收到的申请列表
- 处理申请（同意/拒绝）
- 好友列表
- 搜索用户（按用户名模糊搜索）
- 好友资料（头像/状态/在线/备注）
- 好友备注管理
- 删除好友
- 好友消息免打扰
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database.db import get_db, User, FriendRelation
from database.models.friend import FriendRemark, FriendMuteSetting
from utils.security import get_current_user_from_token
from utils.ws_manager import manager
from utils.logger import get_logger

router = APIRouter(prefix="/friend", tags=["好友模块"])
logger = get_logger("friend")


# ==================== 请求模型 ====================

class FriendApplyReq(BaseModel):
    friend_username: str
    token: str


class DealApplyReq(BaseModel):
    apply_id: int
    operate: int   # 1=同意, 其他=拒绝
    token: str


class FriendRemarkReq(BaseModel):
    token: str
    friend_username: str
    remark: str = ""  # 备注名，最多12字，空字符串表示清除备注


class FriendOpReq(BaseModel):
    token: str
    friend_username: str


# ==================== 接口实现 ====================

# 1. 发起好友申请
@router.post("/apply")
def apply_friend(body: FriendApplyReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(body.token)

    # 查找目标用户
    target = db.query(User).filter(User.username == body.friend_username).first()
    if not target:
        raise HTTPException(status_code=400, detail="该用户不存在")
    target_uid = target.id

    if current_uid == target_uid:
        raise HTTPException(status_code=400, detail="不能添加自己为好友")

    # 查是否已有关系记录（仅检查活跃状态）
    exist = db.query(FriendRelation).filter(
        ((FriendRelation.user_id == current_uid) & (FriendRelation.friend_id == target_uid)) |
        ((FriendRelation.user_id == target_uid) & (FriendRelation.friend_id == current_uid)),
        FriendRelation.status.in_([0, 1])  # 0=待处理 1=已好友
    ).first()

    if exist:
        if exist.status == 1:
            raise HTTPException(status_code=400, detail="你们已经是好友")
        else:
            raise HTTPException(status_code=400, detail="已发送过好友申请，等待对方处理")
    else:
        # 检查是否有已删除(status=2)的旧记录，有则清理旧记录
        db.query(FriendRelation).filter(
            ((FriendRelation.user_id == current_uid) & (FriendRelation.friend_id == target_uid)) |
            ((FriendRelation.user_id == target_uid) & (FriendRelation.friend_id == current_uid)),
            FriendRelation.status == 2
        ).delete()

    # 创建申请
    new_apply = FriendRelation(user_id=current_uid, friend_id=target_uid, status=0)
    db.add(new_apply)
    db.commit()
    db.refresh(new_apply)

    logger.info(f"好友申请 uid={current_uid} target_uid={target_uid} apply_id={new_apply.id}")
    return {"code": 200, "msg": "好友申请发送成功", "apply_id": new_apply.id}


# 2. 查看收到的申请列表
@router.get("/apply/list")
def get_my_apply_list(token: str, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(token)

    applies = db.query(FriendRelation, User.username).join(
        User, FriendRelation.user_id == User.id
    ).filter(
        FriendRelation.friend_id == current_uid,
        FriendRelation.status == 0
    ).order_by(FriendRelation.create_at.desc()).all()

    res = [{"apply_id": rel.id, "apply_user_name": uname} for rel, uname in applies]
    return {"code": 200, "data": res}


# 3. 处理申请（同意/拒绝）
@router.post("/apply/deal")
def deal_friend_apply(body: DealApplyReq, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(body.token)

    record = db.query(FriendRelation).filter(
        FriendRelation.id == body.apply_id,
        FriendRelation.friend_id == current_uid,
        FriendRelation.status == 0
    ).first()

    if not record:
        raise HTTPException(status_code=400, detail="不存在该好友申请")

    if body.operate == 1:
        record.status = 1
        db.commit()
        logger.info(f"好友申请同意 apply_id={body.apply_id} uid={current_uid}")
        return {"code": 200, "msg": "已同意好友申请"}
    else:
        db.delete(record)
        db.commit()
        logger.info(f"好友申请拒绝 apply_id={body.apply_id} uid={current_uid}")
        return {"code": 200, "msg": "已拒绝好友申请"}


# 4. 好友列表（按用户名拼音首字母排序）
@router.get("/list")
def get_friend_list(token: str, db: Session = Depends(get_db)):
    current_uid = get_current_user_from_token(token)

    # 查询双向好友关系记录
    records = db.query(FriendRelation).filter(
        ((FriendRelation.user_id == current_uid) | (FriendRelation.friend_id == current_uid)),
        FriendRelation.status == 1
    ).all()

    friend_ids = set()
    for rel in records:
        fid = rel.friend_id if rel.user_id == current_uid else rel.user_id
        friend_ids.add(fid)

    # 按用户名排序
    friends = db.query(User).filter(User.id.in_(friend_ids)).order_by(User.username.asc()).all()
    friend_list = [f.username for f in friends]

    return {"code": 200, "friend_list": friend_list}


# 5. 搜索用户（模糊搜索，用于查找添加好友目标）
@router.get("/search")
def search_user(token: str, keyword: str = "", db: Session = Depends(get_db)):
    """按用户名模糊搜索，排除自己和已是好友的用户"""
    current_uid = get_current_user_from_token(token)

    if not keyword.strip():
        return {"code": 200, "data": []}

    # 获取已是好友的用户 ID 集合
    records = db.query(FriendRelation).filter(
        ((FriendRelation.user_id == current_uid) | (FriendRelation.friend_id == current_uid)),
        FriendRelation.status == 1
    ).all()
    friend_ids = set()
    for rel in records:
        fid = rel.friend_id if rel.user_id == current_uid else rel.user_id
        friend_ids.add(fid)

    # 模糊搜索，排除自己
    users = db.query(User).filter(
        User.username.like(f"%{keyword}%"),
        User.id != current_uid
    ).limit(20).all()

    data = [{"username": u.username, "is_friend": u.id in friend_ids} for u in users]

    return {"code": 200, "data": data}


# ---------- 6. 好友资料 ----------
@router.get("/profile")
def get_friend_profile(token: str, friend_username: str, db: Session = Depends(get_db)):
    """获取好友完整资料（头像、状态、在线状态、备注）"""
    current_uid = get_current_user_from_token(token)

    # 查找好友
    friend = db.query(User).filter(User.username == friend_username).first()
    if not friend:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 验证是否为好友
    is_friend = db.query(FriendRelation).filter(
        ((FriendRelation.user_id == current_uid) & (FriendRelation.friend_id == friend.id)) |
        ((FriendRelation.user_id == friend.id) & (FriendRelation.friend_id == current_uid)),
        FriendRelation.status == 1
    ).first()
    if not is_friend:
        raise HTTPException(status_code=400, detail="你们不是好友")

    # 查询我对该好友的备注
    remark = db.query(FriendRemark.remark).filter(
        FriendRemark.user_id == current_uid,
        FriendRemark.friend_id == friend.id
    ).scalar() or ""

    # 在线状态
    is_online = manager.is_online(friend.id)

    # 查询免打扰设置
    mute_setting = db.query(FriendMuteSetting.is_muted).filter(
        FriendMuteSetting.user_id == current_uid,
        FriendMuteSetting.friend_id == friend.id
    ).scalar() or 0

    return {
        "code": 200,
        "data": {
            "user_id": friend.id,
            "username": friend.username,
            "avatar": friend.avatar or "",
            "status_message": friend.status_message or "",
            "is_online": is_online,
            "remark": remark,
            "is_muted": bool(mute_setting)
        }
    }


# ---------- 7. 设置好友备注 ----------
@router.post("/remark")
def set_friend_remark(req: FriendRemarkReq, db: Session = Depends(get_db)):
    """设置或清除好友备注（最多12字）"""
    current_uid = get_current_user_from_token(req.token)

    # 查找好友
    friend = db.query(User).filter(User.username == req.friend_username).first()
    if not friend:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 验证是否为好友
    is_friend = db.query(FriendRelation).filter(
        ((FriendRelation.user_id == current_uid) & (FriendRelation.friend_id == friend.id)) |
        ((FriendRelation.user_id == friend.id) & (FriendRelation.friend_id == current_uid)),
        FriendRelation.status == 1
    ).first()
    if not is_friend:
        raise HTTPException(status_code=400, detail="你们不是好友")

    remark_text = req.remark.strip()
    if len(remark_text) > 12:
        raise HTTPException(status_code=400, detail="备注最多12个字")

    # upsert
    existing = db.query(FriendRemark).filter(
        FriendRemark.user_id == current_uid,
        FriendRemark.friend_id == friend.id
    ).first()

    if remark_text:
        if existing:
            existing.remark = remark_text
        else:
            db.add(FriendRemark(user_id=current_uid, friend_id=friend.id, remark=remark_text))
    else:
        # 空备注 = 清除
        if existing:
            db.delete(existing)

    db.commit()
    logger.info(f"好友备注设置 uid={current_uid} friend={friend.username} remark={remark_text or '(清除)'}")
    return {"code": 200, "msg": "备注已更新", "remark": remark_text}


# ---------- 8. 查询好友备注 ----------
@router.get("/remark")
def get_friend_remark(token: str, friend_username: str, db: Session = Depends(get_db)):
    """获取对某好友的备注"""
    current_uid = get_current_user_from_token(token)

    friend = db.query(User).filter(User.username == friend_username).first()
    if not friend:
        raise HTTPException(status_code=404, detail="用户不存在")

    remark = db.query(FriendRemark.remark).filter(
        FriendRemark.user_id == current_uid,
        FriendRemark.friend_id == friend.id
    ).scalar() or ""

    return {"code": 200, "remark": remark}


# ---------- 9. 删除好友 ----------
@router.post("/delete")
def delete_friend(req: FriendOpReq, db: Session = Depends(get_db)):
    """删除好友（双向清除好友关系）"""
    current_uid = get_current_user_from_token(req.token)

    friend = db.query(User).filter(User.username == req.friend_username).first()
    if not friend:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 查找双向好友关系记录
    rels = db.query(FriendRelation).filter(
        ((FriendRelation.user_id == current_uid) & (FriendRelation.friend_id == friend.id)) |
        ((FriendRelation.user_id == friend.id) & (FriendRelation.friend_id == current_uid)),
        FriendRelation.status == 1
    ).all()

    if not rels:
        raise HTTPException(status_code=400, detail="你们不是好友")

    # 将所有好友关系标记为删除（status=2）
    for rel in rels:
        rel.status = 2

    # 清除备注
    db.query(FriendRemark).filter(
        ((FriendRemark.user_id == current_uid) & (FriendRemark.friend_id == friend.id)) |
        ((FriendRemark.user_id == friend.id) & (FriendRemark.friend_id == current_uid))
    ).delete()

    # 清除免打扰设置
    db.query(FriendMuteSetting).filter(
        ((FriendMuteSetting.user_id == current_uid) & (FriendMuteSetting.friend_id == friend.id)) |
        ((FriendMuteSetting.user_id == friend.id) & (FriendMuteSetting.friend_id == current_uid))
    ).delete()

    db.commit()
    logger.info(f"删除好友 uid={current_uid} friend={friend.username}")
    return {"code": 200, "msg": f"已删除好友 {friend.username}"}


# ---------- 10. 好友消息免打扰 ----------
@router.post("/mute")
def set_friend_mute(token: str, friend_username: str, is_muted: int = 1, db: Session = Depends(get_db)):
    """设置/取消好友消息免打扰"""
    current_uid = get_current_user_from_token(token)

    friend = db.query(User).filter(User.username == friend_username).first()
    if not friend:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 验证好友关系
    is_friend = db.query(FriendRelation).filter(
        ((FriendRelation.user_id == current_uid) & (FriendRelation.friend_id == friend.id)) |
        ((FriendRelation.user_id == friend.id) & (FriendRelation.friend_id == current_uid)),
        FriendRelation.status == 1
    ).first()
    if not is_friend:
        raise HTTPException(status_code=400, detail="你们不是好友")

    setting = db.query(FriendMuteSetting).filter(
        FriendMuteSetting.user_id == current_uid,
        FriendMuteSetting.friend_id == friend.id
    ).first()

    if setting:
        setting.is_muted = is_muted
    else:
        setting = FriendMuteSetting(user_id=current_uid, friend_id=friend.id, is_muted=is_muted)
        db.add(setting)

    db.commit()
    return {"code": 200, "msg": "已设置免打扰" if is_muted else "已关闭免打扰", "is_muted": is_muted}


# ---------- 11. 查询好友免打扰 ----------
@router.get("/mute")
def get_friend_mute(token: str, friend_username: str, db: Session = Depends(get_db)):
    """查询好友免打扰状态"""
    current_uid = get_current_user_from_token(token)

    friend = db.query(User).filter(User.username == friend_username).first()
    if not friend:
        raise HTTPException(status_code=404, detail="用户不存在")

    setting = db.query(FriendMuteSetting.is_muted).filter(
        FriendMuteSetting.user_id == current_uid,
        FriendMuteSetting.friend_id == friend.id
    ).scalar() or 0

    return {"code": 200, "is_muted": setting}

# ---------- 12. ?????? ----------
@router.get("/apply/count")
def get_apply_count(token: str, db: Session = Depends(get_db)):
    """????????????????????"""
    current_uid = get_current_user_from_token(token)
    count = db.query(FriendRelation).filter(
        FriendRelation.friend_id == current_uid,
        FriendRelation.status == 0
    ).count()
    return {"code": 200, "count": count}
