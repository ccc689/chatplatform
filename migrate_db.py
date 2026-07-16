"""
数据库迁移脚本 — 向已存在的表添加新列，并创建新表
运行方式: venv/Scripts/python.exe migrate_db.py
"""
from database.db import engine, Base, SessionLocal
from database.models.chat import GroupEvent, GroupJoinRequest, GroupMuteSetting
from database.models.friend import FriendRemark, FriendMuteSetting
from sqlalchemy import text
from utils.logger import get_logger

logger = get_logger("migrate")

MIGRATIONS = [
    # ========== chat_group 表新增字段 ==========
    {
        "desc": "chat_group.admin_ids (JSON, 管理员UID列表)",
        "sql": "ALTER TABLE chat_group ADD COLUMN admin_ids JSON DEFAULT NULL COMMENT '管理员UID列表(JSON数组)'"
    },
    {
        "desc": "chat_group.avatar (群头像URL)",
        "sql": "ALTER TABLE chat_group ADD COLUMN avatar VARCHAR(255) DEFAULT '' COMMENT '群头像URL'"
    },
    {
        "desc": "chat_group.announcement (群公告)",
        "sql": "ALTER TABLE chat_group ADD COLUMN announcement TEXT DEFAULT NULL COMMENT '群公告'"
    },
    {
        "desc": "chat_group.join_mode (入群模式)",
        "sql": "ALTER TABLE chat_group ADD COLUMN join_mode SMALLINT DEFAULT 1 COMMENT '入群模式: 0自由加入 1需验证'"
    },
    {
        "desc": "chat_group.is_disband (解散标记)",
        "sql": "ALTER TABLE chat_group ADD COLUMN is_disband SMALLINT DEFAULT 0 COMMENT '0正常 1已解散'"
    },
    # ========== group_member 表新增字段 ==========
    {
        "desc": "group_member.role (成员角色)",
        "sql": "ALTER TABLE group_member ADD COLUMN role SMALLINT DEFAULT 0 COMMENT '0普通成员 1管理员 2群主'"
    },
    {
        "desc": "group_member.mute_until (禁言截止时间)",
        "sql": "ALTER TABLE group_member ADD COLUMN mute_until DATETIME NULL COMMENT '禁言截止时间(null=未禁言)'"
    },
    {
        "desc": "group_member.is_quit (退群标记)",
        "sql": "ALTER TABLE group_member ADD COLUMN is_quit SMALLINT DEFAULT 0 COMMENT '0在群 1已退群'"
    },
]


def run_migration():
    db = SessionLocal()
    try:
        # 1. ALTER TABLE statements
        print("=" * 60)
        print("  ChatPlatform — Database Migration")
        print("=" * 60)
        for m in MIGRATIONS:
            try:
                db.execute(text(m["sql"]))
                db.commit()
                print(f"  [OK] {m['desc']}")
            except Exception as e:
                db.rollback()
                err = str(e)
                if "Duplicate column" in err or "already exists" in err.lower():
                    print(f"  [SKIP] {m['desc']} (already exists)")
                else:
                    print(f"  [FAIL] {m['desc']} -- {err}")

        # 2. Create new tables
        print(f"\n  --- Create New Tables ---")
        Base.metadata.create_all(bind=engine)
        from sqlalchemy import inspect
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        for t in ["group_event", "group_join_request", "group_mute_setting", "friend_remark", "friend_mute_setting"]:
            if t in tables:
                print(f"  [OK] {t}")
            else:
                print(f"  [FAIL] {t}")

        # 3. Fix existing owner roles
        print(f"\n  --- Fix Owner Roles ---")
        result = db.execute(text("""
            UPDATE group_member gm
            JOIN chat_group cg ON gm.group_id = cg.id AND gm.user_id = cg.owner_id
            SET gm.role = 2
            WHERE gm.role = 0
        """))
        db.commit()
        print(f"  [OK] Updated {result.rowcount} owner(s) role=2")

        # 4. Verify
        print(f"\n  --- Verify ---")
        columns_result = db.execute(text("""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME IN ('chat_group', 'group_member')
              AND COLUMN_NAME IN ('admin_ids', 'avatar', 'announcement', 'join_mode', 'is_disband', 'role', 'mute_until', 'is_quit')
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """))
        for row in columns_result:
            print(f"  {row[0]}.{row[1]} ({row[2]})")

        print(f"\n[OK] Migration complete!")
        print(f"[!] Please restart the server.")

    except Exception as e:
        db.rollback()
        print(f"\n[FAIL] Migration error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run_migration()
