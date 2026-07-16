"""
好友关系相关补充数据模型
- 好友备注（服务器端存储，替换 localStorage）
- 好友消息免打扰
"""
from sqlalchemy import Column, Integer, String, SmallInteger, DateTime, UniqueConstraint
from datetime import datetime
from database.db import Base


class FriendRemark(Base):
    """好友备注：每个用户可对每个好友设置一个备注名（最多12字）"""
    __tablename__ = "friend_remark"
    __table_args__ = (UniqueConstraint("user_id", "friend_id", name="uq_friend_remark"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, comment="设置者UID")
    friend_id = Column(Integer, nullable=False, comment="被备注的好友UID")
    remark = Column(String(12), default="", comment="备注名(最多12字)")
    create_at = Column(DateTime, default=datetime.now, comment="创建时间")


class FriendMuteSetting(Base):
    """好友消息免打扰设置（按用户+好友存储）"""
    __tablename__ = "friend_mute_setting"
    __table_args__ = (UniqueConstraint("user_id", "friend_id", name="uq_friend_mute"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, comment="用户UID")
    friend_id = Column(Integer, nullable=False, comment="好友UID")
    is_muted = Column(SmallInteger, default=0, comment="0正常 1免打扰")
    create_at = Column(DateTime, default=datetime.now, comment="设置时间")
