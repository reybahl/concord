import { DEMO_DOCS } from "./demo-documents";
import type { HealthRecord } from "./types";

/**
 * The deterministic "answer key" — the correct reconciled output for the five
 * demo documents. Used when no XAI_API_KEY is present (and as a golden reference
 * for the live Grok pipeline). Keeping this on-hand means the live demo renders a
 * complete, correct record even if the model/network misbehaves on stage.
 */
export const MOCK_RECORD: HealthRecord = {
  patient: { name: "Maria Elena Gonzalez", dob: "1968-03-14", sex: "female" },
  sources: DEMO_DOCS,
  medications: [
    {
      id: "med-metformin",
      display: "Metformin hydrochloride 500 MG Oral Tablet",
      rxnorm: "861007",
      dose: "500 mg",
      sig: "1 tablet PO twice daily with meals",
      status: "active",
      confidence: 0.98,
      aliases: ["Metformin HCl 500 mg", "Glucophage 500 mg", "METFORMIN HCL 500MG TAB", '"a metformin"'],
      provenance: [
        { sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "Metformin HCl 500 mg tablet -- 1 tablet PO TWICE daily" },
        { sourceDocId: "cardiology", sourceLabel: "Cardiology", textSpan: "Glucophage 500 mg PO BID" },
        { sourceDocId: "pharmacy", sourceLabel: "CVS Pharmacy", textSpan: "METFORMIN HCL 500MG TAB  NDC 00093-7214-01" },
      ],
    },
    {
      id: "med-lisinopril",
      display: "Lisinopril 10 MG Oral Tablet",
      rxnorm: "314076",
      dose: "10 mg",
      sig: "1 tablet PO once daily",
      status: "active",
      confidence: 0.97,
      aliases: ["Lisinopril 10 mg", "Zestril 10 mg", "LISINOPRIL 10MG TAB"],
      reviewNeeded: true,
      provenance: [
        { sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "Lisinopril 10 mg tablet -- 1 tablet PO once daily" },
        { sourceDocId: "cardiology", sourceLabel: "Cardiology", textSpan: "Zestril 10 mg PO QD" },
        { sourceDocId: "pharmacy", sourceLabel: "CVS Pharmacy", textSpan: "LISINOPRIL 10MG TAB  NDC 68180-0518-01" },
      ],
    },
    {
      id: "med-simvastatin",
      display: "Simvastatin 20 MG Oral Tablet",
      rxnorm: "312962",
      dose: "20 mg",
      sig: "1 tablet PO at bedtime",
      status: "active",
      confidence: 0.98,
      aliases: ["Simvastatin 20 mg", "SIMVASTATIN 20MG TAB", '"a cholesterol pill"'],
      provenance: [
        { sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "Simvastatin 20 mg tablet -- 1 tablet PO at bedtime" },
        { sourceDocId: "cardiology", sourceLabel: "Cardiology", textSpan: "Simvastatin 20 mg PO QHS" },
        { sourceDocId: "pharmacy", sourceLabel: "CVS Pharmacy", textSpan: "SIMVASTATIN 20MG TAB  NDC 00093-7155-98" },
      ],
    },
    {
      id: "med-hctz",
      display: "Hydrochlorothiazide 25 MG Oral Tablet",
      rxnorm: "310798",
      dose: "25 mg",
      sig: "1 tablet PO once daily",
      status: "active",
      confidence: 0.96,
      aliases: ["Hydrochlorothiazide 25 mg", "HCTZ 25 mg", "HYDROCHLOROTHIAZIDE 25MG TAB"],
      provenance: [
        { sourceDocId: "cardiology", sourceLabel: "Cardiology", textSpan: "Started today: Hydrochlorothiazide 25 mg PO QD" },
        { sourceDocId: "pharmacy", sourceLabel: "CVS Pharmacy", textSpan: "HYDROCHLOROTHIAZIDE 25MG TAB  NDC 00378-0016-01" },
      ],
    },
    {
      id: "med-aspirin",
      display: "Aspirin 81 MG Delayed Release Oral Tablet",
      rxnorm: "243670",
      dose: "81 mg",
      sig: "1 tablet PO once daily",
      status: "active",
      confidence: 0.95,
      aliases: ["ASA 81 mg", "ASPIRIN 81MG EC TAB"],
      provenance: [
        { sourceDocId: "cardiology", sourceLabel: "Cardiology", textSpan: "Started today: ASA 81 mg PO QD" },
        { sourceDocId: "pharmacy", sourceLabel: "CVS Pharmacy", textSpan: "ASPIRIN 81MG EC TAB (OTC)  NDC 00904-2013-60" },
      ],
    },
    {
      id: "med-clarithromycin",
      display: "Clarithromycin 500 MG Oral Tablet",
      rxnorm: "205671",
      dose: "500 mg",
      sig: "1 tablet PO every 12 hours x 7 days (acute course, started 2026-05-22)",
      status: "acute",
      confidence: 0.97,
      aliases: ["Clarithromycin 500 mg", "CLARITHROMYCIN 500MG TAB"],
      provenance: [
        { sourceDocId: "urgent_care", sourceLabel: "Urgent Care", textSpan: "Clarithromycin 500 mg -- 1 tab PO every 12 hours x 7 days" },
        { sourceDocId: "pharmacy", sourceLabel: "CVS Pharmacy", textSpan: "CLARITHROMYCIN 500MG TAB  NDC 00074-2586-13" },
      ],
    },
  ],
  labs: [
    {
      id: "lab-a1c",
      display: "Hemoglobin A1c",
      loinc: "4548-4",
      goal: "individualized, typically < 7%",
      trend: "rising",
      confidence: 0.96,
      series: [
        { date: "2026-02-08", value: 6.1, unit: "%", source: "Primary Care" },
        { date: "2026-04-08", value: 6.5, unit: "%", source: "Cardiology (POC)" },
        { date: "2026-05-28", value: 6.9, unit: "%", reported: "52 mmol/mol (IFCC)", normalizedValue: 6.9, source: "Meridian Lab" },
      ],
      provenance: [
        { sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "Hemoglobin A1c 6.1 %" },
        { sourceDocId: "cardiology", sourceLabel: "Cardiology", textSpan: "In-office A1c (point-of-care): 6.5%" },
        { sourceDocId: "lab", sourceLabel: "Meridian Lab", textSpan: "Hemoglobin A1c (IFCC) 52 mmol/mol -> 6.9% NGSP" },
      ],
    },
    {
      id: "lab-ldl",
      display: "LDL Cholesterol (calculated)",
      loinc: "13457-7",
      goal: "< 100 mg/dL",
      trend: "rising",
      confidence: 0.97,
      series: [
        { date: "2026-02-08", value: 138, unit: "mg/dL", source: "Primary Care" },
        { date: "2026-05-28", value: 152, unit: "mg/dL", source: "Meridian Lab" },
      ],
      provenance: [
        { sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "LDL cholesterol 138 mg/dL" },
        { sourceDocId: "lab", sourceLabel: "Meridian Lab", textSpan: "LDL-Cholesterol (calc) 152 mg/dL" },
      ],
    },
    {
      id: "lab-cr",
      display: "Creatinine, serum",
      loinc: "2160-0",
      goal: "0.6 - 1.1 mg/dL",
      trend: "rising",
      confidence: 0.97,
      series: [
        { date: "2026-02-08", value: 0.9, unit: "mg/dL", source: "Primary Care" },
        { date: "2026-05-28", value: 1.2, unit: "mg/dL", source: "Meridian Lab" },
      ],
      provenance: [
        { sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "Creatinine, serum 0.9 mg/dL" },
        { sourceDocId: "lab", sourceLabel: "Meridian Lab", textSpan: "Creatinine, serum 1.2 mg/dL (H)" },
      ],
    },
    {
      id: "lab-egfr",
      display: "eGFR (CKD-EPI 2021)",
      loinc: "98979-8",
      goal: "> 60 mL/min/1.73m2",
      trend: "falling",
      confidence: 0.95,
      series: [
        { date: "2026-02-08", value: null, unit: "mL/min/1.73m2", reported: "> 60", source: "Primary Care" },
        { date: "2026-05-28", value: 58, unit: "mL/min/1.73m2", source: "Meridian Lab" },
      ],
      provenance: [
        { sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "eGFR > 60 mL/min/1.73m2" },
        { sourceDocId: "lab", sourceLabel: "Meridian Lab", textSpan: "eGFR (CKD-EPI 2021) 58 (L)" },
      ],
    },
  ],
  conditions: [
    {
      id: "cond-t2dm",
      display: "Type 2 diabetes mellitus",
      icd10: "E11.9",
      snomed: "44054006",
      confidence: 0.98,
      provenance: [{ sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "Type 2 diabetes mellitus without complications (E11.9)" }],
    },
    {
      id: "cond-htn",
      display: "Essential hypertension",
      icd10: "I10",
      snomed: "59621000",
      confidence: 0.98,
      provenance: [{ sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "Essential (primary) hypertension (I10)" }],
    },
    {
      id: "cond-hld",
      display: "Mixed hyperlipidemia",
      icd10: "E78.2",
      snomed: "267434003",
      confidence: 0.97,
      provenance: [{ sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "Mixed hyperlipidemia (E78.2)" }],
    },
    {
      id: "cond-bronchitis",
      display: "Acute bronchitis",
      icd10: "J20.9",
      snomed: "10509002",
      note: "Acute / transient (May 2026)",
      confidence: 0.9,
      provenance: [{ sourceDocId: "urgent_care", sourceLabel: "Urgent Care", textSpan: "Acute bronchitis (J20.9)" }],
    },
    {
      id: "cond-ckd",
      display: "Chronic kidney disease, stage 3a (emerging)",
      icd10: "N18.31",
      snomed: "700378005",
      note: "Inferred from eGFR 58 + rising creatinine. Not yet coded by any provider — potential care gap.",
      inferred: true,
      confidence: 0.72,
      provenance: [{ sourceDocId: "lab", sourceLabel: "Meridian Lab", textSpan: "If eGFR remains 45-59, consider CKD stage G3a evaluation" }],
    },
  ],
  allergies: [
    {
      id: "allergy-pcn",
      display: "Allergy to penicillin",
      snomed: "91936005",
      reaction: "rash",
      confidence: 0.95,
      provenance: [
        { sourceDocId: "pcp", sourceLabel: "Primary Care", textSpan: "PENICILLIN -- reaction: rash" },
        { sourceDocId: "urgent_care", sourceLabel: "Urgent Care", textSpan: "States penicillin allergy (PCN -> rash)" },
      ],
    },
  ],
  insights: [
    {
      id: "insight-interaction",
      kind: "interaction",
      severity: "high",
      title: "Clarithromycin + Simvastatin — contraindicated combination",
      explanation:
        "Urgent care prescribed clarithromycin without the medication list. Clarithromycin is a strong CYP3A4 inhibitor that sharply raises simvastatin blood levels, risking myopathy and rhabdomyolysis — the combination is contraindicated on the simvastatin label. No single record contained both drugs, so no one prescriber could have caught it.",
      crossProvider: true,
      citationUrl:
        "https://www.fda.gov/drugs/drug-safety-and-availability/fda-drug-safety-communication-new-restrictions-contraindications-and-dose-limitations-zocor-simvastatin",
      citationLabel: "FDA Drug Safety Communication — simvastatin contraindications",
      relatedFactIds: ["med-clarithromycin", "med-simvastatin"],
    },
    {
      id: "insight-duplicate",
      kind: "duplicate_therapy",
      severity: "medium",
      title: "Lisinopril and Zestril are the same drug",
      explanation:
        "The PCP lists generic 'Lisinopril 10 mg' and cardiology lists brand 'Zestril 10 mg'. They map to the same RxNorm ingredient. A naive merge would list two ACE inhibitors and risk a double dose.",
      crossProvider: true,
      relatedFactIds: ["med-lisinopril"],
    },
    {
      id: "insight-a1c",
      kind: "lab_trend",
      severity: "medium",
      title: "Worsening glycemic control (A1c 6.1 → 6.5 → 6.9%)",
      explanation:
        "The trend is only visible after normalizing the most recent result from IFCC mmol/mol (52) to NGSP % (6.9). Suggests a treatment-intensification discussion.",
      relatedFactIds: ["lab-a1c"],
    },
    {
      id: "insight-egfr",
      kind: "lab_trend",
      severity: "medium",
      title: "Declining kidney function (eGFR > 60 → 58; creatinine 0.9 → 1.2)",
      explanation:
        "Emerging CKD stage G3a affects metformin safety and ACE-inhibitor / thiazide / potassium management. Not yet acknowledged on any provider's problem list.",
      relatedFactIds: ["lab-egfr", "lab-cr"],
    },
    {
      id: "insight-ldl",
      kind: "lab_trend",
      severity: "low",
      title: "LDL above goal on simvastatin (138 → 152 mg/dL)",
      explanation: "LDL is rising and remains above the < 100 mg/dL goal despite statin therapy — statin not at goal.",
      relatedFactIds: ["lab-ldl"],
    },
    {
      id: "insight-eye",
      kind: "care_gap",
      severity: "medium",
      title: "Overdue diabetic retinal eye exam",
      explanation: "Recommended annually for diabetes; none on file per the PCP health-maintenance section.",
      relatedFactIds: ["cond-t2dm"],
    },
    {
      id: "insight-crc",
      kind: "care_gap",
      severity: "medium",
      title: "Overdue colorectal cancer screening",
      explanation: "USPSTF recommends screening for adults 45–75; none on file. The patient is 58.",
      relatedFactIds: [],
    },
    {
      id: "insight-acr",
      kind: "care_gap",
      severity: "low",
      title: "Missing urine albumin–creatinine ratio",
      explanation: "Recommended for diabetic kidney monitoring, especially with declining eGFR; not on file.",
      relatedFactIds: ["cond-t2dm", "lab-egfr"],
    },
  ],
};
