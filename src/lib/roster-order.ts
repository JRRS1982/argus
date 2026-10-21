// One comparator for both roster lists, so engineers and repositories cannot disagree:
// what is ticked floats to the top (a workspace can hold hundreds of untouched entries),
// then alphabetical, case-insensitively, within each group.
export const byIncludedThenName = <T extends { included: boolean; name: string }>(a: T, b: T): number =>
  a.included === b.included
    ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    : (a.included ? -1 : 1);
