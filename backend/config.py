"""
Application configuration for LinkedIn AI Profile Finder.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --- API Keys ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
LINKEDIN_MCP_URL = os.getenv("LINKEDIN_MCP_URL", "http://localhost:8000/mcp")

# --- Hardcoded iGaming Keywords ---
KEYWORDS = [
   
    "gambling SEO manager",
    "iGaming growth lead",

]

# --- Limits ---
MAX_PROFILES_PER_KEYWORD = 1
