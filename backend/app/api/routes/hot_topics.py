from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user, require_role
from app.models.models import HotTopic, Employee, RoleEnum, LanguageEnum
from app.schemas.schemas import HotTopicOut, HotTopicCreate

router = APIRouter()


@router.get("/", response_model=List[HotTopicOut])
def list_hot_topics(
    business_area_id: Optional[int] = None,
    responsibility_domain: Optional[str] = None,
    language: Optional[LanguageEnum] = None,
    active_only: bool = True,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    query = db.query(HotTopic)
    if active_only:
        query = query.filter(HotTopic.is_active == True)
    if business_area_id:
        query = query.filter(HotTopic.business_area_id == business_area_id)
    if responsibility_domain:
        query = query.filter(HotTopic.responsibility_domain == responsibility_domain)
    if language:
        query = query.filter(HotTopic.language == language)

    return [HotTopicOut.model_validate(t) for t in query.order_by(HotTopic.created_at.desc()).all()]


@router.post("/", response_model=HotTopicOut)
def create_hot_topic(
    data: HotTopicCreate,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    topic = HotTopic(
        business_area_id=data.business_area_id,
        responsibility_domain=data.responsibility_domain,
        topic_text=data.topic_text,
        language=data.language,
    )
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return HotTopicOut.model_validate(topic)


@router.delete("/{topic_id}")
def deactivate_hot_topic(
    topic_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(require_role(RoleEnum.ADMIN, RoleEnum.BA_MANAGER)),
):
    topic = db.query(HotTopic).filter(HotTopic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Hot topic not found")
    topic.is_active = False
    db.commit()
    return {"status": "deactivated"}
