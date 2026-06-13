import type { NoteEvent, PipelineEvent, StageEvent } from "./types";

/** Serializable stage/note events from one reconciliation run (excludes the result payload). */
export type PersistedPipelineEvent = StageEvent | NoteEvent;

export interface PipelineRunLog {
  events: PersistedPipelineEvent[];
  completedAt: string;
}

export interface PipelineStageSnapshot {
  stage: string;
  label: string;
  status: "start" | "done";
  detail?: string;
  notes: { text: string; tone?: NoteEvent["tone"] }[];
}

export function isPersistablePipelineEvent(
  event: PipelineEvent,
): event is PersistedPipelineEvent {
  return event.type === "stage" || event.type === "note";
}

/** Fold streamed events into the stage list the UI renders. */
export function foldPipelineEvents(events: ReadonlyArray<PersistedPipelineEvent>): PipelineStageSnapshot[] {
  const stages: PipelineStageSnapshot[] = [];

  for (const event of events) {
    if (event.type === "stage") {
      const existing = stages.find((s) => s.stage === event.stage);
      if (existing) {
        existing.status = event.status;
        existing.label = event.label;
        existing.detail = event.detail ?? existing.detail;
      } else {
        stages.push({
          stage: event.stage,
          label: event.label,
          status: event.status,
          detail: event.detail,
          notes: [],
        });
      }
      continue;
    }

    const note = { text: event.text, tone: event.tone };
    const existing = stages.find((s) => s.stage === event.stage);
    if (existing) {
      existing.notes.push(note);
    } else {
      stages.push({
        stage: event.stage,
        label: event.stage,
        status: "start",
        notes: [note],
      });
    }
  }

  return stages;
}
