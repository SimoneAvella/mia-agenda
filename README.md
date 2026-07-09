# Mia Agenda - Personal Manager

**Mia Agenda** è una web application full-stack progettata per gestire compiti, appuntamenti e note in modo intuitivo attraverso un'interfaccia moderna e reattiva con funzionalità di Drag & Drop.

## 🚀 Tecnologie Utilizzate

Questo progetto è stato sviluppato adottando un'architettura full-stack divisa tra Frontend e Backend:

### Frontend
- **React.js**: Libreria principale per la creazione della UI.
- **Vite**: Strumento di build super veloce.
- **dnd-kit**: Libreria per l'implementazione fluida e accessibile del Drag & Drop.
- **CSS Vanilla (Glassmorphism)**: Interfaccia utente curata, moderna e reattiva, che sfrutta animazioni fluide e design glassmorfico.

### Backend
- **Python 3 / FastAPI**: Framework backend ad altissime prestazioni per la gestione delle API REST.
- **Uvicorn**: Server ASGI fulmineo.
- **SQLAlchemy (SQLite / PostgreSQL)**: ORM per la gestione del database, strutturato per funzionare in locale tramite SQLite o in produzione tramite PostgreSQL.
- **Autenticazione**: Sistema di sicurezza con MFA (Autenticazione a Due Fattori) integrato.

## 🧠 Collaborazione con Intelligenza Artificiale
Questo progetto è stato architettato, sviluppato e debuggato adottando un flusso di lavoro **AI Pair Programming**. L'obiettivo è stato concentrarsi sulla definizione dei requisiti, progettazione del sistema e gestione del ciclo di vita del software, guidando un assistente AI nella stesura del codice, e dimostrando così una forte capacità di problem-solving e system design nell'era dell'Intelligenza Artificiale.

## 📦 Installazione e Avvio (Locale)

Per eseguire l'Agenda sul tuo computer locale in ambiente di sviluppo, segui questi passaggi:

1. **Clona il repository**:
   ```bash
   git clone https://github.com/simoneavella-cpu/mia-agenda.git
   cd mia-agenda
   ```

2. **Installa le dipendenze Python**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Installa le dipendenze Node.js (Frontend)**:
   ```bash
   cd Frontend_agenda
   npm install
   ```

4. **Avvia l'applicazione**:
   In ambiente Windows, puoi usare i comodi script batch presenti nella cartella root:
   - Fai doppio clic su `Avvia_Agenda.bat` per avviare il backend FastAPI (che servirà automaticamente i file React precompilati).

## 🌍 Deploy
L'applicazione è configurata per il deploy su piattaforme Cloud come Render.com, tramite il `Procfile` e lo script automatizzato `build.sh`.

## 🔒 Sicurezza
Il database locale (`agenda_locale.db`) e i file di configurazione (`auth_config.json`) non sono inclusi in questo repository per proteggere i dati personali.

---
*Progetto personale realizzato da Simone Avella.*
