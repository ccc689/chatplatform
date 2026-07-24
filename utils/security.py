from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
import re

load_dotenv()

# 密码加密工具
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 明文密码加密
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

# 校验明文与加密密码是否匹配
def verify_password(plain_pwd: str, hashed_pwd: str) -> bool:
    return pwd_context.verify(plain_pwd, hashed_pwd)

# JWT 配置 — 密钥从环境变量读取，不存在则自动生成
SECRET_KEY = os.getenv("JWT_SECRET_KEY") or "chat_platform_2026_secret_key_0000000000000000"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24小时

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


# ==================== 输入校验 ====================

# 用户名规则：3-20 个字符，仅允许中文、字母、数字、下划线
USERNAME_PATTERN = re.compile(r'^[\w一-鿿]{3,20}$')

# 密码规则：至少 8 位，必须包含至少一个字母和一个数字，不允许空格
PASSWORD_LETTER_PATTERN = re.compile(r'[A-Za-z]')
PASSWORD_DIGIT_PATTERN = re.compile(r'\d')


def validate_username(username: str) -> str | None:
    """
    校验用户名合法性。
    返回 None 表示通过，返回字符串表示错误原因。
    """
    if not username or not username.strip():
        return "用户名不能为空"
    username = username.strip()
    if len(username) < 3:
        return "用户名至少需要 3 个字符"
    if len(username) > 20:
        return "用户名最多 20 个字符"
    if not USERNAME_PATTERN.match(username):
        return "用户名仅允许中文、字母、数字、下划线"
    return None


def validate_password(password: str) -> str | None:
    """
    校验密码强度。
    返回 None 表示通过，返回字符串表示错误原因。
    """
    if not password:
        return "密码不能为空"
    if len(password) < 8:
        return "密码至少需要 8 位"
    if len(password) > 128:
        return "密码最多 128 位"
    if ' ' in password:
        return "密码不允许包含空格"
    if not PASSWORD_LETTER_PATTERN.search(password):
        return "密码必须包含至少一个字母"
    if not PASSWORD_DIGIT_PATTERN.search(password):
        return "密码必须包含至少一个数字"
    return None