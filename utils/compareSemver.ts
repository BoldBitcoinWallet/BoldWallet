/**
 * Compare two semver-like strings (optional leading "v"). Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const norm = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('.')
      .map(part => parseInt(part, 10) || 0);
  const [a1, a2, a3] = norm(a);
  const [b1, b2, b3] = norm(b);
  if (a1 !== b1) {
    return a1 - b1;
  }
  if (a2 !== b2) {
    return a2 - b2;
  }
  return a3 - b3;
}
