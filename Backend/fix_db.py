import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL")
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL:
    print("ERRORE: DATABASE_URL non trovato!")
    exit(1)

engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    print("Verifica database in corso...")
    
    # Aggiunge la colonna 'time' se manca
    try:
        conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time VARCHAR;"))
        print("Colonna 'time' aggiunta/verificata con successo.")
    except Exception as e:
        print(f"Nota su colonna 'time': {e}")
        
    # Crea la tabella subscriptions se manca
    try:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS subscriptions (
                endpoint VARCHAR PRIMARY KEY,
                subscription_info TEXT
            );
        """))
        conn.commit()
        print("Tabella 'subscriptions' verificata con successo.")
    except Exception as e:
        print(f"Errore tabella subscriptions: {e}")

print("OPERAZIONE COMPLETATA. I tuoi task dovrebbero riapparire ora!")
