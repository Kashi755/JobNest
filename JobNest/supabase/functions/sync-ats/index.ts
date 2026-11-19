type Provider = "greenhouse" | "lever";

type Board = {
  provider: Provider;
  board: string;
  company: string;
  location?: string;
};

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
  last_seen_at: string;
  is_active: boolean;
};

type SyncedBoard = {
  sourceName: string;
  jobs: JobRow[];
};

const batchSize = 100;
const maxBoards = 50;
const boardPattern = /^[A-Za-z0-9_-]+$/;
const jobIdPattern = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nestedString(value: unknown, key: string): string {
  return isRecord(value) ? stringValue(value[key]) : "";
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

function dateValue(value: unknown): Date | null {
  const date =
    typeof value === "number" && Number.isFinite(value)
      ? new Date(value)
      : typeof value === "string"
        ? new Date(value)
        : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function arrayStrings(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => nestedString(item, key))
    .filter((item) => item.length > 0);
}

function boardSourceName(board: Board): string {
  return `${board.provider === "greenhouse" ? "Greenhouse" : "Lever"}:${board.board}`;
}

function mapJob(value: unknown, board: Board, seenAt: string): JobRow | null {
  if (!isRecord(value)) return null;

  const rawId = value.id;
  const id =
    typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
  const title =
    board.provider === "greenhouse" ? stringValue(value.title) : stringValue(value.text);
  const company = board.company;
  const rawApplyUrl =
    board.provider === "greenhouse"
      ? stringValue(value.absolute_url)
      : stringValue(value.hostedUrl);
  const postedAt = dateValue(
    board.provider === "greenhouse" ? value.updated_at : value.createdAt,
  );

  if (!id || !jobIdPattern.test(id) || !title || !company || !postedAt) return null;

  let applyUrl: URL;
  try {
    applyUrl = new URL(rawApplyUrl);
  } catch {
    return null;
  }
  if (applyUrl.protocol !== "https:") return null;

  const category = isRecord(value.categories) ? value.categories : {};
  const greenhouseLocation =
    nestedString(value.location, "name") ||
    arrayStrings(value.offices, "location").join(", ");
  const location =
    board.provider === "greenhouse"
      ? greenhouseLocation
      : stringValue(category.location);
  const description = plainText(
    board.provider === "greenhouse"
      ? stringValue(value.content)
      : stringValue(value.descriptionPlain) || stringValue(value.description),
  );
  const team =
    board.provider === "greenhouse"
      ? arrayStrings(value.departments, "name")
      : [stringValue(category.team), stringValue(category.department)].filter(Boolean);
  const searchableText = [
    title,
    description,
    location,
    stringValue(value.workplaceType),
  ]
    .join(" ")
    .toLowerCase();
  const workplace = /\bremote\b/.test(searchableText)
    ? "Remote"
    : /\bhybrid\b/.test(searchableText)
      ? "Hybrid"
      : /\bon[\s-]?site\b/.test(searchableText)
        ? "On-site"
        : "Not specified";
  const commitment = stringValue(category.commitment).toLowerCase();
  const employmentType = /\bintern(ship)?\b/.test(title.toLowerCase())
    ? "Internship"
    : /\bcontract\b/.test(commitment)
      ? "Contract"
      : /\bpart[\s-]?time\b/.test(commitment)
        ? "Part-time"
        : /\bfull[\s-]?time\b/.test(commitment)
          ? "Full-time"
          : "Not specified";
  const experienceLevel = /\b(intern|junior|graduate|entry[\s-]level)\b/i.test(title)
    ? "Entry level"
    : "Not specified";

  return {
    title,
    company,
    location: location || board.location || "Location not specified",
    workplace,
    employment_type: employmentType,
    experience_level: experienceLevel,
    salary_label: "Salary not listed",
    tags: [...new Set(team)],
    description: description || "No description provided by the source.",
    apply_url: applyUrl.toString(),
    posted_at: postedAt.toISOString(),
    source_name: boardSourceName(board),
    source_job_id: id,
    last_seen_at: seenAt,
    is_active: true,
  };
}

function parseBoards(value: string | undefined): Board[] {
  if (!value) throw new Error("ATS_BOARDS is not configured.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    console.error("ATS_BOARDS is not valid JSON:", error);
    throw new Error("ATS_BOARDS must contain valid JSON.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > maxBoards) {
    throw new Error(`ATS_BOARDS must be an array of 1 to ${maxBoards} boards.`);
  }

  const boards = parsed.map((item): Board => {
    if (!isRecord(item)) throw new Error("Each ATS board must be an object.");
    const provider = item.provider;
    const board = stringValue(item.board);
    const company = stringValue(item.company);
    const location = stringValue(item.location);
    if (
      (provider !== "greenhouse" && provider !== "lever") ||
      !boardPattern.test(board) ||
      !company ||
      (item.location !== undefined && typeof item.location !== "string")
    ) {
      throw new Error("Each ATS board needs a valid provider, board, company, and optional location.");
    }
    return { provider, board, company, location };
  });

  const uniqueBoards = new Set(
    boards.map((board) => `${board.provider}:${board.board.toLowerCase()}`),
  );
  if (uniqueBoards.size !== boards.length) {
    throw new Error("ATS_BOARDS cannot contain duplicate provider and board pairs.");
  }
  return boards;
}

function boardUrl(board: Board): URL {
  return board.provider === "greenhouse"
    ? new URL(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.board)}/jobs?content=true`,
      )
    : new URL(
        `https://api.lever.co/v0/postings/${encodeURIComponent(board.board)}?mode=json`,
      );
}

async function fetchBoard(board: Board, seenAt: string): Promise<SyncedBoard> {
  let response: Response;
  try {
    response = await fetch(boardUrl(board), {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    console.error(`Unable to contact ${boardSourceName(board)}:`, error);
    throw new Error(`Unable to contact ${boardSourceName(board)}.`);
  }
  if (!response.ok) {
    console.error(`${boardSourceName(board)} returned an error:`, response.status);
    throw new Error(`${boardSourceName(board)} returned an error.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    console.error(`${boardSourceName(board)} returned invalid JSON:`, error);
    throw new Error(`${boardSourceName(board)} returned invalid data.`);
  }

  const rawJobs =
    board.provider === "greenhouse"
      ? isRecord(payload)
        ? payload.jobs
        : null
      : payload;
  if (!Array.isArray(rawJobs)) {
    console.error(`${boardSourceName(board)} returned an unexpected response shape.`);
    throw new Error(`${boardSourceName(board)} returned invalid data.`);
  }

  const jobs = rawJobs
    .map((job) => mapJob(job, board, seenAt))
    .filter((job): job is JobRow => job !== null);
  if (jobs.length !== rawJobs.length) {
    console.error(`${boardSourceName(board)} returned invalid job records.`);
    throw new Error(`${boardSourceName(board)} returned invalid job records.`);
  }
  return { sourceName: boardSourceName(board), jobs };
}

function supabaseHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

async function updateJobs(
  url: URL,
  serviceRoleKey: string,
  body: unknown,
  prefer?: string,
): Promise<void> {
  const headers = supabaseHeaders(serviceRoleKey);
  if (prefer) headers["Prefer"] = prefer;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("Unable to store ATS listings:", error);
    throw new Error("Unable to store job listings.");
  }
  if (!response.ok) {
    console.error("Unable to store ATS listings:", response.status);
    throw new Error("Unable to store job listings.");
  }
}

async function deactivateMissingJobs(
  supabaseUrl: string,
  serviceRoleKey: string,
  sourceName: string,
  syncStartedAt: string,
): Promise<void> {
  const staleUrl = new URL("/rest/v1/jobs", supabaseUrl);
  staleUrl.searchParams.set("source_name", `eq.${sourceName}`);
  staleUrl.searchParams.set("or", `(last_seen_at.is.null,last_seen_at.lt.${syncStartedAt})`);

  let response: Response;
  try {
    response = await fetch(staleUrl, {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(serviceRoleKey),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ is_active: false }),
    });
  } catch (error) {
    console.error(`Unable to deactivate missing ${sourceName} listings:`, error);
    throw new Error("Unable to expire missing job listings.");
  }
  if (!response.ok) {
    console.error(`Unable to deactivate missing ${sourceName} listings:`, response.status);
    throw new Error("Unable to expire missing job listings.");
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const syncToken = Deno.env.get("JOB_SYNC_TOKEN");
  if (!syncToken || request.headers.get("x-job-sync-token") !== syncToken) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase Edge Function secrets.");
    return Response.json({ error: "Job sync is not configured." }, { status: 500 });
  }

  let boards: Board[];
  try {
    boards = parseBoards(Deno.env.get("ATS_BOARDS"));
  } catch (error) {
    console.error("Invalid ATS board configuration:", error);
    return Response.json({ error: "ATS board configuration is invalid." }, { status: 500 });
  }

  const syncStartedAt = new Date().toISOString();
  let syncedBoards: SyncedBoard[];
  try {
    syncedBoards = await Promise.all(
      boards.map((board) => fetchBoard(board, syncStartedAt)),
    );
  } catch (error) {
    console.error("ATS sync stopped before database updates:", error);
    return Response.json({ error: "Unable to fetch all configured job boards." }, { status: 502 });
  }

  let imported = 0;
  let completedBoards = 0;
  try {
    for (const syncedBoard of syncedBoards) {
      for (let offset = 0; offset < syncedBoard.jobs.length; offset += batchSize) {
        const upsertUrl = new URL("/rest/v1/jobs", supabaseUrl);
        upsertUrl.searchParams.set("on_conflict", "source_name,source_job_id");
        await updateJobs(
          upsertUrl,
          serviceRoleKey,
          syncedBoard.jobs.slice(offset, offset + batchSize),
          "resolution=merge-duplicates,return=minimal",
        );
      }
      imported += syncedBoard.jobs.length;
      await deactivateMissingJobs(
        supabaseUrl,
        serviceRoleKey,
        syncedBoard.sourceName,
        syncStartedAt,
      );
      completedBoards += 1;
    }
  } catch (error) {
    console.error("ATS sync failed while updating the database:", error);
    return Response.json({ error: "Unable to store or expire job listings." }, { status: 502 });
  }

  return Response.json({ imported, syncedBoards: completedBoards });
});
