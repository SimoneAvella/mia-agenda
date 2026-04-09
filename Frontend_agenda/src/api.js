import axios from "axios";

const BASE_URL = import.meta.env.DEV ? "http://127.0.0.1:8000" : "";

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
  try {
    const res = await api.get(`/auth/check`);
    return res.data.status === "ok";
  } catch (e) {
    return false;
  }
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