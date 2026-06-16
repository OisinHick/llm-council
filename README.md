# LLM Council

![llmcouncil](header.jpg)

The idea of this repo is that instead of asking a question to your favorite LLM provider (e.g., OpenAI GPT-4o, Google Gemini 2.5 Pro, Anthropic Claude 3.5 Sonnet, Meta Llama 3.3, etc.), you can group them into your "LLM Council". This repo is a simple, local web app that essentially looks like ChatGPT, except it uses OpenRouter to send your query to multiple LLMs, asks them to review and rank each other's work anonymized, and finally compiles a synthesized final response using a Chairman LLM.

Additionally, LLM Council supports **Stage 4 Action Execution** using the Model Context Protocol (MCP) to turn the council's recommendations into executable system tools, CLI commands, file operations, or API calls.

## How it Works

When you submit a query or task, the system orchestrates a 4-stage workflow:

1. **Stage 1: First Opinions**: The query is sent to all council models individually. Their responses are collected and shown in a tabbed view, allowing you to inspect each output.
2. **Stage 2: Peer Review**: Each model evaluates and ranks all other responses. The identities of the models are anonymized (labeled as Response A, B, etc.) during this stage to prevent favoritism.
3. **Stage 3: Final Synthesis**: The designated **Chairman LLM** takes all individual responses and peer reviews, then synthesizes them into a single, cohesive final answer.
4. **Stage 4: Action Execution (Optional)**: For action-oriented requests, the top-voted approach is analyzed, and the Chairman generates specific tool calls (shell commands, file reads/writes, or API requests) which can be executed directly or reviewed in the UI.

---

## Documentation Index

- **[Main README](README.md)**: Project overview and setup instructions.
- **[MCP Integration Guide](MCP_INTEGRATION.md)**: Detailed technical specifications for Stage 4 action execution.
- **[Quick Start: MCP Integration](QUICKSTART_MCP.md)**: Hands-on tutorials for running and testing the action flow.
- **[Developer Guidelines (CLAUDE.md)](CLAUDE.md)**: Architecture details, API endpoints, and common development patterns.
- **[Frontend Guide (frontend/README.md)](frontend/README.md)**: Directory layout, component design, and interface explanation.

---

## Vibe Code Alert

This project was 99% vibe coded as a fun Saturday hack because I wanted to explore and evaluate a number of LLMs side by side in the process of [reading books together with LLMs](https://x.com/karpathy/status/1990577951671509438). It's nice and useful to see multiple responses side by side, and also the cross-opinions of all LLMs on each other's outputs. I'm not going to support it in any way, it's provided here as is for other people's inspiration and I don't intend to improve it. Code is ephemeral now and libraries are over, ask your LLM to change it in whatever way you like.

---

## Setup

### 1. Install Dependencies

The project uses [uv](https://docs.astral.sh/uv/) for Python dependency management.

**Backend:**
```bash
uv sync
```

**Frontend:**
```bash
cd frontend
npm install
cd ..
```

### 2. Configure API Key

Create a `.env` file in the project root:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Get your API key at [openrouter.ai](https://openrouter.ai/). Make sure to purchase credits or configure automatic top-ups.

### 3. Configure Models (Optional)

Edit `backend/config.py` to customize the council members and the Chairman:

```python
# Council members - list of OpenRouter model identifiers
COUNCIL_MODELS = [
    "openai/gpt-4o-mini",
    "google/gemini-2.5-flash",
    "anthropic/claude-3.5-haiku",
    "meta-llama/llama-3.3-70b-instruct",
]

# Chairman that synthesizes results and generates tool actions
CHAIRMAN_MODEL = "google/gemini-2.5-flash"
```

---

## Running the Application

**Option 1: Use the start script**
```bash
./start.sh
```

**Option 2: Run manually**

Terminal 1 (Backend - runs on port **8001**):
```bash
uv run python -m backend.main
```

Terminal 2 (Frontend - runs on port **5173**):
```bash
cd frontend
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Tech Stack

- **Backend:** FastAPI (Python 3.10+), async httpx, OpenRouter API
- **Frontend:** React + Vite, CSS, ReactMarkdown
- **Storage:** local JSON files in `data/conversations/`
- **Package Management:** `uv` for Python, `npm` for JavaScript

