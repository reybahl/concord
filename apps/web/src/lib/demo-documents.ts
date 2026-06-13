import type { SourceDoc } from "./types";

/**
 * The five synthetic source documents for the demo. They deliberately disagree:
 * different names/MRNs, brand vs generic drugs, a dropped allergy, a unit mismatch,
 * and an interaction nobody could see from a single record. This is the raw input
 * to the reconciliation pipeline.
 */
export const DEMO_DOCS: SourceDoc[] = [
  {
    id: "pcp",
    label: "Primary Care — After-Visit Summary",
    system: "Bay Area Family Medicine (Epic)",
    date: "2026-02-10",
    text: `BAY AREA FAMILY MEDICINE — AFTER VISIT SUMMARY
Patient: GONZALEZ, MARIA E.   MRN: BAFM-0102374
DOB: 03/14/1968 (Age 58)   Sex: Female
Date of Visit: 02/10/2026   Provider: Susan T. Okafor, MD

ACTIVE PROBLEM LIST
  1. Type 2 diabetes mellitus without complications   (E11.9)
  2. Essential (primary) hypertension                 (I10)
  3. Mixed hyperlipidemia                             (E78.2)

ALLERGIES
  PENICILLIN -- reaction: rash (documented by patient report)

CURRENT MEDICATIONS (reviewed today)
  - Metformin HCl 500 mg tablet -- 1 tablet PO TWICE daily with meals
  - Lisinopril 10 mg tablet -- 1 tablet PO once daily
  - Simvastatin 20 mg tablet -- 1 tablet PO at bedtime

RECENT LABORATORY RESULTS (collected 02/08/2026)
  Hemoglobin A1c .......... 6.1 %        (ref < 5.7)
  LDL cholesterol ......... 138 mg/dL    (goal < 100)
  Creatinine, serum ....... 0.9 mg/dL    (ref 0.6-1.1)
  eGFR .................... > 60 mL/min/1.73m2

HEALTH MAINTENANCE -- DUE / OVERDUE
  [ DUE ]  Diabetic retinal eye exam (dilated) -- last on file: none
  [ DUE ]  Colorectal cancer screening -- last on file: none
  [OVERDUE] Urine albumin-creatinine ratio (diabetic kidney screen)

  This summary reflects information in your Bay Area Family Medicine chart only.`,
  },
  {
    id: "cardiology",
    label: "Cardiology Consultation Note",
    system: "Pacific Heart Associates",
    date: "2026-04-08",
    text: `PACIFIC HEART ASSOCIATES — CARDIOLOGY CONSULTATION NOTE
Patient Name : Maria E. Gonzales   <-- (surname spelled "Gonzales")
DOB          : 3/14/1968   Sex: F
Record #     : PHA-558210
Date of Svc  : 04/08/2026
Provider     : Rakesh N. Iyer, MD, FACC

MEDICATIONS (per patient interview)
  Glucophage 500 mg PO BID
  Zestril 10 mg PO QD
  Simvastatin 20 mg PO QHS
  + Started today:
      ASA 81 mg PO QD
      Hydrochlorothiazide 25 mg PO QD

ALLERGIES: Not on file / none reported at this visit.

DATA
  BP 142/88   HR 81   BMI 31.6
  In-office A1c (point-of-care): 6.5%
  ECG: normal sinus rhythm.

PLAN
  1. HTN, suboptimal control -> add HCTZ 25 mg daily; continue Zestril.
  2. Primary prevention -> start low-dose aspirin.
  3. T2DM / dyslipidemia -> continue current regimen, defer to PCP.`,
  },
  {
    id: "urgent_care",
    label: "Urgent Care Visit Note",
    system: "QuickCare Urgent Care",
    date: "2026-05-22",
    text: `QuickCare Urgent Care -- Marina Clinic
Encounter #QC-2026-44817
Patient: Maria Gonzalez   DOB: 03-14-1968   Sex: F
Date/Time of Visit: 05/22/2026 10:47   Seen by: J. Pham, NP

HISTORY
  Patient reports she takes "a metformin, a blood pressure pill, and a
  cholesterol pill" but does not recall names or doses. Has a primary doctor
  and a heart doctor elsewhere; records not available at this visit.
  States penicillin allergy (PCN -> rash).

ASSESSMENT
  Acute bronchitis (J20.9), likely bacterial given duration/productive cough.

PLAN / PRESCRIPTIONS
  - Clarithromycin 500 mg -- 1 tab PO every 12 hours (BID) x 7 days
        (macrolide chosen due to reported penicillin allergy)

  *** Patient advised to confirm no medication conflicts with her regular
      pharmacy. Full medication list was NOT available at time of visit. ***

  eRx sent to: CVS Pharmacy #6648, San Francisco`,
  },
  {
    id: "lab",
    label: "Independent Lab Report",
    system: "Meridian Reference Laboratories",
    date: "2026-05-29",
    text: `MERIDIAN REFERENCE LABORATORIES — FINAL REPORT
PATIENT: Gonzalez, Maria   PATIENT ID: MRL-9931247
DOB: 1968-03-14   AGE/SEX: 58/F
COLLECTED: 2026-05-28   ORDERING PROVIDER: Okafor, Susan

 TEST                        RESULT   UNITS         REF RANGE    LOINC
 Hemoglobin A1c (IFCC)       52       mmol/mol      20 - 42      59261-8
   ** Reported in IFCC SI units. NGSP/DCCT equivalent on request. **
 Glucose, fasting            128      mg/dL         70 - 99      1558-6
 LDL-Cholesterol (calc)      152      mg/dL         < 100        13457-7
 Creatinine, serum           1.2      mg/dL         0.60 - 1.10  2160-0  (H)
 eGFR (CKD-EPI 2021)         58       mL/min/1.73   > 60         98979-8 (L)
 Potassium, serum            4.9      mmol/L        3.5 - 5.1    2823-3

 INTERPRETIVE NOTE: Creatinine increased and eGFR decreased relative to prior.
 If eGFR remains 45-59, consider CKD stage G3a evaluation and medication review.`,
  },
  {
    id: "pharmacy",
    label: "CVS Pharmacy — Rx Profile",
    system: "CVS Pharmacy #6648",
    date: "2026-06-01",
    text: `CVS PHARMACY #6648 — PATIENT MEDICATION HISTORY / RX PROFILE
Patient: MARIA E GONZALEZ   DOB: 03/14/1968   Profile ID: CVS-SF-0048812

FILL HISTORY (most recent 6 months)
 DRUG (as dispensed)            NDC            QTY DAYS LAST FILL   PRESCRIBER
 METFORMIN HCL 500MG TAB        00093-7214-01  180  90  05/02/2026  S OKAFOR MD
 LISINOPRIL 10MG TAB            68180-0518-01   90  90  05/02/2026  S OKAFOR MD
 SIMVASTATIN 20MG TAB           00093-7155-98   90  90  05/02/2026  S OKAFOR MD
 HYDROCHLOROTHIAZIDE 25MG TAB   00378-0016-01   30  30  04/10/2026  R IYER MD
 ASPIRIN 81MG EC TAB (OTC)      00904-2013-60   90  90  04/10/2026  R IYER MD
 CLARITHROMYCIN 500MG TAB       00074-2586-13   14   7  05/22/2026  J PHAM NP

NOTES
  * NDC = National Drug Code (pharmacy dispensing identifier).
  * No allergy information is maintained on this dispensing profile.
  * This profile reflects fills at CVS #6648 only.`,
  },
];
