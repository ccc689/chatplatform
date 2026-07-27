"""
WebSocket 在线连接管理器
- 维护 {uid: websocket} 映射
- 一对一私聊推送
- 群聊广播（排除发送者本人）
- 线程安全（asyncio.Lock）
"""
import asyncio
from typing import Dict, Set
from fastapi import WebSocket

from utils.logger import get_logger

logger = get_logger("ws_manager")


class ConnectionManager:
    """WebSocket 在线连接管理器"""

    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
        self._lock = asyncio.Lock()
        self._loop = None

    def _ensure_loop(self):
        """确保有可用的 event loop（兼容同步端点调用）"""
        if self._loop is None or self._loop.is_closed():
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                self._loop = asyncio.new_event_loop()
                asyncio.set_event_loop(self._loop)
        return self._loop

    def notify_user(self, target_uid: int, msg_json: dict):
        """线程安全地向指定用户推送消息（可从同步函数调用）"""
        loop = self._ensure_loop()
        try:
            asyncio.run_coroutine_threadsafe(self.send_personal_msg(target_uid, msg_json), loop)
        except Exception:
            pass

    async def connect(self, user_id: int, websocket: WebSocket):
        """用户上线，若已存在旧连接则主动断开"""
        async with self._lock:
            old_ws = self.active_connections.get(user_id)
            if old_ws:
                try:
                    await old_ws.close(code=1000, reason="新连接取代旧连接")
                except Exception:
                    pass
            self.active_connections[user_id] = websocket

    async def disconnect(self, user_id: int):
        """用户下线，移除连接"""
        async with self._lock:
            if user_id in self.active_connections:
                del self.active_connections[user_id]

    def is_online(self, user_id: int) -> bool:
        """检查用户是否在线"""
        return user_id in self.active_connections

    def get_online_users(self) -> Set[int]:
        """获取所有在线用户 ID 集合"""
        return set(self.active_connections.keys())

    async def send_personal_msg(self, target_uid: int, msg_json: dict):
        """向指定用户推送私聊消息"""
        async with self._lock:
            ws = self.active_connections.get(target_uid)
        if ws:
            try:
                await ws.send_json(msg_json)
            except Exception:
                logger.warning(f"私聊推送失败 target_uid={target_uid}")

    async def send_group_msg(self, group_id: int, sender_uid: int, online_members: Set[int], msg_json: dict):
        """
        向群内所有在线成员广播消息（排除发送者本人）
        :param group_id: 群ID
        :param sender_uid: 发送者UID（不会被推送）
        :param online_members: 群内在线成员 UID 集合
        :param msg_json: 要推送的消息 JSON
        """
        count = 0
        for member_uid in online_members:
            if member_uid == sender_uid:
                continue
            try:
                ws = self.active_connections.get(member_uid)
                if ws:
                    await ws.send_json(msg_json)
                    count += 1
            except Exception:
                logger.warning(f"群聊推送失败 group_id={group_id} target_uid={member_uid}")

        if count > 0:
            logger.info(f"群聊消息广播 group_id={group_id} sender_uid={sender_uid} 送达{count}人")

    async def broadcast_to_group(self, group_id: int, member_ids: set, msg_json: dict):
        """向群内所有在线成员广播管理事件通知（包括操作者本人）"""
        count = 0
        for member_uid in member_ids:
            try:
                ws = self.active_connections.get(member_uid)
                if ws:
                    await ws.send_json(msg_json)
                    count += 1
            except Exception:
                logger.warning(f"群事件推送失败 group_id={group_id} target_uid={member_uid}")
        return count


# 全局单例管理器
manager = ConnectionManager()
