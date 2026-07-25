"""
全局日志系统
- 控制台输出：开发调试
- 文件写入：持久化存储，按日期轮转
- 格式：时间 | 级别 | 模块 | 用户UID | 消息
"""
import logging
import os
from logging.handlers import RotatingFileHandler

# 日志目录
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)

# 日志格式
LOG_FORMAT = logging.Formatter(
    "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)


def get_logger(name: str) -> logging.Logger:
    """
    获取指定名称的 logger 实例。
    如果 logger 尚未配置 handler，自动添加控制台 + 文件 handler。
    """
    logger = logging.getLogger(name)

    if not logger.handlers:
        logger.setLevel(logging.DEBUG)

        # 控制台 handler
        console = logging.StreamHandler()
        console.setLevel(logging.INFO)
        console.setFormatter(LOG_FORMAT)
        logger.addHandler(console)

        # 文件 handler（按大小轮转，单文件最大 10MB，保留 5 个备份）
        try:
            file_handler = RotatingFileHandler(
                os.path.join(LOG_DIR, "app.log"),
                maxBytes=10 * 1024 * 1024,
                backupCount=5,
                encoding="utf-8"
            )
            file_handler.setLevel(logging.DEBUG)
            file_handler.setFormatter(LOG_FORMAT)
            logger.addHandler(file_handler)
        except PermissionError:
            pass

    return logger


def log_error(logger: logging.Logger, msg: str, exc_info: bool = True):
    """
    记录错误日志，包含完整的异常堆栈。
    用法：
        try:
            ...
        except Exception as e:
            log_error(logger, f"用户注册失败: {e}")
    """
    logger.error(msg, exc_info=exc_info)


def log_api_call(logger: logging.Logger, uid: int = None, path: str = "", detail: str = ""):
    """
    记录 API 调用信息。
    例：log_api_call(logger, uid=1, path="/user/login", detail="success")
    """
    uid_str = f"uid={uid} | " if uid else ""
    path_str = f"[{path}] " if path else ""
    logger.info(f"{uid_str}{path_str}{detail}")
