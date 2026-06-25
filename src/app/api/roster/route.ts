import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getUsers, getRepos, setUserIncluded, setRepoIncluded } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  return NextResponse.json({ users: getUsers(db), repos: getRepos(db) });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || (body.kind !== "user" && body.kind !== "repo") || typeof body.id !== "string" || typeof body.included !== "boolean") {
    return NextResponse.json({ error: "Expected { kind: 'user'|'repo', id: string, included: boolean }" }, { status: 400 });
  }
  const db = getDb();
  if (body.kind === "user") setUserIncluded(db, body.id, body.included);
  else setRepoIncluded(db, body.id, body.included);
  return NextResponse.json({ ok: true });
}
