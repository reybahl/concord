/** Core domain types for Concord's reconciled health record. */

export type CodeSystem = "RxNorm" | "LOINC" | "SNOMED" | "ICD-10" | "NDC";

/** Where a fact came from — the spine of the grounding/anti-hallucination story. */
export interface Provenance {
  sourceDocId: string;
  sourceLabel: string;
  /** The exact text the fact was extracted from. */
  textSpan: string;
}

export interface MedicationFact {
  id: string;
  display: string;
  rxnorm?: string;
  dose?: string;
  sig?: string;
  status: "active" | "acute" | "resolved";
  confidence: number;
  provenance: Provenance[];
  /** The different ways this single drug appeared across sources (brand/generic/NDC). */
  aliases?: string[];
  reviewNeeded?: boolean;
}

export interface LabPoint {
  date: string;
  value: number | null;
  unit: string;
  /** Value/unit as originally reported (e.g. IFCC mmol/mol) before normalization. */
  reported?: string;
  /** Normalized value when units differed across sources. */
  normalizedValue?: number;
  source: string;
}

export interface LabObservation {
  id: string;
  display: string;
  loinc?: string;
  series: LabPoint[];
  trend?: "rising" | "falling" | "stable";
  goal?: string;
  confidence: number;
  provenance: Provenance[];
}

export interface ConditionFact {
  id: string;
  display: string;
  icd10?: string;
  snomed?: string;
  note?: string;
  /** True when Concord inferred this (e.g. from a lab trend) and no provider coded it. */
  inferred?: boolean;
  confidence: number;
  provenance: Provenance[];
}

export interface AllergyFact {
  id: string;
  display: string;
  snomed?: string;
  reaction?: string;
  confidence: number;
  provenance: Provenance[];
}

export type InsightKind =
  | "interaction"
  | "duplicate_therapy"
  | "lab_trend"
  | "care_gap"
  | "question";

export type Severity = "high" | "medium" | "low";

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: Severity;
  title: string;
  explanation: string;
  /** True when no single provider could have seen this (the hero framing). */
  crossProvider?: boolean;
  citationUrl?: string;
  citationLabel?: string;
  relatedFactIds: string[];
}

export interface SourceDoc {
  id: string;
  label: string;
  system: string;
  date?: string;
  text: string;
}

export interface WebSource {
  url: string;
  title?: string;
}

export interface HealthRecord {
  patient: { name: string; dob?: string; sex?: string };
  sources: SourceDoc[];
  medications: MedicationFact[];
  labs: LabObservation[];
  conditions: ConditionFact[];
  allergies: AllergyFact[];
  insights: Insight[];
  /** URLs retrieved via Grok web_search during analysis (verified reachable). */
  webSources?: WebSource[];
  meta?: {
    pipeline: "live" | "fallback";
  };
}

/** Streamed pipeline progress event. */
export interface StageEvent {
  type: "stage";
  stage: string;
  label: string;
  status: "start" | "done";
  detail?: string;
}

/** A line of real-time substance emitted under a stage (a merge, a normalization, a finding). */
export interface NoteEvent {
  type: "note";
  stage: string;
  text: string;
  tone?: "info" | "merge" | "flag" | "model";
  /** When set, replaces the prior note with the same slot instead of appending. */
  slot?: string;
}

export interface ResultEvent {
  type: "result";
  record: HealthRecord;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type PipelineEvent = StageEvent | NoteEvent | ResultEvent | ErrorEvent;
