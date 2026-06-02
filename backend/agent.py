"""
Agno agent that uses Groq LLM + LinkedIn MCP tools to search profiles.

This module handles the AI orchestration:
1. Connects to LinkedIn MCP server via streamable-http
2. Uses Groq (llama-3.3-70b-versatile) for tool-calling reasoning
3. Searches keywords → extracts profile usernames → enriches each profile
"""

import asyncio
import json
import logging
import re
import time
from typing import Any

from agno.agent import Agent
from agno.models.groq import Groq
from agno.tools.mcp import MCPTools

from config import GROQ_API_KEY, KEYWORDS, LINKEDIN_MCP_URL, MAX_PROFILES_PER_KEYWORD
from models import KeywordSearchResult, ProfileResult, SearchResponse

logger = logging.getLogger(__name__)


def _parse_profile_from_text(raw_text: str, linkedin_url: str = "") -> ProfileResult:
    """
    Best-effort parse of raw LinkedIn profile text into a structured ProfileResult.
    The MCP returns innerText dumps; we extract what we can.
    """
    lines = [l.strip() for l in raw_text.split("\n") if l.strip()]

    name = lines[0] if lines else ""
    headline = lines[1] if len(lines) > 1 else ""
    location = ""
    email = ""
    phone = ""
    websites: list[str] = []

    for line in lines:
        # Location patterns
        if any(geo in line.lower() for geo in ["metropolitan", "area", "city", "country", "state", "region"]):
            if not location:
                location = line

        # Email
        email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', line)
        if email_match:
            email = email_match.group(0)

        # Phone
        phone_match = re.search(r'[\+]?[\d\s\-\(\)]{7,15}', line)
        if phone_match and not email:
            candidate = phone_match.group(0).strip()
            if len(candidate) >= 7:
                phone = candidate

        # Websites
        url_match = re.search(r'https?://[^\s]+', line)
        if url_match:
            url = url_match.group(0)
            if "linkedin.com" not in url:
                websites.append(url)

    return ProfileResult(
        name=name,
        headline=headline,
        location=location,
        linkedin_url=linkedin_url,
        email=email,
        phone=phone,
        websites=websites,
    )


def _extract_usernames_from_search(result: Any) -> list[str]:
    """
    Extract LinkedIn usernames from search_people MCP result.
    The result contains references with profile URLs like /in/username/
    """
    usernames = []

    if isinstance(result, dict):
        # Check references for profile URLs
        refs = result.get("references", {})
        for key, value in refs.items():
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and "/in/" in item:
                        match = re.search(r'/in/([^/]+)/?', item)
                        if match:
                            usernames.append(match.group(1))
            elif isinstance(value, str) and "/in/" in value:
                match = re.search(r'/in/([^/]+)/?', value)
                if match:
                    usernames.append(match.group(1))

        # Also scan sections text for /in/ links
        sections = result.get("sections", {})
        for section_name, section_text in sections.items():
            if isinstance(section_text, str):
                matches = re.findall(r'/in/([^/\s]+)/?', section_text)
                usernames.extend(matches)

        # Scan the URL field
        url = result.get("url", "")
        if "/in/" in url:
            match = re.search(r'/in/([^/]+)/?', url)
            if match:
                usernames.append(match.group(1))

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for u in usernames:
        if u not in seen and u != "me":
            seen.add(u)
            unique.append(u)

    return unique


async def search_profiles_for_keyword(
    mcp_tools: MCPTools,
    keyword: str,
    max_profiles: int = MAX_PROFILES_PER_KEYWORD,
) -> KeywordSearchResult:
    """
    Search LinkedIn for a keyword and enrich up to max_profiles results.
    Uses Agno Agent with Groq to orchestrate MCP tool calls.
    """
    logger.info(f"🔍 Searching keyword: {keyword}")

    agent = Agent(
        model=Groq(id="meta-llama/llama-4-scout-17b-16e-instruct", api_key=GROQ_API_KEY),
        tools=[mcp_tools],
        markdown=False,
        instructions=[
            "You are a LinkedIn profile researcher.",
            "When asked to search for people, use the search_people tool with the given keywords.",
            "Only pass required parameters to tools. Do NOT pass null values for optional parameters.",
            "After calling a tool and receiving its result, respond with a brief plain-text summary only. Never return raw JSON or tool output verbatim.",
        ],
    )

    profiles: list[ProfileResult] = []
    usernames: list[str] = []

    try:
        # Step 1: Search for people with the keyword
        search_response = await agent.arun(
            f'Search LinkedIn for people with keywords: "{keyword}". Call search_people once, then briefly summarize how many results were found.'
        )

        # Extract usernames from tool call results in the agent's messages
        if hasattr(search_response, 'messages'):
            for msg in search_response.messages:
                if hasattr(msg, 'content') and msg.content:
                    content = msg.content if isinstance(msg.content, str) else str(msg.content)
                    found = re.findall(r'/in/([^/\s"\']+)/?', content)
                    usernames.extend(found)
                if hasattr(msg, 'tool_calls') and msg.tool_calls:
                    for tc in msg.tool_calls:
                        if hasattr(tc, 'result') and tc.result:
                            result_str = str(tc.result)
                            found = re.findall(r'/in/([^/\s"\']+)/?', result_str)
                            usernames.extend(found)

        if hasattr(search_response, 'content') and search_response.content:
            content = search_response.content if isinstance(search_response.content, str) else str(search_response.content)
            found = re.findall(r'/in/([^/\s"\']+)/?', content)
            usernames.extend(found)

    except Exception as e:
        logger.warning(f"  ⚠️ Agent search failed, attempting direct MCP fallback: {e}")
        # Fallback: call the MCP tool directly without the agent
        try:
            raw_result = await mcp_tools.session.call_tool("search_people", {"keywords": keyword})
            result_str = str(raw_result)
            found = re.findall(r'/in/([^/\s"\']+)/?', result_str)
            usernames.extend(found)
            logger.info(f"  ✅ Direct MCP fallback found {len(found)} profile URLs")
        except Exception as fallback_err:
            logger.error(f"❌ Direct MCP fallback also failed for '{keyword}': {fallback_err}")

    # Deduplicate usernames
    seen: set[str] = set()
    unique_usernames: list[str] = []
    for u in usernames:
        u_clean = u.strip().rstrip(')')
        if u_clean and u_clean not in seen and u_clean != "me" and len(u_clean) > 1:
            seen.add(u_clean)
            unique_usernames.append(u_clean)

    logger.info(f"  Found {len(unique_usernames)} usernames for '{keyword}': {unique_usernames[:max_profiles]}")

    # Step 2: Enrich each profile (up to max)
    for username in unique_usernames[:max_profiles]:
        try:
            logger.info(f"  📋 Enriching profile: {username}")
            profile_text = ""
            try:
                profile_response = await agent.arun(
                    f'Get the LinkedIn profile for username "{username}". Call get_person_profile with linkedin_username="{username}", sections="contact_info". Then briefly describe what you found.'
                )

                if hasattr(profile_response, 'content') and profile_response.content:
                    profile_text = profile_response.content if isinstance(profile_response.content, str) else str(profile_response.content)

                if hasattr(profile_response, 'messages') and profile_response.messages:
                    for msg in profile_response.messages:
                        if hasattr(msg, 'content') and msg.content:
                            msg_content = msg.content if isinstance(msg.content, str) else str(msg.content)
                            if len(msg_content) > len(profile_text):
                                profile_text = msg_content
                        if hasattr(msg, 'tool_calls') and msg.tool_calls:
                            for tc in msg.tool_calls:
                                if hasattr(tc, 'result') and tc.result is not None:
                                    if isinstance(tc.result, dict):
                                        sections = tc.result.get("sections", {})
                                        combined = sections.get("main_profile", "") + "\n" + sections.get("contact_info", "")
                                        if len(combined) > len(profile_text):
                                            profile_text = combined
                                    elif isinstance(tc.result, str):
                                        try:
                                            parsed = json.loads(tc.result)
                                            sections = parsed.get("sections", {})
                                            combined = sections.get("main_profile", "") + "\n" + sections.get("contact_info", "")
                                            if len(combined) > len(profile_text):
                                                profile_text = combined
                                        except Exception:
                                            if len(tc.result) > len(profile_text):
                                                profile_text = tc.result
                                    else:
                                        tc_str = str(tc.result)
                                        if len(tc_str) > len(profile_text):
                                            profile_text = tc_str
            except Exception as e:
                logger.warning(f"  ⚠️ Agent profile enrichment failed, attempting direct MCP fallback: {e}")
                raw_result = await mcp_tools.session.call_tool(
                    "get_person_profile", 
                    {"linkedin_username": username, "sections": "contact_info"}
                )
                if isinstance(raw_result, dict):
                    sections = raw_result.get("sections", {})
                    profile_text = sections.get("main_profile", "") + "\n" + sections.get("contact_info", "")
                elif hasattr(raw_result, "content") and isinstance(raw_result.content, list):
                    # For MCP SDK TextContent
                    for item in raw_result.content:
                        if getattr(item, "type", "") == "text":
                            try:
                                parsed = json.loads(item.text)
                                sections = parsed.get("sections", {})
                                profile_text += sections.get("main_profile", "") + "\n" + sections.get("contact_info", "")
                            except Exception:
                                profile_text += item.text + "\n"
                else:
                    try:
                        parsed = json.loads(str(raw_result))
                        sections = parsed.get("sections", {})
                        profile_text = sections.get("main_profile", "") + "\n" + sections.get("contact_info", "")
                    except Exception:
                        profile_text = str(raw_result)

            linkedin_url = f"https://www.linkedin.com/in/{username}/"
            profile = _parse_profile_from_text(profile_text, linkedin_url)

            if not profile.name or profile.name.startswith("Here") or profile.name.startswith("I "):
                profile.name = username.replace("-", " ").title()

            profiles.append(profile)
            logger.info(f"  ✅ Got profile: {profile.name}")

            await asyncio.sleep(3)

        except Exception as e:
            logger.warning(f"  ⚠️ Failed to enrich {username}: {e}")
            profiles.append(ProfileResult(
                name=username.replace("-", " ").title(),
                linkedin_url=f"https://www.linkedin.com/in/{username}/",
            ))

    return KeywordSearchResult(
        keyword=keyword,
        profiles=profiles,
        count=len(profiles),
    )


async def run_full_search(
    keywords: list[str] | None = None,
    progress_callback=None,
) -> SearchResponse:
    """
    Run the full LinkedIn search across all keywords.
    Connects to MCP, searches each keyword, enriches profiles.
    """
    if keywords is None:
        keywords = KEYWORDS

    start_time = time.time()
    results: list[KeywordSearchResult] = []

    # Connect to LinkedIn MCP server
    mcp_tools = MCPTools(
        transport="streamable-http",
        url=LINKEDIN_MCP_URL,
        timeout_seconds=60,  # LinkedIn scraping can be slow
    )

    try:
        logger.info(f"🔗 Connecting to LinkedIn MCP at {LINKEDIN_MCP_URL}")
        await mcp_tools.connect()
        logger.info("✅ MCP connected successfully")

        for i, keyword in enumerate(keywords):
            if progress_callback:
                await progress_callback(keyword, i, len(keywords))

            result = await search_profiles_for_keyword(mcp_tools, keyword)
            results.append(result)
            logger.info(f"📊 Keyword '{keyword}': {result.count} profiles found")

            # Delay between keywords to avoid Groq rate limits
            if i < len(keywords) - 1:
                await asyncio.sleep(2)

    except Exception as e:
        logger.error(f"❌ MCP connection error: {e}")
        return SearchResponse(
            results=results,
            total_profiles=sum(r.count for r in results),
            search_duration_seconds=time.time() - start_time,
            status="error",
            error=str(e),
        )
    finally:
        try:
            await mcp_tools.close()
        except Exception:
            pass

    total = sum(r.count for r in results)
    duration = time.time() - start_time

    logger.info(f"🏁 Search complete: {total} profiles in {duration:.1f}s")

    return SearchResponse(
        results=results,
        total_profiles=total,
        search_duration_seconds=duration,
        status="completed",
    )
