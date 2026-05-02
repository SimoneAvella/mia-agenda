import axios from "axios";

// Determina se siamo in sviluppo o produzione
// Inserisci qui la tua URL di Render (es. https://mia-agenda.onrender.com)
const RENDER_URL = "https://mia-agenda.onrender.com"; 
const BASE_URL = import.meta.env.DEV ? RENDER_URL : "";

// Configura axios per includere il token se presente
const api = axios.create({
  baseURL: BASE_URL
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem("agenda_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function loginStep1(password) {
  const res = await api.post(`/auth/login`, { password });
  return res.data;
}

export async function loginStep2(password, code, remember) {
  const res = await api.post(`/auth/mfa`, { password, code, remember });
  if (res.data.token) {
    localStorage.setItem("agenda_token", res.data.token);
  }
  return res.data;
}

export async function checkAuth() {
  const token = localStorage.getItem("agenda_token");
  if (!token) return false;

  const maxRetries = 15; // 15 tentativi = circa 45-50 secondi di attesa risveglio
  const retryDelay = 3000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      // Usiamo un timeout breve per ogni tentativo per non bloccare tutto
      const res = await api.get(`/auth/check`, { timeout: 5000 });
      return res.data.status === "ok";
    } catch (e) {
      // Se il server risponde 401, il token è proprio scaduto. Esci.
      if (e.response && e.response.status === 401) {
        return false;
      }

      // Se è un errore di rete o timeout, il server probabilmente sta dormendo.
      if (i < maxRetries - 1) {
        console.log(`Risveglio server in corso... (${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }
      return false;
    }
  }
  return false;
}

export function logout() {
  localStorage.removeItem("agenda_token");
}

export async function getTasks() {
  const res = await api.get(`/tasks`);
  return res.data;
}

export async function updateTasks(tasks) {
  const res = await api.post(`/tasks`, tasks);
  return res.data;
}

export async function moveTaskAPI(from_date, to_date, task_id) {
  const res = await api.post(`/move_task`, {
    from_date,
    to_date,
    task_id
  });
  return res.data;
}