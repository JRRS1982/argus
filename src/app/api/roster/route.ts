import { NextRequest, NextResponse } from "next/server";
import { config, hasBitbucketCredentials } from "@/config";
import { getDb } from "@/lib/db";
import {
  getPeople, getServices, setPersonIncluded, setServiceIncluded,
  linkPersonIdentity, linkServiceIdentity, splitPersonIdentity, splitServiceIdentity, AmbiguousSplitError,
} from "@/lib/db/canonical";
import { isDemoRequest } from "@/lib/demo/request";
import { buildDemoDataset } from "@/lib/demo/fixture";
import type { ProviderId, Service } from "@/types";

export const runtime = "nodejs";

// Providers that have an active identity on a ticked service but no credentials here.
// Sync drops those identities without a word, so the Team tab needs telling.
const unconfiguredProviders = (services: Service[]): ProviderId[] => {
  const configured: Record<ProviderId, boolean> = {
    bitbucket: hasBitbucketCredentials(), github: Boolean(config.githubToken),
  };
  const missing = new Set<ProviderId>();
  for (const s of services) {
    if (!s.included) continue;
    for (const i of s.identities) if (i.state === "active" && !configured[i.provider]) missing.add(i.provider);
  }
  return [...missing].sort();
};

export async function GET(req: NextRequest) {
  try {
    if (isDemoRequest(req.nextUrl)) {
      const { people, services } = buildDemoDataset(new Date().toISOString());
      return NextResponse.json({ people, services, unconfiguredProviders: [] });
    }
    const db = getDb();
    const services = getServices(db);
    return NextResponse.json({ people: getPeople(db), services, unconfiguredProviders: unconfiguredProviders(services) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const isProvider = (v: unknown): v is ProviderId => v === "bitbucket" || v === "github";

// Body, keyed by canonical id — never by account id or slug:
//   { kind, id, included }                       tick / untick
//   { kind, action: "merge", provider, key, intoId }   link an identity into another entity
//   { kind, action: "split", provider, key }           give an identity its own entity again
// kind is "person" | "service". Nothing here ever deletes an identity or its history.
export async function PATCH(req: NextRequest) {
  // The client never appends `?demo=1` to this write — the UI disables the roster
  // checkboxes instead — so this guard is defence-in-depth, not the active protection.
  if (isDemoRequest(req.nextUrl)) {
    return NextResponse.json(
      { error: "Demo mode shows fabricated data — turn it off to change the roster." },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => null);
  const bad = () => NextResponse.json({
    error: "Expected { kind: 'person'|'service', id: number, included: boolean } or { kind, action: 'merge'|'split', provider, key, intoId? }",
  }, { status: 400 });
  if (!body || (body.kind !== "person" && body.kind !== "service")) return bad();
  const person = body.kind === "person";

  try {
    const db = getDb();
    if (body.action === "merge" || body.action === "split") {
      if (!isProvider(body.provider) || typeof body.key !== "string") return bad();
      if (body.action === "split") {
        (person ? splitPersonIdentity : splitServiceIdentity)(db, body.provider, body.key);
      } else {
        if (!Number.isInteger(body.intoId)) return bad();
        (person ? linkPersonIdentity : linkServiceIdentity)(db, body.provider, body.key, body.intoId);
      }
      return NextResponse.json({ ok: true });
    }
    if (!Number.isInteger(body.id) || typeof body.included !== "boolean") return bad();
    (person ? setPersonIncluded : setServiceIncluded)(db, body.id, body.included);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // A refused split is the caller's request being unsafe, not a server fault.
    if (err instanceof AmbiguousSplitError) return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
