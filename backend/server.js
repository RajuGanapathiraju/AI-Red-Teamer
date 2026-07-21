require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const { generateAllPrompts, generatePromptsForCategory, OWASP_CATEGORIES } = require("./lib/promptGenerator");
const { sendAttack } = require("./lib/attacker");
const { analyzeResponse, generateScanSummary } = require("./lib/analyzer");
const { GENERATOR_MODEL, ANALYZER_MODEL } = require("./lib/bedrock");
const { saveReport, listReports, getReportPath, REPORTS_DIR } = require("./lib/reports");
const { runCategoryAttack } = require("./lib/iterativeAttacker");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/reports", express.static(REPORTS_DIR)); // serve HTML reports directly

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    generator_model: GENERATOR_MODEL,
    analyzer_model: ANALYZER_MODEL,
    region: process.env.AWS_REGION || "us-east-1",
  });
});

// ─── OWASP categories metadata ────────────────────────────────────────────────

app.get("/api/categories", (req, res) => {
  res.json(OWASP_CATEGORIES);
});

// ─── Generate red team prompts ────────────────────────────────────────────────
// POST /api/generate-prompts
// Body: { appContext: string, categories: string[], countPerCategory: number }

app.post("/api/generate-prompts", async (req, res) => {
  const { appContext, categories = [], countPerCategory = 3 } = req.body;

  if (!appContext || typeof appContext !== "string" || appContext.trim().length < 10) {
    return res.status(400).json({ error: "appContext must be at least 10 characters." });
  }

  const count = Math.min(Math.max(parseInt(countPerCategory, 10) || 3, 1), 5);

  try {
    const { prompts, errors } = await generateAllPrompts(appContext.trim(), categories, count);
    if (errors.length) {
      console.error("[generate-prompts] category errors:", JSON.stringify(errors, null, 2));
    }
    res.json({ prompts, errors, total: prompts.length });
  } catch (err) {
    console.error("[generate-prompts] error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Run a single attack ──────────────────────────────────────────────────────
// POST /api/run-attack
// Body: { targetRequest: object, prompt: string }

app.post("/api/run-attack", async (req, res) => {
  const { targetRequest, prompt } = req.body;

  if (!targetRequest || !targetRequest.url) {
    return res.status(400).json({ error: "targetRequest.url is required." });
  }
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt is required." });
  }

  try {
    const result = await sendAttack(targetRequest, prompt);
    res.json(result);
  } catch (err) {
    console.error("[run-attack] error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Analyze a single response ────────────────────────────────────────────────
// POST /api/analyze
// Body: { appContext, attackPrompt, attackCategory, attackTechnique, attackResponse }

app.post("/api/analyze", async (req, res) => {
  const { appContext, attackPrompt, attackCategory, attackTechnique, attackResponse } = req.body;

  if (!appContext || !attackPrompt || !attackResponse) {
    return res.status(400).json({ error: "appContext, attackPrompt, and attackResponse are required." });
  }

  try {
    const analysis = await analyzeResponse({ appContext, attackPrompt, attackCategory, attackTechnique, attackResponse });
    res.json(analysis);
  } catch (err) {
    console.error("[analyze] error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Full scan (attack + analyze for each prompt) ─────────────────────────────
// POST /api/scan
// Body: { appContext, targetRequest, prompts: PromptObject[] }
// Streams results via SSE

app.post("/api/scan", async (req, res) => {
  const { appContext, targetRequest, prompts, targetName } = req.body;

  if (!appContext || !targetRequest?.url || !Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: "appContext, targetRequest, and prompts[] are required." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("start", { total: prompts.length });

  const allResults = [];

  for (let i = 0; i < prompts.length; i++) {
    const promptObj = prompts[i];
    send("progress", { index: i, id: promptObj.id, status: "attacking", title: promptObj.title });

    let attackResult;
    try {
      attackResult = await sendAttack(targetRequest, promptObj.prompt);
    } catch (err) {
      attackResult = { success: false, error: err.message, response_body: null };
    }

    send("progress", { index: i, id: promptObj.id, status: "analyzing" });

    let analysis = null;
    if (attackResult.response_body || attackResult.error) {
      analysis = await analyzeResponse({
        appContext,
        attackPrompt: promptObj.prompt,
        attackCategory: promptObj.category,
        attackTechnique: promptObj.technique,
        attackResponse: attackResult.response_body || attackResult.error,
      });
    }

    const result = { prompt: promptObj, attack: attackResult, analysis };
    allResults.push(result);

    send("result", { index: i, result });
  }

  // Generate summary
  send("progress", { status: "summarizing" });
  const summary = await generateScanSummary({ appContext, results: allResults });
  send("summary", { summary });

  // Auto-save report to disk
  try {
    const meta = saveReport({ appContext, targetRequest, prompts, results: allResults, summary, targetName });
    send("saved", { filename: meta.filename, id: meta.id });
  } catch (err) {
    console.error("[scan] report save failed:", err.message);
  }

  send("done", { total: prompts.length, vulnerable: allResults.filter((r) => r.analysis?.vulnerable).length });

  res.end();
});

// ─── Reports ──────────────────────────────────────────────────────────────────

// GET /api/reports — list all saved reports (metadata from index.json)
app.get("/api/reports", (req, res) => {
  try { res.json(listReports()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// HTML reports are served as static files via /reports/:filename
// (handled by express.static above — no extra route needed)

// ─── Iterative scan (per-category adaptive attack loop) ───────────────────────
// POST /api/iterative-scan
// Body: { appContext, targetRequest, categories: string[], maxRounds: number }
// Streams via SSE:
//   start         { totalCategories }
//   category_start{ category, categoryName, categoryColor }
//   round_start   { category, round, prompt }
//   round_result  { category, round, prompt, attack, analysis }
//   category_done { category, success, foundAtRound, totalRounds }
//   summary       { summary }
//   saved         { filename, id }
//   done          { totalCategories, vulnerable, totalRoundsUsed }

app.post("/api/iterative-scan", async (req, res) => {
  const { appContext, targetRequest, categories = [], maxRounds = 5, targetName } = req.body;

  if (!appContext || typeof appContext !== "string" || appContext.trim().length < 10) {
    return res.status(400).json({ error: "appContext must be at least 10 characters." });
  }
  if (!targetRequest?.url) {
    return res.status(400).json({ error: "targetRequest.url is required." });
  }

  const rounds = Math.min(Math.max(parseInt(maxRounds, 10) || 5, 2), 10);

  const categoriesToTest = (
    categories.length > 0
      ? categories.filter((c) => OWASP_CATEGORIES[c])
      : Object.keys(OWASP_CATEGORIES)
  ).map((id) => OWASP_CATEGORIES[id]);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("start", { totalCategories: categoriesToTest.length });

  const allCategoryResults = [];
  let totalRoundsUsed = 0;
  let totalVulnerable = 0;

  for (const category of categoriesToTest) {
    send("category_start", { category: category.id, categoryName: category.name, categoryColor: category.color });

    const categoryResult = await runCategoryAttack({
      appContext: appContext.trim(),
      category,
      targetRequest,
      maxRounds: rounds,
      onRound: async ({ type, round, prompt, attack, analysis }) => {
        if (type === "round_start") {
          send("round_start", { category: category.id, round, prompt });
        } else if (type === "round_result") {
          send("round_result", { category: category.id, round, prompt, attack, analysis });
        }
      },
    });

    totalRoundsUsed += categoryResult.rounds.length;
    if (categoryResult.success) totalVulnerable++;

    allCategoryResults.push({ category, ...categoryResult });

    send("category_done", {
      category: category.id,
      success: categoryResult.success,
      foundAtRound: categoryResult.foundAtRound,
      totalRounds: categoryResult.rounds.length,
    });
  }

  // Executive summary across all rounds
  send("progress", { status: "summarizing" });

  const flatResults = allCategoryResults.flatMap((cr) =>
    cr.rounds.map((r) => ({ prompt: r.prompt, attack: r.attack, analysis: r.analysis }))
  );

  const summary = await generateScanSummary({ appContext: appContext.trim(), results: flatResults });
  send("summary", { summary });

  // Save report
  try {
    const allPrompts = flatResults.map((r) => r.prompt);
    const meta = saveReport({ appContext: appContext.trim(), targetRequest, prompts: allPrompts, results: flatResults, summary, targetName });
    send("saved", { filename: meta.filename, id: meta.id });
  } catch (err) {
    console.error("[iterative-scan] report save failed:", err.message);
  }

  send("done", {
    totalCategories: categoriesToTest.length,
    vulnerable: totalVulnerable,
    totalRoundsUsed,
  });

  res.end();
});

// ─── Serve frontend ───────────────────────────────────────────────────────────

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🔴 AI Red Teamer backend running at http://localhost:${PORT}`);
  console.log(`   Generator : ${GENERATOR_MODEL}`);
  console.log(`   Analyzer  : ${ANALYZER_MODEL}`);
  console.log(`   Region    : ${process.env.AWS_REGION || "us-east-1"}\n`);
});
