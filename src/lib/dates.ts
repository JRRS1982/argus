import type { MonthColumn } from "@/types";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const formatMonthLabel = (year: number, month: number): string =>
  `${MONTH_NAMES[month - 1]} ${year}`;

export const formatMonthKey = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, "0")}`;

export const buildMonthColumn = (year: number, month: number): MonthColumn => ({
  year,
  month,
  label: formatMonthLabel(year, month),
  key: formatMonthKey(year, month),
});

export const subtractMonths = (year: number, month: number, count: number): { year: number; month: number } => {
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - count);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
};

// Returns an array of MonthColumns going back `count` months from today (inclusive of current month)
export const getLastNMonthColumns = (count: number): MonthColumn[] => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const columns: MonthColumn[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const { year, month } = subtractMonths(currentYear, currentMonth, i);
    columns.push(buildMonthColumn(year, month));
  }
  return columns;
};

// Returns ISO 8601 date strings for start of a given month and start of next month
export const getMonthRange = (year: number, month: number): { since: string; until: string } => {
  const since = new Date(year, month - 1, 1).toISOString();
  const until = new Date(year, month, 1).toISOString();
  return { since, until };
};
