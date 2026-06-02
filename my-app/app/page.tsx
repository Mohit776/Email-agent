"use client";

import { useState, useEffect, useCallback } from "react";

// --- Types ---
interface ProfileResult {
  name: string;
  headline: string;
  location: string;
  current_company: string;
  linkedin_url: string;
  email: string;
  phone: string;
  websites: string[];
  experience_summary: string;
  education_summary: string;
  skills: string[];
}

interface KeywordSearchResult {
  keyword: string;
  profiles: ProfileResult[];
  count: number;
}

interface SearchResponse {
  results: KeywordSearchResult[];
  total_profiles: number;
  search_duration_seconds: number;
  status: string;
  error: string | null;
}

interface SearchStatus {
  is_running: boolean;
  current_keyword: string;
  progress: number;
  total: number;
  has_results: boolean;
}

const API_BASE = "http://localhost:8080";

// --- Helper: CSV Export ---
function exportToCSV(results: KeywordSearchResult[]) {
  const headers = [
    "Keyword",
    "Name",
    "Headline",
    "Location",
    "Company",
    "Email",
    "Phone",
    "LinkedIn URL",
    "Websites",
    "Skills",
  ];

  const rows = results.flatMap((r) =>
    r.profiles.map((p) => [
      r.keyword,
      p.name,
      p.headline,
      p.location,
      p.current_company,
      p.email,
      p.phone,
      p.linkedin_url,
      p.websites.join("; "),
      p.skills.join("; "),
    ])
  );

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${(cell || "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `linkedin-profiles-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Skeleton Row ---
function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="p-4">
          <div className="skeleton h-4 w-full" style={{ width: `${60 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

export default function Home() {
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [activeKeyword, setActiveKeyword] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  // Health check on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((data) => setHealthOk(data.groq_configured))
      .catch(() => setHealthOk(false));
  }, []);

  // Poll status while searching
  useEffect(() => {
    if (!isSearching) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/search/status`);
        const data: SearchStatus = await res.json();
        setStatus(data);

        if (!data.is_running && data.has_results) {
          // Search completed, fetch results
          const resultRes = await fetch(`${API_BASE}/api/search/results`);
          const resultData: SearchResponse = await resultRes.json();
          setSearchData(resultData);
          setIsSearching(false);
        } else if (!data.is_running && !data.has_results) {
          // Search failed
          setIsSearching(false);
          setError("Search completed without results. Check backend logs.");
        }
      } catch {
        // Backend might be busy, keep polling
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isSearching]);

  const startSearch = useCallback(async () => {
    setError(null);
    setSearchData(null);
    setIsSearching(true);
    setActiveKeyword("all");

    try {
      const res = await fetch(`${API_BASE}/api/search`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start search");
        setIsSearching(false);
      }
    } catch (e) {
      setError("Cannot connect to backend. Is FastAPI running on port 8080?");
      setIsSearching(false);
    }
  }, []);

  // Filter profiles by keyword
  const filteredResults =
    activeKeyword === "all"
      ? searchData?.results || []
      : searchData?.results.filter((r) => r.keyword === activeKeyword) || [];

  const allProfiles = filteredResults.flatMap((r) =>
    r.profiles.map((p) => ({ ...p, _keyword: r.keyword }))
  );

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background orbs */}
      <div
        className="bg-orb"
        style={{
          width: 500,
          height: 500,
          background: "var(--accent-purple)",
          top: "-10%",
          left: "-5%",
        }}
      />
      <div
        className="bg-orb"
        style={{
          width: 400,
          height: 400,
          background: "var(--accent-cyan)",
          bottom: "-10%",
          right: "-5%",
          animationDelay: "7s",
        }}
      />
      <div
        className="bg-orb"
        style={{
          width: 300,
          height: 300,
          background: "#6366f1",
          top: "40%",
          right: "20%",
          animationDelay: "14s",
        }}
      />

      {/* Main content */}
      <div className="relative z-10 w-full max-w-[1440px] mx-auto px-6 py-10">
        {/* Header */}
        <header className="text-center mb-12 fade-in-up">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-purple-500/20 bg-purple-500/5 mb-6">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-medium text-purple-300">
              Powered by Agno + Groq + LinkedIn MCP
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="gradient-text">LinkedIn AI</span>{" "}
            <span className="text-white">Profile Finder</span>
          </h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Discover iGaming industry professionals across SEO, marketing, affiliates, and more.
            AI-powered search with structured contact data.
          </p>
        </header>

        {/* Action Bar */}
        <div className="glass-card p-6 mb-8 flex flex-col sm:flex-row items-center gap-4 fade-in-up" style={{ animationDelay: "0.15s" }}>
          <button
            id="start-search-btn"
            className="btn-accent flex items-center gap-2"
            onClick={startSearch}
            disabled={isSearching || healthOk === false}
          >
            {isSearching ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path
                    d="M4 12a8 8 0 018-8"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                Searching...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                Start Search
              </>
            )}
          </button>

          {/* Status */}
          <div className="flex-1 text-sm text-zinc-400">
            {healthOk === false && (
              <span className="text-red-400">
                ⚠ Backend not connected. Start FastAPI on port 8080.
              </span>
            )}
            {healthOk === true && !isSearching && !searchData && (
              <span>Ready — 8 iGaming keywords loaded</span>
            )}
            {isSearching && status && (
              <div className="space-y-2">
                <span>
                  Searching:{" "}
                  <span className="text-purple-300 font-medium">
                    {status.current_keyword || "initializing..."}
                  </span>{" "}
                  ({status.progress + 1}/{status.total || 8})
                </span>
                <div className="progress-bar max-w-xs">
                  <div
                    className="progress-bar-fill"
                    style={{
                      width: `${status.total ? ((status.progress + 1) / status.total) * 100 : 10}%`,
                    }}
                  />
                </div>
              </div>
            )}
            {searchData && !isSearching && (
              <span className="text-green-400">
                ✓ Found {searchData.total_profiles} profiles in{" "}
                {searchData.search_duration_seconds.toFixed(1)}s
              </span>
            )}
          </div>

          {/* Export */}
          {searchData && searchData.results.length > 0 && (
            <button
              id="export-csv-btn"
              onClick={() => exportToCSV(searchData.results)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium hover:bg-white/5 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="glass-card border-red-500/30 p-4 mb-6 text-red-300 text-sm flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="m15 9-6 6M9 9l6 6" />
            </svg>
            {error}
          </div>
        )}

        {/* Keyword Tabs */}
        {searchData && searchData.results.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6 fade-in-up" style={{ animationDelay: "0.3s" }}>
            <button
              className={`keyword-tab ${activeKeyword === "all" ? "active" : ""}`}
              onClick={() => setActiveKeyword("all")}
            >
              All ({searchData.total_profiles})
            </button>
            {searchData.results.map((r) => (
              <button
                key={r.keyword}
                className={`keyword-tab ${activeKeyword === r.keyword ? "active" : ""}`}
                onClick={() => setActiveKeyword(r.keyword)}
              >
                {r.keyword} ({r.count})
              </button>
            ))}
          </div>
        )}

        {/* Results Table */}
        <div className="glass-card overflow-hidden fade-in-up" style={{ animationDelay: "0.4s" }}>
          <div className="overflow-x-auto">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Headline</th>
                  <th>Location</th>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>LinkedIn</th>
                </tr>
              </thead>
              <tbody>
                {/* Loading state */}
                {isSearching && allProfiles.length === 0 && (
                  <>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <SkeletonRow key={i} />
                    ))}
                  </>
                )}

                {/* Empty state */}
                {!isSearching && allProfiles.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-20 text-zinc-500">
                      <div className="flex flex-col items-center gap-3">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-600">
                          <circle cx="11" cy="11" r="8" />
                          <path d="m21 21-4.35-4.35" />
                        </svg>
                        <p className="text-base">No profiles yet</p>
                        <p className="text-sm text-zinc-600">
                          Click &quot;Start Search&quot; to discover iGaming professionals
                        </p>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Profile rows */}
                {allProfiles.map((profile, index) => (
                  <tr key={`${profile.linkedin_url}-${index}`}>
                    <td className="text-zinc-500 font-mono text-xs">
                      {index + 1}
                    </td>
                    <td>
                      <div className="font-medium text-white">{profile.name}</div>
                      {activeKeyword === "all" && (
                        <span className="text-[10px] text-purple-400 font-medium uppercase tracking-wide">
                          {(profile as ProfileResult & { _keyword: string })._keyword}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[240px]">
                      <span className="text-zinc-300 line-clamp-2 text-[13px]">
                        {profile.headline || "—"}
                      </span>
                    </td>
                    <td className="text-zinc-400 text-[13px]">{profile.location || "—"}</td>
                    <td className="text-zinc-300 text-[13px]">{profile.current_company || "—"}</td>
                    <td>
                      <div className="flex flex-col gap-1 text-[13px]">
                        {profile.email && (
                          <a
                            href={`mailto:${profile.email}`}
                            className="text-cyan-400 hover:text-cyan-300 transition-colors"
                          >
                            ✉ {profile.email}
                          </a>
                        )}
                        {profile.phone && (
                          <span className="text-zinc-400">📞 {profile.phone}</span>
                        )}
                        {!profile.email && !profile.phone && (
                          <span className="text-zinc-600">—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {profile.linkedin_url ? (
                        <a
                          href={profile.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="linkedin-link text-[13px] inline-flex items-center gap-1"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                          </svg>
                          Profile
                        </a>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center mt-10 text-xs text-zinc-600">
          <p>LinkedIn AI Profile Finder — POC · Agno + Groq + LinkedIn MCP</p>
        </footer>
      </div>
    </div>
  );
}
