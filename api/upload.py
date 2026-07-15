"""
文件 / 图片上传模块
- 支持格式：JPG、PNG、XLSX、PPTX、DOCX、PDF
- 文件存储到 static/uploads/ 按日期分类
- 返回可访问的文件 URL
"""
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from datetime import datetime
import os
import uuid

from utils.security import get_current_user_from_token
from database.db import get_db, UploadResource
from sqlalchemy.orm import Session
from fastapi import Depends

from utils.logger import get_logger

router = APIRouter(prefix="/upload", tags=["文件上传"])
logger = get_logger("upload")

# 允许的文件类型
ALLOWED_IMAGE = {"image/jpeg", "image/png"}
ALLOWED_FILE = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",   # xlsx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # pptx
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",    # docx
    "application/pdf",
}
MAX_IMAGE_SIZE = 10 * 1024 * 1024   # 10MB
MAX_FILE_SIZE  = 50 * 1024 * 1024   # 50MB


def get_upload_dir() -> str:
    """获取按日期组织的上传目录"""
    today = datetime.now().strftime("%Y%m%d")
    upload_dir = os.path.join("static", "uploads", today)
    os.makedirs(upload_dir, exist_ok=True)
    return upload_dir


@router.post("/file")
async def upload_file(
    token: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """上传图片或文件，自动识别类型"""
    current_uid = get_current_user_from_token(token)

    # 读取文件内容
    content = await file.read()
    file_size = len(content)

    # 校验文件类型和大小
    if file.content_type in ALLOWED_IMAGE:
        if file_size > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=400, detail="图片大小不能超过 10MB")
    elif file.content_type in ALLOWED_FILE:
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="文件大小不能超过 50MB")
    else:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {file.content_type}")

    # 生成唯一文件名（保留原始扩展名）
    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    unique_name = f"{uuid.uuid4().hex}{ext}"

    # 存储文件
    upload_dir = get_upload_dir()
    file_path = os.path.join(upload_dir, unique_name)
    with open(file_path, "wb") as f:
        f.write(content)

    # 相对路径存入数据库
    relative_path = file_path.replace("\\", "/")
    resource = UploadResource(
        user_id=current_uid,
        file_name=file.filename or unique_name,
        save_path=relative_path,
        file_size=file_size
    )
    db.add(resource)
    db.commit()
    db.refresh(resource)

    # 返回可直接访问的 URL
    file_url = f"/{relative_path}"

    logger.info(f"文件上传成功 uid={current_uid} name={file.filename} size={file_size} url={file_url}")
    return {
        "code": 200,
        "msg": "上传成功",
        "resource_id": resource.id,
        "file_name": resource.file_name,
        "file_url": file_url,
        "file_size": file_size
    }
