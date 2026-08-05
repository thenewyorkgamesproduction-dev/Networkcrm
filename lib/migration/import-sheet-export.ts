import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Row = Record<string, string>;
type ExportFile = {
  format: string;
  version: number;
  exported_at?: string;
  spreadsheet_name?: string;
  sheets: Record<string, Row[]>;
};

type ImportReport = {
  source: { spreadsheet?: string; exported_at?: string };
  imported: Record<string, number>;
  skipped: Record<string, number>;
  errors: Array<{ table: string; message: string }>;
  validation: Record<string, { source: number; database: number; matches: boolean }>;
};

const clean = (value: unknown): string | null => {
  const text = String(value ?? "").replace(/^'/, "").trim();
  return text === "" ? null : text;
};

const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number =>
  Math.max(min, Math.min(max, Math.round(numberValue(value))));

const dateValue = (value: unknown): string | null => {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const boolValue = (value: unknown): boolean =>
  ["true", "yes", "1"].includes(String(value ?? "").toLowerCase().trim());

const splitTopics = (value: unknown): string[] =>
  String(value ?? "")
    .split(",")
    .map((topic) => topic.trim().toLowerCase())
    .filter(Boolean);

const reasonsJson = (value: unknown): string[] =>
  String(value ?? "")
    .split("|")
    .map((reason) => reason.trim())
    .filter(Boolean);

async function upsertChunks(
  table: string,
  records: Record<string, unknown>[],
  report: ImportReport,
  chunkSize = 250
) {
  if (!records.length) {
    report.imported[table] = 0;
    return;
  }

  const supabase = getSupabaseAdmin();
  let imported = 0;

  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: "id" });
    if (error) {
      report.errors.push({ table, message: error.message });
      throw new Error(`${table} import failed: ${error.message}`);
    }
    imported += chunk.length;
  }

  report.imported[table] = imported;
}

async function upsertTopicScores(
  records: Record<string, unknown>[],
  report: ImportReport
) {
  if (!records.length) {
    report.imported.topic_scores = 0;
    return;
  }

  const supabase = getSupabaseAdmin();
  let imported = 0;
  for (let index = 0; index < records.length; index += 250) {
    const chunk = records.slice(index, index + 250);
    const { error } = await supabase
      .from("topic_scores")
      .upsert(chunk, { onConflict: "person_id,topic" });
    if (error) {
      report.errors.push({ table: "topic_scores", message: error.message });
      throw new Error(`topic_scores import failed: ${error.message}`);
    }
    imported += chunk.length;
  }
  report.imported.topic_scores = imported;
}

export async function importSheetExport(input: unknown): Promise<ImportReport> {
  const data = input as ExportFile;
  if (!data || data.format !== "network-crm-sheets-export" || !data.sheets) {
    throw new Error("This is not a valid Network CRM migration export.");
  }

  const report: ImportReport = {
    source: {
      spreadsheet: data.spreadsheet_name,
      exported_at: data.exported_at,
    },
    imported: {},
    skipped: {},
    errors: [],
    validation: {},
  };

  const people = (data.sheets.People ?? [])
    .filter((row) => clean(row.person_id))
    .map((row) => ({
      id: clean(row.person_id),
      name: clean(row.name) ?? "Unknown",
      phone: clean(row.phone),
      email: clean(row.email),
      instagram: clean(row.instagram),
      instagram_followers: integer(row.instagram_followers),
      company: clean(row.company),
      role: clean(row.role),
      where_met: clean(row.where_met),
      summary: clean(row.summary),
      importance: integer(row.importance),
      importance_reason: clean(row.importance_reason),
      last_contact: dateValue(row.last_contact),
      affinity_override:
        clean(row.affinity_override) === null
          ? null
          : integer(row.affinity_override, 0, 100),
      computed_affinity: integer(
        row.computed_affinity || row.affinity_score,
        0,
        100
      ),
      affinity_confidence: integer(row.affinity_confidence, 0, 100),
      affinity_reasons: reasonsJson(row.affinity_reasons),
      created_at: dateValue(row.created_at) ?? new Date().toISOString(),
    }));

  await upsertChunks("people", people, report);

  const personIds = new Set(people.map((person) => String(person.id)));

  const memories = (data.sheets.Memories ?? [])
    .filter((row) => clean(row.memory_id) && personIds.has(String(clean(row.person_id))))
    .map((row) => ({
      id: clean(row.memory_id),
      person_id: clean(row.person_id),
      raw_note: clean(row.raw_note) ?? "",
      topics: splitTopics(row.topics),
      event: clean(row.event),
      source: clean(row.source),
      created_at: dateValue(row.date) ?? new Date().toISOString(),
    }));
  report.skipped.memories = (data.sheets.Memories ?? []).length - memories.length;
  await upsertChunks("memories", memories, report);

  const memoryIds = new Set(memories.map((memory) => String(memory.id)));

  const evidence = (data.sheets.Evidence ?? [])
    .filter((row) => clean(row.evidence_id) && personIds.has(String(clean(row.person_id))))
    .map((row) => ({
      id: clean(row.evidence_id),
      person_id: clean(row.person_id),
      memory_id: memoryIds.has(String(clean(row.source_memory_id)))
        ? clean(row.source_memory_id)
        : null,
      topic: (clean(row.topic) ?? "unknown").toLowerCase(),
      polarity: numberValue(row.polarity, 1) < 0 ? -1 : 1,
      enthusiasm: integer(row.enthusiasm, 0, 100),
      behavior: integer(row.behavior, 0, 100),
      specificity: integer(row.specificity, 0, 100),
      certainty: integer(row.certainty, 0, 100),
      recency_weight: Math.max(0, Math.min(1, numberValue(row.recency, 100) / 100)),
      score: integer(row.score, 0, 100),
      confidence: integer(row.confidence, 0, 100),
      evidence_type: clean(row.evidence_type) ?? "imported",
      quote: clean(row.quote) ?? "",
      is_correction: boolValue(row.is_correction),
      created_at: dateValue(row.created_at) ?? new Date().toISOString(),
    }));
  report.skipped.interest_evidence =
    (data.sheets.Evidence ?? []).length - evidence.length;
  await upsertChunks("interest_evidence", evidence, report);

  const connections = (data.sheets.Connections ?? [])
    .filter(
      (row) =>
        clean(row.connection_id) &&
        personIds.has(String(clean(row.person_a_id))) &&
        personIds.has(String(clean(row.person_b_id))) &&
        clean(row.person_a_id) !== clean(row.person_b_id)
    )
    .map((row) => ({
      id: clean(row.connection_id),
      person_a_id: clean(row.person_a_id),
      person_b_id: clean(row.person_b_id),
      relationship: clean(row.relationship),
      strength: integer(row.strength, 0, 100),
      notes: clean(row.notes),
      created_at: dateValue(row.created_at) ?? new Date().toISOString(),
    }));
  report.skipped.connections =
    (data.sheets.Connections ?? []).length - connections.length;
  await upsertChunks("connections", connections, report);

  const lists = (data.sheets.Lists ?? [])
    .filter((row) => clean(row.list_id))
    .map((row) => ({
      id: clean(row.list_id),
      name: clean(row.name) ?? "Untitled list",
      topic: clean(row.topic)?.toLowerCase() ?? null,
      description: clean(row.description),
      created_at: dateValue(row.created_at) ?? new Date().toISOString(),
    }));
  await upsertChunks("lists", lists, report);

  const listIds = new Set(lists.map((list) => String(list.id)));
  const listMembers = (data.sheets.ListMembers ?? [])
    .filter(
      (row) =>
        clean(row.list_member_id) &&
        listIds.has(String(clean(row.list_id))) &&
        personIds.has(String(clean(row.person_id)))
    )
    .map((row) => ({
      id: clean(row.list_member_id),
      list_id: clean(row.list_id),
      person_id: clean(row.person_id),
      status: clean(row.status) ?? "candidate",
      notes: clean(row.notes),
      created_at: dateValue(row.created_at) ?? new Date().toISOString(),
    }));
  report.skipped.list_members =
    (data.sheets.ListMembers ?? []).length - listMembers.length;
  await upsertChunks("list_members", listMembers, report);

  const events = (data.sheets.Events ?? [])
    .filter((row) => clean(row.event_id))
    .map((row) => ({
      id: clean(row.event_id),
      name: clean(row.name) ?? "Untitled event",
      topic: clean(row.topic)?.toLowerCase() ?? null,
      event_date: dateValue(row.date),
      notes: clean(row.notes),
      created_at: dateValue(row.created_at) ?? new Date().toISOString(),
    }));
  await upsertChunks("events", events, report);

  const eventIds = new Set(events.map((event) => String(event.id)));
  const feedback = (data.sheets.EventFeedback ?? [])
    .filter(
      (row) =>
        clean(row.feedback_id) &&
        eventIds.has(String(clean(row.event_id))) &&
        personIds.has(String(clean(row.person_id)))
    )
    .map((row) => ({
      id: clean(row.feedback_id),
      event_id: clean(row.event_id),
      person_id: clean(row.person_id),
      interest_score: integer(row.interest_score, 0, 5),
      fit_score: integer(row.fit_score, 0, 5),
      energy_score: integer(row.energy_score, 0, 5),
      reliability_score: integer(row.reliability_score, 0, 5),
      notes: clean(row.notes),
      created_at: dateValue(row.created_at) ?? new Date().toISOString(),
    }));
  report.skipped.event_feedback =
    (data.sheets.EventFeedback ?? []).length - feedback.length;
  await upsertChunks("event_feedback", feedback, report);

  const topicScoreMap = new Map<
    string,
    {
      person_id: string;
      topic: string;
      weighted: number;
      weight: number;
      count: number;
      explanations: Array<Record<string, unknown>>;
    }
  >();

  for (const item of evidence) {
    const key = `${item.person_id}:${item.topic}`;
    const confidenceWeight = Math.max(0.2, Number(item.confidence) / 100);
    const correctionWeight = item.is_correction ? 1.75 : 1;
    const weight = confidenceWeight * correctionWeight;
    const existing = topicScoreMap.get(key) ?? {
      person_id: String(item.person_id),
      topic: String(item.topic),
      weighted: 0,
      weight: 0,
      count: 0,
      explanations: [],
    };
    existing.weighted += Number(item.score) * weight;
    existing.weight += weight;
    existing.count += 1;
    existing.explanations.push({
      quote: item.quote,
      score: item.score,
      confidence: item.confidence,
      evidence_type: item.evidence_type,
    });
    topicScoreMap.set(key, existing);
  }

  const topicScores = Array.from(topicScoreMap.values()).map((item) => ({
    person_id: item.person_id,
    topic: item.topic,
    score: integer(item.weight ? item.weighted / item.weight : 0, 0, 100),
    confidence: integer(Math.min(100, 38 + item.count * 15), 0, 100),
    evidence_count: item.count,
    explanation: item.explanations
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, 5),
    updated_at: new Date().toISOString(),
  }));
  await upsertTopicScores(topicScores, report);

  const sourceCounts: Record<string, number> = {
    people: people.length,
    memories: memories.length,
    interest_evidence: evidence.length,
    connections: connections.length,
    lists: lists.length,
    list_members: listMembers.length,
    events: events.length,
    event_feedback: feedback.length,
    topic_scores: topicScores.length,
  };

  const supabase = getSupabaseAdmin();
  for (const [table, source] of Object.entries(sourceCounts)) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) {
      report.errors.push({ table, message: error.message });
      continue;
    }
    const database = count ?? 0;
    report.validation[table] = {
      source,
      database,
      matches: database >= source,
    };
  }

  return report;
}
