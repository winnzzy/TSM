/**
 * Shared domain types for the Transport Coordination CRM.
 * Mirrors the Prisma schema enums; the API maps Prisma rows onto these shapes.
 */

export type Role = 'ADMIN' | 'CAMPAIGN_LEAD' | 'TRANSPORT' | 'MANAGEMENT';
export type RequestStatus = 'DRAFT' | 'SUBMITTED' | 'LOCKED';
export type ManifestStatus = 'DRAFT' | 'SENT' | 'CONFIRMED';
export type RecipientType = 'MANAGEMENT' | 'TRANSPORT';
export type NotifStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type NotifKind = 'MANIFEST' | 'UPDATE' | 'REMINDER' | 'ESCALATION';

/** One agent row fed into the grouping engine (from a locked TransportRequest). */
export interface GroupEntry {
  agentId: string;
  name: string;
  phone: string;
  campaignId: string;
  campaign: string;
  zoneId: string | null;
  zoneName: string | null;
  pickupPoint: string | null;
  /** "HH:mm" 24h */
  shiftEndTime: string;
  removed: boolean;
}

export interface SnapshotAgent {
  name: string;
  phone: string;
  campaign: string;
  pickupPoint: string | null;
}

export interface Trip {
  tripNo: number;
  agents: SnapshotAgent[];
}

export interface ZoneGroup {
  zoneId: string | null;
  zoneName: string;
  totalAgents: number;
  trips: Trip[];
}

export interface TimeBucket {
  /** bucket centre in minutes since midnight */
  key: number;
  /** e.g. "7:00 PM" */
  label: string;
  totalAgents: number;
  zones: ZoneGroup[];
}

export interface RouteAgent {
  name: string;
  phone: string;
  pickupPoint: string | null;
  shiftEndTime: string;
}

export interface RouteView {
  zoneId: string | null;
  zoneName: string;
  /** "HH:mm" — all agents in a route share one shift end time */
  shiftEnd: string;
  totalAgents: number;
  agents: RouteAgent[];
}

export interface CampaignView {
  campaignId: string;
  campaign: string;
  totalAgents: number;
  routes: RouteView[];
}

export interface ManifestSnapshot {
  /** "YYYY-MM-DD" (Lagos) */
  date: string;
  totalAgents: number;
  timeBuckets: TimeBucket[];
  byCampaign: CampaignView[];
  warnings: string[];
}

export interface DiffAgent {
  agentId: string;
  name: string;
  campaign: string;
  zoneName: string | null;
  shiftEndTime: string;
}

export interface MovedAgent extends DiffAgent {
  fromZoneName: string | null;
  toZoneName: string | null;
  fromShiftEndTime: string;
  toShiftEndTime: string;
}

export interface ManifestDiff {
  added: DiffAgent[];
  removed: DiffAgent[];
  moved: MovedAgent[];
}

export interface RecipientInfo {
  id: string;
  name: string;
  phone: string;
  type: RecipientType;
}
