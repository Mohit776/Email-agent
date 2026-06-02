"""
Pydantic models for API request/response schemas.
"""

from pydantic import BaseModel


class ProfileResult(BaseModel):
    """A single LinkedIn profile with extracted info."""
    name: str = ""
    headline: str = ""
    location: str = ""
    current_company: str = ""
    linkedin_url: str = ""
    email: str = ""
    phone: str = ""
    websites: list[str] = []
    experience_summary: str = ""
    education_summary: str = ""
    skills: list[str] = []


class KeywordSearchResult(BaseModel):
    """Results for a single keyword search."""
    keyword: str
    profiles: list[ProfileResult] = []
    count: int = 0


class SearchResponse(BaseModel):
    """Full search response across all keywords."""
    results: list[KeywordSearchResult] = []
    total_profiles: int = 0
    search_duration_seconds: float = 0.0
    status: str = "completed"
    error: str | None = None
