from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database.db import get_db, User, LoginAttempt, FriendRelation
from utils.ws_manager import manager
from sqlalchemy import or_, and_
from utils.security import (
    hash_password, verify_password, create_access_token,
    get_current_user_from_token, validate_username, validate_password
)
from datetime import timedelta, datetime

router = APIRouter(prefix="/user", tags=["用户模块"])

# 注册请求模型
class UserRegister(BaseModel):
    username: str
    password: str

# 登录请求模型
class UserLogin(BaseModel):
    username: str
    password: str

# 个人信息更新模型
class ProfileUpdate(BaseModel):
    token: str
    avatar: str = ""
    nickname: str = ""
    status_message: str = ""


# ==================== 注册 / 登录 ====================

@router.post("/register")
def register(user: UserRegister, db: Session = Depends(get_db)):
    # Bug 1: 用户名校验
    username_err = validate_username(user.username)
    if username_err:
        raise HTTPException(status_code=400, detail=username_err)

    # Bug 4: 密码强度校验
    pwd_err = validate_password(user.password)
    if pwd_err:
        raise HTTPException(status_code=400, detail=pwd_err)

    exist_user = db.query(User).filter(User.username == user.username.strip()).first()
    if exist_user:
        raise HTTPException(status_code=400, detail="用户名已被注册")
    hashed_pwd = hash_password(user.password)
    new_user = User(username=user.username.strip(), password=hashed_pwd)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"code": 200, "msg": "注册成功", "user_id": new_user.id}

@router.post("/login")
def login(user: UserLogin, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"

    # Bug 2: 暴力破解防护 — 同一账号 15 分钟内失败 ≥5 次则锁定
    lock_time = datetime.now() - timedelta(minutes=15)
    recent_failures = db.query(LoginAttempt).filter(
        LoginAttempt.username == user.username.strip(),
        LoginAttempt.success == 0,
        LoginAttempt.create_at >= lock_time
    ).count()

    if recent_failures >= 5:
        raise HTTPException(status_code=429, detail="登录失败次数过多，请 15 分钟后再试")

    db_user = db.query(User).filter(User.username == user.username.strip()).first()

    if not db_user or not verify_password(user.password, db_user.password):
        # 记录失败尝试
        attempt = LoginAttempt(username=user.username.strip(), ip_address=client_ip, success=0)
        db.add(attempt)
        db.commit()
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    # 记录成功尝试
    attempt = LoginAttempt(username=user.username.strip(), ip_address=client_ip, success=1)
    db.add(attempt)
    db.commit()

    token = create_access_token(data={"uid": db_user.id})
    return {"code": 200, "msg": "登录成功", "access_token": token, "token_type": "bearer"}


# ==================== 个人信息 ====================

@router.get("/profile")
def get_profile(token: str, db: Session = Depends(get_db)):
    """获取当前用户个人信息"""
    uid = get_current_user_from_token(token)
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "code": 200,
        "data": {
            "user_id": user.id,
            "username": user.username,
            "avatar": user.avatar or "",
            "status_message": user.status_message or "",
            "online_status": user.online_status
        }
    }

@router.post("/profile")
def update_profile(body: ProfileUpdate, db: Session = Depends(get_db)):
    """更新头像、昵称、个性状态（传什么改什么）"""
    uid = get_current_user_from_token(body.token)
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if body.nickname.strip():
        # 检查新昵称是否和其他人冲突
        conflict = db.query(User).filter(User.username == body.nickname.strip(), User.id != uid).first()
        if conflict:
            raise HTTPException(status_code=400, detail="昵称已被占用")
        user.username = body.nickname.strip()

    if body.avatar.strip():
        user.avatar = body.avatar.strip()

    if body.status_message is not None:
        # 空字符串 = 清除状态
        msg = body.status_message.strip()
        if len(msg) > 20:
            raise HTTPException(status_code=400, detail="个性状态最多20个字")
        user.status_message = msg

    db.commit()
    db.refresh(user)
    _broadcast_profile_update(uid, user, db)
    return {
        "code": 200,
        "msg": "更新成功",
        "data": {
            "username": user.username,
            "avatar": user.avatar or "",
            "status_message": user.status_message or "",
            "online_status": user.online_status
        }
    }



def _broadcast_profile_update(uid: int, user, db):
    """通知所有在线好友：某用户更新了个人资料/在线状态"""
    try:
        # 找到所有互为好友的用户ID
        records = db.query(FriendRelation).filter(
            ((FriendRelation.user_id == uid) | (FriendRelation.friend_id == uid)),
            FriendRelation.status == 1
        ).all()
        friend_ids = set()
        for rel in records:
            fid = rel.friend_id if rel.user_id == uid else rel.user_id
            friend_ids.add(fid)
        online_friends = manager.get_online_users() & friend_ids
        for fid in online_friends:
            manager.notify_user(fid, {
                "type": "friend_profile_update",
                "uid": uid,
                "username": user.username,
                "avatar": user.avatar or "",
                "online_status": user.online_status,
                "status_message": user.status_message or ""
            })
    except Exception:
        pass


def _broadcast_status_update(uid: int, user, db):
    """轻量广播：仅通知在线状态变更（用于前端快速 DOM 更新，不刷新整个列表）"""
    try:
        records = db.query(FriendRelation).filter(
            ((FriendRelation.user_id == uid) | (FriendRelation.friend_id == uid)),
            FriendRelation.status == 1
        ).all()
        friend_ids = set()
        for rel in records:
            fid = rel.friend_id if rel.user_id == uid else rel.user_id
            friend_ids.add(fid)
        online_friends = manager.get_online_users() & friend_ids
        msg = {"type": "status_update", "user_id": uid, "online": user.online_status == 1}
        print(f"[后端广播日志] 当前连接池用户: {list(manager.get_online_users())}")
        print(f"[后端广播日志] 好友列表: {list(friend_ids)}, 在线好友: {list(online_friends)}")
        print(f"[后端广播日志] 正在发送消息给所有在线好友: {msg}")
        for fid in online_friends:
            manager.notify_user(fid, msg)
    except Exception:
        pass


# ==================== 在线状态 ====================

class OnlineStatusReq(BaseModel):
    token: str
    online_status: int  # 0=离线 1=在线

@router.post("/online_status")
def set_online_status(body: OnlineStatusReq, db: Session = Depends(get_db)):
    """手动设置在线/离线状态"""
    uid = get_current_user_from_token(body.token)
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    user.online_status = 1 if body.online_status == 1 else 0
    db.commit()
    db.refresh(user)
    print(f"[set_online_status] uid={uid} 状态已更新为 online_status={user.online_status}")
    
    # 广播状态变更给所有在线好友（轻量实时DOM更新 + 完整资料同步）
    _broadcast_status_update(uid, user, db)
    _broadcast_profile_update(uid, user, db)
    
    return {
        "code": 200,
        "msg": "状态更新成功",
        "data": {
            "online_status": user.online_status
        }
    }
# ==================== 修改密码 ====================

class ChangePasswordRequest(BaseModel):
    token: str
    old_password: str
    new_password: str

@router.post("/change_password")
def change_password(body: ChangePasswordRequest, db: Session = Depends(get_db)):
    """修改登录密码"""
    uid = get_current_user_from_token(body.token)
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not verify_password(body.old_password, user.password):
        raise HTTPException(status_code=400, detail="当前密码错误")

    # Bug 3: 新旧密码不能相同
    if verify_password(body.new_password, user.password):
        raise HTTPException(status_code=400, detail="新密码不能与旧密码相同")

    # Bug 4: 密码强度校验
    pwd_err = validate_password(body.new_password)
    if pwd_err:
        raise HTTPException(status_code=400, detail=pwd_err)

    user.password = hash_password(body.new_password)
    db.commit()
    return {"code": 200, "msg": "密码修改成功"}

