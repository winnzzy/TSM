/**
 * Shared zod validation schemas. The API re-uses these; the web app re-uses
 * the client-safe ones for form validation.
 */
import { z } from 'zod';

/** E.164 international format, e.g. +2348012345678 */
export const e164Phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format, e.g. +2348012345678');

/** "HH:mm" 24-hour */
export const hhmm = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm (24h), e.g. 19:00');

/** "YYYY-MM-DD" */
export const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const recipientSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  phone: e164Phone,
  type: z.enum(['MANAGEMENT', 'TRANSPORT']),
  active: z.boolean().default(true),
});

export const settingsSchema = z.object({
  cutoffTime: hhmm,
  windowMinutes: z.number().int().min(5).max(240),
  vehicleCapacity: z.number().int().min(1).max(200),
  reminderAfterMins: z.number().int().min(1).max(1440),
  escalateAfterMins: z.number().int().min(1).max(1440),
  defaultShiftEnd: hhmm,
  weekendsEnabled: z.boolean(),
});

export const agentScheduleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  shiftEndTime: hhmm,
  needsTransport: z.boolean().default(true),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RecipientInput = z.infer<typeof recipientSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type AgentScheduleInput = z.infer<typeof agentScheduleSchema>;
