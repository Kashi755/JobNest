type JobRow = {
  title: string;
  company: string;
  location: string;
  workplace: string;
  employment_type: string;
  experience_level: string;
  salary_label: string;
  tags: string[];
  description: string;
  apply_url: string;
  posted_at: string;
  source_name: string;
  source_job_id: string;
  is_active: boolean;
};

const adzunaBaseUrl = "https://api.adzuna.com/v1/api/jobs/in/search";
const pageSize = 50;
const pageCount = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nestedString(value: unknown, key: string): string {
  return isRecord(value) ? stringValue(value[key]) : "";
}

function salaryLabel(min: unknown, max: unknown): string {
  const format = (amount: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  const salaryMin = typeof min === "number" && Number.isFinite(min) ? min : null;
  const salaryMax = typeof max === "number" && Number.isFinite(max) ? max : null;

  if (salaryMin !== null && salaryMax !== null) {
    return `${format(salaryMin)}–${format(salaryMax)}`;
  }
  if (salaryMin !== null) return `${format(salaryMin)}+`;
  if (salaryMax !== null) return `Up to ${format(salaryMax)}`;
  return "Salary not listed";
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function mapJob(value: unknown): JobRow | null {
  if (!isRecord(value)) return null;
  const rawId = value.id;
  const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
  const title = stringValue(value.title);
  const company = nestedString(value.company, "display_name");
  const applyUrl = stringValue(value.redirect_url);
  const createdAt = stringValue(value.created);
  const postedAt = new Date(createdAt);

  if (!id || !title || !company || !Number.isFinite(postedAt.getTime())) return null;

  let applicationUrl: URL;
  try {
    applicationUrl = new URL(applyUrl);
  } catch {
    return null;
  }
  const host = applicationUrl.hostname.toLowerCase();
  const isAdzunaHost = ["adzuna.in", "adzuna.co.in", "adzuna.com", "adzuna.co.uk"]
    .some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (applicationUrl.protocol === "http:" && isAdzunaHost) {
    applicationUrl.protocol = "https:";
  } else if (applicationUrl.protocol !== "https:") {
    return null;
  }

  const description = plainText(stringValue(value.description));
  const searchableText = `${title} ${description}`.toLowerCase();
  const workplace = /\bremote\b/.test(searchableText)
    ? "Remote"
    : /\bhybrid\b/.test(searchableText)
      ? "Hybrid"
      : /\bon[\s-]?site\b/.test(searchableText)
        ? "On-site"
        : "Not specified";
  const contractType = stringValue(value.contract_type).toLowerCase();
  const contractTime = stringValue(value.contract_time).toLowerCase();
  const employmentType = /\bintern(ship)?\b/.test(title.toLowerCase())
    ? "Internship"
    : contractType.includes("contract")
      ? "Contract"
      : contractTime.includes("part")
        ? "Part-time"
        : contractTime.includes("full") || contractType.includes("permanent")
          ? "Full-time"
          : "Not specified";
  const experienceLevel = /\b(intern|junior|graduate|entry[\s-]level)\b/.test(title.toLowerCase())
    ? "Entry level"
    : "Not specified";
  const category = nestedString(value.category, "label");

  return {
    title,
    company,
    location: nestedString(value.location, "display_name") || "Location not specified",
    workplace,
    employment_type: employmentType,
    experience_level: experienceLevel,
    salary_label: salaryLabel(value.salary_min, value.salary_max),
    tags: category ? [category] : [],
    description: description || "No description provided by the source.",
    apply_url: applicationUrl.toString(),
    posted_at: postedAt.toISOString(),
    source_name: "Adzuna",
    source_job_id: id,
    is_active: true,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const syncToken = Deno.env.get("JOB_SYNC_TOKEN");
  if (!syncToken || request.headers.get("x-job-sync-token") !== syncToken) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const appId = Deno.env.get("ADZUNA_APP_ID");
  const appKey = Deno.env.get("ADZUNA_APP_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!appId || !appKey || !supabaseUrl || !serviceRoleKey) {
    console.error("Missing Adzuna or Supabase Edge Function secrets.");
    return Response.json({ error: "Job sync is not configured." }, { status: 500 });
  }

  const jobs: JobRow[] = [];
  let pagesFetched = 0;
  for (let page = 1; page <= pageCount; page += 1) {
    const url = new URL(`${adzunaBaseUrl}/${page}`);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("results_per_page", String(pageSize));
    url.searchParams.set("sort_by", "date");
    url.searchParams.set("content-type", "application/json");

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      console.error("Unable to contact Adzuna.");
      return Response.json({ error: "Unable to contact the job provider." }, { status: 502 });
    }
    if (!response.ok) {
      console.error("Adzuna returned an error:", response.status);
      return Response.json({ error: "The job provider returned an error." }, { status: 502 });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      console.error("Adzuna returned invalid JSON:", error);
      return Response.json({ error: "The job provider returned invalid data." }, { status: 502 });
    }
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      console.error("Adzuna returned an unexpected response shape.");
      return Response.json({ error: "The job provider returned invalid data." }, { status: 502 });
    }
    pagesFetched = page;
    jobs.push(...payload.results.map(mapJob).filter((job): job is JobRow => job !== null));
    if (payload.results.length < pageSize) break;
  }

  if (jobs.length > 0) {
    const restUrl = new URL("/rest/v1/jobs", supabaseUrl);
    restUrl.searchParams.set("on_conflict", "source_name,source_job_id");
    const upsertResponse = await fetch(restUrl, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(jobs),
    });
    if (!upsertResponse.ok) {
      console.error("Unable to store Adzuna listings:", upsertResponse.status);
      return Response.json({ error: "Unable to store job listings." }, { status: 502 });
    }
  }

  const staleBefore = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const staleUrl = new URL("/rest/v1/jobs", supabaseUrl);
  staleUrl.searchParams.set("source_name", "eq.Adzuna");
  staleUrl.searchParams.set("posted_at", `lt.${staleBefore}`);
  const staleResponse = await fetch(staleUrl, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ is_active: false }),
  });
  if (!staleResponse.ok) {
    console.error("Unable to deactivate expired Adzuna listings:", staleResponse.status);
    return Response.json({ error: "Unable to expire old job listings." }, { status: 502 });
  }

  return Response.json({ imported: jobs.length, pagesFetched });
});
