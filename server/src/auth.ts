import crypto from "crypto";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function resolveAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET wajib diisi (minimal 32 karakter) saat NODE_ENV=production");
  }
  console.warn("[Auth] AUTH_SECRET belum diisi — memakai secret acak sementara, semua login hilang saat server restart.");
  return crypto.randomBytes(32).toString("hex");
}

const AUTH_SECRET = resolveAuthSecret();

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
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return null;
    }

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (typeof data.iat !== "number" || Date.now() - data.iat > TOKEN_TTL_MS) return null;
    return { userId: data.userId, email: data.email };
  } catch (err) {
    return null;
  }
}
