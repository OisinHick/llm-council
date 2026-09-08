# Stage 1: Build React Frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python Backend Runtime
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast package management and uvx MCP tool execution
RUN pip install --no-cache-dir uv

# Install backend dependencies
COPY pyproject.toml ./
RUN uv pip install --system -e .

# Copy application code and default configurations
COPY backend/ ./backend/
COPY mcp_servers.json ./mcp_servers.json
COPY README.md ./README.md

# Copy built frontend from frontend-builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create directory for persistent conversation data and settings
RUN mkdir -p /app/data

EXPOSE 8001

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8001"]
