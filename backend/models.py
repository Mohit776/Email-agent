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


class BriefResult(BaseModel):
    """AI-generated mini brief about a LinkedIn profile."""
    who_they_are: str = ""
    what_company_does: str = ""
    why_approach: str = ""
    likely_pain_point: str = ""
    best_outreach_angle: str = ""
    suggested_service: str = ""
    generated: bool = False


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


# --- Email outreach models ---

class EmailRecipient(BaseModel):
    """A single profile + its brief, packaged for emailing."""
    profile: ProfileResult
    brief: BriefResult | None = None
    # Optional override: use this address instead of profile.email
    override_email: str = ""


class SendEmailsRequest(BaseModel):
    """Request body for POST /api/send-emails."""
    recipients: list[EmailRecipient]
    # Sender credentials (overrides .env if provided)
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_from_name: str = ""


class EmailSendResult(BaseModel):
    """Result for a single recipient."""
    name: str
    email: str
    status: str          # "sent" | "skipped" | "failed"
    reason: str = ""


class SendEmailsResponse(BaseModel):
    """Response from POST /api/send-emails."""
    sent: int = 0
    skipped: int = 0
    failed: int = 0
    results: list[EmailSendResult] = []

