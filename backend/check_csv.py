import sys, csv
sys.path.insert(0, ".")
from app.core.database import SessionLocal
from app.models.models import FileUpload, BusinessArea, Team, Site
from pathlib import Path

db = SessionLocal()

# Find the latest consultant CSV
uploads = db.query(FileUpload).filter(FileUpload.file_type == "consultants").order_by(FileUpload.uploaded_at.desc()).all()
print(f"Consultant uploads: {len(uploads)}")
for u in uploads:
    exists = Path(u.stored_path).is_file() if u.stored_path else False
    print(f"  id={u.id} filename={u.filename} stored={u.stored_path} exists={exists}")

if uploads and uploads[0].stored_path:
    path = uploads[0].stored_path
    print(f"\nReading CSV: {path}")
    
    # Try different encodings
    for enc in ['utf-8-sig', 'utf-8', 'latin-1']:
        try:
            with open(path, 'r', encoding=enc) as f:
                # Try to detect delimiter
                sample = f.read(2000)
                f.seek(0)
                
                # Check if semicolon-delimited
                if sample.count(';') > sample.count(','):
                    delimiter = ';'
                else:
                    delimiter = ','
                    
                reader = csv.DictReader(f, delimiter=delimiter)
                headers = reader.fieldnames
                print(f"\nEncoding: {enc}, Delimiter: '{delimiter}'")
                print(f"Column headers ({len(headers)}):")
                for h in headers:
                    print(f"  '{h}'")
                
                # Read first 5 rows to see data
                rows = []
                for i, row in enumerate(reader):
                    if i >= 5:
                        break
                    rows.append(row)
                
                # Show BA/Team/Site related columns
                ba_cols = [h for h in headers if 'business' in h.lower() or 'ba' in h.lower() or 'area' in h.lower()]
                team_cols = [h for h in headers if 'team' in h.lower()]
                site_cols = [h for h in headers if 'site' in h.lower() or 'office' in h.lower() or 'kontor' in h.lower()]
                
                print(f"\nBA-related columns: {ba_cols}")
                print(f"Team-related columns: {team_cols}")
                print(f"Site-related columns: {site_cols}")
                
                print(f"\nSample data (first 5 rows):")
                for i, row in enumerate(rows):
                    print(f"\n  Row {i}:")
                    for col in ba_cols + team_cols + site_cols:
                        print(f"    {col} = '{row.get(col, 'MISSING')}'")
                
                # Count distinct values
                f.seek(0)
                reader2 = csv.DictReader(f, delimiter=delimiter)
                ba_vals = set()
                team_vals = set()
                site_vals = set()
                for row in reader2:
                    for col in ba_cols:
                        v = row.get(col, '').strip()
                        if v:
                            ba_vals.add(v)
                    for col in team_cols:
                        v = row.get(col, '').strip()
                        if v:
                            team_vals.add(v)
                    for col in site_cols:
                        v = row.get(col, '').strip()
                        if v:
                            site_vals.add(v)
                
                print(f"\nDistinct BA values ({len(ba_vals)}): {sorted(ba_vals)}")
                print(f"Distinct Team values ({len(team_vals)}): {sorted(team_vals)}")
                print(f"Distinct Site values ({len(site_vals)}): {sorted(site_vals)}")
                
                # Compare with DB
                db_bas = {ba.name.lower(): ba.name for ba in db.query(BusinessArea).all()}
                db_teams = {t.name.lower(): t.name for t in db.query(Team).all()}
                db_sites = {s.name.lower(): s.name for s in db.query(Site).all()}
                
                print(f"\nDB Business Areas: {list(db_bas.values())}")
                print(f"DB Teams: {list(db_teams.values())}")
                print(f"DB Sites: {list(db_sites.values())}")
                
                # Check which CSV values DON'T match DB
                unmatched_ba = [v for v in ba_vals if v.lower() not in db_bas]
                unmatched_team = [v for v in team_vals if v.lower() not in db_teams]
                unmatched_site = [v for v in site_vals if v.lower() not in db_sites]
                
                print(f"\nUnmatched BA values: {unmatched_ba}")
                print(f"Unmatched Team values: {unmatched_team}")
                print(f"Unmatched Site values: {unmatched_site}")
                
                break  # encoding worked
        except Exception as ex:
            print(f"Failed with {enc}: {ex}")

db.close()
