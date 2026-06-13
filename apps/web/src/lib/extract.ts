import { generateObject } from "ai";

import { grokModel } from "./grok";
import { ExtractionSchema, type Extraction } from "./schemas";
import type { SourceDoc } from "./types";

const SYSTEM = `You are a clinical information extraction engine for a patient-owned health record.
Extract ONLY what is explicitly written in the document. Never infer, never add facts that are not present, never assign codes that are not printed in the text.

Critical rule — provenance: for every item you MUST return \`textSpan\`, the exact verbatim substring of the document the item came from. Copy it character-for-character (do not paraphrase, do not reformat). This quote is shown to clinicians as proof, so it must be findable in the original text.

Also identify \`sourceSystem\`: the facility or health system that produced this document, read from its header/letterhead (e.g. "Pacific Heart Cardiology", "Bay Area Family Medicine", "CVS Pharmacy").

Capture medications with their brand names exactly as written (e.g. "Glucophage", "Zestril") — do not generic-ize them yet. Capture EVERY lab value exactly as written, including comparator symbols and original units (do not skip labs from a panel).`;

/** Pull raw, verbatim clinical mentions from a single source document. */
export async function extractFromDocument(doc: SourceDoc): Promise<Extraction> {
  const { object } = await generateObject({
    model: grokModel("extract"),
    schema: ExtractionSchema,
    temperature: 0,
    system: SYSTEM,
    prompt: [
      `Source document id: ${doc.id}`,
      `Label: ${doc.label}`,
      `Originating system: ${doc.system}`,
      doc.date ? `Date: ${doc.date}` : null,
      "",
      "Document text:",
      '"""',
      doc.text,
      '"""',
    ]
      .filter((line) => line !== null)
      .join("\n"),
  });

  return object;
}

/** A per-document extraction paired with the document it came from. */
export interface DocExtraction {
  doc: SourceDoc;
  extraction: Extraction;
}

export function countMentions(e: Extraction): number {
  return e.medications.length + e.labs.length + e.conditions.length + e.allergies.length;
}
