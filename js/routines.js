// routines.js — the "Now" screen logic. Plain time rules, no machine learning.
//
// A rule looks like: { name, from: '06:00', to: '09:00', days: [1..5], cat }
// The first rule whose day and time window match "now" wins. If none match,
// the fallback board is used.

const toMinutes = hhmm => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** True if `date` falls inside the rule. Handles windows that cross midnight
 *  (e.g. 21:00 -> 06:00). */
export function ruleMatches(rule, date = new Date()) {
  const day = date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();
  const from = toMinutes(rule.from), to = toMinutes(rule.to);
  if (from <= to) {
    return (rule.days || []).includes(day) && mins >= from && mins < to;
  }
  // Overnight window: the part after midnight belongs to the previous day.
  if (mins >= from) return (rule.days || []).includes(day);
  if (mins < to) return (rule.days || []).includes((day + 6) % 7);
  return false;
}

/** Return {rule, cat} for the current moment. */
export function currentRoutine(routines, date = new Date()) {
  const rule = (routines.rules || []).find(r => ruleMatches(r, date)) || null;
  return { rule, cat: rule ? rule.cat : routines.fallback };
}
