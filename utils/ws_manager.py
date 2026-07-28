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
        """获取可用的 event loop。优先返回 connect() 时捕获的主循环。"""
        if self._loop is None or self._loop.is_closed():
            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                # 同步端点调用（线程池中无运行循环）→ 复用 connect() 存储的主循环
                pass
        return self._loop

    def notify_user(self, target_uid: int, msg_json: dict):
        """线程安全地向指定用户推送消息（可从同步函数调用）"""
        loop = self._ensure_loop()
        if loop is None or loop.is_closed():
            logger.warning(f"[notify_user] 无可用事件循环，跳过推送 target={target_uid}")
            return
        try:
            asyncio.run_coroutine_threadsafe(self.send_personal_msg(target_uid, msg_json), loop)
            logger.info(f"[notify_user] 已调度 target={target_uid} type={msg_json.get('type')}")
        except Exception as e:
            logger.error(f"[notify_user] 调度失败 target={target_uid}: {e}")

    async def connect(self, user_id: int, websocket: WebSocket):
        """用户上线，若已存在旧连接则主动断开"""
        # 在主事件循环上运行 → 捕获循环引用供同步端点（sync endpoint）使用
        if self._loop is None or self._loop.is_closed():
            self._loop = asyncio.get_running_loop()
            logger.info("[connect] 已捕获主事件循环")
        async with self._lock:
            old_ws = self.active_connections.get(user_id)
            if old_ws:
                try:
                    await old_ws.close(code=1000, reason="新连接取代旧连接")
                except Exception:
                    pass
            self.active_connections[user_id] = websocket
        logger.info(f"[connect] 用户上线 uid={user_id} 在线数={len(self.active_connections)}")

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
