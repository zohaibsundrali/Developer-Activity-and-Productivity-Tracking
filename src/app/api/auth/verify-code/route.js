import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { serviceClient } from "@/utils/serverAuth";
import { normalizeEmail, hashCode } from "@/utils/verificationCodes";

export const dynamic = "force-dynamic";
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Every successful response requires proof of the emailed code. The private
// transaction serializes guesses; verified_at alone never authorizes a caller.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!email || !/^\d{4,8}$/.test(code)) return reply({ error: "Invalid or expired code." }, 400);
    const grant = randomBytes(32).toString("hex");
    const { data, error } = await serviceClient().rpc("verify_signup_code", {
      p_email: email, p_code_hash: hashCode(email, code),
      p_grant_hash: createHash("sha256").update(grant).digest("hex"),
    });
    if (error) return reply({ error: "Could not verify right now." }, 503);
    if (!data?.verified) return reply({ error: "Invalid or expired code.",
      ...(Number.isInteger(data?.attemptsRemaining) ? { attemptsRemaining: data.attemptsRemaining } : {}) }, 400);
    return reply({ success: true, verified: true, verificationGrant: grant });
  } catch {
    return reply({ error: "Could not verify right now." }, 503);
  }
}
