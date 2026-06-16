# LLM Council Frontend

This directory contains the React-based frontend for the LLM Council application, built on top of [Vite](https://vite.dev/).

The user interface is styled using vanilla CSS to provide a clean, modern, and highly interactive ChatGPT-like experience. It communicates with the FastAPI backend at `http://localhost:8001` via REST APIs and Server-Sent Events (SSE) for real-time streaming updates.

---

## Tech Stack

- **Framework**: [React](https://react.dev/) (Functional components with hooks)
- **Build Tool / Dev Server**: [Vite](https://vite.dev/)
- **Markdown Rendering**: `react-markdown` (for rendering rich model responses with correct code blocks)
- **API Client**: Standard `fetch` / `EventSource` (SSE) APIs
- **Package Manager**: `npm`

---

## Setup & Running

1. **Install Dependencies**:
   Ensure you have [Node.js](https://nodejs.org/) installed, then run:
   ```bash
   npm install
   ```

2. **Run Development Server**:
   Start the local development server (runs on port **5173** by default):
   ```bash
   npm run dev
   ```

3. **Production Build** (Optional):
   Compile a minified production build in the `dist/` directory:
   ```bash
   npm run build
   ```

---

## Directory & File Structure

```
frontend/
├── README.md             # This documentation file
├── package.json          # Node dependencies and scripts
├── index.html            # Main HTML entry point
├── src/
│   ├── main.jsx          # Mounts the React application
│   ├── App.jsx           # Orchestrates state, API polling, and SSE listeners
│   ├── App.css           # Global layout styles
│   ├── index.css         # Styling variables, resets, and markdown helpers
│   ├── api.js            # Fetch wrappers for communication with the backend
│   └── components/       # UI Components
│       ├── Sidebar.jsx          # Handles conversation list and history
│       ├── Sidebar.css          # Sidebar styles (scrollbars, active states)
│       ├── ChatInterface.jsx    # Primary workspace (input, loading state, action plans)
│       ├── ChatInterface.css    # Message bubbles, markdown layouts, action-card styles
│       ├── Stage1.jsx           # Renders Stage 1 individual model responses in a tabbed panel
│       ├── Stage1.css           # Tab styles, active/inactive indicators
│       ├── Stage2.jsx           # Renders Stage 2 peer reviews and de-anonymized aggregate rankings
│       ├── Stage2.css           # Evaluation layouts, badges, and scorecards
│       └── Stage3.jsx           # Renders Stage 3 final response with chairman styling
│           └── Stage3.css       # Green-tinted container styles
```

---

## Key UI/UX Features

### 1. Real-Time Streaming (SSE)
When a message is sent or an action plan is executed, `App.jsx` establishes an SSE connection to the backend stream `/api/conversations/{id}/message/stream` (or `/api/action/stream`). The UI shows live state transitions:
- `stage1_start` / `stage1_complete`
- `stage2_start` / `stage2_complete`
- `stage3_start` / `stage3_complete`
- `stage4_start` / `stage4_action_plan`
- `execution_start` / `execution_complete`

### 2. Client-Side De-Anonymization
In Stage 2, council models judge each other anonymously (using labels "Response A", "Response B", etc.) to prevent bias. 
The frontend uses the mapping `label_to_model` sent by the backend to **de-anonymize** the rankings for the user, rendering actual model identifiers (e.g. **gpt-4o-mini**) in bold text, while displaying an explanatory note that the models evaluated them without knowing their names.

### 3. Interactive Action execution
When the user requests an action (e.g., "Scan local ports"), and the request has `execute: false` (or is loaded from history without execution), the frontend renders a clean "Action Card" detailing:
- The generated plan description and reasoning.
- The list of tools (e.g., `execute_command`, `write_file`) and their parameters.
- A **"Run Action Plan"** button that calls the backend endpoint `/api/action/execute/stream` to execute the actions and stream the execution log back.

---

## Backend Integration

The frontend assumes the FastAPI backend is running on `http://localhost:8001`. If the backend runs on a different port, update the API base URL configuration in `src/api.js`.
