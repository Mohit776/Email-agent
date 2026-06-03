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
from models import BriefResult, ProfileResult, SearchResponse
from agent import run_full_search
from brief_agent import generate_brief

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

# --- Mock profiles DB (for testing without LinkedIn MCP) ---
MOCK_PROFILES: list[ProfileResult] = [
    ProfileResult(
        name="Sophia Reeves",
        headline="Head of SEO & Organic Growth · Casino & Sports Betting",
        location="Sliema, Malta",
        current_company="BetCore Group",
        linkedin_url="https://www.linkedin.com/in/sophia-reeves-seo/",
        email="s.reeves@betcore.com",
        skills=["Technical SEO", "Content Strategy", "Link Building", "GA4", "Ahrefs"],
        experience_summary="8 years in iGaming SEO. Previously at LeoVegas and 888 Holdings.",
    ),
    ProfileResult(
        name="Marco Dimitriou",
        headline="Affiliate Program Manager | iGaming | CPA & RevShare Networks",
        location="Nicosia, Cyprus",
        current_company="SpinWin Media",
        linkedin_url="https://www.linkedin.com/in/marco-dimitriou-affiliates/",
        email="marco.d@spinwinmedia.io",
        skills=["Affiliate Marketing", "Revenue Share", "Partner Management", "Tracking Platforms"],
        experience_summary="6 years managing affiliate networks for online casino brands across EU markets.",
    ),
    ProfileResult(
        name="Aisha Ndungu",
        headline="iGaming Growth Lead | User Acquisition | Africa & LATAM Markets",
        location="Nairobi, Kenya",
        current_company="FairPlay Digital",
        linkedin_url="https://www.linkedin.com/in/aisha-ndungu-growth/",
        email="",
        phone="+254 700 123456",
        skills=["Growth Hacking", "Paid Media", "SEO", "Localisation", "Analytics"],
        experience_summary="Scaling FairPlay across 12 African countries. Previously growth lead at Betway Africa.",
    ),
    ProfileResult(
        name="Liam Hartley",
        headline="Gambling SEO Manager | Content & Technical SEO for Tier-1 Casino Brands",
        location="Dublin, Ireland",
        current_company="Rank Group Digital",
        linkedin_url="https://www.linkedin.com/in/liam-hartley-gambling-seo/",
        email="liam.hartley@rankgroup.ie",
        skills=["Gambling SEO", "Core Web Vitals", "Schema Markup", "Surfer SEO", "Python"],
        experience_summary="5 years focused on regulated gambling SEO in UK/IE. Expert in E-E-A-T compliance.",
    ),
    ProfileResult(
        name="Elena Popescu",
        headline="VP Marketing | Online Casino | CRM & Retention Specialist",
        location="Bucharest, Romania",
        current_company="AceCasino.ro",
        linkedin_url="https://www.linkedin.com/in/elena-popescu-casino/",
        email="e.popescu@acecasino.ro",
        skills=["CRM", "Email Marketing", "Retention", "Bonus Strategy", "SEO"],
        experience_summary="10 years in online gaming marketing. Strong focus on player LTV and retention loops.",
    ),
]



# ── New endpoints ─────────────────────────────────────────────────────────────

@app.post("/api/brief", response_model=BriefResult)
async def get_brief(profile: ProfileResult):
    """
    Generate an AI mini-brief for a single LinkedIn profile.
    Calls Groq LLM and returns a structured BriefResult.
    """
    return await generate_brief(profile)


@app.post("/api/briefs/batch", response_model=list[BriefResult])
async def get_briefs_batch(profiles: list[ProfileResult]):
    """
    Generate AI briefs for multiple profiles concurrently.
    Returns a list of BriefResult in the same order as the input.
    """
    import asyncio
    tasks = [generate_brief(p) for p in profiles]
    results = await asyncio.gather(*tasks)
    return list(results)


@app.get("/api/mock-profiles", response_model=list[ProfileResult])
async def get_mock_profiles():
    """
    Return the in-memory seed profiles for testing without LinkedIn MCP.
    """
    return MOCK_PROFILES


@app.get("/api/debug/raw-profile/{username}")
async def debug_raw_profile(username: str):
    """
    Debug endpoint: returns the RAW MCP response for a LinkedIn username.
    Shows exactly what sections LinkedIn returns (contact_info, experience, etc.)
    Useful for diagnosing missing contact info.
    """
    from agno.tools.mcp import MCPTools

    mcp_tools = MCPTools(
        transport="streamable-http",
        url=LINKEDIN_MCP_URL,
        timeout_seconds=60,
    )
    try:
        await mcp_tools.connect()
        raw_result = await mcp_tools.session.call_tool(
            "get_person_profile",
            {"linkedin_username": username, "sections": "contact_info,experience,skills"},
        )

        # Normalise the raw result into something JSON-serialisable
        if isinstance(raw_result, dict):
            return {"source": "dict", "data": raw_result}
        elif hasattr(raw_result, "content"):
            import json as _json
            items = []
            for item in raw_result.content:
                if getattr(item, "type", "") == "text":
                    try:
                        items.append({"type": "text", "parsed": _json.loads(item.text)})
                    except Exception:
                        items.append({"type": "text", "raw": item.text[:2000]})
            return {"source": "TextContent", "items": items}
        else:
            return {"source": "other", "raw": str(raw_result)[:3000]}
    finally:
        try:
            await mcp_tools.close()
        except Exception:
            pass


# ── Existing endpoints ─────────────────────────────────────────────────────────

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
