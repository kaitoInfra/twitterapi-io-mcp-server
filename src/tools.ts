/**
 * 12 MCP tools for twitterapi.io.
 *
 * Each tool maps 1:1 to a verified GET endpoint in
 * `/Users/abdc/Documents/gitProject/twitterapi_page/scripts/endpoint-manifest.json`.
 * Tool descriptions are written for LLM consumption — explain WHEN to use and
 * what each parameter means so Claude/Cursor pick the right tool.
 *
 * Pagination convention: every paged endpoint returns `next_cursor`; pass it back
 * as `cursor` for the next page.
 */
import { z } from "zod";
import { twitterApiGet } from "./twitterapi-client.js";
import { compactResponse } from "./transformer.js";

/**
 * Wrap twitterApiGet with LLM-friendly transformer.
 * Strips deeply nested fields (full author profile per tweet, extendedEntities,
 * retweeted_tweet embedding) and flattens {data: {tweets}} → {tweets}.
 * Reduces a 20-tweet response from ~120 KB → ~3 KB so Claude.ai can inline
 * the result instead of stashing to /mnt/user-data/.
 * Pagination signals (has_next_page, next_cursor) are preserved.
 */
async function twitterApiGetCompact(
  path: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const raw = await twitterApiGet(path, input);
  return compactResponse(raw);
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  call: (input: Record<string, unknown>) => Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. search_tweets
// ─────────────────────────────────────────────────────────────────────────
const searchTweetsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Twitter advanced search query string. Supports operators: from:USER, to:USER, since:YYYY-MM-DD, until:YYYY-MM-DD, lang:en, filter:replies, -filter:retweets, has:images, etc. Example: 'from:elonmusk since:2026-01-01 has:images'",
    ),
  queryType: z
    .enum(["Latest", "Top"])
    .describe(
      "'Latest' returns most recent tweets first; 'Top' returns highest-engagement tweets first. Default to 'Latest' for time-sensitive queries.",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Pagination cursor from a previous response's next_cursor field. Omit for first page. Each page returns ~20 tweets.",
    ),
});

// ─────────────────────────────────────────────────────────────────────────
// 2. get_user_info
// ─────────────────────────────────────────────────────────────────────────
const getUserInfoSchema = z.object({
  userName: z
    .string()
    .min(1)
    .describe(
      "Twitter/X screen name (handle) WITHOUT the leading @ sign. Example: 'elonmusk', not '@elonmusk'.",
    ),
});

// ─────────────────────────────────────────────────────────────────────────
// 3. get_user_about
// ─────────────────────────────────────────────────────────────────────────
const getUserAboutSchema = z.object({
  userName: z
    .string()
    .min(1)
    .describe("Twitter/X screen name without @ — fetches the user's profile 'about' / bio page."),
});

// ─────────────────────────────────────────────────────────────────────────
// 4. get_user_followers
// ─────────────────────────────────────────────────────────────────────────
const getUserFollowersSchema = z.object({
  userName: z
    .string()
    .min(1)
    .describe("Twitter/X screen name without @ — fetches followers of this user."),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor from previous response's next_cursor. Omit for first page."),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Followers per page (default 200, max 200). Each follower includes full profile metadata (name, bio, follower count, etc.).",
    ),
});

// ─────────────────────────────────────────────────────────────────────────
// 5. get_user_followings
// ─────────────────────────────────────────────────────────────────────────
const getUserFollowingsSchema = z.object({
  userName: z
    .string()
    .min(1)
    .describe("Twitter/X screen name without @ — fetches accounts this user follows."),
  cursor: z.string().optional().describe("Pagination cursor; omit for first page."),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Followings per page (default 200, max 200). Each includes full profile metadata."),
});

// ─────────────────────────────────────────────────────────────────────────
// 6. get_user_last_tweets
// ─────────────────────────────────────────────────────────────────────────
const getUserLastTweetsSchema = z.object({
  userName: z
    .string()
    .optional()
    .describe(
      "Twitter/X screen name without @ (e.g. 'elonmusk'). Provide EITHER userName OR userId.",
    ),
  userId: z
    .string()
    .optional()
    .describe(
      "Twitter/X numeric user ID (e.g. '44196397'). Provide EITHER userName OR userId. Prefer userId if known — handles can change.",
    ),
  cursor: z.string().optional().describe("Pagination cursor; omit for first page."),
  includeReplies: z
    .boolean()
    .optional()
    .describe(
      "Include the user's reply tweets in addition to top-level tweets. Default false — only top-level tweets.",
    ),
});

// ─────────────────────────────────────────────────────────────────────────
// 7. get_user_mentions
// ─────────────────────────────────────────────────────────────────────────
const getUserMentionsSchema = z.object({
  userName: z
    .string()
    .min(1)
    .describe("Twitter/X screen name without @ — fetches tweets that mention this user (@userName)."),
  sinceTime: z
    .number()
    .int()
    .optional()
    .describe(
      "Unix timestamp (seconds) lower bound — only mentions after this time. Omit for no lower bound.",
    ),
  untilTime: z
    .number()
    .int()
    .optional()
    .describe("Unix timestamp (seconds) upper bound. Omit for no upper bound."),
  cursor: z.string().optional().describe("Pagination cursor; omit for first page (~20 per page)."),
});

// ─────────────────────────────────────────────────────────────────────────
// 8. get_tweets_by_ids
// ─────────────────────────────────────────────────────────────────────────
const getTweetsByIdsSchema = z.object({
  tweet_ids: z
    .string()
    .min(1)
    .describe(
      "Comma-separated tweet IDs (e.g. '1234567890,9876543210'). Batch fetch up to 100 tweets in one call. Tweet IDs are numeric strings.",
    ),
});

// ─────────────────────────────────────────────────────────────────────────
// 9. get_tweet_replies
// ─────────────────────────────────────────────────────────────────────────
const getTweetRepliesSchema = z.object({
  tweetId: z.string().min(1).describe("Numeric ID of the tweet to fetch replies for."),
  cursor: z.string().optional().describe("Pagination cursor; omit for first page (~20 replies per page)."),
  queryType: z
    .enum(["Latest", "Top"])
    .optional()
    .describe("'Latest' or 'Top' — sort order of replies. Default 'Latest'."),
});

// ─────────────────────────────────────────────────────────────────────────
// 10. get_tweet_quotes
// ─────────────────────────────────────────────────────────────────────────
const getTweetQuotesSchema = z.object({
  tweetId: z.string().min(1).describe("Numeric ID of the tweet to fetch quote-tweets for."),
  sinceTime: z.number().int().optional().describe("Unix timestamp (seconds) lower bound."),
  untilTime: z.number().int().optional().describe("Unix timestamp (seconds) upper bound."),
  includeReplies: z
    .boolean()
    .optional()
    .describe("Include reply-type quote-tweets in addition to top-level. Default false."),
  cursor: z.string().optional().describe("Pagination cursor; omit for first page (~20 per page)."),
});

// ─────────────────────────────────────────────────────────────────────────
// 11. get_tweet_retweeters
// ─────────────────────────────────────────────────────────────────────────
const getTweetRetweetersSchema = z.object({
  tweetId: z.string().min(1).describe("Numeric ID of the tweet to fetch retweeters for."),
  cursor: z.string().optional().describe("Pagination cursor; omit for first page (~100 per page)."),
});

// ─────────────────────────────────────────────────────────────────────────
// 12. get_trends
// ─────────────────────────────────────────────────────────────────────────
const getTrendsSchema = z.object({
  woeid: z
    .number()
    .int()
    .describe(
      "Yahoo Where-On-Earth ID for the location. Common values: 1 = Worldwide, 23424977 = USA, 23424975 = UK, 23424856 = Japan. Use 1 for global trends if unsure.",
    ),
  count: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max trends to return (default API behavior; may be silently capped by API)."),
});

// ─────────────────────────────────────────────────────────────────────────
// Tool registry
// ─────────────────────────────────────────────────────────────────────────
export const TOOLS: McpTool[] = [
  {
    name: "search_tweets",
    description:
      "🎯 PRIMARY CHOICE for date-range / historical / keyword-based tweet queries. Use this (NOT get_user_last_tweets) whenever user asks about a SPECIFIC TIME RANGE or historical tweets:\n  • 'tweets from January 2026' → query='from:elonmusk since:2026-01-01 until:2026-02-01'\n  • 'tweets between X and Y' → 'from:USER since:X until:Y'\n  • 'tweets last week / last month' → translate to since:/until: dates\n  • 'tweets containing keyword X by user Y' → 'from:Y X'\n  • 'older tweets' / 'archive' / 'in 2025' → use date range, not pagination\n\nDate format: YYYY-MM-DD (UTC midnight). 'until:' is exclusive (until:2026-02-01 = up to Jan 31).\n\nGeneral: Search Twitter/X for tweets matching a query. Supports the full Twitter advanced search syntax (from:, to:, since:, until:, lang:, filter:, has:, -, OR, etc). Returns ~20 tweets per page in reverse chronological order ('Latest') or by engagement ('Top'). Use this for keyword research, monitoring mentions of a brand/topic, finding tweets in a date range, or any open-ended tweet discovery.",
    inputSchema: searchTweetsSchema,
    call: async (input) =>
      twitterApiGetCompact("/twitter/tweet/advanced_search", input),
  },
  {
    name: "get_user_info",
    description:
      "Fetch basic profile info for a Twitter/X user by their screen name (handle). Returns user ID, display name, bio, follower/following counts, verified status, profile picture, banner, location, website, and account creation date. Use this as the starting point for any user analysis.",
    inputSchema: getUserInfoSchema,
    call: async (input) => twitterApiGetCompact("/twitter/user/info", input),
  },
  {
    name: "get_user_about",
    description:
      "Fetch the extended 'about' / profile page data for a Twitter/X user by screen name. Returns extra profile metadata beyond what get_user_info gives (when available). Use get_user_info first; only call this if you need additional about-page fields.",
    inputSchema: getUserAboutSchema,
    call: async (input) => twitterApiGetCompact("/twitter/user_about", input),
  },
  {
    name: "get_user_followers",
    description:
      "Fetch followers of a Twitter/X user in reverse chronological order (newest first), each with full profile metadata (name, bio, follower count, verified status, etc.). Paginates via cursor. Use this to analyze who follows an account, build follower audiences, or sample for competitive analysis. For large accounts use pagination; you will not get all followers in one call.",
    inputSchema: getUserFollowersSchema,
    call: async (input) => twitterApiGetCompact("/twitter/user/followers", input),
  },
  {
    name: "get_user_followings",
    description:
      "Fetch the accounts a Twitter/X user follows, with full profile metadata. Paginates via cursor. Use this to map a user's interest graph (who they follow signals what they care about).",
    inputSchema: getUserFollowingsSchema,
    call: async (input) => twitterApiGetCompact("/twitter/user/followings", input),
  },
  {
    name: "get_user_last_tweets",
    description:
      "⚠️ ONLY for 'latest / recent / what's new' queries about a user. DO NOT use for date-range queries (e.g. 'tweets from January 2026', 'tweets last week', 'tweets between X and Y', 'tweets in 2025'). For specific dates / older tweets, use **search_tweets** with query like 'from:elonmusk since:2026-01-01 until:2026-02-01'.\n\nFetch the MOST RECENT tweets posted by a Twitter/X user, sorted by created_at descending (newest first). Provide EITHER userName (screen name, no @) OR userId (numeric). Use userId when known — handles can change. Set includeReplies=true to include the user's reply tweets in addition to top-level tweets. Paginates via cursor (~20 per page).",
    inputSchema: getUserLastTweetsSchema,
    call: async (input) => twitterApiGetCompact("/twitter/user/last_tweets", input),
  },
  {
    name: "get_user_mentions",
    description:
      "Fetch tweets that mention a specific Twitter/X user (i.e. tweets containing @userName). Useful for brand monitoring, sentiment tracking on a public figure, or finding conversations involving an account. Supports time-bound queries via sinceTime/untilTime (Unix seconds). Paginates via cursor.",
    inputSchema: getUserMentionsSchema,
    call: async (input) => twitterApiGetCompact("/twitter/user/mentions", input),
  },
  {
    name: "get_tweets_by_ids",
    description:
      "Batch-fetch full tweet objects by their numeric tweet IDs. Pass a comma-separated string of up to 100 IDs. Use this when you already have specific tweet IDs (e.g., from a search result, a URL, or a webhook event) and need the full tweet data — author, text, engagement counts, media, etc.",
    inputSchema: getTweetsByIdsSchema,
    call: async (input) => twitterApiGetCompact("/twitter/tweets", input),
  },
  {
    name: "get_tweet_replies",
    description:
      "Fetch replies to a specific tweet. Pass the numeric tweetId of the root tweet; returns top-level replies (about 20 per page) with full tweet objects. Use this for thread analysis, sentiment on a viral post, or building reply trees.",
    inputSchema: getTweetRepliesSchema,
    call: async (input) => twitterApiGetCompact("/twitter/tweet/replies/v2", input),
  },
  {
    name: "get_tweet_quotes",
    description:
      "Fetch quote-tweets (tweets that quote the given tweetId). Useful for finding commentary on a tweet, measuring reach beyond direct replies. Supports time bounds (sinceTime/untilTime, Unix seconds). Paginates via cursor (~20 per page).",
    inputSchema: getTweetQuotesSchema,
    call: async (input) => twitterApiGetCompact("/twitter/tweet/quotes", input),
  },
  {
    name: "get_tweet_retweeters",
    description:
      "Fetch users who retweeted a specific tweet (the simple 'retweet' action, not quote-tweets — for those use get_tweet_quotes). Returns user profiles with metadata. Paginates via cursor (~100 per page).",
    inputSchema: getTweetRetweetersSchema,
    call: async (input) => twitterApiGetCompact("/twitter/tweet/retweeters", input),
  },
  {
    name: "get_trends",
    description:
      "Fetch current trending topics/hashtags for a location. Pass a Yahoo Where-On-Earth ID (woeid). Common: 1=Worldwide, 23424977=USA, 23424975=UK, 23424856=Japan, 23424848=India, 23424881=South Korea. Use woeid=1 for global trends if you don't know a specific location.",
    inputSchema: getTrendsSchema,
    call: async (input) => twitterApiGetCompact("/twitter/trends", input),
  },
];
