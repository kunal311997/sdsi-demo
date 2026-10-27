/** Persistence shapes and service-level contracts. */

/** Row shape of the `links` table (snake_case, as stored). */
export interface LinkRow {
  id: number;
  code: string;
  url: string;
  url_hash: string;
  /** 1 when the code was chosen by the user, 0 when generated. */
  alias: number;
  created_at: number;
  expires_at: number | null;
  deleted_at: number | null;
  click_count: number;
  last_accessed_at: number | null;
}

/** Row shape of the `clicks` table. */
export interface ClickRow {
  id: number;
  code: string;
  clicked_at: number;
  ip_hash: string | null;
  user_agent: string | null;
  referer: string | null;
}

/** A click to be recorded; `ipHash` is already HMAC'd, never a raw IP. */
export interface NewClick {
  code: string;
  clickedAt: number;
  ipHash: string | null;
  userAgent: string | null;
  referer: string | null;
}

export interface CreateLinkInput {
  url: unknown;
  alias?: unknown;
  expiresAt?: unknown;
}

export interface CreateLinkResult {
  link: LinkRow;
  shortUrl: string;
  /** false when an existing code was returned for an already-known URL. */
  created: boolean;
}

export interface ResolveResult {
  link: LinkRow;
  /** Absolute target URL to redirect to. */
  targetUrl: string;
}

export interface DailyClicksEntry {
  /** UTC calendar date, `YYYY-MM-DD`. */
  date: string;
  clicks: number;
}

export interface LinkStats {
  code: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
  deletedAt: string | null;
  expired: boolean;
  totalClicks: number;
  uniqueVisitors: number;
  lastAccessedAt: string | null;
  firstAccessedAt: string | null;
  /** Dense series: one entry per day from (lastAccess or createdAt) to today, UTC. */
  clicksPerDay: DailyClicksEntry[];
  clickDays: number;
}

export interface LinkSummary {
  code: string;
  shortUrl: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  clickCount: number;
  lastAccessedAt: string | null;
}

export interface ListLinksResult {
  items: LinkSummary[];
  total: number;
  limit: number;
  offset: number;
}
