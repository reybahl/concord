import { generateObject } from "ai";

import { getBlobBytes } from "./blob";
import { grokModel } from "./grok";
import { isPdfMimeType } from "./mime";
import { ExtractionSchema, type Extraction } from "./schemas";
import type { SourceDoc } from "./types";
import { deleteXaiFile, extractFromPdfWithGrok, uploadXaiFile } from "./xai-files";

const PROVENANCE_RULE = `Critical rule — provenance: for every item you MUST return \`textSpan\`, a verbatim excerpt from the document the item came from. Copy it character-for-character (do not paraphrase, do not reformat). This quote is shown to clinicians as proof.

Also identify \`sourceSystem\`: the facility or health system that produced this document, read from its header/letterhead (e.g. "Pacific Heart Cardiology", "Bay Area Family Medicine", "CVS Pharmacy").

Capture medications with their brand names exactly as written (e.g. "Glucophage", "Zestril") — do not generic-ize them yet. Capture EVERY lab value exactly as written, including comparator symbols and original units (do not skip labs from a panel).`;

const SYSTEM_TEXT = `You are a clinical information extraction engine for a patient-owned health record.
Extract ONLY what is explicitly written in the document. Never infer, never add facts that are not present, never assign codes that are not printed in the text.

${PROVENANCE_RULE}`;

const SYSTEM_PDF = `You are a clinical information extraction engine for a patient-owned health record.
The user attached a PDF source document. Read it fully — including tables, panels, and letterhead — using the document attachment tools available to you.

Extract ONLY what is explicitly written in the PDF. Never infer, never add facts that are not present, never assign codes that are not printed.

${PROVENANCE_RULE}
For PDF sources, \`textSpan\` must be a short verbatim quote exactly as it appears in the PDF (the smallest excerpt that contains the fact).`;

function buildDocHeader(doc: SourceDoc): string {
  return [
    `Source document id: ${doc.id}`,
    `Label: ${doc.label}`,
    `Originating system: ${doc.system}`,
    doc.date ? `Date: ${doc.date}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Pull raw, verbatim clinical mentions from a single source document. */
export async function extractFromDocument(doc: SourceDoc): Promise<Extraction> {
  if (doc.mimeType && isPdfMimeType(doc.mimeType)) {
    if (!doc.blobUrl) {
      throw new Error(`PDF "${doc.label}" is missing blob storage reference.`);
    }

    const bytes = await getBlobBytes(doc.blobUrl);
    const filename = doc.filename ?? `${doc.label.replace(/\s+/g, "-")}.pdf`;
    const fileId = await uploadXaiFile(bytes, filename);

    try {
      return await extractFromPdfWithGrok({
        fileId,
        system: SYSTEM_PDF,
        prompt: [
          buildDocHeader(doc),
          "",
          "Extract clinical facts from the attached PDF.",
        ].join("\n"),
      });
    } finally {
      await deleteXaiFile(fileId);
    }
  }

  const { object } = await generateObject({
    model: grokModel("extract"),
    schema: ExtractionSchema,
    temperature: 0,
    system: SYSTEM_TEXT,
    prompt: [
      buildDocHeader(doc),
      "",
      "Document text:",
      '"""',
      doc.text,
      '"""',
    ].join("\n"),
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
