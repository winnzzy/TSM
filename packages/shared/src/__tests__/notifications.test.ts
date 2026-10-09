import { describe, expect, it } from 'vitest';
import { groupAgents } from '../grouping.js';
import {
  buildLongFormMessage,
  buildManifestTemplateVars,
  buildReminderTemplateVars,
  buildUpdateTemplateVars,
  compactRouteList,
  computeDiffFromEntries,
  computeManifestDiff,
  describeDiff,
  diffSummary,
  maskPhone,
  publicAgentLabel,
  shiftSummary,
} from '../notifications.js';
import type { GroupEntry, ManifestSnapshot } from '../types.js';

function entry(partial: Partial<GroupEntry> & { name: string; agentId: string }): GroupEntry {
  return {
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

function sampleSnapshot(): ManifestSnapshot {
  return groupAgents(
    [
      entry({ agentId: 'a1', name: 'Ada Okafor', zoneName: 'Ikeja-Ogba', zoneId: 'z1' }),
      entry({ agentId: 'a2', name: 'Bola Ade', zoneName: 'Ikeja-Ogba', zoneId: 'z1' }),
      entry({
        agentId: 'a3',
        name: 'Chidi Eze',
        zoneName: 'Lekki-Ajah',
        zoneId: 'z2',
        campaignId: 'camp-2',
        campaign: 'Beta Retail',
      }),
    ],
    { windowMinutes: 30, capacity: 14 },
    '2026-10-08',
  );
}

describe('masking helpers', () => {
  it('masks all but the last 4 digits', () => {
    expect(maskPhone('+2348012345678')).toBe('•••••••••5678');
  });
  it('public label is first name + last 4 digits only', () => {
    expect(publicAgentLabel('Ada Okafor', '+2348012345678')).toBe('Ada ••••5678');
    expect(publicAgentLabel('Ada Okafor', '+2348012345678')).not.toContain('0801');
  });
});

describe('manifest template vars', () => {
  it('builds the 6 summary variables in order', () => {
    const snap = sampleSnapshot();
    const vars = buildManifestTemplateVars(snap, 'http://localhost:3000/m/abc123');
    expect(vars).toHaveLength(6);
    expect(vars[0]).toBe('Thu, 08 Oct 2026'); // {{1}} date
    expect(vars[1]).toBe('7:00 PM'); // {{2}} shift ends
    expect(vars[2]).toBe('3'); // {{3}} agents
    expect(vars[3]).toBe('2'); // {{4}} campaigns
    expect(vars[4]).toContain('Ikeja-Ogba (2)');
    expect(vars[4]).toContain('Lekki-Ajah (1)');
    expect(vars[5]).toBe('http://localhost:3000/m/abc123');
  });

  it('summarises a multi-bucket range', () => {
    const snap = groupAgents(
      [
        entry({ agentId: 'a1', name: 'Ada', shiftEndTime: '18:30' }),
        entry({ agentId: 'a2', name: 'Bola', shiftEndTime: '20:00' }),
      ],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    expect(shiftSummary(snap)).toBe('6:30 PM – 8:00 PM');
  });
});

describe('update + reminder vars', () => {
  it('builds update vars with diff summaries', () => {
    const diff = {
      added: [
        { agentId: 'a9', name: 'New Guy', campaign: 'Acme', zoneName: 'Ikeja-Ogba', shiftEndTime: '19:00' },
      ],
      removed: [],
      moved: [],
    };
    const vars = buildUpdateTemplateVars('2026-10-08', 2, diff, 'http://x/m/tok');
    expect(vars).toEqual([
      'Thu, 08 Oct 2026',
      '2',
      '1 (New Guy)',
      '0',
      '0',
      'http://x/m/tok',
    ]);
  });

  it('formats diff summaries with truncation', () => {
    expect(diffSummary([])).toBe('0');
    const many = Array.from({ length: 5 }, (_, i) => ({
      agentId: `a${i}`,
      name: `Agent ${i}`,
      campaign: 'C',
      zoneName: 'Z',
      shiftEndTime: '19:00',
    }));
    expect(diffSummary(many)).toBe('5 (Agent 0, Agent 1, Agent 2, +2 more)');
  });

  it('builds reminder vars', () => {
    expect(buildReminderTemplateVars('2026-10-08', 'http://x/m/tok')).toEqual([
      'Thu, 08 Oct 2026',
      'http://x/m/tok',
    ]);
  });
});

describe('long-form message', () => {
  it('renders the campaign -> route structure with masked phones', () => {
    const msg = buildLongFormMessage(sampleSnapshot());
    expect(msg).toContain('🚐 TRANSPORT MANIFEST — Thu, 08 Oct 2026');
    expect(msg).toContain('Total agents: 3');
    expect(msg).toContain('⏱ 7:00 PM');
    expect(msg).toContain('━━ CAMPAIGN: Acme Support (2) ━━');
    expect(msg).toContain('📍 Ikeja-Ogba (2)');
    expect(msg).toContain('• Ada Okafor — •••••••••5678 — Computer Village');
    expect(msg).toContain('━━ CAMPAIGN: Beta Retail (1) ━━');
    expect(msg).toContain('📍 Lekki-Ajah (1)');
    expect(msg).not.toContain('+2348012345678');
  });

  it('appends warnings when present', () => {
    const snap = groupAgents(
      [entry({ agentId: 'a1', name: 'Ada', zoneId: null, zoneName: null })],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    expect(buildLongFormMessage(snap)).toContain('⚠️');
  });
});

describe('manifest diff', () => {
  const prev = [
    entry({ agentId: 'a1', name: 'Ada', zoneId: 'z1', zoneName: 'Ikeja-Ogba' }),
    entry({ agentId: 'a2', name: 'Bola', zoneId: 'z1', zoneName: 'Ikeja-Ogba' }),
    entry({ agentId: 'a3', name: 'Chidi', zoneId: 'z2', zoneName: 'Lekki-Ajah', shiftEndTime: '19:00' }),
  ];

  it('computes added / removed / moved from entries', () => {
    const next = [
      entry({ agentId: 'a1', name: 'Ada', zoneId: 'z1', zoneName: 'Ikeja-Ogba' }),
      // a2 removed
      entry({ agentId: 'a3', name: 'Chidi', zoneId: 'z2', zoneName: 'Lekki-Ajah', shiftEndTime: '20:00' }), // moved time
      entry({ agentId: 'a4', name: 'Dami', zoneId: 'z1', zoneName: 'Ikeja-Ogba' }), // added
    ];
    const diff = computeDiffFromEntries(prev, next);
    expect(diff.added.map((a) => a.name)).toEqual(['Dami']);
    expect(diff.removed.map((a) => a.name)).toEqual(['Bola']);
    expect(diff.moved.map((a) => a.name)).toEqual(['Chidi']);
    expect(diff.moved[0].fromShiftEndTime).toBe('7:00 PM');
    expect(diff.moved[0].toShiftEndTime).toBe('8:00 PM');
    expect(describeDiff(diff)).toBe('added 1, removed 1, moved 1');
  });

  it('detects a zone move', () => {
    const next = [
      entry({ agentId: 'a1', name: 'Ada', zoneId: 'z2', zoneName: 'Lekki-Ajah' }),
      entry({ agentId: 'a2', name: 'Bola', zoneId: 'z1', zoneName: 'Ikeja-Ogba' }),
      entry({ agentId: 'a3', name: 'Chidi', zoneId: 'z2', zoneName: 'Lekki-Ajah', shiftEndTime: '19:00' }),
    ];
    const diff = computeDiffFromEntries(prev, next);
    expect(diff.moved.map((a) => a.name)).toEqual(['Ada']);
    expect(diff.moved[0].fromZoneName).toBe('Ikeja-Ogba');
    expect(diff.moved[0].toZoneName).toBe('Lekki-Ajah');
  });

  it('ignores removed-flagged entries on both sides', () => {
    const diff = computeDiffFromEntries(
      prev.map((e) => ({ ...e })),
      prev.map((e) => ({ ...e, removed: true })),
    );
    expect(diff.removed).toHaveLength(3);
  });

  it('snapshot-level diff works without ids', () => {
    const s1 = sampleSnapshot();
    const s2 = groupAgents(
      [
        entry({ agentId: 'a1', name: 'Ada Okafor', zoneName: 'Ikeja-Ogba', zoneId: 'z1' }),
        entry({ agentId: 'a3', name: 'Chidi Eze', zoneName: 'Lekki-Ajah', zoneId: 'z2', campaignId: 'camp-2', campaign: 'Beta Retail' }),
        entry({ agentId: 'a4', name: 'New Guy', zoneName: 'Ikeja-Ogba', zoneId: 'z1' }),
      ],
      { windowMinutes: 30, capacity: 14 },
      '2026-10-08',
    );
    const diff = computeManifestDiff(s1, s2);
    expect(diff.added.map((a) => a.name)).toEqual(['New Guy']);
    expect(diff.removed.map((a) => a.name)).toEqual(['Bola Ade']);
    expect(diff.moved).toHaveLength(0);
  });

  it('compactRouteList orders biggest routes first', () => {
    expect(compactRouteList(sampleSnapshot())).toBe('Ikeja-Ogba (2), Lekki-Ajah (1)');
  });
});
