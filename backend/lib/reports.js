const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const REPORTS_DIR = path.join(__dirname, "../../reports");
const INDEX_FILE  = path.join(REPORTS_DIR, "index.json");

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function urlSlug(url) {
  try { return new URL(url).hostname.replace(/[^a-z0-9]/gi, "-").slice(0, 30); }
  catch { return "unknown"; }
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); }
  catch { return []; }
}

function writeIndex(entries) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2), "utf8");
}

// ─── HTML report generator ────────────────────────────────────────────────────

const RISK_COLOR = {
  critical: "#ff4444", high: "#ef4444", medium: "#f97316",
  low: "#eab308", minimal: "#00e5a0", unknown: "#64748b",
};
const RISK_BG = {
  critical: "#ff000015", high: "#ef444415", medium: "#f9731615",
  low: "#eab30815", minimal: "#00e5a015", unknown: "#64748b15",
};
const CAT_COLOR = {
  LLM01: "#ef4444", LLM02: "#f97316", LLM03: "#d946ef", LLM04: "#eab308",
  LLM05: "#84cc16", LLM06: "#a855f7", LLM07: "#3b82f6", LLM08: "#ec4899",
  LLM09: "#14b8a6", LLM10: "#06b6d4",
  AGT01: "#6366f1", AGT02: "#8b5cf6", AGT03: "#0ea5e9", AGT04: "#f43f5e",
  AGT05: "#22c55e", AGT06: "#10b981", AGT07: "#e879f9",
};
const SEV_COLOR = {
  critical: "#ff4444", high: "#ef4444", medium: "#f97316",
  low: "#eab308", none: "#00e5a0",
};

function generateHtml({ id, createdAt, appContext, targetRequest, prompts, results, summary, stats, targetName }) {
  const date        = new Date(createdAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
  const risk        = stats.overall_risk || "unknown";
  const riskColor   = RISK_COLOR[risk]  || RISK_COLOR.unknown;
  const riskBg      = RISK_BG[risk]     || RISK_BG.unknown;
  const vulnerable  = results.filter(r => r.analysis?.vulnerable);
  const passed      = results.length - vulnerable.length;

  // ── Target request section ──────────────────────────────────────────────────
  const headersHtml = Object.entries(targetRequest.headers || {})
    .map(([k, v]) => {
      const isAuth = /authorization|cookie/i.test(k);
      const display = isAuth ? `${v.slice(0, 30)}…<span style="color:#64748b">[redacted]</span>` : esc(v);
      return `<tr><td class="hk">${esc(k)}</td><td class="hv">${display}</td></tr>`;
    }).join("");

  const bodyHtml = targetRequest.body
    ? `<pre class="code">${esc(JSON.stringify(targetRequest.body, null, 2))}</pre>`
    : `<span style="color:#64748b">—</span>`;

  // ── Vulnerability findings ──────────────────────────────────────────────────
  const findingsHtml = vulnerable.length === 0
    ? `<div class="no-findings">✅ No vulnerabilities confirmed in this scan.</div>`
    : vulnerable.map((r, i) => {
        const a  = r.analysis;
        const p  = r.prompt;
        const cc = CAT_COLOR[a.owasp_category] || "#64748b";
        const sc = SEV_COLOR[a.severity]       || "#64748b";
        return `
        <div class="finding-card" style="border-left:4px solid ${cc}">
          <div class="finding-header">
            <span class="badge" style="background:${cc}20;color:${cc}">${esc(a.owasp_category)}</span>
            <span class="badge" style="background:${sc}20;color:${sc}">${esc(a.severity?.toUpperCase())}</span>
            <span class="finding-name">${esc(a.owasp_name)}</span>
            <span class="confidence">Confidence: ${esc(a.confidence)}</span>
          </div>
          <div class="finding-technique">Technique: <strong>${esc(p?.technique)}</strong></div>
          <div class="finding-explanation">${esc(a.explanation)}</div>
          ${a.evidence ? `<div class="evidence-box">"${esc(a.evidence)}"</div>` : ""}
          <details class="prompt-detail">
            <summary>View attack prompt</summary>
            <pre class="code">${esc(p?.prompt)}</pre>
          </details>
          ${r.attack?.response_body ? `
          <details class="prompt-detail">
            <summary>View response</summary>
            <pre class="code">${esc(r.attack.response_body.slice(0, 2000))}</pre>
          </details>` : ""}
        </div>`;
      }).join("");

  // ── All results table ───────────────────────────────────────────────────────
  const resultsTableHtml = results.map((r, i) => {
    const a  = r.analysis;
    const p  = r.prompt;
    const isVuln = a?.vulnerable;
    const cc = CAT_COLOR[p?.category] || "#64748b";
    const sc = isVuln ? SEV_COLOR[a.severity] || "#ef4444" : "#00e5a0";
    return `
      <tr class="${isVuln ? "row-vuln" : "row-clean"}">
        <td>${i + 1}</td>
        <td><span class="badge sm" style="background:${cc}20;color:${cc}">${esc(p?.category)}</span></td>
        <td>${esc(p?.title)}</td>
        <td>${esc(p?.technique)}</td>
        <td><span class="badge sm" style="background:${sc}20;color:${sc}">${isVuln ? esc(a?.severity?.toUpperCase()) : "PASS"}</span></td>
        <td style="color:#64748b">${r.attack?.elapsed_ms ? r.attack.elapsed_ms + "ms" : "—"}</td>
      </tr>`;
  }).join("");

  // ── Recommendations ─────────────────────────────────────────────────────────
  const recsHtml = (summary?.top_recommendations || []).length === 0
    ? ""
    : `<ol class="recs-list">${(summary.top_recommendations).map(r => `<li>${esc(r)}</li>`).join("")}</ol>`;

  // ── Prompt inventory ────────────────────────────────────────────────────────
  const promptsByCategory = {};
  prompts.forEach(p => {
    if (!promptsByCategory[p.category]) promptsByCategory[p.category] = [];
    promptsByCategory[p.category].push(p);
  });

  const promptInventoryHtml = Object.entries(promptsByCategory).map(([cat, ps]) => {
    const cc = CAT_COLOR[cat] || "#64748b";
    return `
      <div class="prompt-group">
        <div class="prompt-group-header" style="color:${cc}">${cat} — ${esc(ps[0]?.category_name)}</div>
        ${ps.map(p => `
          <details class="prompt-detail">
            <summary><strong>${esc(p.title)}</strong> <span style="color:#64748b;font-size:11px">[${esc(p.risk)} risk · ${esc(p.technique)}]</span></summary>
            <pre class="code">${esc(p.prompt)}</pre>
            <div style="font-size:11px;color:#64748b;margin-top:6px">Expected if vulnerable: ${esc(p.expected_behavior_if_vulnerable)}</div>
          </details>`).join("")}
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AI Red Team Report — ${targetName ? esc(targetName) : esc(urlSlug(targetRequest.url))} — ${new Date(createdAt).toLocaleDateString()}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#080b12;--bg2:#0d1117;--bg3:#141b27;--bg4:#1a2235;
  --border:#1e2d42;--border2:#253347;
  --text:#e2e8f0;--text2:#94a3b8;--text3:#64748b;
  --accent:#00e5a0;--red:#ef4444;
  --radius:8px;--radius-lg:12px;
}
html,body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.6}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px}
a{color:var(--accent);text-decoration:none}
.wrap{max-width:1100px;margin:0 auto;padding:32px 24px}

/* Header */
.report-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid var(--border)}
.report-title{font-size:24px;font-weight:800;letter-spacing:-.5px}
.report-subtitle{font-size:13px;color:var(--text3);margin-top:4px}
.report-logo{font-size:13px;color:var(--text3);text-align:right}
.report-logo strong{display:block;font-size:16px;color:var(--accent);margin-bottom:2px}

/* Risk banner */
.risk-banner{border-radius:var(--radius-lg);border:2px solid;padding:20px 24px;display:flex;align-items:center;gap:20px;margin-bottom:24px}
.risk-icon{font-size:40px;line-height:1}
.risk-label{font-size:11px;text-transform:uppercase;letter-spacing:.8px;font-weight:700;opacity:.7}
.risk-level{font-size:28px;font-weight:900;letter-spacing:-.5px;margin:2px 0}
.risk-summary{font-size:13px;color:var(--text2);max-width:700px;line-height:1.6}

/* Stats */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;text-align:center}
.stat-val{font-size:32px;font-weight:800;line-height:1}
.stat-key{font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin-top:4px}

/* Section */
.section{margin-bottom:32px}
.section-title{font-size:16px;font-weight:700;padding-bottom:10px;border-bottom:1px solid var(--border);margin-bottom:16px;display:flex;align-items:center;gap:8px}

/* Target request */
.request-block{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px}
.req-method{display:inline-block;background:var(--accent);color:#000;font-weight:800;font-size:11px;padding:2px 8px;border-radius:4px;margin-right:8px;letter-spacing:.5px}
.req-url{font-family:monospace;font-size:13px;word-break:break-all;color:var(--text)}
table.headers-table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
table.headers-table td{padding:4px 8px;vertical-align:top}
td.hk{color:var(--text3);white-space:nowrap;width:200px;font-family:monospace}
td.hv{color:var(--text);font-family:monospace;word-break:break-all}

/* App context */
.context-box{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;font-size:13px;color:var(--text2);white-space:pre-wrap;line-height:1.7}

/* Findings */
.finding-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;margin-bottom:12px}
.finding-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.finding-name{font-weight:700;font-size:14px;flex:1}
.confidence{font-size:11px;color:var(--text3);margin-left:auto}
.finding-technique{font-size:12px;color:var(--text3);margin-bottom:8px}
.finding-explanation{font-size:13px;color:var(--text2);margin-bottom:10px;line-height:1.6}
.evidence-box{background:#ef444415;border:1px solid #ef444440;border-radius:var(--radius);padding:10px 12px;font-size:12px;font-style:italic;color:var(--text);margin-bottom:10px}
.no-findings{text-align:center;padding:32px;color:var(--accent);font-size:15px;font-weight:600;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg)}

/* Badge */
.badge{font-size:10px;font-weight:800;letter-spacing:.6px;padding:3px 8px;border-radius:99px;white-space:nowrap}
.badge.sm{font-size:9px;padding:2px 6px}

/* Table */
.results-table{width:100%;border-collapse:collapse;font-size:13px}
.results-table th{text-align:left;padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);border-bottom:2px solid var(--border);background:var(--bg2)}
.results-table td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:middle}
.row-vuln td{background:#ef444408}
.row-clean td{background:#00e5a005}

/* Details / prompts */
.prompt-detail{margin-top:8px}
.prompt-detail summary{cursor:pointer;font-size:12px;color:var(--text3);padding:4px 0;list-style:none;display:flex;align-items:center;gap:6px}
.prompt-detail summary::before{content:"▶";font-size:10px;transition:transform .2s}
.prompt-detail[open] summary::before{transform:rotate(90deg)}
.code{background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-family:'Fira Code',monospace;font-size:11px;white-space:pre-wrap;word-break:break-word;color:var(--text);margin-top:8px;max-height:300px;overflow-y:auto}

/* Prompt inventory */
.prompt-group{margin-bottom:16px}
.prompt-group-header{font-weight:700;font-size:13px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border)}

/* Recommendations */
.recs-list{padding-left:20px;display:flex;flex-direction:column;gap:10px}
.recs-list li{font-size:13px;color:var(--text2);line-height:1.6;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);list-style:decimal}

/* Footer */
.report-footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:11px;color:var(--text3)}

@media print{
  body{background:#fff;color:#000}
  .risk-banner,.stat-card,.finding-card,.request-block,.context-box{border:1px solid #ccc;background:#f9f9f9}
  .section-title{border-color:#ccc}
}
</style>
</head>
<body>
<div class="wrap">

  <!-- ── Header ─────────────────────────────────────────────── -->
  <div class="report-header">
    <div>
      <div class="report-title">🔴 AI Red Team Report</div>
      ${targetName ? `<div class="report-subtitle" style="font-size:16px;font-weight:700;color:var(--text);margin-top:2px">🏷️ ${esc(targetName)}</div>` : ""}
      <div class="report-subtitle">${esc(targetRequest.url)}</div>
      <div class="report-subtitle" style="margin-top:4px">${date}</div>
    </div>
    <div class="report-logo">
      <strong>AI Red Teamer</strong>
      OWASP LLM Top 10 Scanner<br/>
      Report ID: <code style="font-size:10px;color:var(--text3)">${esc(id)}</code>
    </div>
  </div>

  <!-- ── Overall Risk ────────────────────────────────────────── -->
  <div class="risk-banner" style="border-color:${riskColor};background:${riskBg}">
    <div class="risk-icon">${{ critical:"🔴", high:"🟠", medium:"🟡", low:"🟢", minimal:"✅", unknown:"❔" }[risk] || "❔"}</div>
    <div>
      <div class="risk-label">Overall Risk Posture</div>
      <div class="risk-level" style="color:${riskColor}">${risk.toUpperCase()}</div>
      <div class="risk-summary">${esc(summary?.summary || "No summary available.")}</div>
    </div>
  </div>

  <!-- ── Stats ───────────────────────────────────────────────── -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-val">${results.length}</div>
      <div class="stat-key">Total Tests</div>
    </div>
    <div class="stat-card">
      <div class="stat-val" style="color:${RISK_COLOR.high}">${vulnerable.length}</div>
      <div class="stat-key">Vulnerabilities</div>
    </div>
    <div class="stat-card">
      <div class="stat-val" style="color:${RISK_COLOR.minimal}">${passed}</div>
      <div class="stat-key">Passed</div>
    </div>
    <div class="stat-card">
      <div class="stat-val" style="color:${stats.vuln_rate > 50 ? RISK_COLOR.high : stats.vuln_rate > 20 ? RISK_COLOR.medium : RISK_COLOR.minimal}">${stats.vuln_rate}%</div>
      <div class="stat-key">Vuln Rate</div>
    </div>
    <div class="stat-card">
      <div class="stat-val" style="font-size:16px;padding-top:8px">${(stats.categories_found || []).join(", ") || "—"}</div>
      <div class="stat-key">Categories Found</div>
    </div>
  </div>

  <!-- ── Application Context ─────────────────────────────────── -->
  <div class="section">
    <div class="section-title">🎯 Application Context</div>
    <div class="context-box">${esc(appContext)}</div>
  </div>

  <!-- ── Target Request ──────────────────────────────────────── -->
  <div class="section">
    <div class="section-title">🔗 Target Request</div>
    <div class="request-block">
      <div>
        <span class="req-method">${esc(targetRequest.method)}</span>
        <span class="req-url">${esc(targetRequest.url)}</span>
      </div>
      ${headersHtml ? `<table class="headers-table">${headersHtml}</table>` : ""}
      ${targetRequest.body ? `<div style="margin-top:12px;font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Body Template</div>${bodyHtml}` : ""}
    </div>
  </div>

  <!-- ── Confirmed Vulnerabilities ──────────────────────────── -->
  <div class="section">
    <div class="section-title">🚨 Confirmed Vulnerabilities (${vulnerable.length})</div>
    ${findingsHtml}
  </div>

  <!-- ── All Test Results ────────────────────────────────────── -->
  <div class="section">
    <div class="section-title">📊 All Test Results</div>
    <table class="results-table">
      <thead>
        <tr>
          <th>#</th><th>Category</th><th>Attack Title</th><th>Technique</th><th>Result</th><th>Latency</th>
        </tr>
      </thead>
      <tbody>${resultsTableHtml}</tbody>
    </table>
  </div>

  <!-- ── Recommendations ────────────────────────────────────── -->
  ${(summary?.top_recommendations || []).length > 0 ? `
  <div class="section">
    <div class="section-title">🛡️ Recommendations</div>
    ${recsHtml}
  </div>` : ""}

  <!-- ── Attack Prompt Inventory ─────────────────────────────── -->
  <div class="section">
    <div class="section-title">⚡ Attack Prompt Inventory (${prompts.length} prompts)</div>
    ${promptInventoryHtml}
  </div>

  <!-- ── Footer ─────────────────────────────────────────────── -->
  <div class="report-footer">
    <span>Generated by AI Red Teamer · OWASP LLM Top 10 Scanner</span>
    <span>${date} · Report ID: ${esc(id)}</span>
  </div>

</div>
</body>
</html>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function saveReport({ appContext, targetRequest, prompts, results, summary, targetName }) {
  const id        = uuidv4();
  const createdAt = new Date().toISOString();
  const slug      = urlSlug(targetRequest?.url || "");
  const filename  = `${createdAt.replace(/[:.]/g, "-")}_${slug}.html`;
  const filepath  = path.join(REPORTS_DIR, filename);

  const vulnerable = results.filter(r => r.analysis?.vulnerable);
  const total      = results.length;
  const stats = {
    total,
    vulnerable: vulnerable.length,
    vuln_rate: total > 0 ? Math.round((vulnerable.length / total) * 100) : 0,
    categories_found: [...new Set(vulnerable.map(r => r.analysis?.owasp_category).filter(Boolean))],
    overall_risk: summary?.overall_risk || "unknown",
  };

  const html = generateHtml({ id, createdAt, appContext, targetRequest, prompts, results, summary, stats, targetName });
  fs.writeFileSync(filepath, html, "utf8");

  // Update index
  const index = readIndex().filter(e => e.filename !== filename);
  index.unshift({
    id, filename, created_at: createdAt,
    url: targetRequest?.url,
    target_name: targetName || null,
    app_context_preview: (appContext || "").slice(0, 120),
    stats,
    summary_preview: (summary?.summary || "").slice(0, 200),
  });
  writeIndex(index);

  console.log(`[reports] saved: ${filename}`);
  return { id, filename, created_at: createdAt, stats, url: targetRequest?.url };
}

function listReports() {
  return readIndex();
}

function getReportPath(filename) {
  const safe = path.basename(filename); // prevent path traversal
  return path.join(REPORTS_DIR, safe);
}

module.exports = { saveReport, listReports, getReportPath, REPORTS_DIR };
