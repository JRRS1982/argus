import type { IdentityState, ProviderId } from "@/types";

const PROVIDERS: Record<ProviderId, { short: string; label: string }> = {
  bitbucket: { short: "BB", label: "Bitbucket" },
  github: { short: "GH", label: "GitHub" },
};

// Archived is the normal, expected state of every Bitbucket identity, so it is plain
// grey like the chrome around it — only `missing` is allowed to look like a warning.
const STATE_STYLE: Record<IdentityState, string> = {
  active: "bg-green-50 text-green-800 border-green-300",
  archived: "bg-gray-100 text-gray-600 border-gray-300",
  missing: "bg-amber-50 text-amber-800 border-amber-300",
};

export type BadgeIdentity = { provider: ProviderId; state?: IdentityState };

export default function IdentityBadges({ identities }: { identities: BadgeIdentity[] }) {
  return (
    <span className="inline-flex gap-1">
      {identities.map((i, n) => {
        const { short, label } = PROVIDERS[i.provider];
        return (
          <span key={`${i.provider}-${n}`} title={i.state ? `${label} · ${i.state}` : label}
            className={`text-[10px] leading-4 px-1 rounded border font-medium ${
              i.state ? STATE_STYLE[i.state] : "bg-gray-100 text-gray-600 border-gray-300"}`}>
            {short}
          </span>
        );
      })}
    </span>
  );
}
