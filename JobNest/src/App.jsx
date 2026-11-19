import { useEffect, useMemo, useState } from "react";
import { Bookmark, BriefcaseBusiness, Check, ChevronDown, Clock3, ExternalLink, Filter, MapPin, Search, Sparkles, X } from "lucide-react";
import { demoJobs } from "./data/jobs";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import AuthPage from "./AuthPage";

const savedFromStorage = () => {
  try {
    const value = JSON.parse(localStorage.getItem("jobnest:saved-jobs") ?? localStorage.getItem("firsthire:saved-jobs") ?? "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
};

function App() {
  const page = window.location.pathname.replace(/\/+$/, "");
  if (["/signin", "/signup", "/reset-password", "/update-password"].includes(page)) {
    const modes = {
      "/signin": "signin",
      "/signup": "signup",
      "/reset-password": "reset",
      "/update-password": "update",
    };
    return <AuthPage mode={modes[page]} />;
  }
  return <JobBoard />;
}

function JobBoard() {
  const [sourceJobs, setSourceJobs] = useState(isSupabaseConfigured ? [] : demoJobs);
  const [connectionState, setConnectionState] = useState(
    isSupabaseConfigured ? "connecting" : "demo"
  );
  const [user, setUser] = useState(null);
  const [authMessage, setAuthMessage] = useState("");
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [workplace, setWorkplace] = useState("All types");
  const [experience, setExperience] = useState("Any experience");
  const [sort, setSort] = useState("Newest first");
  const [saved, setSaved] = useState(savedFromStorage);
  const [savedOnly, setSavedOnly] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);

  useEffect(() => {
    if (!supabase) return undefined;

    let isMounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error("Unable to load the current session:", error.message);
        if (isMounted) setAuthMessage("We couldn't check your sign-in status.");
        return;
      }
      if (isMounted) setUser(data.session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthMessage("");
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const userId = user?.id;

  useEffect(() => {
    if (!userId || !supabase) {
      setSaved(savedFromStorage());
      return undefined;
    }

    let isMounted = true;
    const loadSavedJobs = async () => {
      const localSaved = savedFromStorage();
      if (localSaved.length) {
        const { error } = await supabase.from("saved_jobs").upsert(
          localSaved.map((jobId) => ({ user_id: userId, job_id: jobId })),
          { onConflict: "user_id,job_id", ignoreDuplicates: true }
        );
        if (error) {
          console.error("Unable to sync locally saved jobs:", error.message);
          if (isMounted) setAuthMessage("Some saved jobs could not be synced to your account.");
        }
      }

      const { data, error } = await supabase
        .from("saved_jobs")
        .select("job_id")
        .eq("user_id", userId);
      if (!isMounted) return;
      if (error) {
        console.error("Unable to load saved jobs:", error.message);
        setAuthMessage("We couldn't load your saved jobs. Please try again.");
        return;
      }
      setSaved((data ?? []).map((row) => row.job_id));
    };

    void loadSavedJobs();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!supabase) {
      setConnectionState("demo");
      return;
    }
    let isMounted = true;

    const loadJobs = async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,title,company,location,workplace,employment_type,experience_level,salary_label,tags,description,apply_url,posted_at,is_active")
        .eq("is_active", true)
        .order("posted_at", { ascending: false });

      if (!isMounted) return;
      if (error) {
        console.error("Unable to load jobs from Supabase:", error.message);
        setConnectionState("error");
        return;
      }

      const liveJobs = (data ?? []).map((row) => {
        const postedDate = row.posted_at ? new Date(row.posted_at) : new Date();
        const minutesAgo = Math.max(0, Math.floor((Date.now() - postedDate.getTime()) / 60000));
        const initials = row.company.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
        const workplace = ["Remote", "Hybrid", "On-site", "Not specified"].includes(row.workplace ?? "") ? row.workplace : "Not specified";
        const type = ["Full-time", "Part-time", "Internship", "Contract", "Not specified"].includes(row.employment_type ?? "") ? row.employment_type : "Not specified";
        const experience = ["Entry level", "1–3 years", "3+ years", "Not specified"].includes(row.experience_level ?? "") ? row.experience_level : "Not specified";
        const colors = ["violet", "blue", "green", "orange", "pink", "teal"];
        const colorIndex = Math.abs(String(row.id).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % colors.length;
        return {
          id: String(row.id), title: row.title, company: row.company, companyInitials: initials || "J",
          location: row.location ?? "Location not specified", workplace, type, experience,
          salary: row.salary_label ?? "Salary not listed",
          postedAt: minutesAgo < 60 ? `${minutesAgo} min ago` : minutesAgo < 1440 ? `${Math.floor(minutesAgo / 60)} hr ago` : `${Math.floor(minutesAgo / 1440)} days ago`,
          postedMinutesAgo: minutesAgo, tags: Array.isArray(row.tags) ? row.tags : [],
          description: row.description ?? "No description provided.", applyUrl: row.apply_url ?? "#",
          color: colors[colorIndex],
        };
      });
      setSourceJobs(liveJobs);
      setConnectionState("live");
    };

    void loadJobs();
    const channel = supabase
      .channel("public-jobs-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => { void loadJobs(); })
      .subscribe((status) => {
        if (!isMounted) return;
        if (status === "SUBSCRIBED") setConnectionState("live");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnectionState("error");
      });

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  const toggleSaved = async (id) => {
    const wasSaved = saved.includes(id);
    const next = wasSaved ? saved.filter((item) => item !== id) : [...saved, id];
    setSaved(next);

    if (user && supabase) {
      const result = wasSaved
        ? await supabase.from("saved_jobs").delete().eq("user_id", user.id).eq("job_id", id)
        : await supabase.from("saved_jobs").upsert(
          { user_id: user.id, job_id: id },
          { onConflict: "user_id,job_id", ignoreDuplicates: true }
        );
      if (result.error) {
        console.error("Unable to update saved jobs:", result.error.message);
        setSaved(saved);
        setAuthMessage("We couldn't update your saved jobs. Please try again.");
      }
      return;
    }

    try {
      localStorage.setItem("jobnest:saved-jobs", JSON.stringify(next));
    } catch (error) {
      console.error("Unable to save jobs in this browser:", error);
      setSaved(saved);
      setAuthMessage("We couldn't save this job in your browser.");
    }
  };

  const jobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    const city = location.trim().toLowerCase();
    const filtered = sourceJobs.filter((job) => {
      const matchesQuery = !query || [job.title, job.company, ...job.tags].some((value) => value.toLowerCase().includes(query));
      const matchesLocation = !city || job.location.toLowerCase().includes(city);
      const matchesWorkplace = workplace === "All types" || job.workplace === workplace;
      const matchesExperience = experience === "Any experience" || job.experience === experience;
      const matchesSaved = !savedOnly || saved.includes(job.id);
      return matchesQuery && matchesLocation && matchesWorkplace && matchesExperience && matchesSaved;
    });
    return filtered.sort((a, b) => sort === "Newest first" ? a.postedMinutesAgo - b.postedMinutesAgo : b.postedMinutesAgo - a.postedMinutesAgo);
  }, [sourceJobs, search, location, workplace, experience, sort, saved, savedOnly]);

  const clearFilters = () => {
    setSearch("");
    setLocation("");
    setWorkplace("All types");
    setExperience("Any experience");
    setSavedOnly(false);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Unable to sign out:", error.message);
      setAuthMessage("We couldn't sign you out. Please try again.");
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="JobNest home"><span className="brand-mark"><Sparkles size={19} /></span><span>job<span className="brand-accent">nest</span></span></a>
        <nav className="topnav" aria-label="Main navigation">
          <button className={!savedOnly ? "nav-link active" : "nav-link"} onClick={() => setSavedOnly(false)}>Find jobs</button>
          <button className={savedOnly ? "nav-link active" : "nav-link"} onClick={() => setSavedOnly(true)}>Saved jobs <span className="saved-count">{saved.length}</span></button>
        </nav>
        {user ? (
          <div className="account-actions">
            <span className="account-email">{user.email}</span>
            <button className="account-button" onClick={handleSignOut}>Sign out</button>
          </div>
        ) : (
          <div className="account-actions">
            <a className="account-link" href="/signin">Sign in</a>
            <a className="account-button" href="/signup">Sign up</a>
          </div>
        )}
      </header>
      {authMessage && <p className="auth-status" role="status">{authMessage}</p>}

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="live-dot" /> YOUR NEXT OPPORTUNITY STARTS HERE</div>
            <h1>Good things come<br />to those who <span>apply early.</span></h1>
            <p>Discover fresh opportunities before the crowd. Less searching, more chances to get noticed.</p>
            <div className="hero-proof"><span><Check size={15} /> Fresh listings</span><span><Check size={15} /> Curated roles</span><span><Check size={15} /> Your next move</span></div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="floating-card card-back"><span className="mini-logo violet">P</span><div><b>Product Designer</b><small>Design · Remote</small></div><span className="tiny-pill">New</span></div>
            <div className="floating-card card-front"><span className="mini-logo blue">F</span><div><b>Frontend Developer</b><small>Engineering · Hybrid</small><span className="salary-mini">₹8–12 LPA</span></div><span className="sparkle">✦</span></div>
            <div className="hero-bubble"><Sparkles size={16} /> Just landed</div>
          </div>
        </section>

        <section className="search-panel" aria-label="Search jobs">
          <label className="search-field"><Search size={19} /><span className="sr-only">Search job title or company</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Job title, skill, or company" /></label>
          <span className="field-divider" />
          <label className="search-field location-field"><MapPin size={19} /><span className="sr-only">Location</span><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City or remote" /></label>
          <button className="search-button" onClick={() => setSavedOnly(false)}><Search size={17} /> Search jobs</button>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div><div className="section-kicker">THE OPPORTUNITY BOARD</div><h2>{savedOnly ? "Your saved jobs" : "Fresh jobs, just for you"} <span className="result-count">{jobs.length}</span></h2><p>Thoughtful opportunities for your next career move.</p></div>
            <label className="sort-control"><span>Sort by</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option>Newest first</option><option>Oldest first</option></select><ChevronDown size={15} /></label>
          </div>

          <div className="filters-row">
            <span className="filter-label"><Filter size={15} /> Filters</span>
            <label className="filter-select"><span className="sr-only">Workplace type</span><select value={workplace} onChange={(e) => setWorkplace(e.target.value)}><option>All types</option><option>Remote</option><option>Hybrid</option><option>On-site</option><option>Not specified</option></select><ChevronDown size={14} /></label>
            <label className="filter-select"><span className="sr-only">Experience level</span><select value={experience} onChange={(e) => setExperience(e.target.value)}><option>Any experience</option><option>Entry level</option><option>1–3 years</option><option>3+ years</option><option>Not specified</option></select><ChevronDown size={14} /></label>
            <button className="clear-button" onClick={clearFilters}>Clear filters</button>
            <span className={`demo-note status-${connectionState}`}><span className="live-dot" /> {connectionState === "live" ? "Live database" : connectionState === "connecting" ? "Connecting…" : connectionState === "error" ? "Connection issue" : "Demo listings"}</span>
          </div>

          {jobs.length > 0 ? <div className="job-list">
            {jobs.map((job) => <article className="job-card" key={job.id}>
              <div className={`company-logo ${job.color}`}>{job.companyInitials}</div>
              <div className="job-main">
                <div className="job-company-line"><span className="company-name">{job.company}</span><span className="dot-separator">·</span><span className="posted"><Clock3 size={13} /> {job.postedAt}</span>{job.postedMinutesAgo <= 30 && <span className="new-pill">JUST IN</span>}</div>
                <button className="job-title" onClick={() => setSelectedJob(job)}>{job.title}</button>
                <div className="job-meta"><span><MapPin size={14} />{job.location}</span><span><BriefcaseBusiness size={14} />{job.workplace}</span><span>{job.type}</span></div>
                <div className="tag-list">{job.tags.map((tag) => <span className="skill-tag" key={tag}>{tag}</span>)}</div>
              </div>
              <div className="job-aside"><button className={`bookmark-button ${saved.includes(job.id) ? "is-saved" : ""}`} onClick={() => toggleSaved(job.id)} aria-label={saved.includes(job.id) ? `Remove ${job.title} from saved jobs` : `Save ${job.title}`} title={saved.includes(job.id) ? "Saved" : "Save job"}><Bookmark size={18} fill={saved.includes(job.id) ? "currentColor" : "none"} /></button><div className="salary">{job.salary}</div><span className="experience-label">{job.experience}</span><button className="details-button" onClick={() => setSelectedJob(job)}>View details <span>→</span></button></div>
            </article>)}
          </div> : <div className="empty-state"><div className="empty-icon"><Search size={24} /></div><h3>No jobs found</h3><p>Try a different keyword or remove a filter to see more opportunities.</p><button className="search-button" onClick={clearFilters}>Clear all filters</button></div>}
        </section>
        <footer className="footer"><a className="brand footer-brand" href="#"><span className="brand-mark"><Sparkles size={16} /></span><span>job<span className="brand-accent">nest</span></span></a><span>Find it fresh. Apply with confidence.</span><span>{connectionState === "live" ? <>Job listings provided by <a href="https://www.adzuna.in/" target="_blank" rel="noreferrer">Adzuna</a> · Confirm details on the employer site.</> : connectionState === "demo" ? "Portfolio demo · Listings are sample data" : connectionState === "connecting" ? "Loading live listings…" : "Live listings are temporarily unavailable."}</span></footer>
      </main>

      {selectedJob && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedJob(null); }}>
        <section className="job-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button className="modal-close" onClick={() => setSelectedJob(null)} aria-label="Close job details"><X size={20} /></button>
          <div className={`company-logo modal-logo ${selectedJob.color}`}>{selectedJob.companyInitials}</div>
          <p className="modal-company">{selectedJob.company} · {selectedJob.location}</p>
          <h2 id="modal-title">{selectedJob.title}</h2>
          <div className="modal-pills"><span>{selectedJob.workplace}</span><span>{selectedJob.type}</span><span>{selectedJob.experience}</span></div>
          <h3>About the role</h3><p className="modal-description">{selectedJob.description}</p>
          <h3>Compensation</h3><p className="modal-description">{selectedJob.salary}</p>
          <div className="modal-actions"><button className="save-modal" onClick={() => toggleSaved(selectedJob.id)}><Bookmark size={16} fill={saved.includes(selectedJob.id) ? "currentColor" : "none"} />{saved.includes(selectedJob.id) ? "Saved" : "Save job"}</button><a className="search-button apply-button" href={selectedJob.applyUrl} target="_blank" rel="noreferrer">Continue to application <ExternalLink size={15} /></a></div>
          <p className="demo-warning">Demo listing: the application link is a placeholder. Replace it with a verified employer link before publishing.</p>
        </section>
      </div>}
    </div>
  );
}

export default App;