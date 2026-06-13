import type { HealthRecord } from "./types";

/**
 * Export the reconciled record as a FHIR R4 (US Core-aligned) Bundle. This is the
 * "it's yours, and it's portable" proof point: the patient-owned record leaves in
 * the same standard format any EHR can ingest.
 */
export function toFhirBundle(record: HealthRecord) {
  const patientId = "patient-1";

  const entries: unknown[] = [];

  entries.push({
    fullUrl: `urn:uuid:${patientId}`,
    resource: {
      resourceType: "Patient",
      id: patientId,
      name: [{ text: record.patient.name }],
      birthDate: record.patient.dob,
      gender: record.patient.sex,
    },
  });

  for (const med of record.medications) {
    entries.push({
      resource: {
        resourceType: "MedicationStatement",
        id: med.id,
        status: med.status === "resolved" ? "completed" : "active",
        medicationCodeableConcept: {
          coding: med.rxnorm
            ? [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: med.rxnorm, display: med.display }]
            : [],
          text: med.display,
        },
        subject: { reference: `Patient/${patientId}` },
        dosage: med.sig ? [{ text: med.sig }] : undefined,
      },
    });
  }

  for (const lab of record.labs) {
    for (const point of lab.series) {
      entries.push({
        resource: {
          resourceType: "Observation",
          id: `${lab.id}-${point.date}`,
          status: "final",
          category: [
            {
              coding: [
                { system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" },
              ],
            },
          ],
          code: {
            coding: lab.loinc ? [{ system: "http://loinc.org", code: lab.loinc, display: lab.display }] : [],
            text: lab.display,
          },
          subject: { reference: `Patient/${patientId}` },
          effectiveDateTime: point.date,
          valueQuantity:
            point.value != null ? { value: point.value, unit: point.unit } : undefined,
        },
      });
    }
  }

  for (const cond of record.conditions) {
    entries.push({
      resource: {
        resourceType: "Condition",
        id: cond.id,
        clinicalStatus: { coding: [{ code: "active" }] },
        code: {
          coding: [
            ...(cond.icd10 ? [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: cond.icd10 }] : []),
            ...(cond.snomed ? [{ system: "http://snomed.info/sct", code: cond.snomed }] : []),
          ],
          text: cond.display,
        },
        subject: { reference: `Patient/${patientId}` },
      },
    });
  }

  for (const allergy of record.allergies) {
    entries.push({
      resource: {
        resourceType: "AllergyIntolerance",
        id: allergy.id,
        code: {
          coding: allergy.snomed ? [{ system: "http://snomed.info/sct", code: allergy.snomed }] : [],
          text: allergy.display,
        },
        patient: { reference: `Patient/${patientId}` },
        reaction: allergy.reaction ? [{ manifestation: [{ text: allergy.reaction }] }] : undefined,
      },
    });
  }

  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}
