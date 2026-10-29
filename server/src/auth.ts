import crypto from "crypto";

const AUTH_SECRET = process.env.AUTH_SECRET || "ALLBOT-SECURE-WORKSPACE-SECRET-KEY-2026";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, combined: string): boolean {
  try {
    const [salt, key] = combined.split(":");
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, "hex");
    const matchBuffer = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(keyBuffer, matchBuffer);
  } catch (err) {
    return false;
  }
}

export function createAuthToken(userId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, email, iat: Date.now() })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAuthToken(token: string): { userId: string; email: string } | null {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;

    const expectedSignature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return { userId: data.userId, email: data.email };
  } catch (err) {
    return null;
  }
}
