/**
 * Grouping engine: time window -> zone -> capacity-balanced trips.
 *
 * BUCKETING RULE (documented per spec): each agent's shift-end time is rounded
 * to the NEAREST window multiple (round-half-up). All agents sharing a bucket
 * are labelled by that round time in 12-hour format.
 *   e.g. window=30: 18:50, 19:00 and 19:10 all round to 19:00 -> "7:00 PM";
 *   20:00 rounds to 20:00 -> "8:00 PM" (its own bucket).
 *
 * CAPACITY RULE: trips = ceil(n / capacity), agents distributed as evenly as
 * possible (e.g. 15 agents, capacity 14 -> 8 + 7, never 14 + 1).
 *
 * Sort order: time buckets ascending; zones by agent count descending (then
 * name); agents alphabetical by name.
 */
import {
  CampaignView,
  GroupEntry,
  ManifestSnapshot,
  RouteView,
  SnapshotAgent,
  TimeBucket,
  ZoneGroup,
} from './types.js';
import { formatTime12h, hhmmToMinutes, lagosTodayYmd, minutesToHhmm } from './time.js';

export interface GroupOptions {
  /** minutes per time bucket, e.g. 30 */
  windowMinutes: number;
  /** seats per vehicle, e.g. 14 */
  capacity: number;
}

const UNASSIGNED_ZONE_ID = '__unassigned__';
const UNASSIGNED_ZONE_NAME = 'Unassigned';

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

/** Split n items into the fewest balanced trips (no trip exceeds capacity). */
export function balancedTripSizes(total: number, capacity: number): number[] {
  if (total <= 0) return [];
  const trips = Math.ceil(total / capacity);
  const base = Math.floor(total / trips);
  const remainder = total % trips;
  const sizes: number[] = [];
  for (let i = 0; i < trips; i++) {
    sizes.push(base + (i < remainder ? 1 : 0));
  }
  return sizes;
}

export function groupAgents(
  entries: GroupEntry[],
  opts: GroupOptions,
  date: string = lagosTodayYmd(),
): ManifestSnapshot {
  const { windowMinutes, capacity } = opts;
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    throw new Error('windowMinutes must be a positive number');
  }
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error('capacity must be a positive number');
  }

  const active = entries.filter((e) => !e.removed);
  const warnings: string[] = [];

  // 1. Time buckets (round to nearest window multiple)
  const buckets = new Map<number, GroupEntry[]>();
  for (const e of active) {
    const minutes = hhmmToMinutes(e.shiftEndTime);
    const key = Math.round(minutes / windowMinutes) * windowMinutes;
    const list = buckets.get(key);
    if (list) list.push(e);
    else buckets.set(key, [e]);
  }

  const timeBuckets: TimeBucket[] = [];
  for (const [key, bucketEntries] of buckets) {
    const label = formatTime12h(minutesToHhmm(key));

    // 2. Group by zone within the bucket
    const zoneMap = new Map<string, { zoneId: string | null; zoneName: string; entries: GroupEntry[] }>();
    for (const e of bucketEntries) {
      const zid = e.zoneId ?? UNASSIGNED_ZONE_ID;
      const existing = zoneMap.get(zid);
      if (existing) existing.entries.push(e);
      else zoneMap.set(zid, { zoneId: e.zoneId, zoneName: e.zoneName ?? UNASSIGNED_ZONE_NAME, entries: [e] });
    }

    const zones: ZoneGroup[] = [];
    for (const { zoneId, zoneName, entries: ze } of zoneMap.values()) {
      const sorted = [...ze].sort((a, b) => compareNames(a.name, b.name));
      const sizes = balancedTripSizes(sorted.length, capacity);
      const trips = sizes.map((size, i) => ({
        tripNo: i + 1,
        agents: sorted.slice(
          sizes.slice(0, i).reduce((s, n) => s + n, 0),
          sizes.slice(0, i + 1).reduce((s, n) => s + n, 0),
        ).map(
          (a): SnapshotAgent => ({
            name: a.name,
            phone: a.phone,
            campaign: a.campaign,
            pickupPoint: a.pickupPoint,
          }),
        ),
      }));
      zones.push({ zoneId, zoneName, totalAgents: sorted.length, trips });
    }

    zones.sort((a, b) => b.totalAgents - a.totalAgents || compareNames(a.zoneName, b.zoneName));

    const unassigned = zoneMap.get(UNASSIGNED_ZONE_ID);
    if (unassigned) {
      warnings.push(
        `${unassigned.entries.length} agent(s) have no zone assigned and were placed in "${UNASSIGNED_ZONE_NAME}".`,
      );
    }

    timeBuckets.push({
      key,
      label,
      totalAgents: bucketEntries.length,
      zones,
    });
  }

  timeBuckets.sort((a, b) => a.key - b.key);

  // 3. By-campaign view: campaign -> (zone, shiftEnd) routes
  const campaignMap = new Map<string, { campaignId: string; campaign: string; routes: Map<string, RouteView> }>();
  for (const e of active) {
    let c = campaignMap.get(e.campaignId);
    if (!c) {
      c = { campaignId: e.campaignId, campaign: e.campaign, routes: new Map() };
      campaignMap.set(e.campaignId, c);
    }
    const routeKey = `${e.zoneId ?? UNASSIGNED_ZONE_ID}|${e.shiftEndTime}`;
    let r = c.routes.get(routeKey);
    if (!r) {
      r = {
        zoneId: e.zoneId,
        zoneName: e.zoneName ?? UNASSIGNED_ZONE_NAME,
        shiftEnd: e.shiftEndTime,
        totalAgents: 0,
        agents: [],
      };
      c.routes.set(routeKey, r);
    }
    r.totalAgents += 1;
    r.agents.push({
      name: e.name,
      phone: e.phone,
      pickupPoint: e.pickupPoint,
      shiftEndTime: e.shiftEndTime,
    });
  }

  const byCampaign: CampaignView[] = [...campaignMap.values()]
    .map((c) => {
      const routes = [...c.routes.values()].map((r) => ({
        ...r,
        agents: r.agents.sort((a, b) => compareNames(a.name, b.name)),
      }));
      routes.sort(
        (a, b) => b.totalAgents - a.totalAgents || compareNames(a.zoneName, b.zoneName),
      );
      return {
        campaignId: c.campaignId,
        campaign: c.campaign,
        totalAgents: routes.reduce((s, r) => s + r.totalAgents, 0),
        routes,
      };
    })
    .sort((a, b) => compareNames(a.campaign, b.campaign));

  const totalAgents = active.length;

  return { date, totalAgents, timeBuckets, byCampaign, warnings };
}
