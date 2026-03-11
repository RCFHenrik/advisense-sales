import sys
sys.path.insert(0, ".")
from app.core.database import SessionLocal
from app.models.models import Employee, FileUpload
from pathlib import Path

db = SessionLocal()
emps = db.query(Employee).filter(Employee.is_active == True).all()
print("Active employees:", len(emps))
for e in emps:
    ba = e.business_area.name if e.business_area else "none"
    tm = e.team.name if e.team else "none"
    print("  %d: %s (%s) BA=%s Team=%s" % (e.id, e.name, e.role.value, ba, tm))

uploads = db.query(FileUpload).filter(FileUpload.file_type == "consultants").all()
print("\nConsultant uploads:", len(uploads))
for u in uploads:
    exists = Path(u.stored_path).is_file() if u.stored_path else False
    print("  %d: %s stored=%s exists=%s" % (u.id, u.filename, u.stored_path, exists))
db.close()
