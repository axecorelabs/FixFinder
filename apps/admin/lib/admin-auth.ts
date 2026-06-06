import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

const ADMIN_SESSION_COOKIE = "fixfinder_admin_session";

function readEnv(name: string): string | null {
  return process.env[name] ?? null;
}

function buildSessionToken(email: string, password: string, secret: string): string {
  return createHmac("sha256", secret).update(`${email}:${password}`).digest("hex");
}

export function validateAdminCredentials(email: string, password: string): boolean {
  const adminEmail = readEnv("ADMIN_EMAIL");
  const adminPassword = readEnv("ADMIN_PASSWORD");
  if (!adminEmail || !adminPassword) {
    return false;
  }
  return email === adminEmail && password === adminPassword;
}

export async function createAdminSession(): Promise<void> {
  const adminEmail = readEnv("ADMIN_EMAIL");
  const adminPassword = readEnv("ADMIN_PASSWORD");
  const authSecret = readEnv("AUTH_SECRET");
  if (!adminEmail || !adminPassword || !authSecret) {
    throw new Error("ADMIN_EMAIL, ADMIN_PASSWORD, and AUTH_SECRET are required.");
  }
  const token = buildSessionToken(adminEmail, adminPassword, authSecret);

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12
  });
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const adminEmail = readEnv("ADMIN_EMAIL");
  const adminPassword = readEnv("ADMIN_PASSWORD");
  const authSecret = readEnv("AUTH_SECRET");
  if (!adminEmail || !adminPassword || !authSecret) {
    return false;
  }
  const expected = buildSessionToken(adminEmail, adminPassword, authSecret);

  const cookieStore = await cookies();
  const current = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  if (!current) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const currentBuffer = Buffer.from(current, "utf8");

  if (expectedBuffer.length !== currentBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, currentBuffer);
}
