"""
好友模块接口
- 发起好友申请
- 查看收到的申请列表
- 处理申请（同意/拒绝）
- 好友列表
- 搜索用户（按用户名模糊搜索）
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database.db import get_db, User, FriendRelation
from utils.security import get_current_user_from_token
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

    # 查是否已有关系记录
    exist = db.query(FriendRelation).filter(
        ((FriendRelation.user_id == current_uid) & (FriendRelation.friend_id == target_uid)) |
        ((FriendRelation.user_id == target_uid) & (FriendRelation.friend_id == current_uid))
    ).first()

    if exist:
        if exist.status == 1:
            raise HTTPException(status_code=400, detail="你们已经是好友")
        else:
            raise HTTPException(status_code=400, detail="已发送过好友申请，等待对方处理")

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
