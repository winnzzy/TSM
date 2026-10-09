import { describe, expect, it } from 'vitest';
import { balancedTripSizes, groupAgents } from '../grouping.js';
import type { GroupEntry } from '../types.js';

function entry(partial: Partial<GroupEntry> & { name: string }): GroupEntry {
  return {
    agentId: `agent-${partial.name.replace(/\s+/g, '-').toLowerCase()}`,
    phone: '+2348012345678',
    campaignId: 'camp-1',
    campaign: 'Acme Support',
    zoneId: 'zone-1',
    zoneName: 'Ikeja-Ogba',
    pickupPoint: 'Computer Village',
    shiftEndTime: '19:00',
    removed: false,
    ...partial,
  };
}

describe('groupAgents bucketing', () => {
  it('puts 18:50, 19:00 and 19:10 in the same 30-min bucket, 20:00 in its own', () => {
    const snap = groupAgents(
      [
        entry({ name: 'Ada', shiftEndTime: '18:50' }),
        entry({ name: 'Bola', shiftEndTime: '19:00' }),
        entry({ name: 'Chidi', shiftEndTime: '19:10' }),
        entry({ name: 'Dami', shiftEndTime: '20:00' }),
      ],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    expect(snap.timeBuckets).toHaveLength(2);
    expect(snap.timeBuckets[0].label).toBe('7:00 PM');
    expect(snap.timeBuckets[0].totalAgents).toBe(3);
    expect(snap.timeBuckets[1].label).toBe('8:00 PM');
    expect(snap.timeBuckets[1].totalAgents).toBe(1);
    expect(snap.totalAgents).toBe(4);
  });

  it('labels the bucket by the nearest round time (18:50 + 19:10 -> "7:00 PM")', () => {
    const snap = groupAgents(
      [entry({ name: 'Ada', shiftEndTime: '18:50' }), entry({ name: 'Bola', shiftEndTime: '19:10' })],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    expect(snap.timeBuckets).toHaveLength(1);
    expect(snap.timeBuckets[0].label).toBe('7:00 PM');
  });

  it('sorts time buckets ascending', () => {
    const snap = groupAgents(
      [
        entry({ name: 'Zed', shiftEndTime: '20:00' }),
        entry({ name: 'Ada', shiftEndTime: '18:30' }),
      ],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    expect(snap.timeBuckets.map((b) => b.label)).toEqual(['6:30 PM', '8:00 PM']);
  });
});

describe('groupAgents zones', () => {
  it('produces separate zone groups for the same bucket with different zones', () => {
    const snap = groupAgents(
      [
        entry({ name: 'Ada', zoneId: 'z1', zoneName: 'Ikeja-Ogba' }),
        entry({ name: 'Bola', zoneId: 'z2', zoneName: 'Lekki-Ajah' }),
        entry({ name: 'Chidi', zoneId: 'z1', zoneName: 'Ikeja-Ogba' }),
      ],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    const zones = snap.timeBuckets[0].zones;
    expect(zones).toHaveLength(2);
    // sorted by agent count desc
    expect(zones[0].zoneName).toBe('Ikeja-Ogba');
    expect(zones[0].totalAgents).toBe(2);
    expect(zones[1].zoneName).toBe('Lekki-Ajah');
  });

  it('puts agents without a zone in "Unassigned" and raises a warning', () => {
    const snap = groupAgents(
      [
        entry({ name: 'Ada', zoneId: null, zoneName: null }),
        entry({ name: 'Bola', zoneId: 'z1', zoneName: 'Ikeja-Ogba' }),
      ],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    const zones = snap.timeBuckets[0].zones;
    const unassigned = zones.find((z) => z.zoneName === 'Unassigned');
    expect(unassigned).toBeDefined();
    expect(unassigned!.totalAgents).toBe(1);
    expect(snap.warnings.length).toBeGreaterThan(0);
    expect(snap.warnings.join(' ')).toMatch(/no zone/i);
  });
});

describe('groupAgents capacity split', () => {
  it('splits 15 agents with capacity 14 into trips of 8 and 7', () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      entry({ name: `Agent ${String(i + 1).padStart(2, '0')}` }),
    );
    const snap = groupAgents(entries, { windowMinutes: 30, capacity: 14 }, '2026-10-08');
    const trips = snap.timeBuckets[0].zones[0].trips;
    expect(trips).toHaveLength(2);
    expect(trips[0].agents).toHaveLength(8);
    expect(trips[1].agents).toHaveLength(7);
  });

  it('keeps a single trip when under capacity', () => {
    const snap = groupAgents(
      [entry({ name: 'Ada' }), entry({ name: 'Bola' })],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    expect(snap.timeBuckets[0].zones[0].trips).toHaveLength(1);
  });

  it('distributes evenly for awkward counts (e.g. 29 / 14 -> 10+10+9)', () => {
    expect(balancedTripSizes(29, 14)).toEqual([10, 10, 9]);
    expect(balancedTripSizes(28, 14)).toEqual([14, 14]);
    expect(balancedTripSizes(1, 14)).toEqual([1]);
  });
});

describe('groupAgents filtering and views', () => {
  it('excludes removed entries', () => {
    const snap = groupAgents(
      [entry({ name: 'Ada' }), entry({ name: 'Bola', removed: true })],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    expect(snap.totalAgents).toBe(1);
    const names = snap.timeBuckets[0].zones[0].trips.flatMap((t) => t.agents.map((a) => a.name));
    expect(names).toEqual(['Ada']);
  });

  it('byCampaign totals equal timeBuckets totals and preserve campaign on agents', () => {
    const snap = groupAgents(
      [
        entry({ name: 'Ada', campaignId: 'c1', campaign: 'Acme' }),
        entry({ name: 'Bola', campaignId: 'c2', campaign: 'Beta' }),
        entry({ name: 'Chidi', campaignId: 'c1', campaign: 'Acme', shiftEndTime: '20:00' }),
      ],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    const bucketTotal = snap.timeBuckets.reduce((s, b) => s + b.totalAgents, 0);
    const campaignTotal = snap.byCampaign.reduce((s, c) => s + c.totalAgents, 0);
    expect(bucketTotal).toBe(3);
    expect(campaignTotal).toBe(3);
    expect(snap.byCampaign).toHaveLength(2);
    const acme = snap.byCampaign.find((c) => c.campaign === 'Acme')!;
    expect(acme.totalAgents).toBe(2);
    for (const b of snap.timeBuckets) {
      for (const z of b.zones) {
        for (const t of z.trips) {
          for (const a of t.agents) {
            expect(a.campaign).toBeTruthy();
          }
        }
      }
    }
  });

  it('sorts agents alphabetically within trips', () => {
    const snap = groupAgents(
      [entry({ name: 'Zara' }), entry({ name: 'Ada' }), entry({ name: 'Musa' })],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    const names = snap.timeBuckets[0].zones[0].trips[0].agents.map((a) => a.name);
    expect(names).toEqual(['Ada', 'Musa', 'Zara']);
  });

  it('throws on invalid options', () => {
    expect(() => groupAgents([], { windowMinutes: 0, capacity: 14 })).toThrow();
    expect(() => groupAgents([], { windowMinutes: 30, capacity: 0 })).toThrow();
    expect(() => groupAgents([entry({ name: 'X', shiftEndTime: 'nope' })], { windowMinutes: 30, capacity: 14 })).toThrow();
  });
});
