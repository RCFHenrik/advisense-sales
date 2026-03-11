"""In-app notifications for campaign assignments and other events."""

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.models import Notification, Employee
from app.schemas.schemas import NotificationOut, UnreadCountOut

router = APIRouter()


@router.get("/", response_model=List[NotificationOut])
def list_notifications(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """List notifications for the current user, newest first."""
    notifications = (
        db.query(Notification)
        .filter(Notification.employee_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
        .all()
    )
    return [NotificationOut.model_validate(n) for n in notifications]


@router.get("/unread-count", response_model=UnreadCountOut)
def get_unread_count(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Return count of unread notifications for the current user."""
    count = (
        db.query(func.count(Notification.id))
        .filter(
            Notification.employee_id == current_user.id,
            Notification.is_read == False,  # noqa: E712
        )
        .scalar()
    )
    return UnreadCountOut(count=count or 0)


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Mark a single notification as read."""
    notification = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.employee_id == current_user.id,
    ).first()
    if not notification:
        raise HTTPException(404, "Notification not found")

    notification.is_read = True
    db.commit()
    return {"status": "ok"}


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: Employee = Depends(get_current_user),
):
    """Mark all notifications as read for the current user."""
    db.query(Notification).filter(
        Notification.employee_id == current_user.id,
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return {"status": "ok"}
