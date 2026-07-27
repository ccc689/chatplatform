from sqlalchemy import create_engine, Column, Integer, String, SmallInteger, Text, DateTime, BIGINT, ForeignKey, JSON
from sqlalchemy.orm import sessionmaker, declarative_base
from datetime import datetime
from dotenv import load_dotenv
import os
from urllib.parse import quote_plus

# ==================== 数据库配置 ====================

load_dotenv()

DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_DATABASE")

safe_password = quote_plus(DB_PASSWORD)
SQLALCHEMY_DATABASE_URL = f"mysql+pymysql://{DB_USER}:{safe_password}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True, pool_size=20, max_overflow=10)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """依赖函数：每次接口请求获取一个数据库会话，用完自动关闭"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ==================== 数据表模型（统一使用 create_at） ====================

class User(Base):
    __tablename__ = "user"
    id = Column(Integer, primary_key=True, autoincrement=True, comment="用户ID")
    username = Column(String(50), unique=True, nullable=False, comment="用户名")
    password = Column(String(255), nullable=False, comment="加密密码")
    avatar = Column(String(255), default="", comment="头像URL")
    status_message = Column(String(50), default="", comment="个性状态")
    online_status = Column(SmallInteger, default=1, comment="在线状态: 0离线 1在线")
    create_at = Column(DateTime, default=datetime.now, comment="注册时间")


class FriendRelation(Base):
    __tablename__ = "friend_relation"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, comment="发起用户ID")
    friend_id = Column(Integer, nullable=False, comment="好友用户ID")
    status = Column(SmallInteger, default=0, comment="0待同意 1好友 2拒绝")
    create_at = Column(DateTime, default=datetime.now, comment="创建时间")


class ChatMessage(Base):
    __tablename__ = "chat_message"
    id = Column(BIGINT, primary_key=True, autoincrement=True)
    sender_id = Column(Integer, nullable=False, comment="发送者ID")
    receiver_id = Column(Integer, nullable=True, comment="私聊接收者ID（群聊时为空）")
    group_id = Column(Integer, nullable=True, comment="群聊ID（私聊时为空）")
    content = Column(Text, comment="消息内容")
    is_read = Column(SmallInteger, default=0, comment="0未读 1已读")
    is_delete = Column(SmallInteger, default=0, comment="0正常 1撤回")
    message_type = Column(SmallInteger, default=0, comment="0文本 1图片 2文件 3表情")
    create_at = Column(DateTime, default=datetime.now, comment="发送时间")


class ChatGroup(Base):
    __tablename__ = "chat_group"
    id = Column(Integer, primary_key=True, autoincrement=True)
    group_name = Column(String(100), nullable=False, comment="群名称")
    owner_id = Column(Integer, nullable=False, comment="群主用户ID")
    admin_ids = Column(JSON, default=list, comment="管理员UID列表(JSON数组)")
    avatar = Column(String(255), default="", comment="群头像URL")
    announcement = Column(Text, default="", comment="群公告")
    join_mode = Column(SmallInteger, default=1, comment="入群模式: 0自由加入 1需验证")
    is_disband = Column(SmallInteger, default=0, comment="0正常 1已解散")
    create_at = Column(DateTime, default=datetime.now, comment="创建时间")


class GroupMember(Base):
    __tablename__ = "group_member"
    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(Integer, ForeignKey("chat_group.id"), nullable=False, comment="群ID")
    user_id = Column(Integer, nullable=False, comment="用户ID")
    role = Column(SmallInteger, default=0, comment="0普通成员 1管理员 2群主")
    mute_until = Column(DateTime, nullable=True, comment="禁言截止时间(null=未禁言)")
    is_quit = Column(SmallInteger, default=0, comment="0在群 1已退群")
    create_at = Column(DateTime, default=datetime.now, comment="加入时间")


class UploadResource(Base):
    __tablename__ = "upload_resource"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, comment="上传用户ID")
    file_name = Column(String(255), nullable=False, comment="原始文件名")
    save_path = Column(String(500), nullable=False, comment="服务器存储路径")
    file_size = Column(BIGINT, comment="文件大小（字节）")
    create_at = Column(DateTime, default=datetime.now, comment="上传时间")


class LoginAttempt(Base):
    __tablename__ = "login_attempt"
    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), nullable=False, comment="尝试登录的用户名")
    ip_address = Column(String(45), default="", comment="客户端IP")
    success = Column(SmallInteger, default=0, comment="0失败 1成功")
    create_at = Column(DateTime, default=datetime.now, comment="尝试时间")

