import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { budgetStatus } from "@/agent/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remaining shared budget, for the run form. Signed-in users only. */
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(await budgetStatus());
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
