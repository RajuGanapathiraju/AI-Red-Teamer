# AI Red Teamer

An OWASP LLM Top 10 vulnerability scanner for LLM-integrated applications. Uses AWS Bedrock (Claude) to **generate** context-aware red team attack prompts, **fire** them at a target endpoint, **analyze** responses for vulnerabilities, and produce shareable HTML reports — with two scan modes: a basic breadth scan and an adaptive session-aware scan.

## Features

- **Two scan modes** — Basic (breadth) and Adaptive (session-aware)
- **Context-aware prompt generation** — describe your app and Claude crafts realistic, targeted attacks
- **OWASP LLM Top 10 coverage**:
  - `LLM01` Prompt Injection
  - `LLM02` Insecure Output Handling
  - `LLM03` Training Data Poisoning
  - `LLM04` Model Denial of Service
  - `LLM05` Supply Chain Vulnerabilities
  - `LLM06` Sensitive Information Disclosure
  - `LLM07` Insecure Plugin Design
  - `LLM08` Excessive Agency
  - `LLM09` Overreliance
  - `LLM10` Model Theft / Extraction
- **Agentic / Tool-Use coverage** (for agents with tool access & write capabilities):
  - `AGT01` Tool / Function Misuse
  - `AGT02` Confirmation Bypass
  - `AGT03` Multi-Step Action Chaining
  - `AGT04` Privilege Escalation via Tools
  - `AGT05` Rate / Volume Limit Bypass
  - `AGT06` Cross-Tenant Data Access
  - `AGT07` Memory / Session Poisoning
- **Dual-model pipeline** — Claude Opus 4.8 generates attacks, Claude Sonnet 5 analyzes responses
- **Real-time streaming** — results stream live via Server-Sent Events (SSE)
- **HTML reports** — auto-saved after every scan, viewable and downloadable from the UI
- **Burp-compatible header input** — paste raw headers directly from Burp Repeater

## Scan Modes

### Basic Scan
Generate a batch of attack prompts upfront, review them, then fire all of them sequentially.

1. Set **Prompts per category** (1–5)
2. Click **Generate Prompts** — review in the Attack Prompts tab
3. Click **Basic Scan** — streams results live in the Scan Results tab

### Adaptive Scan
Session-aware scanning. No pre-generation needed — prompts are generated and mutated on the fly.

1. Set **Max rounds per category** (2–10, default 5)
2. Click **Adaptive Scan**

For each selected category:
- **Round 1** — generates a fresh, context-aware attack
- **If defended** → reads the app's refusal/response, mutates the technique, tries again (marked **Adaptive**)
- **Stops early** as soon as a vulnerability is found for that category
- Continues until vulnerable or max rounds exhausted

Results show a round-by-round timeline per category. The model learns from each failed attempt — if direct injection was blocked, it automatically switches to roleplay, encoding, indirect injection, multi-step attacks, etc.

| | Basic | Adaptive |
|---|---|---|
| Pre-generate prompts | Yes | No |
| Adapts to defenses | No | Yes |
| Stops early on vuln | No | Yes (per category) |
| Cost | Fixed | Variable (up to maxRounds × categories) |

## Architecture

```
red-teamer/
├── backend/
│   ├── server.js                # Express API + SSE endpoints
│   └── lib/
│       ├── bedrock.js           # AWS Bedrock Converse API client
│       ├── promptGenerator.js   # Standard + adaptive prompt generation
│       ├── iterativeAttacker.js # Iterative session loop (per-category)
│       ├── attacker.js          # HTTP attack sender with {{INPUT}} injection
│       ├── analyzer.js          # Response vulnerability analysis + summary
│       └── reports.js           # HTML report generation and storage
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── reports/                     # Auto-saved HTML reports (git-ignored)
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Backend status + active models |
| `GET` | `/api/categories` | OWASP category metadata |
| `POST` | `/api/generate-prompts` | Generate attack prompts for selected categories |
| `POST` | `/api/run-attack` | Send a single attack to the target |
| `POST` | `/api/analyze` | Analyze a single response for vulnerabilities |
| `POST` | `/api/scan` | Basic scan — SSE stream of attack + analysis results |
| `POST` | `/api/iterative-scan` | Adaptive scan — SSE stream per round |
| `GET` | `/api/reports` | List saved report metadata |

## Prerequisites

- Node.js 18+
- AWS account with Amazon Bedrock access
- Both models enabled in your region:
  - `us.anthropic.claude-opus-4-8` (generator)
  - `us.anthropic.claude-sonnet-5` (analyzer)
- AWS credentials configured via `aws configure` or `AWS_PROFILE`

## Setup

```bash
cd backend
npm install
```

No `.env` file is required — all settings have defaults. Create one from the example only if you need to override:

```bash
cp .env.example .env
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `AWS_REGION` | `us-east-1` | Bedrock region |
| `AWS_PROFILE` | _(shell default)_ | Named AWS profile |
| `GENERATOR_MODEL_ID` | `us.anthropic.claude-opus-4-8` | Model for attack generation |
| `ANALYZER_MODEL_ID` | `us.anthropic.claude-sonnet-5` | Model for response analysis |
| `PORT` | `3001` | Backend server port |
| `MAX_PROMPTS_PER_CATEGORY` | `3` | Default prompts per category |
| `ATTACK_TIMEOUT_MS` | `30000` | Per-attack HTTP timeout |

## Running

```bash
cd backend
npm start        # production
npm run dev      # watch mode (Node.js 18+)
```

Open **http://localhost:3001** in your browser.

## Usage

1. **Target** — give the target agent / application a name (shown in the summary and saved reports)
2. **Application Context** — describe the target LLM app in plain English (what it does, what data it accesses, what it should/shouldn't do)
3. **Target Request** — enter the endpoint URL, HTTP method, headers (Burp format supported), and JSON body with `{{INPUT}}` where the attack prompt should be injected
4. **Select categories** — pick specific categories (OWASP LLM Top 10 and/or Agentic) or leave all unchecked to test everything
5. **Choose scan mode** and run

## Disclaimer

This tool is intended for **authorized security testing only**. Only run it against applications you own or have explicit written permission to test. You are responsible for complying with all applicable laws and terms of service.
