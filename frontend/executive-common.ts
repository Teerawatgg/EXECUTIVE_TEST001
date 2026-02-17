// executive/frontend/ts/executive-common.ts

export const API_BASE = "../api/";
export const LOOKUPS_BASE = "../api/lookups/";

export type ApiOk<T> = { success: true } & T;
export type ApiFail = { success: false; message?: string; error?: string };
export type ApiRes<T> = ApiOk<T> | ApiFail;

export function $id<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  // ให้หน้าไป login ถ้า session หลุด
  if (res.status === 401 || res.status === 403) {
    throw new Error("UNAUTHORIZED");
  }

  return (await res.json()) as T;
}

export async function postJSON<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("UNAUTHORIZED");
  }

  return (await res.json()) as T;
}

// ===== Auth Guard (ใช้ me.php ตามโครง executive) =====
export async function requireLogin(loginPage = "login.html") {
  try {
    const me = await getJSON<ApiRes<any>>(API_BASE + "me.php");
    if (!me.success) {
      location.replace(loginPage);
      return null;
    }
    return me;
  } catch (e: any) {
    location.replace(loginPage);
    return null;
  }
}

// ===== lookup helper =====
export async function loadLookup<T>(file: string): Promise<ApiRes<T>> {
  return await getJSON<ApiRes<T>>(LOOKUPS_BASE + file);
}

// ===== utilities =====
export function toInt(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

export function safeText(el: HTMLElement | null, value: any) {
  if (!el) return;
  el.textContent = value === undefined || value === null || value === "" ? "-" : String(value);
}