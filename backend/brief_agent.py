"""
brief_agent.py — LLM-powered profile brief generator and parser.

1. parse_profile_with_llm  — raw MCP text → clean ProfileResult
2. generate_brief          — ProfileResult → sales-intelligence BriefResult
"""

import json
import logging
import re

from groq import AsyncGroq

from config import GROQ_API_KEY
from models import BriefResult, ProfileResult

logger = logging.getLogger(__name__)

_groq_client = AsyncGroq(api_key=GROQ_API_KEY)

# ── Profile Parser ────────────────────────────────────────────────────────────

_PARSE_SYSTEM_PROMPT = """\
You are a LinkedIn profile data extractor.  You receive raw scraped text
(which may contain JSON fragments, innerText dumps, or mixed content) from
a LinkedIn profile page.

Extract ONLY the facts that are explicitly present.  Do NOT invent data.
Return **valid JSON only** with exactly this structure:

{
  "name": "Full name of the person",
  "headline": "Their professional headline / tagline",
  "location": "City, Country or region",
  "current_company": "Current employer name",
  "email": "Email if found, else empty string",
  "phone": "Phone if found, else empty string",
  "websites": ["list of non-linkedin URLs found"],
  "experience_summary": "1-2 sentence summary of their work experience",
  "education_summary": "1 sentence summary of education",
  "skills": ["up to 10 key skills"]
}

Rules:
- If a field is not present in the raw text, use "" or [].
- For experience_summary, condense their jobs into 1-2 sentences.
- For skills, list only explicitly mentioned skills (not inferred).
- Do NOT include LinkedIn URLs in the websites list.
- Return ONLY the JSON object, no markdown, no explanation.
"""


async def parse_profile_with_llm(raw_text: str, linkedin_url: str = "") -> ProfileResult:
    """
    Send raw MCP profile text to Groq and get back a clean ProfileResult.
    Falls back to basic regex parsing if the LLM call fails.
    """
    # Truncate to avoid token limits (LinkedIn pages can be huge)
    truncated = raw_text[:6000] if len(raw_text) > 6000 else raw_text

    try:
        logger.info("🧠 Parsing profile with LLM...")
        response = await _groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[
                {"role": "system", "content": _PARSE_SYSTEM_PROMPT},
                {"role": "user", "content": f"Extract structured profile data from this raw LinkedIn text:\n\n{truncated}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=800,
        )

        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)

        profile = ProfileResult(
            name=data.get("name", ""),
            headline=data.get("headline", ""),
            location=data.get("location", ""),
            current_company=data.get("current_company", ""),
            linkedin_url=linkedin_url,
            email=data.get("email", ""),
            phone=data.get("phone", ""),
            websites=data.get("websites", []),
            experience_summary=data.get("experience_summary", ""),
            education_summary=data.get("education_summary", ""),
            skills=data.get("skills", []),
        )
        logger.info(f"✅ LLM parsed profile: {profile.name}")
        return profile

    except Exception as e:
        logger.error(f"❌ LLM profile parsing failed: {e}, using fallback regex")
        return _fallback_parse(raw_text, linkedin_url)


def _fallback_parse(raw_text: str, linkedin_url: str = "") -> ProfileResult:
    """Basic regex fallback if LLM parsing fails."""
    # Try to extract from JSON structure first
    try:
        data = json.loads(raw_text)
        sections = data.get("sections", {})
        text = sections.get("main_profile", "") + "\n" + sections.get("contact_info", "")
    except Exception:
        text = raw_text

    lines = [l.strip() for l in text.split("\n") if l.strip()]
    name = lines[0] if lines else ""
    headline = lines[1] if len(lines) > 1 else ""

    email = ""
    phone = ""
    for line in lines:
        em = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', line)
        if em and not email:
            email = em.group(0)
        ph = re.search(r'[\+]?[\d\s\-\(\)]{7,15}', line)
        if ph and not email and not phone:
            candidate = ph.group(0).strip()
            if len(candidate) >= 7:
                phone = candidate

    return ProfileResult(
        name=name,
        headline=headline,
        linkedin_url=linkedin_url,
        email=email,
        phone=phone,
    )


# ── Brief Generator ───────────────────────────────────────────────────────────

_BRIEF_SYSTEM_PROMPT = """\
You are a B2B sales intelligence analyst specialising in iGaming and digital marketing services.

Given a LinkedIn profile, produce a concise, actionable brief in **valid JSON only** — no markdown, no preamble.

Return EXACTLY this JSON structure:
{
  "who_they_are": "1–2 sentences: their role, seniority level, and industry niche",
  "what_company_does": "1–2 sentences: what their company/employer appears to do based on name/headline",
  "why_approach": "1–2 sentences: why this person is a strong lead for SEO/affiliate/growth services",
  "likely_pain_point": "1 sentence: the most likely business pain this person faces in their role",
  "best_outreach_angle": "1 sentence: the strongest hook for a cold outreach message",
  "suggested_service": "1 sentence: the specific service to lead with (e.g. competitor SEO audit, affiliate program build, content gap analysis)"
}

Be specific, not generic. Use their actual role title and company name where available.
If fields like experience or skills are empty, infer from the headline and company.
"""


async def generate_brief(profile: ProfileResult) -> BriefResult:
    """
    Call Groq LLM to generate a structured mini-brief for a profile.
    Returns a BriefResult. On error, returns an empty BriefResult with generated=False.
    """
    profile_context = f"""
Name: {profile.name or 'Unknown'}
Headline: {profile.headline or 'N/A'}
Current Company: {profile.current_company or 'N/A'}
Location: {profile.location or 'N/A'}
Skills: {', '.join(profile.skills) if profile.skills else 'N/A'}
Experience Summary: {profile.experience_summary or 'N/A'}
Education Summary: {profile.education_summary or 'N/A'}
LinkedIn: {profile.linkedin_url or 'N/A'}
""".strip()

    try:
        logger.info(f"🧠 Generating brief for: {profile.name}")
        response = await _groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[
                {"role": "system", "content": _BRIEF_SYSTEM_PROMPT},
                {"role": "user", "content": f"Generate a brief for this LinkedIn profile:\n\n{profile_context}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
            max_tokens=600,
        )

        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)

        brief = BriefResult(
            who_they_are=data.get("who_they_are", ""),
            what_company_does=data.get("what_company_does", ""),
            why_approach=data.get("why_approach", ""),
            likely_pain_point=data.get("likely_pain_point", ""),
            best_outreach_angle=data.get("best_outreach_angle", ""),
            suggested_service=data.get("suggested_service", ""),
            generated=True,
        )
        logger.info(f"✅ Brief generated for: {profile.name}")
        return brief

    except Exception as e:
        logger.error(f"❌ Brief generation failed for {profile.name}: {e}")
        return BriefResult(generated=False)

