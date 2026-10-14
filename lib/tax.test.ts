import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculate,
  slabRows,
  slabLabel,
  rupees,
  shortInr,
  PROFESSIONAL_TAX,
  type Regime,
} from "./tax.ts";

const base = { basicPct: 0.5, pfOnCeiling: true } as const;
const run = (annualGross: number, regime: Regime = "new") =>
  calculate({ ...base, annualGross, regime });

// Employer PF at the ceiling is a flat ₹21,600/yr, so taxable income is
// gross − 21,600 − standard deduction.
const EMPLOYER_PF_AT_CEILING = 21_600;

describe("slab rates", () => {
  test("new regime slabs charge the published rates", () => {
    const rows = slabRows(2_400_000, "new");
    assert.deepEqual(
      rows.map((r) => r.rate),
      [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3],
    );
    // 20k + 40k + 60k + 80k + 100k across the six charged slabs
    assert.equal(
      rows.reduce((s, r) => s + r.tax, 0),
      300_000,
    );
  });

  test("old regime slabs charge the published rates", () => {
    const rows = slabRows(1_000_000, "old");
    assert.deepEqual(
      rows.map((r) => r.rate),
      [0, 0.05, 0.2, 0.3],
    );
    assert.equal(
      rows.reduce((s, r) => s + r.tax, 0),
      112_500, // 12,500 + 1,00,000
    );
  });

  test("only the slice inside a slab is taxed at that rate", () => {
    const rows = slabRows(1_703_400, "new");
    assert.equal(rows[4].taxed, 103_400); // 16-20L slab holds the remainder
    assert.equal(rows[4].tax, 20_680);
    assert.equal(rows[5].taxed, 0); // 20-24L untouched
    assert.equal(rows[6].taxed, 0);
  });

  test("an income of zero fills no slab", () => {
    assert.equal(
      slabRows(0, "new").every((r) => r.taxed === 0 && r.tax === 0),
      true,
    );
  });
});

describe("87A rebate and marginal relief", () => {
  test("salary up to ₹12.75L pays no tax in the new regime", () => {
    assert.equal(run(1_275_000).incomeTax, 0);
  });

  test("the exact break-even gross still pays nothing", () => {
    const breakEven = 1_200_000 + 75_000 + EMPLOYER_PF_AT_CEILING;
    assert.equal(run(breakEven).taxableIncome, 1_200_000);
    assert.equal(run(breakEven).incomeTax, 0);
  });

  test("just past it, marginal relief caps tax at the excess income", () => {
    const b = run(1_200_000 + 75_000 + EMPLOYER_PF_AT_CEILING + 10_000);
    assert.equal(b.taxableIncome, 1_210_000);
    assert.equal(b.slabTax, 61_500); // what the slabs alone would charge
    assert.equal(b.incomeTax, 10_400); // ₹10,000 excess + 4% cess
  });

  test("relief runs out once slab tax falls below the excess", () => {
    assert.equal(run(2_000_000).rebate, 0);
  });

  test("old regime rebate applies only up to ₹5L taxable", () => {
    assert.equal(run(595_600, "old").taxableIncome, 500_000);
    assert.equal(run(595_600, "old").incomeTax, 0);
    assert.ok(run(600_000, "old").incomeTax > 0);
  });
});

describe("surcharge and cess", () => {
  test("no surcharge at or below ₹50L taxable", () => {
    assert.equal(run(5_000_000).surcharge, 0);
  });

  test("10% surcharge above ₹50L taxable", () => {
    const b = run(6_000_000);
    assert.ok(b.taxableIncome > 5_000_000);
    assert.equal(b.surcharge, (b.slabTax - b.rebate) * 0.1);
  });

  test("cess is 4% of tax plus surcharge", () => {
    const b = run(6_000_000);
    assert.equal(b.cess, (b.slabTax - b.rebate + b.surcharge) * 0.04);
    assert.equal(b.incomeTax, b.slabTax - b.rebate + b.surcharge + b.cess);
  });
});

describe("provident fund", () => {
  test("ceiling caps employee PF at 12% of ₹1.8L", () => {
    const b = run(5_000_000);
    assert.equal(b.employeePf, EMPLOYER_PF_AT_CEILING);
    assert.equal(b.employerPf, EMPLOYER_PF_AT_CEILING);
  });

  test("full basic charges 12% of actual basic", () => {
    const b = calculate({
      annualGross: 5_000_000,
      regime: "new",
      basicPct: 0.5,
      pfOnCeiling: false,
    });
    assert.equal(b.employeePf, 5_000_000 * 0.5 * 0.12);
  });

  test("a lower basic reduces PF", () => {
    const forty = calculate({ ...base, annualGross: 1_000_000, regime: "new", basicPct: 0.4, pfOnCeiling: false });
    const fifty = calculate({ ...base, annualGross: 1_000_000, regime: "new", basicPct: 0.5, pfOnCeiling: false });
    assert.ok(forty.employeePf < fifty.employeePf);
  });
});

describe("payslip arithmetic", () => {
  test("employer PF is carved out of CTC, not paid in hand", () => {
    const b = run(2_000_000);
    assert.equal(b.grossPayable, b.annualGross - b.employerPf);
  });

  test("deductions reconcile to in-hand", () => {
    for (const g of [400_000, 1_200_000, 2_500_000, 7_500_000]) {
      for (const r of ["new", "old"] as Regime[]) {
        const b = run(g, r);
        assert.equal(
          b.totalDeductions,
          b.employeePf + PROFESSIONAL_TAX + b.incomeTax,
        );
        assert.equal(b.netAnnual, b.grossPayable - b.totalDeductions);
        assert.equal(b.netMonthly, b.netAnnual / 12);
      }
    }
  });

  test("slab rows always sum to the slab tax", () => {
    for (let g = 300_000; g <= 10_000_000; g += 50_000) {
      for (const r of ["new", "old"] as Regime[]) {
        const b = run(g, r);
        const summed = slabRows(b.taxableIncome, r).reduce(
          (s, row) => s + row.tax,
          0,
        );
        assert.ok(
          Math.abs(summed - b.slabTax) < 1e-6,
          `slab rows ${summed} != slabTax ${b.slabTax} at ${g} (${r})`,
        );
      }
    }
  });

  test("a raise never shrinks take-home, outside the rebate cliffs", () => {
    const cliff: Record<Regime, number> = { new: 1_200_000, old: 500_000 };
    for (const r of ["new", "old"] as Regime[]) {
      let prev: ReturnType<typeof run> | null = null;
      for (let g = 300_000; g <= 10_000_000; g += 10_000) {
        const b = run(g, r);
        if (prev) {
          const crossesCliff =
            prev.taxableIncome <= cliff[r] && b.taxableIncome > cliff[r];
          const inReliefBand =
            (r === "new" && b.rebate > 0 && b.taxableIncome > cliff[r]) ||
            b.surchargeRelief > 0;
          if (!crossesCliff && !inReliefBand) {
            assert.ok(
              b.netAnnual >= prev.netAnnual,
              `take-home dropped at ₹${g} (${r} regime)`,
            );
          }
        }
        prev = b;
      }
    }
  });

  // Both cliffs below are the law, not rounding slips. They are pinned here so
  // a future refactor cannot quietly "smooth" them away.

  test("inside the relief band, cess makes the marginal rate 104%", () => {
    // Relief caps tax at the income above ₹12L, then 4% cess lands on top, so
    // ₹10,000 of extra income costs ₹10,400 and take-home dips ₹400.
    const at12L = run(1_296_600);
    const past = run(1_306_600);
    assert.equal(at12L.incomeTax, 0);
    assert.equal(past.incomeTax, 10_400);
    assert.equal(
      Math.round(past.netAnnual - at12L.netAnnual),
      10_000 - 10_400,
    );
  });

  test("surcharge relief stops the ₹50L cliff from costing a lakh", () => {
    const at50L = run(5_096_600); // taxable exactly ₹50,00,000
    const past = run(5_106_600); // taxable ₹50,10,000
    assert.equal(at50L.taxableIncome, 5_000_000);
    assert.equal(at50L.surcharge, 0);

    // Unrelieved, 10% would land on the whole tax: over ₹1.08L at a stroke.
    assert.ok(past.surchargeRelief > 100_000);
    // Relieved, tax + surcharge is capped at the tax on ₹50L plus the excess.
    assert.equal(
      Math.round(past.slabTax + past.surcharge),
      Math.round(at50L.slabTax + 10_000),
    );
    // Only the 4% cess on the extra ₹10,000 separates the two.
    assert.ok(at50L.netAnnual - past.netAnnual < 500);
  });

  test("surcharge applies in full once past the relief band", () => {
    const b = run(6_000_000);
    assert.equal(b.surchargeRelief, 0);
    assert.equal(b.surcharge, (b.slabTax - b.rebate) * 0.1);
  });

  test("the old regime has a hard ₹5L cliff with no marginal relief", () => {
    const at5L = run(595_600, "old");
    const past = run(605_600, "old");
    assert.equal(at5L.taxableIncome, 500_000);
    assert.equal(at5L.incomeTax, 0);
    assert.ok(past.incomeTax > 10_000);
    assert.ok(past.netAnnual < at5L.netAnnual);
  });

  test("taxable income never goes negative on a small salary", () => {
    assert.equal(run(50_000).taxableIncome, 0);
    assert.equal(run(50_000).incomeTax, 0);
  });
});

describe("formatting", () => {
  test("rupees uses the Indian grouping", () => {
    assert.equal(rupees(1_200_000), "₹12,00,000");
    assert.equal(rupees(0), "₹0");
  });

  test("shortInr switches to crore above 1Cr", () => {
    assert.equal(shortInr(1_200_000), "12 L");
    assert.equal(shortInr(1_250_000), "12.5 L");
    assert.equal(shortInr(10_000_000), "1 Cr");
  });

  test("slabLabel drops the repeated unit", () => {
    assert.equal(slabLabel(0, 400_000), "0 – 4 L");
    assert.equal(slabLabel(400_000, 800_000), "4 – 8 L");
    assert.equal(slabLabel(2_400_000, Infinity), "24 L +");
    assert.equal(slabLabel(250_000, 500_000), "2.5 – 5 L");
  });
});
