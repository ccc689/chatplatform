from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta

# 密码加密工具
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 明文密码加密
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

# 校验明文与加密密码是否匹配
def verify_password(plain_pwd: str, hashed_pwd: str) -> bool:
    return pwd_context.verify(plain_pwd, hashed_pwd)

# JWT 配置
SECRET_KEY = "chat_platform_2026_secret_key_0000000000000000"
ALGORITHM = "HS256"
# Token 有效期 2小时
ACCESS_TOKEN_EXPIRE_MINUTES = 10080  # 7天 = 7 × 24 × 60

# 生成登录Token
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


# ==================== 共享鉴权函数 ====================

def get_current_user_from_token(token: str) -> int:
    """
    统一的 token 解析函数，所有接口共用。
    成功返回 uid (int)，失败抛出 HTTPException。
    """
    from fastapi import HTTPException
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="无效 token")
    uid = payload.get("uid")
    if uid is None:
        raise HTTPException(status_code=401, detail="token 缺少用户信息")
    return int(uid)


# ==================== 表情包数据 ====================

EMOJI_MAP = {
    "[smile]": "😊",
    "[angry]": "😡",
    "[cry]": "😭",
    "[pout]": "😗",
    "[daze]": "😳",
    "[proud]": "😎",
}