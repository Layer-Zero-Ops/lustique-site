// worker/src/booking/dashboard-style.ts
// Central design system for the Lustique admin surface.
// Single source of truth: brand rose #C02C4E on warm neutral #f7f3ef.
// Every view imports DASHBOARD_STYLE and uses semantic classes — NO inline style= strings.
//
// Layout: fixed sidebar (230px) + sticky topbar + scrollable main.
// Responsive: <920px the sidebar collapses to a top bar; the list becomes a stacked card view.

export const BRAND = {
  rose: "#C02C4E",
  roseSoft: "#fbeaee",
  roseDeep: "#9b223f",
  neutral: "#f7f3ef",
  ink: "#2b2b2b",
  muted: "#8a7d72",
  line: "#ede7e0",
  lineSoft: "#f3ede8",
  white: "#ffffff",
  // status hues
  amber: "#b7791f",
  amberBg: "#fef9e7",
  blue: "#2b6cb0",
  blueBg: "#ebf8ff",
  violet: "#553c9a",
  violetBg: "#e9d8fd",
  green: "#276749",
  greenBg: "#f0fff4",
  greenDeep: "#22543d",
  greenBg2: "#c6f6d5",
  red: "#c53030",
  redBg: "#fff5f5",
  slate: "#718096",
  slateBg: "#f7fafc",
} as const;

export const DASHBOARD_STYLE = `<style>
:root{
  --rose:#C02C4E; --rose-soft:#fbeaee; --rose-deep:#9b223f;
  --neutral:#f7f3ef; --ink:#2b2b2b; --muted:#8a7d72;
  --line:#ede7e0; --line-soft:#f3ede8; --white:#fff;
  --amber:#b7791f; --blue:#2b6cb0; --violet:#553c9a; --green:#276749; --red:#c53030; --slate:#718096;
  --radius:12px; --radius-sm:8px; --shadow:0 6px 30px rgba(0,0,0,.06);
  --sidebar-w:230px;
  --font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
}
*,*::before,*::after{box-sizing:border-box;}
body{margin:0;font:var(--font);color:var(--ink);background:var(--neutral);}
a{color:var(--rose);}
button{font:inherit;}

/* ── Shell layout ── */
.lz-sidebar{position:fixed;top:0;left:0;width:var(--sidebar-w);height:100vh;overflow-y:auto;
  background:var(--white);border-right:1px solid var(--line);padding:1.4rem .75rem;display:flex;flex-direction:column;z-index:50;}
.lz-logo{display:block;width:72px;margin:0 auto 1.1rem;opacity:.92;}
.lz-main{margin-left:var(--sidebar-w);min-height:100vh;display:flex;flex-direction:column;}
.lz-topbar{position:sticky;top:0;z-index:40;background:var(--white);border-bottom:1px solid var(--line);
  padding:.85rem 1.6rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;}
.lz-topbar h1{font-size:1.15rem;margin:0;color:var(--ink);font-weight:800;}
.lz-content{padding:1.4rem 1.6rem 3rem;flex:1;}
.lz-sidebar-foot{margin-top:auto;padding-top:1rem;border-top:1px solid var(--line-soft);}

/* ── Nav ── */
.lz-nav{display:flex;flex-direction:column;gap:.15rem;}
.lz-nav-group-label{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#c0a898;
  padding:.6rem .85rem .25rem;}
.lz-nav a,.lz-nav button.lz-nav-item{display:flex;align-items:center;gap:.4rem;padding:.45rem .85rem;border-radius:7px;
  text-decoration:none;color:#5c3d47;font-weight:500;font-size:.85rem;border:none;background:none;cursor:pointer;text-align:left;width:100%;}
.lz-nav a:hover,.lz-nav button.lz-nav-item:hover{background:var(--neutral);}
.lz-nav a.active{background:var(--rose-soft);color:var(--rose);font-weight:700;}
.lz-nav .badge{margin-left:auto;background:var(--rose);color:#fff;border-radius:20px;font-size:.68rem;font-weight:700;
  padding:.1em .5em;min-width:1.3em;text-align:center;display:none;}
.lz-nav .badge.show{display:inline-block;}
.lz-user{font-size:.82rem;color:var(--muted);padding:.3rem .85rem;}
.lz-btn-ghost{display:block;width:100%;margin-top:.4rem;padding:.4rem .85rem;font-size:.82rem;font-weight:600;
  color:var(--rose);background:none;border:1.5px solid #e6c9cf;border-radius:var(--radius-sm);cursor:pointer;}
.lz-btn-ghost:hover{background:var(--rose-soft);}

/* ── Buttons ── */
.lz-btn{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .8rem;border-radius:var(--radius-sm);
  font-size:.82rem;font-weight:700;border:none;cursor:pointer;text-decoration:none;line-height:1.2;}
.lz-btn-primary{background:var(--rose);color:#fff;}
.lz-btn-primary:hover{background:var(--rose-deep);}
.lz-btn-advance{background:var(--blue);color:#fff;}
.lz-btn-advance:hover{filter:brightness(.94);}
.lz-btn-quote{background:var(--violet);color:#fff;}
.lz-btn-quote:hover{filter:brightness(.94);}
.lz-btn-danger{background:#fff;color:var(--red);border:1.5px solid var(--red);}
.lz-btn-danger:hover{background:var(--red-bg);}
.lz-btn-soft{background:var(--line);color:var(--ink);}
.lz-btn-soft:hover{background:#e3dcd4;}

/* ── KPI tiles ── */
.lz-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.4rem;}
.lz-kpi{background:var(--white);border:1px solid var(--line);border-radius:var(--radius);padding:1rem 1.1rem;box-shadow:var(--shadow);}
.lz-kpi .label{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700;}
.lz-kpi .value{font-size:1.5rem;font-weight:800;margin-top:.25rem;font-variant-numeric:tabular-nums;}
.lz-kpi .sub{font-size:.72rem;color:var(--muted);margin-top:.15rem;}
.lz-kpi.alert{border-color:var(--red);}
.lz-kpi.alert .value{color:var(--red);}
.lz-kpi.good .value{color:var(--green);}

/* ── Filter tabs ── */
.lz-tabs{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:1rem;}
.lz-tab{padding:.4rem .9rem;border-radius:20px;font-size:.82rem;font-weight:600;text-decoration:none;
  background:var(--line);color:#5c3d47;}
.lz-tab.active{background:var(--rose);color:#fff;}
.lz-tab .count{opacity:.7;font-weight:500;margin-left:.3rem;}

/* ── Bulk bar ── */
.lz-bulkbar{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem;
  background:var(--white);border:1px solid var(--line);border-radius:var(--radius);padding:.6rem .9rem;}
.lz-bulkbar .check{display:flex;align-items:center;gap:.4rem;font-size:.82rem;color:var(--muted);}
.lz-actions{display:flex;gap:.5rem;flex-wrap:wrap;}

/* ── Inline form (action buttons that sit in a row) ── */
.lz-form-inline{margin:0;display:inline;}

/* ── Stage dots ── */
.lz-dot{width:.6rem;height:.6rem;border-radius:50%;display:inline-block;background:var(--slate);}
.lz-dot-new{background:var(--amber);}
.lz-dot-to-quote{background:var(--blue);}
.lz-dot-sent{background:var(--violet);}
.lz-dot-confirmed{background:var(--green);}
.lz-dot-done{background:var(--greenDeep);}
.lz-dot-closed{background:var(--slate);}
.lz-dot-rose{background:var(--rose);}

/* ── Pipeline groups ── */
.lz-stage{margin-bottom:1.6rem;}
.lz-stage-head{display:flex;align-items:center;gap:.6rem;margin:.4rem 0 .6rem;}
.lz-stage-head h2{font-size:.82rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0;}
.lz-stage-head .dot{width:.6rem;height:.6rem;border-radius:50%;}
.lz-stage-count{font-size:.78rem;color:var(--muted);}
.lz-card{background:var(--white);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:.6rem;
  padding:.9rem 1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;box-shadow:var(--shadow);}
.lz-card.overdue{border-color:var(--red);}
.lz-card .who{flex:1;min-width:180px;}
.lz-card .who .name{font-weight:700;color:var(--ink);text-decoration:none;font-size:.95rem;}
.lz-card .who .meta{font-size:.8rem;color:var(--muted);margin-top:.1rem;}
.lz-card .when{font-size:.8rem;color:var(--muted);min-width:90px;}
.lz-card .sla{min-width:120px;font-weight:700;font-size:.82rem;font-variant-numeric:tabular-nums;}
.lz-card .sla.due{color:var(--amber);}
.lz-card .sla.over{color:var(--red);}
.lz-card .sla.ok{color:var(--green);}

/* ── Badges ── */
.lz-badge{display:inline-block;padding:.15em .6em;border-radius:20px;font-size:.72rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.04em;}
.lz-badge.requested{background:var(--amberBg);color:var(--amber);}
.lz-badge.new{background:var(--amberBg);color:var(--amber);}
.lz-badge.quote_sent{background:var(--blueBg);color:var(--blue);}
.lz-badge.contacted{background:var(--blueBg);color:var(--blue);}
.lz-badge.accepted{background:var(--violetBg);color:var(--violet);}
.lz-badge.converted{background:var(--violetBg);color:var(--violet);}
.lz-badge.deposit_paid{background:var(--greenBg);color:var(--green);}
.lz-badge.settled{background:var(--greenBg2);color:var(--greenDeep);}
.lz-badge.closed{background:var(--slateBg);color:var(--slate);}
.lz-badge.declined,.lz-badge.rejected,.lz-badge.cancelled{background:var(--redBg);color:var(--red);}
.lz-badge.invoice_expired{background:var(--slateBg);color:var(--slate);}
.lz-conflict{color:var(--red);font-size:.78rem;font-weight:700;margin-left:.4rem;}

/* ── Row link (legacy table fallback) ── */
.lz-row-link{color:var(--rose);text-decoration:none;font-weight:600;}
.lz-row-link:hover{text-decoration:underline;}

/* ── Empty states ── */
.lz-empty{background:var(--white);border:1px dashed var(--line);border-radius:var(--radius);
  padding:2.4rem 1.5rem;text-align:center;color:var(--muted);}
.lz-empty .big{font-size:1.05rem;font-weight:700;color:var(--ink);margin-bottom:.3rem;}
.lz-empty .hint{font-size:.86rem;}

/* ── Approval queue ── */
.lz-approve{background:var(--white);border:1px solid var(--line);border-radius:var(--radius);margin-bottom:.6rem;padding:.9rem 1rem;
  display:flex;align-items:center;gap:1rem;flex-wrap:wrap;box-shadow:var(--shadow);}
.lz-approve .task{font-weight:700;}
.lz-approve .draft{font-size:.82rem;color:var(--muted);flex:1;min-width:200px;}

/* ── Responsive ── */
@media (max-width:920px){
  .lz-sidebar{position:static;width:100%;height:auto;flex-direction:row;align-items:center;flex-wrap:wrap;
    border-right:none;border-bottom:1px solid var(--line);padding:.6rem 1rem;gap:.4rem;}
  .lz-logo{width:48px;margin:0 .6rem 0 0;}
  .lz-nav{flex-direction:row;flex-wrap:wrap;gap:.2rem;flex:1;}
  .lz-nav-group-label,.lz-sidebar-foot{display:none;}
  .lz-main{margin-left:0;}
  .lz-kpis{grid-template-columns:repeat(2,1fr);}
  .lz-card{flex-direction:column;align-items:flex-start;}
  .lz-card .when,.lz-card .sla{min-width:0;}
}
@media (max-width:560px){
  .lz-kpis{grid-template-columns:1fr;}
}
</style>`;
