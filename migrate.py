"""Migration script - adiciona coluna bucket e outras melhorias."""
import sqlite3, os

db_path = os.path.join(os.path.dirname(__file__), 'residenteai.db')
conn = sqlite3.connect(db_path)

migrations = [
    "ALTER TABLE login_attempts ADD COLUMN bucket TEXT NOT NULL DEFAULT 'login'",
]

for sql in migrations:
    try:
        conn.execute(sql)
        print(f"OK: {sql[:60]}")
    except Exception as e:
        print(f"Skip (já existe): {e}")

conn.commit()
conn.close()
print("Migration concluida.")
