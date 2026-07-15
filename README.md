# AI Red Teamer

An OWASP LLM Top 10 vulnerability scanner for LLM-integrated applications. It uses AWS Bedrock (Claude) to **generate** context-aware red team attack prompts, **launch** them against a target application, **analyze** the responses for vulnerabilities, and produce shareable HTML reports.

## Features

- **Context-aware prompt generation** — describe your app and the tool crafts realistic attacks tailored to it.
- **OWASP LLM Top 10 coverage** — organized by category:
  - `LLM01` Prompt Injection
  - `LLM02` Insecure Output Handling
  - `LLM04` Model Denial of Service
  - `LLM06` Sensitive Information Disclosure
  - `LLM07` Insecure Plugin Design
  - `LLM08` Excessive Agency
  - `LLM09` Overreliance
- **Automated attacking** — sends generated prompts to a target endpoint.
- **AI-powered analysis** — scores each response and flags likely vulnerabilities.
- **HTML reports** — self-contained reports saved under `reports/`.
- **Simple web UI** — vanilla HTML/CSS/JS frontend served by the backend.

## Architecture

```
red-teamer/
├── backend/          # Node.js + Express API
│   ├── server.js     # API routes + static frontend serving
│   └── lib/
│       ├── bedrock.js          # AWS Bedrock client wrapper
│       ├── promptGenerator.js  # OWASP prompt generation
│       ├── attacker.js         # Sends attacks to target
│       ├── analyzer.js         # Analyzes responses for vulnerabilities
│       └── reports.js          # HTML report generation
├── frontend/         # Static web UI (index.html, app.js, style.css)
└── reports/          # Generated HTML reports (git-ignored)
```

## Prerequisites

- Node.js 18+
- AWS account with Amazon Bedrock access and the target Claude model enabled
- AWS credentials available in your environment (via `aws configure` / `AWS_PROFILE`, or static keys)

## Setup

```bash
cd backend
npm install
cp .env.example .env   # then edit as needed
```

### Environment variables

See `backend/.env.example`. Key settings:

| Variable | Description |
| --- | --- |
| `AWS_REGION` | Bedrock region (e.g. `us-east-1`) |
| `AWS_PROFILE` | Optional named AWS profile |
| `BEDROCK_MODEL_ID` | Model used for generation & analysis |
| `PORT` | Backend port (default `3001`) |
| `MAX_PROMPTS_PER_CATEGORY` | Max prompts generated per category |
| `ATTACK_TIMEOUT_MS` | Per-attack request timeout |

## Running

```bash
cd backend
npm start        # or: npm run dev  (watch mode)
```

Then open the UI at `http://localhost:3001`.

## Disclaimer

This tool is intended for **authorized security testing only**. Only run it against applications you own or have explicit permission to test. You are responsible for complying with all applicable laws and terms of service.
