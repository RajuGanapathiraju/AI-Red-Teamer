/* ── Config ───────────────────────────────────────────────────────────────── */
const API = "http://localhost:3001/api";

/* ── State ────────────────────────────────────────────────────────────────── */
let state = {
  prompts: [],
  results: [],
  summary: null,
  scanning: false,
  iterScanning: false,
  // keyed by category id: { category, categoryName, categoryColor, rounds[], status, foundAtRound }
  iterResults: {},
};

/* ── Init ─────────────────────────────────────────────────────────────────── */
(async function init() {
  await checkHealth();
  await loadCategories();
  wireCountSlider();
  loadDefaults();
  // Show report count in badge on startup
  fetch(`${API}/reports`).then(r => r.json()).then(list => updateBadge("reports", list.length)).catch(() => {});
})();

/* ── Health check ────────────────────────────────────────────────────────── */
async function checkHealth() {
  const dot = document.getElementById("statusDot");
  const label = document.getElementById("statusLabel");
  try {
    const res = await fetch(`${API}/health`);
    if (res.ok) {
      const data = await res.json();
      dot.className = "status-dot ok";
      label.textContent = `Connected · ${(data.generator_model || "").split(".").pop().split(":")[0]}`;
    } else {
      throw new Error();
    }
  } catch {
    dot.className = "status-dot err";
    label.textContent = "Backend offline";
  }
}

/* ── Load OWASP category list ────────────────────────────────────────────── */
async function loadCategories() {
  try {
    const res = await fetch(`${API}/categories`);
    const categories = await res.json();
    renderCategoryList(categories);
  } catch {
    // fallback: no categories shown, use empty selection = all
  }
}

function renderCategoryList(categories) {
  const container = document.getElementById("categoryList");
  container.innerHTML = "";

  Object.values(categories).forEach((cat) => {
    const item = document.createElement("div");
    item.className = "category-item";
    item.dataset.catId = cat.id;

    item.innerHTML = `
      <input type="checkbox" id="cat-${cat.id}" value="${cat.id}" />
      <div class="cat-info">
        <div class="cat-id" style="color:${cat.color}">${cat.id}</div>
        <div class="cat-name">${cat.name}</div>
        <div class="cat-desc">${cat.description}</div>
      </div>`;

    item.addEventListener("click", (e) => {
      const cb = item.querySelector("input");
      if (e.target !== cb) cb.checked = !cb.checked;
      item.classList.toggle("selected", cb.checked);
    });

    container.appendChild(item);
  });
}

function getSelectedCategories() {
  return Array.from(document.querySelectorAll("#categoryList input:checked")).map((cb) => cb.value);
}

/* ── Count slider ────────────────────────────────────────────────────────── */
function wireCountSlider() {
  const slider = document.getElementById("countPerCategory");
  const label = document.getElementById("countLabel");
  slider.addEventListener("input", () => (label.textContent = slider.value));

  const maxRoundsSlider = document.getElementById("maxRounds");
  const maxRoundsLabel = document.getElementById("maxRoundsLabel");
  maxRoundsSlider.addEventListener("input", () => (maxRoundsLabel.textContent = maxRoundsSlider.value));
}

/* ── Load defaults ───────────────────────────────────────────────────────── */
function loadDefaults() {
  // Keep fields empty for user to fill — no hardcoded demo data
}

/* ── Tab switching ────────────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));

  document.querySelector(`.tab[data-tab="${name}"]`).classList.add("active");
  document.getElementById(`tab-${name}`).classList.add("active");
}

/* ── Generate Prompts ────────────────────────────────────────────────────── */
async function generatePrompts() {
  const appContext = document.getElementById("appContext").value.trim();
  if (!appContext || appContext.length < 10) {
    showToast("Please enter an application context (at least 10 characters).", "error");
    return;
  }

  const categories = getSelectedCategories();
  const count = parseInt(document.getElementById("countPerCategory").value, 10);

  const btn = document.getElementById("btnGenerate");
  btn.disabled = true;
  btn.innerHTML = `<span class="spin">⚙</span> Generating…`;

  try {
    const res = await fetch(`${API}/generate-prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appContext, categories, countPerCategory: count }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Generation failed");
    }

    const data = await res.json();
    state.prompts = data.prompts;
    state.results = [];

    renderPromptsList();
    updateBadge("prompts", data.total);
    updateBadge("results", 0);

    document.getElementById("btnScan").disabled = false;
    document.getElementById("emptyPrompts").classList.add("hidden");
    switchTab("prompts");

    if (data.total === 0 && data.errors?.length) {
      const firstErr = data.errors[0]?.error || "Unknown error";
      showToast(`Generation failed: ${firstErr}`, "error");
      console.error("Generation errors:", data.errors);
      return;
    }

    showToast(`Generated ${data.total} attack prompts.`, "success");

    if (data.errors?.length) {
      console.warn("Some categories failed:", data.errors);
      showToast(`⚠️ ${data.errors.length} categories failed — check console for details.`, "error");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span class="btn-icon">⚙</span> Generate Prompts`;
  }
}

/* ── Render prompts list ──────────────────────────────────────────────────── */
function renderPromptsList() {
  const container = document.getElementById("promptsList");
  container.innerHTML = "";

  state.prompts.forEach((p) => {
    const card = document.createElement("div");
    card.className = "prompt-card";
    card.id = `prompt-card-${p.id}`;

    card.innerHTML = `
      <div class="prompt-header" onclick="toggleCard('prompt-card-${p.id}')">
        <span class="prompt-cat-badge" style="background:${p.category_color}20;color:${p.category_color}">${p.category}</span>
        <span class="prompt-title">${escHtml(p.title)}</span>
        <span class="prompt-risk risk-${p.risk}">${p.risk}</span>
        <span class="prompt-chevron">▼</span>
      </div>
      <div class="prompt-body">
        <div class="prompt-meta">
          <div class="meta-item">
            <span class="meta-key">Category</span>
            <span class="meta-val">${escHtml(p.category_name)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-key">Technique</span>
            <span class="meta-val">${escHtml(p.technique)}</span>
          </div>
        </div>
        <div class="prompt-text">${escHtml(p.prompt)}</div>
        <div class="prompt-expected">Expected if vulnerable: ${escHtml(p.expected_behavior_if_vulnerable)}</div>
        <div class="prompt-actions">
          <button class="btn-sm attack" onclick="runSingleAttack('${p.id}')">▶ Attack</button>
          <button class="btn-sm" onclick="copyPrompt('${p.id}')">Copy prompt</button>
        </div>
      </div>`;

    container.appendChild(card);
  });
}

function toggleCard(id) {
  const card = document.getElementById(id);
  card.classList.toggle("open");
}

/* ── Run full scan via SSE ────────────────────────────────────────────────── */
async function runFullScan() {
  if (state.scanning) return;
  if (state.prompts.length === 0) {
    showToast("Generate prompts first.", "error");
    return;
  }

  const appContext = document.getElementById("appContext").value.trim();
  const targetRequest = buildTargetRequest();

  if (!targetRequest) return;

  state.scanning = true;
  state.results = [];

  document.getElementById("btnScan").disabled = true;
  document.getElementById("btnGenerate").disabled = true;

  showProgress(true, state.prompts.length);
  switchTab("results");
  document.getElementById("emptyResults").classList.add("hidden");
  document.getElementById("resultsList").innerHTML = "";

  // Render skeleton cards
  state.prompts.forEach((p, i) => {
    renderResultCard({ prompt: p, attack: null, analysis: null }, i, "pending");
  });

  const body = JSON.stringify({ appContext, targetRequest, prompts: state.prompts });
  let completed = 0;

  try {
    const response = await fetch(`${API}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            handleSseEvent(data, completed);
          } catch {}
        } else if (line.startsWith("event: ")) {
          // event name captured in next data line
        }
      }

      // Parse SSE properly (event + data pairs)
      const fullBuffer = buffer;
      void fullBuffer;
    }
  } catch (err) {
    showToast(`Scan failed: ${err.message}`, "error");
  } finally {
    state.scanning = false;
    document.getElementById("btnScan").disabled = false;
    document.getElementById("btnGenerate").disabled = false;
    showProgress(false);
  }
}

function handleSseEvent(data, completed) {
  if (data.index !== undefined && data.result) {
    // result event
    const result = data.result;
    state.results[data.index] = result;
    const status = result.analysis?.vulnerable ? "vuln" : "clean";
    renderResultCard(result, data.index, status);
    completed = state.results.filter(Boolean).length;
    updateProgress(completed, state.prompts.length, "Scanning…");
    updateBadge("results", completed);
  }
  if (data.summary) {
    state.summary = data.summary;
    renderSummary();
  }
  if (data.status === "attacking") {
    updateResultStatus(data.id, "attacking");
    document.getElementById("progressLabel").textContent = `Attacking: ${data.title}`;
  }
  if (data.status === "analyzing") {
    updateResultStatus(data.id, "analyzing");
  }
  if (data.total !== undefined && data.vulnerable !== undefined) {
    // done event
    showToast(`Scan complete: ${data.vulnerable} / ${data.total} vulnerabilities found.`,
      data.vulnerable > 0 ? "error" : "success");
    switchTab("summary");
  }
}

/* ── Render result card ───────────────────────────────────────────────────── */
function renderResultCard(result, index, status) {
  const container = document.getElementById("resultsList");
  let card = document.getElementById(`result-card-${index}`);

  if (!card) {
    card = document.createElement("div");
    card.id = `result-card-${index}`;
    container.appendChild(card);
  }

  const p = result.prompt;
  const an = result.analysis;
  const at = result.attack;

  let cardClass = "result-card";
  let iconHtml = "";
  let statusHtml = "";
  let bodyHtml = "";

  if (status === "pending") {
    cardClass += " pending-card";
    iconHtml = `<span class="result-vuln-icon">⏳</span>`;
    statusHtml = `<span class="status-pill pending">Queued</span>`;
  } else if (status === "attacking") {
    cardClass += " pending-card";
    iconHtml = `<span class="result-vuln-icon spin">⚡</span>`;
    statusHtml = `<span class="status-pill attacking">Attacking</span>`;
  } else if (status === "analyzing") {
    cardClass += " pending-card";
    iconHtml = `<span class="result-vuln-icon spin">🔍</span>`;
    statusHtml = `<span class="status-pill analyzing">Analyzing</span>`;
  } else if (status === "vuln") {
    cardClass += " vuln";
    iconHtml = `<span class="result-vuln-icon">🚨</span>`;
    statusHtml = `<span class="severity-badge sev-${an.severity}">${an.severity}</span>`;

    bodyHtml = `
      <div class="result-body" id="result-body-${index}">
        <div class="result-section">
          <div class="result-section-title">Vulnerability</div>
          <div style="font-size:14px;font-weight:700;color:var(--red);margin-bottom:4px">${escHtml(an.owasp_category)} — ${escHtml(an.owasp_name)}</div>
          <div class="explanation-text">${escHtml(an.explanation)}</div>
        </div>
        ${an.evidence ? `
        <div class="result-section">
          <div class="result-section-title">Evidence</div>
          <div class="evidence-box">"${escHtml(an.evidence)}"</div>
        </div>` : ""}
        <div class="result-section">
          <div class="result-section-title">Attack Prompt</div>
          <div class="prompt-text">${escHtml(p.prompt)}</div>
        </div>
        ${at ? `<button class="btn-sm btn-view" onclick="openResponseModal(${index})">View full response</button>` : ""}
      </div>`;
  } else if (status === "clean") {
    cardClass += " clean";
    iconHtml = `<span class="result-vuln-icon">✅</span>`;
    statusHtml = `<span class="severity-badge sev-none">No issue</span>`;

    bodyHtml = `
      <div class="result-body" id="result-body-${index}">
        <div class="result-section">
          <div class="explanation-text">${escHtml(an?.explanation || "No vulnerability detected.")}</div>
        </div>
        <div class="result-section">
          <div class="result-section-title">Attack Prompt</div>
          <div class="prompt-text">${escHtml(p.prompt)}</div>
        </div>
        ${at ? `<button class="btn-sm btn-view" onclick="openResponseModal(${index})">View full response</button>` : ""}
      </div>`;
  }

  card.className = cardClass;
  card.innerHTML = `
    <div class="result-header" onclick="toggleCard('result-card-${index}')">
      ${iconHtml}
      <div class="result-title">
        <div class="result-title-main">${escHtml(p.title)}</div>
        <div class="result-title-sub" style="color:${p.category_color || 'var(--text-3)'}">${p.category} · ${escHtml(p.technique)}</div>
      </div>
      ${statusHtml}
      <span class="prompt-chevron">▼</span>
    </div>
    ${bodyHtml}`;
}

function updateResultStatus(promptId, status) {
  const index = state.prompts.findIndex((p) => p.id === promptId);
  if (index === -1) return;
  const p = state.prompts[index];
  renderResultCard({ prompt: p, attack: null, analysis: null }, index, status);
}

/* ── Single attack ───────────────────────────────────────────────────────── */
async function runSingleAttack(promptId) {
  const p = state.prompts.find((p) => p.id === promptId);
  if (!p) return;

  const appContext = document.getElementById("appContext").value.trim();
  const targetRequest = buildTargetRequest();
  if (!targetRequest) return;

  const btn = document.querySelector(`#prompt-card-${promptId} .btn-sm.attack`);
  if (btn) { btn.disabled = true; btn.textContent = "Running…"; }

  try {
    // Attack
    const attackRes = await fetch(`${API}/run-attack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetRequest, prompt: p.prompt }),
    });
    const attack = await attackRes.json();

    // Analyze
    const analyzeRes = await fetch(`${API}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appContext,
        attackPrompt: p.prompt,
        attackCategory: p.category,
        attackTechnique: p.technique,
        attackResponse: attack.response_body || attack.error,
      }),
    });
    const analysis = await analyzeRes.json();

    const idx = state.results.length;
    state.results.push({ prompt: p, attack, analysis });
    switchTab("results");
    document.getElementById("emptyResults").classList.add("hidden");
    renderResultCard({ prompt: p, attack, analysis }, idx, analysis.vulnerable ? "vuln" : "clean");
    updateBadge("results", state.results.length);
    showToast(analysis.vulnerable ? `🚨 Vulnerability found: ${analysis.owasp_category}` : "✅ No vulnerability detected.", analysis.vulnerable ? "error" : "success");
  } catch (err) {
    showToast(`Attack failed: ${err.message}`, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "▶ Attack"; }
  }
}

/* ── Build target request from form ──────────────────────────────────────── */
function buildTargetRequest() {
  const url = document.getElementById("reqUrl").value.trim();
  if (!url) {
    showToast("Please enter a target URL.", "error");
    return null;
  }

  const method = document.getElementById("reqMethod").value;
  let headers = {};
  let body = null;
  let params = null;

  try {
    const hRaw = document.getElementById("reqHeaders").value.trim();
    if (hRaw) headers = parseRawHeaders(hRaw);
  } catch (e) {
    showToast(`Headers parse error: ${e.message}`, "error");
    return null;
  }

  try {
    const bRaw = document.getElementById("reqBody").value.trim();
    if (bRaw) body = JSON.parse(bRaw);
  } catch {
    showToast("Body must be valid JSON.", "error");
    return null;
  }

  try {
    const pRaw = document.getElementById("reqParams").value.trim();
    if (pRaw) params = JSON.parse(pRaw);
  } catch {
    showToast("Query params must be valid JSON.", "error");
    return null;
  }

  return { method, url, headers, body, params };
}

/* ── Summary rendering ───────────────────────────────────────────────────── */
function renderSummary() {
  const container = document.getElementById("summaryContent");
  const empty = document.getElementById("emptySummary");
  const s = state.summary;

  if (!s) return;

  const total = state.results.length;
  const vulnerable = state.results.filter((r) => r.analysis?.vulnerable).length;
  const clean = total - vulnerable;
  const rate = total > 0 ? Math.round((vulnerable / total) * 100) : 0;

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  state.results.forEach((r) => {
    if (r.analysis?.vulnerable && r.analysis.severity) {
      severityCounts[r.analysis.severity] = (severityCounts[r.analysis.severity] || 0) + 1;
    }
  });

  const findings = state.results
    .filter((r) => r.analysis?.vulnerable)
    .map((r) => ({ ...r.analysis, technique: r.prompt?.technique }));

  const riskColorMap = {
    critical: "var(--red)", high: "var(--red)", medium: "var(--orange)",
    low: "var(--yellow)", minimal: "var(--accent)", unknown: "var(--border)",
  };
  const riskIconMap = {
    critical: "🔴", high: "🟠", medium: "🟡", low: "🟢", minimal: "✅", unknown: "❔",
  };
  const riskColor = riskColorMap[s.overall_risk] || riskColorMap.unknown;

  container.innerHTML = `
    <div class="summary-stats">
      <div class="stat-card">
        <div class="stat-value" style="color:var(--text)">${total}</div>
        <div class="stat-label">Tests Run</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--red)">${vulnerable}</div>
        <div class="stat-label">Vulnerabilities</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--accent)">${clean}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:${rate > 50 ? 'var(--red)' : rate > 20 ? 'var(--orange)' : 'var(--accent)'}">${rate}%</div>
        <div class="stat-label">Vuln Rate</div>
      </div>
    </div>

    <div class="overall-risk-card risk-${s.overall_risk}">
      <div class="risk-icon">${riskIconMap[s.overall_risk] || "❔"}</div>
      <div>
        <div class="risk-label">Overall Risk</div>
        <div class="risk-level" style="color:${riskColor}">${(s.overall_risk || "unknown").toUpperCase()}</div>
        <div class="risk-summary">${escHtml(s.summary)}</div>
      </div>
    </div>

    ${findings.length > 0 ? `
    <div class="summary-section-title">🚨 Confirmed Vulnerabilities (${findings.length})</div>
    <div class="findings-grid">
      ${findings.map((f) => `
        <div class="finding-card" style="border-color:${getCatColor(f.owasp_category)}">
          <div class="finding-cat" style="color:${getCatColor(f.owasp_category)}">${escHtml(f.owasp_category)}</div>
          <div class="finding-name">${escHtml(f.owasp_name)}</div>
          <div class="finding-technique">${escHtml(f.technique || "")}</div>
          ${f.evidence ? `<div class="finding-evidence">"${escHtml(f.evidence)}"</div>` : ""}
        </div>`).join("")}
    </div>` : ""}

    ${s.top_recommendations?.length > 0 ? `
    <div class="summary-section-title" style="margin-top:24px">🛡️ Top Recommendations</div>
    <div class="recommendations">
      ${s.top_recommendations.map((r, i) => `
        <div class="rec-item">
          <span class="rec-num">${i + 1}</span>
          <span class="rec-text">${escHtml(r)}</span>
        </div>`).join("")}
    </div>` : ""}`;

  container.classList.remove("hidden");
  empty.classList.add("hidden");
}

/* ── Response modal ───────────────────────────────────────────────────────── */
function openResponseModal(index) {
  const result = state.results[index];
  if (!result?.attack) return;

  const at = result.attack;
  const p = result.prompt;

  document.getElementById("modalTitle").textContent = p.title || "Response Details";
  document.getElementById("modalBody").innerHTML = `
    <div class="modal-meta">
      <div class="modal-meta-item">
        <span class="modal-meta-key">Status</span>
        <span class="modal-meta-val" style="color:${at.status_code >= 200 && at.status_code < 300 ? 'var(--accent)' : 'var(--red)'}">${at.status_code || "N/A"}</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-key">Latency</span>
        <span class="modal-meta-val">${at.elapsed_ms}ms</span>
      </div>
      <div class="modal-meta-item">
        <span class="modal-meta-key">Category</span>
        <span class="modal-meta-val" style="color:${p.category_color}">${p.category}</span>
      </div>
      ${result.analysis?.vulnerable ? `
      <div class="modal-meta-item">
        <span class="modal-meta-key">Vulnerability</span>
        <span class="modal-meta-val" style="color:var(--red)">${result.analysis.owasp_category}</span>
      </div>` : ""}
    </div>

    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);margin-bottom:6px">Response Body</div>
    <div class="response-block">${escHtml(at.response_body || at.error || "(empty)")}</div>`;

  document.getElementById("modal").classList.remove("hidden");
}

function closeModal(e) {
  if (!e || e.target === document.getElementById("modal")) {
    document.getElementById("modal").classList.add("hidden");
  }
}

/* ── Progress ────────────────────────────────────────────────────────────── */
function showProgress(show, total = 0) {
  const el = document.getElementById("scanProgress");
  el.classList.toggle("hidden", !show);
  if (show) {
    document.getElementById("progressCount").textContent = `0 / ${total}`;
    document.getElementById("progressBar").style.width = "0%";
  }
}

function updateProgress(completed, total, label) {
  document.getElementById("progressLabel").textContent = label;
  document.getElementById("progressCount").textContent = `${completed} / ${total}`;
  document.getElementById("progressBar").style.width = `${Math.round((completed / total) * 100)}%`;
}

/* ── Reports ─────────────────────────────────────────────────────────────── */
const RISK_COLORS = {
  critical: "var(--red)", high: "var(--red)", medium: "var(--orange)",
  low: "var(--yellow)", minimal: "var(--accent)", unknown: "var(--text-3)",
};

async function loadReportsList() {
  const container = document.getElementById("reportsList");
  const empty     = document.getElementById("emptyReports");
  container.innerHTML = `<div style="color:var(--text-3);font-size:13px;padding:20px 0">Loading…</div>`;

  try {
    const res     = await fetch(`${API}/reports`);
    const reports = await res.json();

    updateBadge("reports", reports.length);

    if (!reports.length) {
      container.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");
    container.innerHTML = "";

    reports.forEach((r) => {
      const card       = document.createElement("div");
      card.className   = "report-card";
      const riskColor  = RISK_COLORS[r.stats?.overall_risk] || RISK_COLORS.unknown;
      const date       = new Date(r.created_at).toLocaleString();
      const reportUrl  = `http://localhost:3001/reports/${encodeURIComponent(r.filename)}`;

      card.innerHTML = `
        <div class="report-card-header">
          <span class="report-card-icon">📋</span>
          <div class="report-card-meta">
            <div class="report-card-url">${escHtml(r.url || "Unknown URL")}</div>
            <div class="report-card-date">${date}</div>
          </div>
          <span class="severity-badge" style="background:${riskColor}20;color:${riskColor}">
            ${(r.stats?.overall_risk || "unknown").toUpperCase()}
          </span>
        </div>
        <div class="report-card-stats">
          <div class="report-stat">
            <span class="report-stat-val">${r.stats?.total || 0}</span>
            <span class="report-stat-key">Tests</span>
          </div>
          <div class="report-stat">
            <span class="report-stat-val" style="color:var(--red)">${r.stats?.vulnerable || 0}</span>
            <span class="report-stat-key">Vulns</span>
          </div>
          <div class="report-stat">
            <span class="report-stat-val" style="color:var(--accent)">${r.stats?.vuln_rate || 0}%</span>
            <span class="report-stat-key">Rate</span>
          </div>
          ${(r.stats?.categories_found || []).map((c) =>
            `<div class="report-stat">
              <span class="report-stat-val" style="font-size:11px;color:${getCatColor(c)}">${c}</span>
              <span class="report-stat-key">Found</span>
            </div>`).join("")}
        </div>
        ${r.app_context_preview ? `<div class="report-card-preview">${escHtml(r.app_context_preview)}…</div>` : ""}
        ${r.summary_preview ? `<div class="report-card-preview" style="margin-top:6px;font-style:italic">${escHtml(r.summary_preview)}…</div>` : ""}
        <div class="report-card-actions">
          <button class="btn-sm" onclick="openReportTab('${reportUrl}', event)">🔗 Open Report</button>
          <button class="btn-sm" onclick="downloadHtmlReport('${reportUrl}', '${escHtml(r.filename)}', event)">⬇ Download HTML</button>
        </div>`;

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div style="color:var(--red);font-size:13px;padding:20px 0">Failed to load reports: ${escHtml(err.message)}</div>`;
  }
}

function openReportTab(url, e) {
  if (e) e.stopPropagation();
  window.open(url, "_blank");
}

async function downloadHtmlReport(url, filename, e) {
  if (e) e.stopPropagation();
  try {
    const res  = await fetch(url);
    const html = await res.text();
    const blob = new Blob([html], { type: "text/html" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    showToast(`Download failed: ${err.message}`, "error");
  }
}

/* ── Raw header parser (Burp Repeater format) ────────────────────────────── */
// Headers that are managed by the HTTP client and must not be forwarded
const SKIP_HEADERS = new Set([
  "host", "content-length", "transfer-encoding",
  "accept-encoding", "connection", "keep-alive",
]);

function parseRawHeaders(raw) {
  const headers = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (!key) continue;
    if (SKIP_HEADERS.has(key.toLowerCase())) continue;
    headers[key] = value;
  }
  return headers;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function updateBadge(tab, count) {
  document.getElementById(`badge${capitalize(tab)}`).textContent = count;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function copyPrompt(promptId) {
  const p = state.prompts.find((p) => p.id === promptId);
  if (!p) return;
  navigator.clipboard.writeText(p.prompt).then(() => showToast("Prompt copied!", "success"));
}

function getCatColor(catId) {
  const map = {
    LLM01: "#ef4444", LLM02: "#f97316", LLM04: "#eab308",
    LLM06: "#a855f7", LLM07: "#3b82f6", LLM08: "#ec4899", LLM09: "#14b8a6",
  };
  return map[catId] || "var(--border)";
}

let toastTimer;
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4000);
}

/* ── SSE parser fix: re-parse full buffer properly ───────────────────────── */
// The SSE reader uses a simple line-based parser above.
// Reassemble event+data pairs properly:
async function* parseSSE(reader) {
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop();

    for (const block of blocks) {
      const lines = block.split("\n");
      let eventName = "";
      let data = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) eventName = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }

      if (data) {
        try { yield { event: eventName, data: JSON.parse(data) }; }
        catch {}
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ITERATIVE SCAN
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Run iterative scan ───────────────────────────────────────────────────── */
async function runIterativeScan() {
  if (state.iterScanning) return;

  const appContext = document.getElementById("appContext").value.trim();
  if (!appContext || appContext.length < 10) {
    showToast("Please enter an application context (at least 10 characters).", "error");
    return;
  }

  const targetRequest = buildTargetRequest();
  if (!targetRequest) return;

  const categories = getSelectedCategories();
  const maxRounds = parseInt(document.getElementById("maxRounds").value, 10);

  state.iterScanning = true;
  state.iterResults = {};

  const btnIter = document.getElementById("btnIterative");
  const btnScan = document.getElementById("btnScan");
  const btnGen  = document.getElementById("btnGenerate");
  btnIter.disabled = true;
  btnIter.innerHTML = `<span class="spin">⟳</span> Scanning…`;
  btnScan.disabled = true;
  btnGen.disabled  = true;

  switchTab("iterative");
  document.getElementById("emptyIterative").classList.add("hidden");
  document.getElementById("iterCategoryList").innerHTML = "";

  const iterProgress = document.getElementById("iterProgress");
  iterProgress.classList.remove("hidden");
  document.getElementById("iterProgressLabel").textContent = "Starting…";
  document.getElementById("iterProgressCount").textContent = "0 / ?";
  document.getElementById("iterProgressBar").style.width = "0%";

  let totalCategories = 0;
  let categoriesDone = 0;

  try {
    const response = await fetch(`${API}/iterative-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appContext, targetRequest, categories, maxRounds }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Iterative scan failed");
    }

    for await (const { event, data } of parseSSE(response.body.getReader())) {

      if (event === "start") {
        totalCategories = data.totalCategories;
        document.getElementById("iterProgressCount").textContent = `0 / ${totalCategories}`;
      }

      else if (event === "category_start") {
        state.iterResults[data.category] = {
          category: data.category,
          categoryName: data.categoryName,
          categoryColor: data.categoryColor,
          rounds: [],
          status: "running",
          foundAtRound: null,
        };
        renderIterCategoryCard(data.category);
        document.getElementById("iterProgressLabel").textContent = `Testing ${data.category} — ${data.categoryName}`;
      }

      else if (event === "round_start") {
        updateIterCategoryStatus(data.category, "running", data.round);
      }

      else if (event === "round_result") {
        const cat = state.iterResults[data.category];
        if (cat) {
          cat.rounds.push({
            round: data.round,
            prompt: data.prompt,
            attack: data.attack,
            analysis: data.analysis,
          });
          appendIterRound(data.category, data.round, data.prompt, data.analysis);
        }
      }

      else if (event === "category_done") {
        const cat = state.iterResults[data.category];
        if (cat) {
          cat.status = data.success ? "found" : "not_found";
          cat.foundAtRound = data.foundAtRound;
        }
        categoriesDone++;
        finalizeIterCategoryCard(data.category, data.success, data.foundAtRound, data.totalRounds);
        const pct = Math.round((categoriesDone / totalCategories) * 100);
        document.getElementById("iterProgressBar").style.width = `${pct}%`;
        document.getElementById("iterProgressCount").textContent = `${categoriesDone} / ${totalCategories}`;
        updateBadge("iterative", Object.values(state.iterResults).filter((r) => r.status === "found").length);
      }

      else if (event === "summary") {
        state.summary = data.summary;
        // Flatten iterative rounds into state.results so renderSummary can count them
        state.results = Object.values(state.iterResults).flatMap((cat) =>
          cat.rounds.map((r) => ({ prompt: r.prompt, attack: r.attack, analysis: r.analysis }))
        );
        renderSummary();
      }

      else if (event === "saved") {
        showToast(`Report saved: ${data.filename}`, "success");
        fetch(`${API}/reports`).then(r => r.json()).then(list => updateBadge("reports", list.length)).catch(() => {});
      }

      else if (event === "done") {
        document.getElementById("iterProgressLabel").textContent = "Scan complete";
        document.getElementById("iterProgressBar").style.width = "100%";
        const vulnCount = Object.values(state.iterResults).filter((r) => r.status === "found").length;
        updateBadge("iterative", vulnCount);
        showToast(
          `Iterative scan done: ${data.vulnerable}/${data.totalCategories} categories vulnerable · ${data.totalRoundsUsed} total rounds.`,
          data.vulnerable > 0 ? "error" : "success"
        );
        setTimeout(() => switchTab("summary"), 1000);
      }
    }
  } catch (err) {
    showToast(`Iterative scan failed: ${err.message}`, "error");
  } finally {
    state.iterScanning = false;
    btnIter.disabled = false;
    btnIter.innerHTML = `<span class="btn-icon">⟳</span> Iterative Scan`;
    btnScan.disabled = false;
    btnGen.disabled  = false;
  }
}

/* ── Render a category card (initially empty / running) ──────────────────── */
function renderIterCategoryCard(catId) {
  const container = document.getElementById("iterCategoryList");
  const cat = state.iterResults[catId];
  if (!cat) return;

  let card = document.getElementById(`iter-cat-${catId}`);
  if (!card) {
    card = document.createElement("div");
    card.id = `iter-cat-${catId}`;
    card.className = "iter-category-card";
    container.appendChild(card);
  }

  card.innerHTML = `
    <div class="iter-cat-header" id="iter-cat-header-${catId}">
      <span class="prompt-cat-badge" style="background:${cat.categoryColor}20;color:${cat.categoryColor}">${catId}</span>
      <span class="iter-cat-name">${escHtml(cat.categoryName)}</span>
      <span class="iter-cat-status" id="iter-cat-status-${catId}">
        <span class="status-pill attacking">Round 1</span>
      </span>
    </div>
    <div class="iter-rounds" id="iter-rounds-${catId}"></div>`;
}

/* ── Update the "running" label while rounds are in flight ───────────────── */
function updateIterCategoryStatus(catId, status, round) {
  const el = document.getElementById(`iter-cat-status-${catId}`);
  if (!el) return;
  if (status === "running") {
    el.innerHTML = `<span class="status-pill attacking">Round ${round}</span>`;
  }
}

/* ── Append a completed round row to a category card ─────────────────────── */
function appendIterRound(catId, round, prompt, analysis) {
  const container = document.getElementById(`iter-rounds-${catId}`);
  if (!container) return;
  const cat = state.iterResults[catId];

  const isVuln = analysis?.vulnerable;
  const isAdaptive = !!prompt?.adaptive;

  const row = document.createElement("div");
  row.className = `iter-round ${isVuln ? "iter-round-vuln" : "iter-round-clean"}`;
  row.id = `iter-round-${catId}-${round}`;

  row.innerHTML = `
    <div class="iter-round-header" onclick="toggleIterRound('${catId}', ${round})">
      <span class="iter-round-dot ${isVuln ? "dot-vuln" : "dot-clean"}"></span>
      <span class="iter-round-num">Round ${round}</span>
      ${isAdaptive ? `<span class="iter-adaptive-badge">Adaptive</span>` : ""}
      <span class="iter-round-title">${escHtml(prompt?.title || "")}</span>
      <span class="iter-round-technique">${escHtml(prompt?.technique || "")}</span>
      <span class="iter-round-outcome ${isVuln ? "outcome-vuln" : "outcome-clean"}">
        ${isVuln ? "🚨 Vulnerable" : "✅ Defended"}
      </span>
      <span class="prompt-chevron">▼</span>
    </div>
    <div class="iter-round-body hidden" id="iter-round-body-${catId}-${round}">
      ${isVuln && analysis.owasp_category ? `
      <div class="result-section">
        <div class="result-section-title">Vulnerability</div>
        <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:4px">${escHtml(analysis.owasp_category)} — ${escHtml(analysis.owasp_name)}</div>
        <div class="explanation-text">${escHtml(analysis.explanation)}</div>
        ${analysis.evidence ? `<div class="evidence-box" style="margin-top:8px">"${escHtml(analysis.evidence)}"</div>` : ""}
      </div>` : `
      <div class="result-section">
        <div class="explanation-text">${escHtml(analysis?.explanation || "No vulnerability detected.")}</div>
      </div>`}
      <div class="result-section">
        <div class="result-section-title">Attack Prompt${isAdaptive ? " (AI-Adapted)" : ""}</div>
        <div class="prompt-text">${escHtml(prompt?.prompt || "")}</div>
      </div>
      ${prompt?.expected_behavior_if_vulnerable ? `
      <div class="result-section">
        <div class="result-section-title">Expected if Vulnerable</div>
        <div class="prompt-expected" style="font-style:italic">${escHtml(prompt.expected_behavior_if_vulnerable)}</div>
      </div>` : ""}
    </div>`;

  container.appendChild(row);
}

/* ── Toggle a round's expanded body ──────────────────────────────────────── */
function toggleIterRound(catId, round) {
  const body = document.getElementById(`iter-round-body-${catId}-${round}`);
  const row  = document.getElementById(`iter-round-${catId}-${round}`);
  if (!body || !row) return;
  const isHidden = body.classList.contains("hidden");
  body.classList.toggle("hidden", !isHidden);
  const chevron = row.querySelector(".prompt-chevron");
  if (chevron) chevron.style.transform = isHidden ? "rotate(180deg)" : "";
}

/* ── Finalize a category card after all rounds complete ──────────────────── */
function finalizeIterCategoryCard(catId, success, foundAtRound, totalRounds) {
  const statusEl = document.getElementById(`iter-cat-status-${catId}`);
  const card     = document.getElementById(`iter-cat-${catId}`);
  if (!statusEl || !card) return;

  if (success) {
    statusEl.innerHTML = `<span class="status-pill done-vuln">Found at round ${foundAtRound}</span>`;
    card.classList.add("iter-cat-found");
  } else {
    statusEl.innerHTML = `<span class="status-pill done-clean">Not found · ${totalRounds} round${totalRounds !== 1 ? "s" : ""}</span>`;
    card.classList.add("iter-cat-clean");
  }
}

// Override runFullScan to use proper SSE parser
const _origRunFullScan = runFullScan;
window.runFullScan = async function () {
  if (state.scanning) return;
  if (state.prompts.length === 0) { showToast("Generate prompts first.", "error"); return; }

  const appContext = document.getElementById("appContext").value.trim();
  const targetRequest = buildTargetRequest();
  if (!targetRequest) return;

  state.scanning = true;
  state.results = new Array(state.prompts.length).fill(null);

  document.getElementById("btnScan").disabled = true;
  document.getElementById("btnGenerate").disabled = true;

  showProgress(true, state.prompts.length);
  switchTab("results");
  document.getElementById("emptyResults").classList.add("hidden");
  document.getElementById("resultsList").innerHTML = "";

  state.prompts.forEach((p, i) => {
    renderResultCard({ prompt: p, attack: null, analysis: null }, i, "pending");
  });

  try {
    const response = await fetch(`${API}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appContext, targetRequest, prompts: state.prompts }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Scan failed");
    }

    for await (const { event, data } of parseSSE(response.body.getReader())) {
      const completed = state.results.filter(Boolean).length;

      if (event === "result") {
        state.results[data.index] = data.result;
        const status = data.result.analysis?.vulnerable ? "vuln" : "clean";
        renderResultCard(data.result, data.index, status);
        const done2 = state.results.filter(Boolean).length;
        updateProgress(done2, state.prompts.length, "Scanning…");
        updateBadge("results", done2);
      } else if (event === "progress") {
        if (data.status === "attacking") {
          updateResultStatus(data.id, "attacking");
          document.getElementById("progressLabel").textContent = `Attacking: ${data.title || ""}`;
        } else if (data.status === "analyzing") {
          updateResultStatus(data.id, "analyzing");
        } else if (data.status === "summarizing") {
          document.getElementById("progressLabel").textContent = "Generating summary…";
        }
      } else if (event === "summary") {
        state.summary = data.summary;
        renderSummary();
      } else if (event === "saved") {
        showToast(`💾 Report saved: ${data.filename}`, "success");
        // Refresh the badge count without switching tabs
        fetch(`${API}/reports`).then(r => r.json()).then(list => updateBadge("reports", list.length)).catch(() => {});
      } else if (event === "done") {
        updateProgress(data.total, data.total, "Scan complete");
        showToast(
          `Scan complete: ${data.vulnerable} / ${data.total} vulnerabilities found.`,
          data.vulnerable > 0 ? "error" : "success"
        );
        setTimeout(() => switchTab("summary"), 800);
      }
    }
  } catch (err) {
    showToast(`Scan failed: ${err.message}`, "error");
  } finally {
    state.scanning = false;
    document.getElementById("btnScan").disabled = false;
    document.getElementById("btnGenerate").disabled = false;
    showProgress(false);
  }
};
