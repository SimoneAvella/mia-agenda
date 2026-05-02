import bcrypt
import getpass

print("--- GENERATORE HASH PER AGENDA ---")
try:
    password = getpass.getpass("Inserisci la password scelta: ")
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    print("\nCopia questa stringa su Render in ADMIN_PASSWORD_HASH:")
    print("-" * 40)
    print(hashed.decode())
    print("-" * 40)
except Exception as e:
    print(f"Errore: {e}")

input("\nPremi Invio per uscire...")
