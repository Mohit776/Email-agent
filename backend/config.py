"""
Application configuration for LinkedIn AI Profile Finder.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --- API Keys ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
LINKEDIN_MCP_URL = os.getenv("LINKEDIN_MCP_URL", "http://localhost:8000/mcp")

# --- SMTP Email Config ---
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "LinkedIn AI Finder")

# --- Hardcoded iGaming Keywords ---
KEYWORDS = [
   
    "gambling SEO manager",
    "iGaming growth lead",

]

# --- Limits ---
MAX_PROFILES_PER_KEYWORD = 1
