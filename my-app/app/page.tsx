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

interface BriefResult {
  who_they_are: string;
  what_company_does: string;
  why_approach: string;
  likely_pain_point: string;
  best_outreach_angle: string;
  suggested_service: string;
  generated: boolean;
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

interface EmailSendResult {
  name: string;
  email: string;
  status: "sent" | "skipped" | "failed";
  reason: string;
}

interface SendEmailsResponse {
  sent: number;
  skipped: number;
  failed: number;
  results: EmailSendResult[];
}

type ProfileWithKeyword = ProfileResult & { _keyword: string };

const API_BASE = "http://localhost:8080";

// --- Helper: CSV Export ---
function exportToCSV(results: KeywordSearchResult[]) {
  const headers = [
    "Keyword", "Name", "Headline", "Location", "Company", "Email",
    "Phone", "LinkedIn URL", "Websites", "Skills",
  ];
  const rows = results.flatMap((r) =>
    r.profiles.map((p) => [
      r.keyword, p.name, p.headline, p.location, p.current_company,
      p.email, p.phone, p.linkedin_url, p.websites.join("; "), p.skills.join("; "),
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
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="p-4">
          <div className="skeleton h-4" style={{ width: `${55 + Math.random() * 45}%` }} />
        </td>
      ))}
    </tr>
  );
}

// --- Brief Card ---
function BriefCard({ brief, loading }: { brief?: BriefResult; loading?: boolean }) {
  if (loading) {
    return (
      <div className="brief-card brief-loading">
        <div className="brief-spinner" />
        <span className="text-zinc-500 text-xs ml-2">Generating brief…</span>
      </div>
    );
  }
  if (!brief || !brief.generated) {
    return <span className="text-zinc-600 text-xs">—</span>;
  }

  const fields: { label: string; icon: string; value: string; color: string }[] = [
    { label: "Who They Are", icon: "👤", value: brief.who_they_are, color: "#a78bfa" },
    { label: "Company", icon: "🏢", value: brief.what_company_does, color: "#06b6d4" },
    { label: "Why Approach", icon: "🎯", value: brief.why_approach, color: "#34d399" },
    { label: "Pain Point", icon: "⚡", value: brief.likely_pain_point, color: "#f59e0b" },
    { label: "Outreach Angle", icon: "📨", value: brief.best_outreach_angle, color: "#f472b6" },
    { label: "Lead With", icon: "🚀", value: brief.suggested_service, color: "#818cf8" },
  ];

  return (
    <div className="brief-card">
      {fields.map(({ label, icon, value, color }) => (
        <div key={label} className="brief-field">
          <span className="brief-label" style={{ color }}>
            {icon} {label}
          </span>
          <p className="brief-value">{value}</p>
        </div>
      ))}
    </div>
  );
}

// --- Main Component ---
export default function Home() {
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [activeKeyword, setActiveKeyword] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [briefs, setBriefs] = useState<Record<string, BriefResult>>({});
  const [briefsLoading, setBriefsLoading] = useState<Record<string, boolean>>({});
  const [loadingTestProfiles, setLoadingTestProfiles] = useState(false);

  // Email state
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [sendingEmails, setSendingEmails] = useState(false);
  const [emailProgress, setEmailProgress] = useState<{ current: number; total: number; currentName: string } | null>(null);
  const [emailResults, setEmailResults] = useState<SendEmailsResponse | null>(null);

  // Health check on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((data) => setHealthOk(data.groq_configured))
      .catch(() => setHealthOk(false));
  }, []);

  // Auto-generate briefs whenever profiles change
  const generateBriefsForProfiles = useCallback(async (profiles: ProfileWithKeyword[]) => {
    if (profiles.length === 0) return;

    // Mark all as loading
    const loadingMap: Record<string, boolean> = {};
    profiles.forEach((p) => {
      const key = p.linkedin_url || p.name;
      loadingMap[key] = true;
    });
    setBriefsLoading((prev) => ({ ...prev, ...loadingMap }));

    // Fire all requests concurrently via batch endpoint
    try {
      const res = await fetch(`${API_BASE}/api/briefs/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profiles),
      });
      if (!res.ok) throw new Error("Batch brief request failed");
      const data: BriefResult[] = await res.json();

      const newBriefs: Record<string, BriefResult> = {};
      const doneLoading: Record<string, boolean> = {};
      profiles.forEach((p, i) => {
        const key = p.linkedin_url || p.name;
        newBriefs[key] = data[i];
        doneLoading[key] = false;
      });

      setBriefs((prev) => ({ ...prev, ...newBriefs }));
      setBriefsLoading((prev) => ({ ...prev, ...doneLoading }));
    } catch (e) {
      // Fallback: call one-by-one
      for (const p of profiles) {
        const key = p.linkedin_url || p.name;
        try {
          const res = await fetch(`${API_BASE}/api/brief`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p),
          });
          const brief: BriefResult = await res.json();
          setBriefs((prev) => ({ ...prev, [key]: brief }));
        } catch {
          // silent
        } finally {
          setBriefsLoading((prev) => ({ ...prev, [key]: false }));
        }
      }
    }
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
          const resultRes = await fetch(`${API_BASE}/api/search/results`);
          const resultData: SearchResponse = await resultRes.json();
          setSearchData(resultData);
          setIsSearching(false);
        } else if (!data.is_running && !data.has_results) {
          setIsSearching(false);
          setError("Search completed without results. Check backend logs.");
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [isSearching]);

  // Trigger brief generation when search data loads
  useEffect(() => {
    if (!searchData) return;
    const all = searchData.results.flatMap((r) =>
      r.profiles.map((p) => ({ ...p, _keyword: r.keyword }))
    );
    generateBriefsForProfiles(all);
  }, [searchData, generateBriefsForProfiles]);

  const startSearch = useCallback(async () => {
    setError(null);
    setSearchData(null);
    setBriefs({});
    setBriefsLoading({});
    setEmailResults(null);
    setIsSearching(true);
    setActiveKeyword("all");
    try {
      const res = await fetch(`${API_BASE}/api/search`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start search");
        setIsSearching(false);
      }
    } catch {
      setError("Cannot connect to backend. Is FastAPI running on port 8080?");
      setIsSearching(false);
    }
  }, []);

  const loadTestProfiles = useCallback(async () => {
    setLoadingTestProfiles(true);
    setBriefs({});
    setBriefsLoading({});
    try {
      const res = await fetch(`${API_BASE}/api/mock-profiles`);
      const profiles: ProfileResult[] = await res.json();
      const fakeResult: SearchResponse = {
        results: [{ keyword: "mock-data", profiles, count: profiles.length }],
        total_profiles: profiles.length,
        search_duration_seconds: 0,
        status: "completed",
        error: null,
      };
      setSearchData(fakeResult);
      setActiveKeyword("all");
    } catch {
      setError("Failed to load test profiles from backend.");
    } finally {
      setLoadingTestProfiles(false);
    }
  }, []);

  const filteredResults =
    activeKeyword === "all"
      ? searchData?.results || []
      : searchData?.results.filter((r) => r.keyword === activeKeyword) || [];

  const allProfiles: ProfileWithKeyword[] = filteredResults.flatMap((r) =>
    r.profiles.map((p) => ({ ...p, _keyword: r.keyword }))
  );

  const briefsGenerating = Object.values(briefsLoading).some(Boolean);
  const briefsDone = allProfiles.length > 0 && allProfiles.every(
    (p) => briefs[p.linkedin_url || p.name]?.generated
  );

  const profilesWithEmail = allProfiles.filter((p) => p.email);

  const sendEmails = useCallback(async () => {
    setSendingEmails(true);
    const recipients = allProfiles.map((p) => ({
      profile: p,
      brief: briefs[p.linkedin_url || p.name] || null,
    }));

    const finalResults: SendEmailsResponse = {
      sent: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };

    setEmailProgress({ current: 0, total: recipients.length, currentName: "" });
    setEmailResults(finalResults);
    setShowResultsModal(true);

    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      setEmailProgress({ current: i + 1, total: recipients.length, currentName: r.profile.name });

      try {
        const res = await fetch(`${API_BASE}/api/send-emails`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: [r] }),
        });
        const data: SendEmailsResponse = await res.json();
        
        finalResults.sent += data.sent || 0;
        finalResults.skipped += data.skipped || 0;
        finalResults.failed += data.failed || 0;
        if (data.results) finalResults.results.push(...data.results);

        setEmailResults({ ...finalResults });
      } catch {
        finalResults.failed += 1;
        finalResults.results.push({
          name: r.profile.name,
          email: r.profile.email || "",
          status: "failed",
          reason: "Network error",
        });
        setEmailResults({ ...finalResults });
      }
    }

    setEmailProgress(null);
    setSendingEmails(false);
  }, [allProfiles, briefs]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background orbs */}
      <div className="bg-orb" style={{ width: 500, height: 500, background: "var(--accent-purple)", top: "-10%", left: "-5%" }} />
      <div className="bg-orb" style={{ width: 400, height: 400, background: "var(--accent-cyan)", bottom: "-10%", right: "-5%", animationDelay: "7s" }} />
      <div className="bg-orb" style={{ width: 300, height: 300, background: "#6366f1", top: "40%", right: "20%", animationDelay: "14s" }} />

      <div className="relative z-10 w-full max-w-[1600px] mx-auto px-6 py-10">
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
            Discover iGaming professionals with AI-generated outreach briefs — instantly.
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
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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

          {/* Load Test Profiles */}
          <button
            id="load-test-btn"
            onClick={loadTestProfiles}
            disabled={loadingTestProfiles || isSearching}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-cyan-500/30 bg-cyan-500/5 text-cyan-400 text-sm font-medium hover:bg-cyan-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingTestProfiles ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10" />
                <path d="M12 8v4l3 3" />
              </svg>
            )}
            Load Test Profiles
          </button>

          {/* Status */}
          <div className="flex-1 text-sm text-zinc-400">
            {healthOk === false && (
              <span className="text-red-400">⚠ Backend not connected. Start FastAPI on port 8080.</span>
            )}
            {healthOk === true && !isSearching && !searchData && (
              <span>Ready — Click "Start Search" or "Load Test Profiles"</span>
            )}
            {isSearching && status && (
              <div className="space-y-2">
                <span>
                  Searching:{" "}
                  <span className="text-purple-300 font-medium">{status.current_keyword || "initializing..."}</span>{" "}
                  ({status.progress + 1}/{status.total || 8})
                </span>
                <div className="progress-bar max-w-xs">
                  <div className="progress-bar-fill" style={{ width: `${status.total ? ((status.progress + 1) / status.total) * 100 : 10}%` }} />
                </div>
              </div>
            )}
            {searchData && !isSearching && (
              <span className={briefsDone ? "text-green-400" : briefsGenerating ? "text-yellow-400" : "text-green-400"}>
                {briefsGenerating
                  ? `✦ ${searchData.total_profiles} profiles found — generating AI briefs…`
                  : `✓ ${searchData.total_profiles} profiles · AI briefs ready`}
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

          {/* Send Emails */}
          {allProfiles.length > 0 && (
            <button
              id="send-emails-btn"
              onClick={sendEmails}
              disabled={sendingEmails}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-sm font-medium hover:bg-emerald-500/15 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendingEmails ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Sending…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2 11 13" />
                    <path d="m22 2-7 20-4-9-9-4 20-7z" />
                  </svg>
                  Send Emails{profilesWithEmail.length > 0 ? ` (${profilesWithEmail.length})` : ""}
                </>
              )}
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
                  <th style={{ minWidth: 40 }}>#</th>
                  <th style={{ minWidth: 160 }}>Name</th>
                  <th style={{ minWidth: 200 }}>Headline</th>
                  <th style={{ minWidth: 130 }}>Location</th>
                  <th style={{ minWidth: 130 }}>Company</th>
                  <th style={{ minWidth: 180 }}>Contact</th>
                  <th style={{ minWidth: 90 }}>LinkedIn</th>
                  <th style={{ minWidth: 380 }}>
                    <span className="gradient-text">✦ AI Brief</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Loading state */}
                {isSearching && allProfiles.length === 0 && (
                  <>{Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}</>
                )}

                {/* Empty state */}
                {!isSearching && allProfiles.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-20 text-zinc-500">
                      <div className="flex flex-col items-center gap-3">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-600">
                          <circle cx="11" cy="11" r="8" />
                          <path d="m21 21-4.35-4.35" />
                        </svg>
                        <p className="text-base">No profiles yet</p>
                        <p className="text-sm text-zinc-600">
                          Click &quot;Start Search&quot; or &quot;Load Test Profiles&quot; to see AI briefs
                        </p>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Profile rows */}
                {allProfiles.map((profile, index) => {
                  const key = profile.linkedin_url || profile.name;
                  const brief = briefs[key];
                  const loading = briefsLoading[key];
                  return (
                    <tr key={`${key}-${index}`} className="profile-row-with-brief">
                      <td className="text-zinc-500 font-mono text-xs">{index + 1}</td>
                      <td>
                        <div className="font-medium text-white">{profile.name}</div>
                        {activeKeyword === "all" && (
                          <span className="text-[10px] text-purple-400 font-medium uppercase tracking-wide">
                            {profile._keyword}
                          </span>
                        )}
                      </td>
                      <td style={{ maxWidth: 220 }}>
                        <span className="text-zinc-300 line-clamp-2 text-[13px]">
                          {profile.headline || "—"}
                        </span>
                      </td>
                      <td className="text-zinc-400 text-[13px]">{profile.location || "—"}</td>
                      <td className="text-zinc-300 text-[13px]">{profile.current_company || "—"}</td>
                      <td>
                        <div className="flex flex-col gap-1 text-[13px]">
                          {profile.email && (
                            <a href={`mailto:${profile.email}`} className="text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1">
                              <span>✉</span> {profile.email}
                            </a>
                          )}
                          {profile.phone && (
                            <span className="text-zinc-400 flex items-center gap-1">
                              <span>📞</span> {profile.phone}
                            </span>
                          )}
                          {profile.websites && profile.websites.length > 0 && (
                            <div className="flex flex-col gap-0.5">
                              {profile.websites.slice(0, 2).map((url, i) => (
                                <a
                                  key={i}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-purple-400 hover:text-purple-300 transition-colors text-[11px] truncate max-w-[160px]"
                                >
                                  🔗 {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                                </a>
                              ))}
                            </div>
                          )}
                          {!profile.email && !profile.phone && (!profile.websites || profile.websites.length === 0) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800/80 text-zinc-500 border border-zinc-700/50">
                              🔒 LinkedIn only
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {profile.linkedin_url ? (
                          <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer" className="linkedin-link text-[13px] inline-flex items-center gap-1">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                            </svg>
                            Profile
                          </a>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td>
                        <BriefCard brief={brief} loading={loading} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center mt-10 text-xs text-zinc-600">
          <p>LinkedIn AI Profile Finder — POC · Agno + Groq + LinkedIn MCP</p>
        </footer>
      </div>

      {/* ── Email Results Modal ── */}
      {showResultsModal && emailResults && (
        <div className="modal-overlay" onClick={() => !sendingEmails && setShowResultsModal(false)}>
          <div className="modal-box modal-box-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-icon">{sendingEmails ? "⏳" : "✅"}</div>
              <div>
                <h2 className="modal-title">{sendingEmails ? "Sending Emails..." : "Emails Sent"}</h2>
                <p className="modal-subtitle">
                  {sendingEmails && emailProgress
                    ? `Sending ${emailProgress.current} of ${emailProgress.total} (Currently: ${emailProgress.currentName})`
                    : "Campaign complete — here's your delivery report."}
                </p>
              </div>
            </div>

            <div className="modal-stats" style={{ margin: "0 0 16px" }}>
              <div className="modal-stat">
                <span className="modal-stat-value text-emerald-400">{emailResults.sent}</span>
                <span className="modal-stat-label">sent</span>
              </div>
              <div className="modal-stat">
                <span className="modal-stat-value text-yellow-400">{emailResults.skipped}</span>
                <span className="modal-stat-label">skipped</span>
              </div>
              <div className="modal-stat">
                <span className="modal-stat-value text-red-400">{emailResults.failed}</span>
                <span className="modal-stat-label">failed</span>
              </div>
            </div>

            <div className="results-list">
              {emailResults.results.map((r, i) => (
                <div key={i} className={`result-row result-row-${r.status}`}>
                  <span className="result-icon">
                    {r.status === "sent" ? "✅" : r.status === "skipped" ? "⚠️" : "❌"}
                  </span>
                  <div className="result-info">
                    <span className="result-name">{r.name}</span>
                    <span className="result-email">{r.email || "—"}</span>
                    {r.reason && <span className="result-reason">{r.reason}</span>}
                  </div>
                  <span className={`result-badge result-badge-${r.status}`}>{r.status}</span>
                </div>
              ))}
              {sendingEmails && (
                <div className="result-row" style={{ opacity: 0.6, borderStyle: "dashed" }}>
                   <span className="result-icon">
                     <svg className="animate-spin h-4 w-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M4 12a8 8 0 018-8" strokeLinecap="round" />
                     </svg>
                   </span>
                   <div className="result-info">
                     <span className="result-name">{emailProgress?.currentName || "..."}</span>
                     <span className="result-email">Sending...</span>
                   </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button 
                className="modal-confirm" 
                onClick={() => setShowResultsModal(false)}
                disabled={sendingEmails}
              >
                {sendingEmails ? "Sending..." : "Done"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brief card styles + modal styles */}
      <style>{`
        .brief-card {
          background: rgba(139, 92, 246, 0.06);
          border: 1px solid rgba(139, 92, 246, 0.15);
          border-radius: 12px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 7px;
          min-width: 340px;
          max-width: 420px;
        }
        .brief-loading {
          display: flex;
          align-items: center;
          padding: 12px;
          background: rgba(139, 92, 246, 0.04);
        }
        .brief-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(139, 92, 246, 0.2);
          border-top-color: #8b5cf6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          flex-shrink: 0;
        }
        .brief-field {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .brief-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          opacity: 0.9;
        }
        .brief-value {
          font-size: 12px;
          color: #d4d4d8;
          line-height: 1.5;
          margin: 0;
        }
        .profile-row-with-brief td {
          vertical-align: top;
          padding-top: 16px;
          padding-bottom: 16px;
        }

        /* ── Modal Styles ── */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 16px;
          animation: fadeIn 0.15s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .modal-box {
          background: #111118;
          border: 1px solid rgba(139, 92, 246, 0.25);
          border-radius: 20px;
          padding: 28px;
          width: 100%;
          max-width: 480px;
          animation: slideUp 0.2s ease;
          box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.1);
        }
        .modal-box-wide { max-width: 600px; }
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .modal-header {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 24px;
        }
        .modal-icon {
          font-size: 32px;
          line-height: 1;
          flex-shrink: 0;
        }
        .modal-title {
          font-size: 20px;
          font-weight: 700;
          color: #fff;
          margin: 0 0 4px;
        }
        .modal-subtitle {
          font-size: 13px;
          color: #71717a;
          margin: 0;
          line-height: 1.5;
        }
        .modal-body { display: flex; flex-direction: column; gap: 16px; }
        .modal-field { display: flex; flex-direction: column; gap: 6px; }
        .modal-label {
          font-size: 12px;
          font-weight: 600;
          color: #a1a1aa;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .modal-input {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 10px 14px;
          color: #fff;
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s;
          width: 100%;
        }
        .modal-input:focus { border-color: rgba(139,92,246,0.5); }
        .modal-hint { font-size: 11px; color: #52525b; }
        .modal-stats {
          display: flex;
          gap: 20px;
          padding: 16px;
          background: rgba(255,255,255,0.03);
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.06);
          margin-top: 8px;
        }
        .modal-stat { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; }
        .modal-stat-value { font-size: 24px; font-weight: 700; }
        .modal-stat-label { font-size: 11px; color: #71717a; }
        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 24px;
        }
        .modal-cancel {
          padding: 10px 20px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.1);
          background: transparent;
          color: #a1a1aa;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s;
        }
        .modal-cancel:hover { background: rgba(255,255,255,0.05); }
        .modal-confirm {
          padding: 10px 20px;
          border-radius: 10px;
          background: linear-gradient(135deg, #10b981, #059669);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: opacity 0.15s, transform 0.1s;
        }
        .modal-confirm:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .modal-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
        .results-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 320px;
          overflow-y: auto;
          padding-right: 4px;
        }
        .result-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-radius: 10px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .result-icon { font-size: 16px; flex-shrink: 0; }
        .result-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
        .result-name { font-size: 13px; font-weight: 600; color: #e4e4e7; }
        .result-email { font-size: 11px; color: #71717a; }
        .result-reason { font-size: 11px; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .result-badge {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 2px 8px;
          border-radius: 20px;
          flex-shrink: 0;
        }
        .result-badge-sent { background: rgba(16,185,129,0.15); color: #34d399; }
        .result-badge-skipped { background: rgba(245,158,11,0.15); color: #fbbf24; }
        .result-badge-failed { background: rgba(239,68,68,0.15); color: #f87171; }
      `}</style>
    </div>
  );
}
