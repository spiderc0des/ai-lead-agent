import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { publicUrl } from "@/lib/public-origin";

export async function POST(request: Request) {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(publicUrl("/login", request), { status: 303 });
}
