/** Greek names of a day's numbered closings («1ο κλείσιμο», …). Pure. */

/** 2 → «2ο κλείσιμο». */
export function closingLabel(no: number): string {
  return `${no}ο κλείσιμο`;
}

/** (2, 3) → «2ο κλείσιμο από 3»; a 1-closing plan has no «από» (callers usually show nothing then). */
export function closingOfLabel(no: number, planned: number): string {
  return planned > 1 ? `${closingLabel(no)} από ${planned}` : closingLabel(no);
}

/** (2, 3) → «2 από 3 κλεισίματα». */
export function closingsDoneLabel(done: number, planned: number): string {
  return `${done} από ${planned} κλεισίματα`;
}

/** 1 → «Λείπει 1 κλείσιμο», 2 → «Λείπουν 2 κλεισίματα». */
export function missingClosingsLabel(missing: number): string {
  return missing === 1 ? 'Λείπει 1 κλείσιμο' : `Λείπουν ${missing} κλεισίματα`;
}
