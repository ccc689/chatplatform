"""
群管理相关补充数据模型
- 群事件日志
- 入群申请记录
- 群消息免打扰
"""
from sqlalchemy import Column, Integer, String, SmallInteger, Text, DateTime, BIGINT, UniqueConstraint
from datetime import datetime
from database.db import Base


class GroupEvent(Base):
    """群事件日志：记录踢人、禁言、任免管理员等系统通知"""
    __tablename__ = "group_event"
    id = Column(BIGINT, primary_key=True, autoincrement=True)
    group_id = Column(Integer, nullable=False, comment="群ID")
    event_type = Column(String(30), nullable=False, comment="事件类型: kick/mute/unmute/set_admin/revoke_admin/rename/transfer_owner/disband/join/leave")
    operator_id = Column(Integer, nullable=False, comment="操作者UID")
    target_id = Column(Integer, nullable=True, comment="被操作者UID(部分事件可为空)")
    extra_info = Column(String(255), default="", comment="附加信息(如新群名、禁言时长)")
    create_at = Column(DateTime, default=datetime.now, comment="事件时间")


class GroupJoinRequest(Base):
    """入群申请记录（join_mode=1 验证模式时使用）"""
    __tablename__ = "group_join_request"
    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(Integer, nullable=False, comment="群ID")
    applicant_id = Column(Integer, nullable=False, comment="申请人UID")
    inviter_id = Column(Integer, nullable=True, comment="邀请人UID(可选)")
    status = Column(SmallInteger, default=0, comment="0待处理 1已同意 2已拒绝")
    create_at = Column(DateTime, default=datetime.now, comment="申请时间")


class GroupMuteSetting(Base):
    """群消息免打扰设置（按用户+群存储）"""
    __tablename__ = "group_mute_setting"
    __table_args__ = (UniqueConstraint("group_id", "user_id", name="uq_group_mute"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(Integer, nullable=False, comment="群ID")
    user_id = Column(Integer, nullable=False, comment="用户UID")
    is_muted = Column(SmallInteger, default=0, comment="0正常 1免打扰")
    create_at = Column(DateTime, default=datetime.now, comment="设置时间")
