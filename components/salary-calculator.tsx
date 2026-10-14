"use client";

import { useMemo, useState } from "react";
import {
  PF_WAGE_CEILING,
  calculate,
  rupees,
  shortInr,
  slabLabel,
  slabRows,
  type Regime,
} from "@/lib/tax";

const MIN = 300_000;
const MAX = 10_000_000;
const STEP = 25_000;
const PRESETS = [600_000, 1_200_000, 2_500_000, 5_000_000];

function Segmented<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-[0.16em] text-ink-soft">
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className="mt-1.5 flex gap-1 rounded-sm border border-rule bg-shade/50 p-1"
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={`min-h-9 flex-1 cursor-pointer rounded-sm px-2 text-xs transition-colors duration-200 ${
                on
                  ? "bg-burgundy text-card"
                  : "text-ink-soft hover:bg-card hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  note,
  tone = "ink",
  strong,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "ink" | "soft" | "burgundy" | "olive";
  strong?: boolean;
}) {
  const color = {
    ink: "text-ink",
    soft: "text-ink-soft",
    burgundy: "text-burgundy",
    olive: "text-olive",
  }[tone];

  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <span className={`shrink-0 text-[13px] ${strong ? "text-ink" : color}`}>
        {label}
        {note ? (
          <span className="ml-1 text-[10px] text-ink-soft">{note}</span>
        ) : null}
      </span>
      <span className="leader" aria-hidden="true" />
      <span
        className={`shrink-0 text-[13px] ${color} ${strong ? "font-bold" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

export default function SalaryCalculator() {
  const [gross, setGross] = useState(1_200_000);
  const [regime, setRegime] = useState<Regime>("new");
  const [basicPct, setBasicPct] = useState(0.5);
  const [pfOnCeiling, setPfOnCeiling] = useState(true);
  const [period, setPeriod] = useState<"month" | "year">("month");

  const breakdown = useMemo(
    () => calculate({ annualGross: gross, regime, basicPct, pfOnCeiling }),
    [gross, regime, basicPct, pfOnCeiling],
  );

  const slabs = useMemo(
    () => slabRows(breakdown.taxableIncome, regime),
    [breakdown.taxableIncome, regime],
  );

  const per = (n: number) => rupees(period === "month" ? n / 12 : n);
  const fill = ((gross - MIN) / (MAX - MIN)) * 100;

  return (
    <main className="mx-auto w-full max-w-[30rem] px-4 pt-7 pb-12">
      {/* ── Masthead ───────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[19px] leading-tight font-bold tracking-[0.04em] uppercase">
            In-Hand
            <br />
            Salary Ledger
          </h1>
          <p className="mt-1.5 text-[11px] tracking-[0.12em] text-ink-soft uppercase">
            India · Annual &amp; Monthly
          </p>
        </div>
        <span className="-rotate-3 rounded-sm border-2 border-double border-burgundy px-2 py-1 text-center text-[10px] leading-tight tracking-[0.1em] text-burgundy uppercase">
          F.Y.
          <br />
          2026-27
        </span>
      </header>

      <div className="mt-4 border-t-2 border-double border-rule" />

      {/* ── Dial ───────────────────────────────────────────────── */}
      <section className="mt-5 rounded-sm border border-rule bg-card p-4 shadow-[3px_3px_0_0_rgba(46,28,16,0.07)]">
        <label
          htmlFor="gross"
          className="block text-[11px] tracking-[0.16em] text-ink-soft uppercase"
        >
          Annual gross (CTC)
        </label>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl text-burgundy">₹</span>
          <input
            id="gross"
            type="text"
            inputMode="numeric"
            value={Math.round(gross).toLocaleString("en-IN")}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^0-9]/g, ""));
              if (!Number.isNaN(n)) setGross(Math.min(n, 100_000_000));
            }}
            onBlur={() => setGross(Math.max(MIN, gross))}
            className="min-w-0 flex-1 border-b border-dotted border-rule bg-transparent pb-0.5 text-2xl font-bold tracking-tight text-ink outline-none focus-visible:border-solid focus-visible:border-burgundy"
            aria-describedby="gross-short"
          />
          <span id="gross-short" className="text-xs text-ink-soft">
            {shortInr(gross)}
          </span>
        </div>

        <input
          className="dial mt-2"
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={Math.min(Math.max(gross, MIN), MAX)}
          onChange={(e) => setGross(Number(e.target.value))}
          style={{ ["--fill" as string]: `${fill}%` }}
          aria-label="Annual gross salary"
          aria-valuetext={rupees(gross)}
        />

        <div className="flex justify-between text-[10px] tracking-wider text-ink-soft">
          <span>3 L</span>
          <span>1 Cr</span>
        </div>

        <div className="mt-3 flex gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setGross(p)}
              className={`min-h-9 flex-1 cursor-pointer rounded-sm border px-1 text-[11px] transition-colors duration-200 ${
                gross === p
                  ? "border-burgundy bg-burgundy/10 text-burgundy"
                  : "border-rule text-ink-soft hover:border-gold hover:text-ink"
              }`}
            >
              {shortInr(p)}
            </button>
          ))}
        </div>
      </section>

      {/* ── Result ─────────────────────────────────────────────── */}
      <section className="mt-4 flex flex-wrap gap-3">
        <div className="min-w-[12rem] flex-[3] rounded-sm border-2 border-burgundy bg-card p-4">
          <p className="text-[10px] tracking-[0.16em] text-ink-soft uppercase">
            Monthly in-hand
          </p>
          <p className="mt-1 text-[clamp(1.5rem,7vw,2rem)] leading-none font-bold text-burgundy">
            {rupees(breakdown.netMonthly)}
          </p>
        </div>
        <div className="min-w-[8.5rem] flex-[2] rounded-sm border border-rule bg-card p-4">
          <p className="text-[10px] tracking-[0.16em] text-ink-soft uppercase">
            Yearly
          </p>
          <p className="mt-1 text-[15px] leading-tight font-bold text-olive">
            {rupees(breakdown.netAnnual)}
          </p>
          <p className="mt-1.5 text-[10px] text-ink-soft">
            Tax rate {(breakdown.effectiveTaxRate * 100).toFixed(1)}%
          </p>
        </div>
      </section>

      {/* ── Assumptions ────────────────────────────────────────── */}
      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <Segmented
          label="Tax regime"
          value={regime}
          onChange={setRegime}
          options={[
            { value: "new" as Regime, label: "New" },
            { value: "old" as Regime, label: "Old" },
          ]}
        />
        <Segmented
          label="Basic pay"
          value={basicPct}
          onChange={setBasicPct}
          options={[
            { value: 0.4, label: "40%" },
            { value: 0.5, label: "50%" },
          ]}
        />
        <Segmented
          label="PF on"
          value={pfOnCeiling}
          onChange={setPfOnCeiling}
          options={[
            { value: true, label: "₹15k cap" },
            { value: false, label: "Full basic" },
          ]}
        />
      </section>

      {/* ── Ledger ─────────────────────────────────────────────── */}
      <section className="mt-5 rounded-sm border border-rule bg-card p-4 shadow-[3px_3px_0_0_rgba(46,28,16,0.07)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] tracking-[0.16em] text-ink-soft uppercase">
            Breakdown
          </h2>
          <div className="flex gap-1 rounded-sm border border-rule p-0.5">
            {(["month", "year"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={`min-h-8 cursor-pointer rounded-sm px-2.5 text-[11px] uppercase transition-colors duration-200 ${
                  period === p
                    ? "bg-ink text-card"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {p === "month" ? "Monthly" : "Annual"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 divide-y divide-dashed divide-rule/60">
          <div>
            <Row
              label="Gross salary"
              value={per(breakdown.annualGross)}
              strong
            />
            <Row
              label="Basic pay"
              note={`${basicPct * 100}%`}
              value={per(breakdown.basic)}
              tone="soft"
            />
            <Row
              label="Employer PF"
              note="not in hand"
              value={`− ${per(breakdown.employerPf)}`}
              tone="soft"
            />
            <Row
              label="Gross on payslip"
              value={per(breakdown.grossPayable)}
              strong
            />
          </div>

          <div className="pt-1">
            <p className="py-1 text-[10px] tracking-[0.16em] text-gold uppercase">
              Deductions
            </p>
            <Row
              label="Employee PF"
              note="12%"
              value={`− ${per(breakdown.employeePf)}`}
              tone="burgundy"
            />
            <Row
              label="Professional tax"
              value={`− ${per(breakdown.professionalTax)}`}
              tone="burgundy"
            />
            <Row
              label="Income tax (TDS)"
              value={`− ${per(breakdown.incomeTax)}`}
              tone="burgundy"
            />
            <Row
              label="Total deductions"
              value={`− ${per(breakdown.totalDeductions)}`}
              tone="burgundy"
              strong
            />
          </div>

          <div className="pt-1">
            <Row
              label={period === "month" ? "In hand / month" : "In hand / year"}
              value={per(breakdown.netAnnual)}
              tone="olive"
              strong
            />
          </div>
        </div>
      </section>

      {/* ── Slab table ─────────────────────────────────────────── */}
      <section className="mt-4 rounded-sm border border-rule bg-card p-4 shadow-[3px_3px_0_0_rgba(46,28,16,0.07)]">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[11px] tracking-[0.16em] text-ink-soft uppercase">
            Slab working
          </h2>
          <span className="text-[10px] tracking-[0.1em] text-gold uppercase">
            {regime === "new" ? "New" : "Old"} regime
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
          Taxable income{" "}
          <b className="text-ink">{rupees(breakdown.taxableIncome)}</b> is cut
          at each slab. Only the slice inside a slab pays that slab&apos;s
          rate.
        </p>

        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <caption className="sr-only">
              Income tax slabs for FY 2026-27 and the tax computed in each
            </caption>
            <thead>
              <tr className="border-b border-rule text-[10px] tracking-[0.1em] text-ink-soft uppercase">
                <th scope="col" className="py-1.5 pr-1 text-left font-normal">
                  Slab
                </th>
                <th scope="col" className="py-1.5 pl-2 text-right font-normal">
                  Rate
                </th>
                <th scope="col" className="py-1.5 pl-2 text-right font-normal">
                  Taxed
                </th>
                <th scope="col" className="py-1.5 pl-2 text-right font-normal">
                  Tax
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dashed divide-rule/60">
              {slabs.map((r) => {
                const live = r.taxed > 0;
                return (
                  <tr key={r.from} className={live ? "" : "text-ink-soft/50"}>
                    <td className="py-1.5 pr-1 align-top">
                      <span className={live ? "text-ink" : ""}>
                        {slabLabel(r.from, r.to)}
                      </span>
                      {live && (
                        <span
                          aria-hidden="true"
                          className="mt-1 block h-[3px] w-full max-w-[4rem] rounded-full bg-shade"
                        >
                          <span
                            className="block h-full rounded-full bg-gold"
                            style={{ width: `${Math.round(r.share * 100)}%` }}
                          />
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pl-2 text-right align-top">
                      {r.rate ? `${Math.round(r.rate * 100)}%` : "Nil"}
                    </td>
                    <td className="py-1.5 pl-2 text-right align-top">
                      {live ? rupees(r.taxed) : "–"}
                    </td>
                    <td
                      className={`py-1.5 pl-2 text-right align-top ${
                        r.tax > 0 ? "font-bold text-ink" : ""
                      }`}
                    >
                      {live ? rupees(r.tax) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-double border-rule">
                <th
                  scope="row"
                  colSpan={3}
                  className="py-2 text-left text-[12px] font-bold"
                >
                  Tax on slabs
                </th>
                <td className="py-2 pl-2 text-right text-[12px] font-bold text-burgundy">
                  {rupees(breakdown.slabTax)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {breakdown.rebate > 0 && (
          <p className="mt-2 border-t border-dotted border-rule pt-2 text-[10px] leading-relaxed text-olive">
            {breakdown.taxableIncome <= (regime === "new" ? 1_200_000 : 500_000)
              ? `Section 87A rebate wipes out ${rupees(breakdown.rebate)} of this, so tax payable is ${rupees(breakdown.incomeTax)}.`
              : `Marginal relief caps the tax at the income above ${regime === "new" ? "₹12 L" : "₹5 L"}, relieving ${rupees(breakdown.rebate)}.`}
          </p>
        )}
      </section>

      {/* ── Tax working ────────────────────────────────────────── */}
      <section className="mt-4 rounded-sm border border-rule bg-shade/40 p-4">
        <h2 className="text-[11px] tracking-[0.16em] text-ink-soft uppercase">
          Tax working · annual
        </h2>
        <div className="mt-2">
          <Row
            label="Gross on payslip"
            value={rupees(breakdown.grossPayable)}
            tone="soft"
          />
          <Row
            label="Standard deduction"
            value={`− ${rupees(breakdown.standardDeduction)}`}
            tone="soft"
          />
          {breakdown.otherDeductions > 0 && (
            <Row
              label="80C + prof. tax"
              value={`− ${rupees(breakdown.otherDeductions)}`}
              tone="soft"
            />
          )}
          <Row
            label="Taxable income"
            value={rupees(breakdown.taxableIncome)}
            strong
          />
          <Row
            label="Tax on slabs"
            value={rupees(breakdown.slabTax)}
            tone="soft"
          />
          {breakdown.rebate > 0 && (
            <Row
              label="Rebate 87A"
              value={`− ${rupees(breakdown.rebate)}`}
              tone="olive"
            />
          )}
          {breakdown.surcharge > 0 && (
            <Row
              label="Surcharge"
              value={`+ ${rupees(breakdown.surcharge)}`}
              tone="soft"
            />
          )}
          {breakdown.surchargeRelief > 0 && (
            <Row
              label="Surcharge relief"
              value={`− ${rupees(breakdown.surchargeRelief)}`}
              tone="olive"
            />
          )}
          <Row
            label="Health & edu. cess 4%"
            value={`+ ${rupees(breakdown.cess)}`}
            tone="soft"
          />
          <Row
            label="Total tax payable"
            value={rupees(breakdown.incomeTax)}
            tone="burgundy"
            strong
          />
        </div>
      </section>

      <footer className="mt-6 border-t border-dotted border-rule pt-3 text-[10px] leading-relaxed text-ink-soft">
        <p>
          FY 2026-27 (AY 2027-28) slabs. Basic pay assumed at{" "}
          {basicPct * 100}% of CTC; PF at 12% of{" "}
          {pfOnCeiling
            ? `basic capped at ${rupees(PF_WAGE_CEILING)}/yr`
            : "full basic"}
          ; professional tax at ₹200/month. Gratuity, HRA exemption, NPS and
          other 80C/80D claims are not included. This is an estimate, so
          confirm it with your payroll team.
        </p>
      </footer>
    </main>
  );
}
