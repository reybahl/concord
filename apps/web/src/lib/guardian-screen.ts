/** Client-safe heuristics — no server/LLM deps. */

export function mightContainClinicalAction(utterance: string): boolean {
  const u = utterance.toLowerCase();
  if (/\b\d+\s*(mg|mcg|g|ml|units?)\b/.test(u)) return true;
  if (/\b(bid|tid|qid|q\d+h|daily|twice daily|three times a day)\b/.test(u)) return true;
  if (/\b(x-?ray|ct scan|mri|iv contrast|contrast|bmp|cbc|a1c|creatinine|sputum)\b/.test(u)) return true;
  if (
    /\b(amoxicillin|azithromycin|clarithromycin|simvastatin|metformin|lisinopril|penicillin|statin|macrolide|beta-lactam)\b/.test(
      u,
    )
  )
    return true;
  if (/\b(prescrib|prescription|start you on|put you on|switch to|switching to|order a|order an)\b/.test(u))
    return true;
  if (/\b(stop|discontinue|hold)\b[\s\S]{0,40}\b(mg|mcg|clarithromycin|azithromycin|amoxicillin|simvastatin)\b/.test(u))
    return true;
  if (/\b(stop|discontinue|hold)\b/.test(u) && /\b(medication|meds|antibiotic|statin|clarithromycin|azithromycin)\b/.test(u))
    return true;
  return false;
}
