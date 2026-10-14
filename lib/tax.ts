/**
 * Indian salary / income-tax math for FY 2026-27 (AY 2027-28).
 * Budget 2026 left the slabs, standard deduction and 87A rebate unchanged,
 * so the FY 2025-26 structure carries forward.
 * All amounts are annual rupees unless noted.
 */

export type Regime = "new" | "old";

const NEW_SLABS: [number, number][] = [
  [400_000, 0],
  [800_000, 0.05],
  [1_200_000, 0.1],
  [1_600_000, 0.15],
  [2_000_000, 0.2],
  [2_400_000, 0.25],
  [Infinity, 0.3],
];

const OLD_SLABS: [number, number][] = [
  [250_000, 0],
  [500_000, 0.05],
  [1_000_000, 0.2],
  [Infinity, 0.3],
];

const SURCHARGE_NEW: [number, number][] = [
  [20_000_000, 0.25],
  [10_000_000, 0.15],
  [5_000_000, 0.1],
];

const SURCHARGE_OLD: [number, number][] = [
  [50_000_000, 0.37],
  [20_000_000, 0.25],
  [10_000_000, 0.15],
  [5_000_000, 0.1],
];

export const PROFESSIONAL_TAX = 2_400; // ₹200/month, typical state levy
export const PF_WAGE_CEILING = 180_000; // ₹15,000/month statutory ceiling
const CESS = 0.04;

function slabTax(income: number, slabs: [number, number][]) {
  let tax = 0;
  let last = 0;
  for (const [upto, rate] of slabs) {
    if (income <= last) break;
    tax += (Math.min(income, upto) - last) * rate;
    last = upto;
  }
  return tax;
}

/**
 * Surcharge, with the marginal relief the law grants at each threshold:
 * tax + surcharge may not exceed the tax at the threshold plus the income
 * earned above it. Without it, crossing ₹50L by ₹1 would cost over a lakh.
 */
function surcharge(tax: number, income: number, regime: Regime) {
  const bands = regime === "new" ? SURCHARGE_NEW : SURCHARGE_OLD;
  const slabs = regime === "new" ? NEW_SLABS : OLD_SLABS;

  for (let i = 0; i < bands.length; i++) {
    const [threshold, rate] = bands[i];
    if (income <= threshold) continue;

    // The rate that applied just below this threshold (bands run high to low).
    const rateBelow = i + 1 < bands.length ? bands[i + 1][1] : 0;
    const taxAtThreshold = slabTax(threshold, slabs) * (1 + rateBelow);
    const ceiling = taxAtThreshold + (income - threshold);

    const full = tax * rate;
    return { charged: Math.max(0, Math.min(full, ceiling - tax)), full };
  }
  return { charged: 0, full: 0 };
}

export interface Inputs {
  annualGross: number;
  regime: Regime;
  basicPct: number; // basic pay as a share of gross
  pfOnCeiling: boolean; // PF on ₹15k wage ceiling vs. full basic
}

export interface Breakdown {
  annualGross: number;
  basic: number;
  employerPf: number;
  grossPayable: number;
  employeePf: number;
  professionalTax: number;
  standardDeduction: number;
  otherDeductions: number;
  taxableIncome: number;
  slabTax: number;
  rebate: number;
  surcharge: number;
  surchargeRelief: number;
  cess: number;
  incomeTax: number;
  totalDeductions: number;
  netAnnual: number;
  netMonthly: number;
  effectiveTaxRate: number;
}

export function calculate({
  annualGross,
  regime,
  basicPct,
  pfOnCeiling,
}: Inputs): Breakdown {
  const basic = annualGross * basicPct;
  const pfWage = pfOnCeiling ? Math.min(basic, PF_WAGE_CEILING) : basic;
  const employeePf = pfWage * 0.12;
  const employerPf = pfWage * 0.12; // part of CTC, never paid in hand

  // What actually hits the payslip before deductions.
  const grossPayable = annualGross - employerPf;

  const standardDeduction = regime === "new" ? 75_000 : 50_000;
  // Old regime: employee PF counts under 80C, professional tax under 16(iii).
  const otherDeductions =
    regime === "old"
      ? Math.min(employeePf, 150_000) + PROFESSIONAL_TAX
      : 0;

  const taxableIncome = Math.max(
    0,
    grossPayable - standardDeduction - otherDeductions,
  );

  const base = slabTax(taxableIncome, regime === "new" ? NEW_SLABS : OLD_SLABS);

  // Section 87A rebate + marginal relief just past the rebate ceiling.
  let rebate = 0;
  if (regime === "new") {
    if (taxableIncome <= 1_200_000) rebate = Math.min(base, 60_000);
    else rebate = Math.max(0, base - (taxableIncome - 1_200_000));
  } else if (taxableIncome <= 500_000) {
    rebate = Math.min(base, 12_500);
  }

  const afterRebate = base - rebate;
  const sur = surcharge(afterRebate, taxableIncome, regime);
  const cess = (afterRebate + sur.charged) * CESS;
  const incomeTax = afterRebate + sur.charged + cess;

  const totalDeductions = employeePf + PROFESSIONAL_TAX + incomeTax;
  const netAnnual = grossPayable - totalDeductions;

  return {
    annualGross,
    basic,
    employerPf,
    grossPayable,
    employeePf,
    professionalTax: PROFESSIONAL_TAX,
    standardDeduction,
    otherDeductions,
    taxableIncome,
    slabTax: base,
    rebate,
    surcharge: sur.charged,
    surchargeRelief: sur.full - sur.charged,
    cess,
    incomeTax,
    totalDeductions,
    netAnnual,
    netMonthly: netAnnual / 12,
    effectiveTaxRate: annualGross > 0 ? incomeTax / annualGross : 0,
  };
}

export interface SlabRow {
  from: number;
  to: number; // Infinity on the top slab
  rate: number;
  taxed: number; // portion of taxable income falling in this slab
  tax: number;
  share: number; // 0-1, how full the slab is (for the meter)
}

/** Slices taxable income across the slabs so the working can be shown. */
export function slabRows(taxableIncome: number, regime: Regime): SlabRow[] {
  const slabs = regime === "new" ? NEW_SLABS : OLD_SLABS;
  const rows: SlabRow[] = [];
  let last = 0;
  for (const [upto, rate] of slabs) {
    const taxed = Math.max(0, Math.min(taxableIncome, upto) - last);
    const width = upto - last;
    rows.push({
      from: last,
      to: upto,
      rate,
      taxed,
      tax: taxed * rate,
      share: Number.isFinite(width) ? taxed / width : taxed > 0 ? 1 : 0,
    });
    last = upto;
  }
  return rows;
}

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const rupees = (n: number) => `₹${inr.format(Math.round(n))}`;

/** ₹12,50,000 → "12.5 L"; ₹1,20,00,000 → "1.2 Cr" */
export function shortInr(n: number) {
  if (n >= 10_000_000) return `${+(n / 10_000_000).toFixed(2)} Cr`;
  return `${+(n / 100_000).toFixed(n % 100_000 === 0 ? 0 : 1)} L`;
}

/** "0 – 4 L", "12 – 16 L", "24 L +" */
export function slabLabel(from: number, to: number) {
  if (!Number.isFinite(to)) return `${shortInr(from)} +`;
  const hi = shortInr(to);
  const unit = hi.slice(hi.indexOf(" ")); // " L" or " Cr"
  const lo = from === 0 ? "0" : shortInr(from);
  return `${lo.endsWith(unit) ? lo.slice(0, -unit.length) : lo} – ${hi}`;
}
