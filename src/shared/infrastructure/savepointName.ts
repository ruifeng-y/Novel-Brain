let sequence = 0;

export function nextSavepointName(prefix: string): string {
  return `${prefix}_${++sequence}`;
}
