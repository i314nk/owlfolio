"""Strategy-driven agents (discovery, etc.)

These are agentic, non-deterministic LLM-driven flows that operate above
the specialist pipeline. They use a scoped MCP tool surface so the model
can only do strategy-relevant things (no shell access, no file writes,
no portfolio mutation).
"""
