import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const dataRoot = () => path.join(process.cwd(), "data");
const filePath = (name: string) => path.join(dataRoot(), name);

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export interface Note {
  id: string;
  title: string;
  contentHtml: string;
  subjectIds: string[];
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  deletedAt: string | null;
}

export type EventRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  recurrence: EventRecurrence;
  subjectId: string | null;
  reminderMinutesBefore: number | null;
  googleEventId: string | null;
  googleEtag: string | null;
  source: "clyra" | "google";
  createdAt: string;
  updatedAt: string;
}

export interface Subject {
  id: string;
  name: string;
  color: string;
}

export interface GoogleAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
  scope: string | null;
}

const NOTES_FILE = filePath("notes.json");
const EVENTS_FILE = filePath("calendar-events.json");
const SUBJECTS_FILE = filePath("subjects.json");
const GOOGLE_AUTH_FILE = filePath("google-auth.json");

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

// --- Notes ---

export async function listNotes(): Promise<Note[]> {
  const notes = await readJson<Note[]>(NOTES_FILE, []);
  return notes.filter((note) => !note.deletedAt);
}

export async function listTrashedNotes(): Promise<Note[]> {
  const notes = await readJson<Note[]>(NOTES_FILE, []);
  return notes.filter((note) => note.deletedAt);
}

export async function getNote(id: string): Promise<Note | null> {
  const notes = await readJson<Note[]>(NOTES_FILE, []);
  return notes.find((note) => note.id === id) ?? null;
}

export async function createNote(input: {
  title: string;
  contentHtml: string;
  subjectIds?: string[];
  pinned?: boolean;
}): Promise<Note> {
  const notes = await readJson<Note[]>(NOTES_FILE, []);
  const timestamp = nowIso();
  const note: Note = {
    id: newId(),
    title: input.title,
    contentHtml: input.contentHtml,
    subjectIds: input.subjectIds ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: input.pinned ?? false,
    deletedAt: null,
  };
  notes.push(note);
  await writeJson(NOTES_FILE, notes);
  return note;
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<Note, "title" | "contentHtml" | "subjectIds" | "pinned">>,
): Promise<Note | null> {
  const notes = await readJson<Note[]>(NOTES_FILE, []);
  const index = notes.findIndex((note) => note.id === id);
  if (index === -1) return null;
  const updated: Note = {
    ...notes[index],
    ...patch,
    updatedAt: nowIso(),
  };
  notes[index] = updated;
  await writeJson(NOTES_FILE, notes);
  return updated;
}

export async function deleteNote(id: string): Promise<boolean> {
  const notes = await readJson<Note[]>(NOTES_FILE, []);
  const index = notes.findIndex((note) => note.id === id);
  if (index === -1) return false;
  notes[index] = { ...notes[index], deletedAt: nowIso() };
  await writeJson(NOTES_FILE, notes);
  return true;
}

export async function restoreNote(id: string): Promise<Note | null> {
  const notes = await readJson<Note[]>(NOTES_FILE, []);
  const index = notes.findIndex((note) => note.id === id);
  if (index === -1) return null;
  notes[index] = { ...notes[index], deletedAt: null };
  await writeJson(NOTES_FILE, notes);
  return notes[index];
}

export async function purgeNote(id: string): Promise<boolean> {
  const notes = await readJson<Note[]>(NOTES_FILE, []);
  const next = notes.filter((note) => note.id !== id);
  if (next.length === notes.length) return false;
  await writeJson(NOTES_FILE, next);
  return true;
}

export async function duplicateNote(id: string): Promise<Note | null> {
  const notes = await readJson<Note[]>(NOTES_FILE, []);
  const source = notes.find((note) => note.id === id);
  if (!source) return null;
  const timestamp = nowIso();
  const copy: Note = {
    ...source,
    id: newId(),
    title: `${source.title} (copy)`,
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: false,
    deletedAt: null,
  };
  notes.push(copy);
  await writeJson(NOTES_FILE, notes);
  return copy;
}

export async function searchNotes(query: string): Promise<Note[]> {
  const notes = await listNotes();
  const needle = query.trim().toLowerCase();
  if (!needle) return notes;
  return notes.filter(
    (note) =>
      note.title.toLowerCase().includes(needle) ||
      note.contentHtml.toLowerCase().includes(needle),
  );
}

// --- Calendar events ---

export async function listEvents(): Promise<CalendarEvent[]> {
  return readJson<CalendarEvent[]>(EVENTS_FILE, []);
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const events = await listEvents();
  return events.find((event) => event.id === id) ?? null;
}

export async function createEvent(
  input: Omit<
    CalendarEvent,
    "id" | "createdAt" | "updatedAt" | "googleEventId" | "googleEtag" | "source"
  > & { source?: CalendarEvent["source"]; googleEventId?: string | null; googleEtag?: string | null },
): Promise<CalendarEvent> {
  const events = await listEvents();
  const timestamp = nowIso();
  const event: CalendarEvent = {
    id: newId(),
    title: input.title,
    description: input.description,
    location: input.location,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    recurrence: input.recurrence,
    subjectId: input.subjectId,
    reminderMinutesBefore: input.reminderMinutesBefore,
    googleEventId: input.googleEventId ?? null,
    googleEtag: input.googleEtag ?? null,
    source: input.source ?? "clyra",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  events.push(event);
  await writeJson(EVENTS_FILE, events);
  return event;
}

export async function updateEvent(
  id: string,
  patch: Partial<Omit<CalendarEvent, "id" | "createdAt">>,
): Promise<CalendarEvent | null> {
  const events = await listEvents();
  const index = events.findIndex((event) => event.id === id);
  if (index === -1) return null;
  const updated: CalendarEvent = {
    ...events[index],
    ...patch,
    updatedAt: nowIso(),
  };
  events[index] = updated;
  await writeJson(EVENTS_FILE, events);
  return updated;
}

export async function deleteEvent(id: string): Promise<CalendarEvent | null> {
  const events = await listEvents();
  const index = events.findIndex((event) => event.id === id);
  if (index === -1) return null;
  const [removed] = events.splice(index, 1);
  await writeJson(EVENTS_FILE, events);
  return removed;
}

export async function upsertGoogleEvent(
  googleEventId: string,
  data: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt" | "source" | "googleEventId"> & {
    googleEtag: string | null;
  },
): Promise<CalendarEvent> {
  const events = await listEvents();
  const index = events.findIndex((event) => event.googleEventId === googleEventId);
  const timestamp = nowIso();
  if (index === -1) {
    const event: CalendarEvent = {
      id: newId(),
      ...data,
      googleEventId,
      source: "google",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    events.push(event);
    await writeJson(EVENTS_FILE, events);
    return event;
  }
  const updated: CalendarEvent = {
    ...events[index],
    ...data,
    googleEventId,
    source: "google",
    updatedAt: timestamp,
  };
  events[index] = updated;
  await writeJson(EVENTS_FILE, events);
  return updated;
}

export async function listUpcomingEvents(withinDays = 30): Promise<CalendarEvent[]> {
  const events = await listEvents();
  const now = Date.now();
  const horizon = now + withinDays * 24 * 60 * 60 * 1000;
  return events
    .filter((event) => {
      const start = new Date(event.start).getTime();
      return start >= now && start <= horizon;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

// --- Subjects ---

export async function listSubjects(): Promise<Subject[]> {
  return readJson<Subject[]>(SUBJECTS_FILE, []);
}

export async function createSubject(input: { name: string; color: string }): Promise<Subject> {
  const subjects = await listSubjects();
  const subject: Subject = { id: newId(), name: input.name, color: input.color };
  subjects.push(subject);
  await writeJson(SUBJECTS_FILE, subjects);
  return subject;
}

export async function updateSubject(
  id: string,
  patch: Partial<Pick<Subject, "name" | "color">>,
): Promise<Subject | null> {
  const subjects = await listSubjects();
  const index = subjects.findIndex((subject) => subject.id === id);
  if (index === -1) return null;
  subjects[index] = { ...subjects[index], ...patch };
  await writeJson(SUBJECTS_FILE, subjects);
  return subjects[index];
}

export async function deleteSubject(id: string): Promise<boolean> {
  const subjects = await listSubjects();
  const next = subjects.filter((subject) => subject.id !== id);
  if (next.length === subjects.length) return false;
  await writeJson(SUBJECTS_FILE, next);
  return true;
}

// --- Google auth tokens (server-side only) ---

export async function readGoogleTokens(): Promise<GoogleAuthTokens | null> {
  return readJson<GoogleAuthTokens | null>(GOOGLE_AUTH_FILE, null);
}

export async function writeGoogleTokens(tokens: GoogleAuthTokens): Promise<void> {
  await writeJson(GOOGLE_AUTH_FILE, tokens);
}

export async function clearGoogleTokens(): Promise<void> {
  await writeJson(GOOGLE_AUTH_FILE, null);
}
