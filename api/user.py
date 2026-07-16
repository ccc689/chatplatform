from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database.db import get_db, User
from utils.security import hash_password, verify_password, create_access_token, get_current_user_from_token
from datetime import timedelta

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
    exist_user = db.query(User).filter(User.username == user.username).first()
    if exist_user:
        raise HTTPException(status_code=400, detail="用户名已被注册")
    hashed_pwd = hash_password(user.password)
    new_user = User(username=user.username, password=hashed_pwd)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"code":200, "msg":"注册成功", "user_id":new_user.id}

@router.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user or not verify_password(user.password, db_user.password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_access_token(data={"uid": db_user.id})
    return {"code":200, "msg":"登录成功", "access_token":token, "token_type":"bearer"}


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
            "status_message": user.status_message or ""
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
    return {
        "code": 200,
        "msg": "更新成功",
        "data": {
            "username": user.username,
            "avatar": user.avatar or "",
            "status_message": user.status_message or ""
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
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少6位")
    user.password = hash_password(body.new_password)
    db.commit()
    return {"code": 200, "msg": "密码修改成功"}