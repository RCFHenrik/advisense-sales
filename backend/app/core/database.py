from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.core.config import settings

# Build engine with DB-specific settings
_connect_args = {}
if settings.is_sqlite:
    _connect_args["check_same_thread"] = False

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=_connect_args,
    echo=settings.DEBUG,
    # PostgreSQL pool settings (ignored for SQLite)
    **({} if settings.is_sqlite else {"pool_size": 10, "max_overflow": 20, "pool_pre_ping": True}),
)

# Enable WAL mode and foreign keys for SQLite
if settings.is_sqlite:
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
