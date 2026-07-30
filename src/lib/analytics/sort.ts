// One definition of engineer ordering, shared by every tab so they cannot disagree.
// Case-insensitive, so "adam" and "Adam" sort together rather than by byte value.
export const byDisplayName = (
  a: { displayName: string },
  b: { displayName: string },
): number => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
