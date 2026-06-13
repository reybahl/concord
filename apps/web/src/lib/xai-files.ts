import { zodSchema } from "ai";

import { MODELS } from "./grok";
import { ExtractionSchema, type Extraction } from "./schemas";

const XAI_BASE = "https://api.x.ai/v1";

function requireXaiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not set — cannot reach Grok.");
  return key;
}

/** Upload a private PDF to xAI storage for attachment_search during extraction. */
export async function uploadXaiFile(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), filename);
  form.append("purpose", "assistants");

  const res = await fetch(`${XAI_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireXaiKey()}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`xAI file upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("xAI file upload returned no file id.");
  return data.id;
}

export async function deleteXaiFile(fileId: string): Promise<void> {
  await fetch(`${XAI_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${requireXaiKey()}` },
  }).catch(() => undefined);
}

type XaiResponsesBody = {
  output?: Array<{
    type: string;
    content?: Array<{ text?: string }>;
  }>;
};

async function extractionJsonSchema(): Promise<Record<string, unknown>> {
  const schema = zodSchema(ExtractionSchema);
  const jsonSchema = await schema.jsonSchema;
  const { $schema, ...rest } = jsonSchema as Record<string, unknown> & { $schema?: unknown };
  return rest;
}

/** Extract structured clinical facts from an uploaded PDF via Grok attachment_search. */
export async function extractFromPdfWithGrok(params: {
  fileId: string;
  system: string;
  prompt: string;
}): Promise<Extraction> {
  const schema = await extractionJsonSchema();

  const res = await fetch(`${XAI_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireXaiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODELS.extract,
      temperature: 0,
      input: [
        { role: "system", content: params.system },
        {
          role: "user",
          content: [
            { type: "input_text", text: params.prompt },
            { type: "input_file", file_id: params.fileId },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          strict: true,
          name: "ClinicalExtraction",
          description: "Structured clinical facts extracted from one source document",
          schema,
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Grok PDF extraction failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  }

  const body = (await res.json()) as XaiResponsesBody;
  const text = extractOutputText(body);
  return ExtractionSchema.parse(JSON.parse(text));
}

function extractOutputText(body: XaiResponsesBody): string {
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.text?.trim()) return part.text;
    }
  }
  throw new Error("Grok returned no extraction output for this PDF.");
}
