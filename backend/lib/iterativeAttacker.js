const { generatePromptsForCategory, generateAdaptivePrompt } = require("./promptGenerator");
const { sendAttack } = require("./attacker");
const { analyzeResponse } = require("./analyzer");

/**
 * Run an iterative (session-aware) red team attack for a single OWASP category.
 *
 * Strategy:
 *   Round 1  — generate a fresh attack prompt for the category
 *   Round N  — if round N-1 was not vulnerable, generate an adaptive prompt
 *              that learns from all prior refusals and mutates the technique
 *
 * Stops early as soon as a vulnerability is confirmed, or when maxRounds is exhausted.
 *
 * @param {object} options
 * @param {string}   options.appContext      - Description of the target application
 * @param {object}   options.category        - OWASP category object { id, name, description, color }
 * @param {object}   options.targetRequest   - { method, url, headers, body, params }
 * @param {number}   options.maxRounds       - Max attempts before giving up (2–10)
 * @param {Function} options.onRound         - Async callback for SSE streaming: ({ type, round, ...data })
 *
 * @returns {{ success: boolean, foundAtRound: number|null, rounds: RoundResult[] }}
 */
async function runCategoryAttack({ appContext, category, targetRequest, maxRounds = 5, onRound }) {
  const history = [];

  // Round 1 uses the normal generator; later rounds use the adaptive generator
  let initialPrompts;
  try {
    initialPrompts = await generatePromptsForCategory(appContext, category.id, 1);
  } catch (err) {
    console.error(`[iterative] failed to generate initial prompt for ${category.id}:`, err.message);
    return { success: false, foundAtRound: null, rounds: [] };
  }

  let currentPrompt = initialPrompts[0];

  for (let round = 1; round <= maxRounds; round++) {
    // Notify: round is starting (prompt is ready, about to attack)
    if (onRound) {
      await onRound({ type: "round_start", round, prompt: currentPrompt });
    }

    // ── Attack ────────────────────────────────────────────────────────────
    let attackResult;
    try {
      attackResult = await sendAttack(targetRequest, currentPrompt.prompt);
    } catch (err) {
      attackResult = { success: false, error: err.message, response_body: null, status_code: null, elapsed_ms: 0 };
    }

    // ── Analyze ───────────────────────────────────────────────────────────
    let analysis;
    try {
      analysis = await analyzeResponse({
        appContext,
        attackPrompt: currentPrompt.prompt,
        attackCategory: category.id,
        attackTechnique: currentPrompt.technique,
        attackResponse: attackResult.response_body || attackResult.error,
      });
    } catch (err) {
      analysis = {
        vulnerable: false,
        owasp_category: null,
        owasp_name: null,
        severity: "none",
        confidence: "low",
        evidence: null,
        explanation: `Analysis failed: ${err.message}`,
      };
    }

    const roundRecord = { round, prompt: currentPrompt, attack: attackResult, analysis };
    history.push(roundRecord);

    // Notify: round result is in
    if (onRound) {
      await onRound({ type: "round_result", round, prompt: currentPrompt, attack: attackResult, analysis });
    }

    // ── Stop if vulnerable ────────────────────────────────────────────────
    if (analysis.vulnerable) {
      return { success: true, foundAtRound: round, rounds: history };
    }

    // ── Generate next adaptive prompt (if rounds remain) ──────────────────
    if (round < maxRounds) {
      try {
        currentPrompt = await generateAdaptivePrompt({ appContext, category, history });
      } catch (err) {
        console.error(`[iterative] adaptive prompt generation failed for ${category.id} round ${round + 1}:`, err.message);
        // Can't generate next prompt — stop early
        break;
      }
    }
  }

  return { success: false, foundAtRound: null, rounds: history };
}

module.exports = { runCategoryAttack };
