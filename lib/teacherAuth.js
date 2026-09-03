import { getSupabase } from "./supabase";

const TEACHER_SESSION_KEY = "hb_teacher";

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToB64(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

export function randomSalt() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 120000, hash: "SHA-256" },
    key,
    256
  );
  return bytesToB64(new Uint8Array(bits));
}

export function readTeacherSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(TEACHER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeTeacherSession(teacher) {
  sessionStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(teacher));
}

export function clearTeacherSession() {
  sessionStorage.removeItem(TEACHER_SESSION_KEY);
}

export async function registerTeacher(username, password) {
  const name = String(username || "").trim();
  if (name.length < 2) throw new Error("Username must be at least 2 characters.");
  if (String(password || "").length < 4) throw new Error("Password must be at least 4 characters.");
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const { data, error } = await getSupabase().rpc("register_teacher", {
    p_username: name,
    p_salt: salt,
    p_hash: hash
  });
  if (error) throw error;
  const payload = typeof data === "string" ? JSON.parse(data) : data;
  if (!payload?.ok) throw new Error(payload?.error || "Could not register.");
  const teacher = { id: payload.id, username: payload.username };
  writeTeacherSession(teacher);
  return teacher;
}

export async function listTeacherNames() {
  const { data, error } = await getSupabase().rpc("list_teacher_usernames");
  if (error) throw error;
  const names = typeof data === "string" ? JSON.parse(data) : data;
  return Array.isArray(names) ? names : [];
}
  const name = String(username || "").trim();
  if (!name || !password) throw new Error("Enter username and password.");
  const { data: salt, error: saltErr } = await getSupabase().rpc("get_teacher_salt", { p_username: name });
  if (saltErr) throw saltErr;
  if (!salt) throw new Error("Incorrect username or password.");
  const hash = await hashPassword(password, salt);
  const { data, error } = await getSupabase().rpc("login_teacher", {
    p_username: name,
    p_hash: hash
  });
  if (error) throw error;
  const payload = typeof data === "string" ? JSON.parse(data) : data;
  if (!payload?.ok) throw new Error(payload?.error || "Incorrect username or password.");
  const teacher = { id: payload.id, username: payload.username };
  writeTeacherSession(teacher);
  return teacher;
}
