"""
FastAPI application for LinkedIn AI Profile Finder.

Endpoints:
- POST /api/search       — Run full search across all keywords
- GET  /api/keywords     — Return the hardcoded keyword list
- GET  /api/health       — Health check
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import KEYWORDS, GROQ_API_KEY, LINKEDIN_MCP_URL
from models import SearchResponse
from agent import run_full_search

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# --- App ---
app = FastAPI(
    title="LinkedIn AI Profile Finder",
    description="AI-powered LinkedIn profile search using Agno + Groq + LinkedIn MCP",
    version="0.1.0",
)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- In-memory state for search results ---
search_state = {
    "is_running": False,
    "current_keyword": "",
    "progress": 0,
    "total": 0,
    "latest_result": None,
}


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "groq_configured": bool(GROQ_API_KEY and GROQ_API_KEY != "your-groq-api-key-here"),
        "mcp_url": LINKEDIN_MCP_URL,
        "keywords_count": len(KEYWORDS),
    }


@app.get("/api/keywords")
async def get_keywords():
    """Return the hardcoded keyword list."""
    return {"keywords": KEYWORDS}


@app.get("/api/search/status")
async def get_search_status():
    """Get current search progress."""
    return {
        "is_running": search_state["is_running"],
        "current_keyword": search_state["current_keyword"],
        "progress": search_state["progress"],
        "total": search_state["total"],
        "has_results": search_state["latest_result"] is not None,
    }


@app.get("/api/search/results")
async def get_search_results():
    """Get the latest search results."""
    if search_state["latest_result"] is None:
        return JSONResponse(
            status_code=404,
            content={"error": "No search results available. Run POST /api/search first."},
        )
    return search_state["latest_result"]


async def _progress_callback(keyword: str, index: int, total: int):
    """Update search progress state."""
    search_state["current_keyword"] = keyword
    search_state["progress"] = index
    search_state["total"] = total
    logger.info(f"Progress: [{index + 1}/{total}] Searching '{keyword}'")


async def _run_search_task(keywords: list[str] | None = None):
    """Background task that runs the full search."""
    search_state["is_running"] = True
    search_state["latest_result"] = None

    try:
        result = await run_full_search(
            keywords=keywords,
            progress_callback=_progress_callback,
        )
        search_state["latest_result"] = result.model_dump()
    except Exception as e:
        logger.error(f"Search task failed: {e}")
        search_state["latest_result"] = SearchResponse(
            status="error",
            error=str(e),
        ).model_dump()
    finally:
        search_state["is_running"] = False
        search_state["current_keyword"] = ""


@app.post("/api/search")
async def start_search(background_tasks: BackgroundTasks):
    """
    Start a full LinkedIn profile search across all keywords.

    The search runs in the background. Use GET /api/search/status to
    check progress and GET /api/search/results to get the final results.
    """
    if search_state["is_running"]:
        return JSONResponse(
            status_code=409,
            content={"error": "A search is already in progress. Check /api/search/status"},
        )

    if not GROQ_API_KEY or GROQ_API_KEY == "your-groq-api-key-here":
        return JSONResponse(
            status_code=400,
            content={"error": "GROQ_API_KEY not configured. Set it in backend/.env"},
        )

    background_tasks.add_task(_run_search_task)

    return {
        "status": "started",
        "message": f"Search started for {len(KEYWORDS)} keywords. Poll /api/search/status for progress.",
        "keywords": KEYWORDS,
    }


@app.post("/api/search/sync")
async def search_sync():
    """
    Run a synchronous search (waits for full completion).
    Use this for testing; use POST /api/search for production.
    """
    if search_state["is_running"]:
        return JSONResponse(
            status_code=409,
            content={"error": "A search is already in progress."},
        )

    if not GROQ_API_KEY or GROQ_API_KEY == "your-groq-api-key-here":
        return JSONResponse(
            status_code=400,
            content={"error": "GROQ_API_KEY not configured. Set it in backend/.env"},
        )

    search_state["is_running"] = True
    try:
        result = await run_full_search(progress_callback=_progress_callback)
        search_state["latest_result"] = result.model_dump()
        return result
    finally:
        search_state["is_running"] = False
