import { randomBytes } from "crypto";
import { supa } from "@/lib/supabaseAdmin";

export interface CustomField {
  id: string;
  label: string;
  type: "text" | "number" | "radio";
  options?: string[];
}

export interface CalendarConfig {
  connected: boolean;
  impersonateUser: string;
  calendarId: string;
  calendarName: string;
}

export interface MeetingType {
  id: string;
  name: string;
  /** תבנית כותרת — [שם הלקוח] יוחלף בשם הליד */
  titleTemplate: string;
  durationMin: number;
  location: string;
}

const DEFAULT_MEETING_TYPES: MeetingType[] = [
  {
    id: "compass",
    name: "פגישת מצפן",
    titleTemplate: "פגישת מצפן תהליך ליווי עסקת אקזיט - פאוור קאפל - עם [שם הלקוח]",
    durationMin: 60,
    location: "שדרות הראשונים 23, ראשון לציון, בניין מילניה B קומה 4",
  },
];

/** יומן אישי של נציג (לפולואפים). המפתח במפה = מייל הנציג. */
export interface RepCalendar {
  impersonateUser: string;
  calendarId: string;
  calendarName: string;
}

export interface LeadsSettings {
  apiKey: string;
  customFields: CustomField[];
  fieldMap: Record<string, string>;
  calendar: CalendarConfig;
  repCalendars: Record<string, RepCalendar>;
  meetingTypes: MeetingType[];
  updatedAt: string;
}

function genKey(): string {
  return "pk_" + randomBytes(24).toString("hex");
}

function normalizeCustom(cf: unknown): CustomField[] {
  if (!Array.isArray(cf)) return [];
  return cf
    .filter((f): f is CustomField => !!f && typeof f === "object" && !!(f as CustomField).id && !!(f as CustomField).label)
    .map((f) => ({ id: String(f.id).trim(), label: String(f.label).trim(), type: (["text", "number", "radio"].includes(f.type) ? f.type : "text") as CustomField["type"], options: Array.isArray(f.options) ? f.options.map(String) : undefined }));
}

function normalizeMeetingTypes(raw: unknown): MeetingType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is MeetingType => !!m && typeof m === "object" && !!(m as MeetingType).id && !!(m as MeetingType).name)
    .map((m) => ({
      id: String(m.id).trim(),
      name: String(m.name).trim(),
      titleTemplate: String(m.titleTemplate || m.name).trim().slice(0, 300),
      durationMin: Number(m.durationMin) > 0 ? Number(m.durationMin) : 60,
      location: String(m.location || "").trim().slice(0, 300),
    }));
}

interface SettingsRow {
  api_key?: string;
  custom_fields?: unknown;
  field_map?: Record<string, string>;
  calendar?: Partial<CalendarConfig>;
  rep_calendars?: Record<string, Partial<RepCalendar>>;
  meeting_types?: unknown;
  updated_at?: string;
}

function normalizeRepCalendars(raw: unknown): Record<string, RepCalendar> {
  const out: Record<string, RepCalendar> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [email, v] of Object.entries(raw as Record<string, Partial<RepCalendar>>)) {
    if (!v || !v.calendarId) continue;
    out[email.toLowerCase()] = {
      impersonateUser: String(v.impersonateUser || email).trim(),
      calendarId: String(v.calendarId).trim(),
      calendarName: String(v.calendarName || "").trim(),
    };
  }
  return out;
}

function rowToSettings(d: SettingsRow | null): LeadsSettings {
  const cal = d?.calendar || {};
  return {
    apiKey: d?.api_key || "",
    customFields: normalizeCustom(d?.custom_fields),
    fieldMap: d?.field_map || {},
    calendar: {
      connected: !!cal.connected,
      impersonateUser: cal.impersonateUser || "",
      calendarId: cal.calendarId || "",
      calendarName: cal.calendarName || "",
    },
    repCalendars: normalizeRepCalendars(d?.rep_calendars),
    meetingTypes: normalizeMeetingTypes(d?.meeting_types),
    updatedAt: d?.updated_at || "",
  };
}

export async function getSettings(): Promise<LeadsSettings> {
  const { data } = await supa().from("settings").select("*").eq("id", 1).maybeSingle();
  const s = rowToSettings(data as SettingsRow | null);
  const patch: Record<string, unknown> = {};
  if (!s.apiKey) { s.apiKey = genKey(); patch.api_key = s.apiKey; }
  if (!data || !Array.isArray((data as SettingsRow)?.meeting_types)) { s.meetingTypes = DEFAULT_MEETING_TYPES; patch.meeting_types = DEFAULT_MEETING_TYPES; }
  if (Object.keys(patch).length) {
    await supa().from("settings").upsert({ id: 1, ...patch, updated_at: new Date().toISOString() });
  }
  return s;
}

export async function saveSettings(patch: Partial<Pick<LeadsSettings, "customFields" | "fieldMap" | "meetingTypes">>): Promise<LeadsSettings> {
  const cur = await getSettings();
  const next: LeadsSettings = {
    ...cur,
    customFields: patch.customFields ? normalizeCustom(patch.customFields) : cur.customFields,
    fieldMap: patch.fieldMap ?? cur.fieldMap,
    meetingTypes: patch.meetingTypes ? normalizeMeetingTypes(patch.meetingTypes) : cur.meetingTypes,
    updatedAt: new Date().toISOString(),
  };
  await supa().from("settings").upsert({
    id: 1,
    custom_fields: next.customFields,
    field_map: next.fieldMap,
    meeting_types: next.meetingTypes,
    updated_at: next.updatedAt,
  });
  return next;
}

export async function rotateApiKey(): Promise<LeadsSettings> {
  const cur = await getSettings();
  const apiKey = genKey();
  await supa().from("settings").upsert({ id: 1, api_key: apiKey, updated_at: new Date().toISOString() });
  return { ...cur, apiKey };
}

export async function saveCalendarConfig(cfg: CalendarConfig): Promise<LeadsSettings> {
  const cur = await getSettings();
  await supa().from("settings").upsert({ id: 1, calendar: cfg, updated_at: new Date().toISOString() });
  return { ...cur, calendar: cfg };
}

/** שומר/מסיר יומן אישי של נציג (email → cfg, או null להסרה). */
export async function saveRepCalendar(email: string, cfg: RepCalendar | null): Promise<LeadsSettings> {
  const cur = await getSettings();
  const key = email.trim().toLowerCase();
  const next = { ...cur.repCalendars };
  if (cfg) next[key] = cfg; else delete next[key];
  await supa().from("settings").upsert({ id: 1, rep_calendars: next, updated_at: new Date().toISOString() });
  return { ...cur, repCalendars: next };
}

/** אימות מפתח API לקליטת לידים. */
export async function validateApiKey(key: string): Promise<boolean> {
  if (!key) return false;
  const s = await getSettings();
  return !!s.apiKey && key === s.apiKey;
}
