from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import Base, engine
from app.core.migrations import run_migrations
from app.api.routes import (
    auth,
    contacts,
    employees,
    outreach,
    negations,
    templates,
    hot_topics,
    uploads,
    dashboard,
    admin,
    meetings,
)

# Run schema migrations, then create any missing tables
run_migrations()
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:8001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(contacts.router, prefix="/api/contacts", tags=["Contacts"])
app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
app.include_router(outreach.router, prefix="/api/outreach", tags=["Outreach"])
app.include_router(negations.router, prefix="/api/negations", tags=["Negations"])
app.include_router(templates.router, prefix="/api/templates", tags=["Email Templates"])
app.include_router(hot_topics.router, prefix="/api/hot-topics", tags=["Hot Topics"])
app.include_router(uploads.router, prefix="/api/uploads", tags=["File Uploads"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(meetings.router, prefix="/api/meetings", tags=["Meetings"])


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


# ── Production: serve the built React app as static files (Railway) ──────────
import os
from fastapi.staticfiles import StaticFiles

_dist = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
)
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="spa")
