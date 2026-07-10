/**
 * Chart palette resolved from CSS variables so it tracks dark/light theme.
 * Recharts wants strings up-front, so each helper reads the live var value.
 */
export const CHART_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
] as const;

export function chartColor(i: number): string {
  return `hsl(var(${CHART_VARS[i % CHART_VARS.length]}))`;
}
