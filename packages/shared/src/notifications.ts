/**
 * Notification content builders (pure functions).
 *
 * Business-initiated WhatsApp messages must use approved templates, so each
 * builder returns the ordered template variables ({{1}}..{{n}}). The long-form
 * message is used by the Console provider and for in-session text replies.
 */
import {
  DiffAgent,
  GroupEntry,
  ManifestDiff,
  ManifestSnapshot,
  MovedAgent,
} from './types.js';
import { formatDateLong, formatTime12h } from './time.js';

/** Mask a phone number: keep the last 4 digits, mask the rest. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  const masked = '•'.repeat(Math.max(0, digits.length - 4));
  return `${masked}${last4}`;
}

/** First name + last 4 digits, for public pages. */
export function publicAgentLabel(name: string, phone: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  const last4 = phone.replace(/\D/g, '').slice(-4);
  return `${first} ••••${last4}`;
}

/** "Ikeja-Ogba (12), Lekki-Ajah (14)" — compact route list, biggest first. */
export function compactRouteList(snapshot: ManifestSnapshot, max = 6): string {
  const totals = new Map<string, number>();
  for (const b of snapshot.timeBuckets) {
    for (const z of b.zones) {
      totals.set(z.zoneName, (totals.get(z.zoneName) ?? 0) + z.totalAgents);
    }
  }
  const parts = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name, n]) => `${name} (${n})`);
  return parts.join(', ');
}

/** "6:30 PM – 8:00 PM" or "7:00 PM" for a single bucket. */
export function shiftSummary(snapshot: ManifestSnapshot): string {
  const labels = snapshot.timeBuckets.map((b) => b.label);
  if (labels.length === 0) return '—';
  if (labels.length === 1) return labels[0];
  return `${labels[0]} – ${labels[labels.length - 1]}`;
}

/**
 * transport_manifest template vars:
 * {{1}} date, {{2}} shift ends, {{3}} agent count, {{4}} campaign count,
 * {{5}} compact routes, {{6}} public link
 */
export function buildManifestTemplateVars(snapshot: ManifestSnapshot, publicUrl: string): string[] {
  return [
    formatDateLong(snapshot.date),
    shiftSummary(snapshot),
    String(snapshot.totalAgents),
    String(snapshot.byCampaign.length),
    compactRouteList(snapshot),
    publicUrl,
  ];
}

/** "2 (Ada O., Bola A.)" / "0" — diff counts with up to 3 sample names. */
export function diffSummary(agents: DiffAgent[]): string {
  if (agents.length === 0) return '0';
  const names = agents.slice(0, 3).map((a) => a.name);
  const more = agents.length > 3 ? `, +${agents.length - 3} more` : '';
  return `${agents.length} (${names.join(', ')}${more})`;
}

/**
 * transport_manifest_update template vars:
 * {{1}} date, {{2}} version, {{3}} added, {{4}} removed, {{5}} moved, {{6}} link
 */
export function buildUpdateTemplateVars(
  date: string,
  version: number,
  diff: ManifestDiff,
  publicUrl: string,
): string[] {
  return [
    formatDateLong(date),
    String(version),
    diffSummary(diff.added),
    diffSummary(diff.removed),
    diffSummary(diff.moved),
    publicUrl,
  ];
}

/**
 * transport_confirm_reminder template vars:
 * {{1}} date, {{2}} public link
 */
export function buildReminderTemplateVars(date: string, publicUrl: string): string[] {
  return [formatDateLong(date), publicUrl];
}

/**
 * Full long-form message (Console provider + 24h-session replies).
 * Phone numbers are masked here too — the full list lives on the manifest page.
 */
export function buildLongFormMessage(snapshot: ManifestSnapshot): string {
  const lines: string[] = [];
  lines.push(`🚐 TRANSPORT MANIFEST — ${formatDateLong(snapshot.date)}`);
  lines.push(`Total agents: ${snapshot.totalAgents}`);
  lines.push('');
  for (const bucket of snapshot.timeBuckets) {
    lines.push(`⏱ ${bucket.label}`);
    for (const campaign of snapshot.byCampaign) {
      const routesInBucket = campaign.routes.filter((r) =>
        bucket.zones.some(
          (z) => (z.zoneId ?? '__unassigned__') === (r.zoneId ?? '__unassigned__'),
        ),
      );
      if (routesInBucket.length === 0) continue;
      const campaignTotal = routesInBucket.reduce((s, r) => s + r.totalAgents, 0);
      lines.push(`━━ CAMPAIGN: ${campaign.campaign} (${campaignTotal}) ━━`);
      for (const route of routesInBucket) {
        lines.push(`📍 ${route.zoneName} (${route.totalAgents})`);
        for (const a of route.agents) {
          const pickup = a.pickupPoint ? ` — ${a.pickupPoint}` : '';
          lines.push(`• ${a.name} — ${maskPhone(a.phone)}${pickup}`);
        }
      }
    }
    lines.push('');
  }
  if (snapshot.warnings.length > 0) {
    lines.push('⚠️ ' + snapshot.warnings.join(' '));
  }
  return lines.join('\n').trimEnd();
}

interface FlatAgent {
  agentId: string;
  name: string;
  campaign: string;
  zoneId: string | null;
  zoneName: string | null;
  shiftEndTime: string;
}

function flatten(snapshot: ManifestSnapshot): Map<string, FlatAgent> {
  const map = new Map<string, FlatAgent>();
  for (const c of snapshot.byCampaign) {
    for (const r of c.routes) {
      for (const a of r.agents) {
        // agentId is not in the snapshot agent shape; recover from the time-bucket view
        map.set(`${c.campaignId}|${a.name}|${a.phone}`, {
          agentId: `${c.campaignId}|${a.name}`,
          name: a.name,
          campaign: c.campaign,
          zoneId: r.zoneId,
          zoneName: r.zoneName,
          shiftEndTime: a.shiftEndTime,
        });
      }
    }
  }
  return map;
}

/**
 * Diff two manifest snapshots. NOTE: snapshots store agent names/phones but not
 * agentIds, so identity is derived from campaignId+name+phone. The API passes
 * the richer RequestAgent-based entries to computeManifestDiffFromEntries when
 * exact ids are available (preferred for UPDATE notifications).
 */
export function computeManifestDiff(prev: ManifestSnapshot, next: ManifestSnapshot): ManifestDiff {
  const p = flatten(prev);
  const n = flatten(next);
  const added: DiffAgent[] = [];
  const removed: DiffAgent[] = [];
  const moved: MovedAgent[] = [];

  for (const [key, a] of n) {
    const old = p.get(key);
    if (!old) {
      added.push(toDiffAgent(a));
    } else if (old.zoneId !== a.zoneId || old.shiftEndTime !== a.shiftEndTime) {
      moved.push({
        ...toDiffAgent(a),
        fromZoneName: old.zoneName,
        toZoneName: a.zoneName,
        fromShiftEndTime: old.shiftEndTime,
        toShiftEndTime: a.shiftEndTime,
      });
    }
  }
  for (const [key, a] of p) {
    if (!n.has(key)) removed.push(toDiffAgent(a));
  }
  return { added, removed, moved };
}

function toDiffAgent(a: FlatAgent): DiffAgent {
  return {
    agentId: a.agentId,
    name: a.name,
    campaign: a.campaign,
    zoneName: a.zoneName,
    shiftEndTime: a.shiftEndTime,
  };
}

/** Exact-id diff used by the API when regenerating from live request entries. */
export function computeDiffFromEntries(
  prev: GroupEntry[],
  next: GroupEntry[],
): ManifestDiff {
  const p = new Map(prev.filter((e) => !e.removed).map((e) => [e.agentId, e]));
  const n = new Map(next.filter((e) => !e.removed).map((e) => [e.agentId, e]));
  const added: DiffAgent[] = [];
  const removed: DiffAgent[] = [];
  const moved: MovedAgent[] = [];

  for (const [id, e] of n) {
    const old = p.get(id);
    if (!old) {
      added.push(entryToDiff(e));
    } else if (old.zoneId !== e.zoneId || old.shiftEndTime !== e.shiftEndTime) {
      moved.push({
        ...entryToDiff(e),
        fromZoneName: old.zoneName,
        toZoneName: e.zoneName,
        fromShiftEndTime: formatTime12h(old.shiftEndTime),
        toShiftEndTime: formatTime12h(e.shiftEndTime),
      });
    }
  }
  for (const [id, e] of p) {
    if (!n.has(id)) removed.push(entryToDiff(e));
  }
  return { added, removed, moved };
}

function entryToDiff(e: GroupEntry): DiffAgent {
  return {
    agentId: e.agentId,
    name: e.name,
    campaign: e.campaign,
    zoneName: e.zoneName,
    shiftEndTime: formatTime12h(e.shiftEndTime),
  };
}

/** Human-readable one-liner for an UPDATE notification / audit log. */
export function describeDiff(diff: ManifestDiff): string {
  return `added ${diff.added.length}, removed ${diff.removed.length}, moved ${diff.moved.length}`;
}
