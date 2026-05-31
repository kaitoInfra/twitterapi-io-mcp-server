/**
 * LLM-friendly response transformer for twitterapi.io MCP server.
 *
 * Problem: backend API returns full Twitter objects with deeply nested fields
 * (full author profile embedded per tweet, extendedEntities media metadata,
 * full retweeted_tweet nesting, etc). A single tweet is ~6.9 KB, 20 tweets =
 * ~120 KB, which exceeds Claude.ai inline context limit (~10-20 KB) and
 * triggers the "Tool result too large for context, stored at /mnt/..." fallback
 * — forcing the LLM to write python parsers, often with wrong schema assumptions.
 *
 * Solution: compact + flatten response before returning to LLM:
 *   - tweets: keep id/text/createdAt/url/engagement + 5 author fields only
 *   - users: keep id/userName/displayName/followers/verified + short bio
 *   - flatten {data: {tweets: [...]}} → {tweets: [...]}
 *   - drop noise: status/code/msg, extendedEntities, nested retweeted_tweet,
 *                 displayTextRange, source, lang, bookmarkCount, card, place
 *   - keep pagination signals (has_next_page, next_cursor) so LLM can decide
 *     to fetch more
 *
 * Reduces single tweet from 6.9 KB → ~250 B (28x smaller).
 * No opt-out parameter — LLMs almost never need the dropped fields; if they
 * truly do, they can call the underlying REST API directly with their API key.
 */

interface CompactTweet {
  id: string;
  text: string;
  createdAt?: string;
  url?: string;
  // author (compact)
  authorUserName?: string;
  authorDisplayName?: string;
  authorIsBlueVerified?: boolean;
  authorFollowers?: number;
  // engagement
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  // reply context
  isReply?: boolean;
  inReplyToId?: string | null;
  conversationId?: string;
  // links to nested tweets (not embedded)
  retweetedTweetId?: string;
  quotedTweetId?: string;
  // media presence (no URLs / metadata, LLM rarely needs)
  hasMedia?: boolean;
  mediaCount?: number;
  lang?: string;
}

interface CompactUser {
  id?: string;
  userName?: string;
  displayName?: string;
  description?: string;
  isVerified?: boolean;
  isBlueVerified?: boolean;
  followers?: number;
  following?: number;
  statusesCount?: number;
  createdAt?: string;
  location?: string;
  profileImageUrl?: string;
}

interface CompactTrend {
  name?: string;
  url?: string;
  tweetVolume?: number;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Recursively drop null / "" / [] / {} fields.
 * Used as fallback polish when response shape is unknown (e.g. get_user_info
 * returns raw user object directly under `data`, no user-collection wrapper).
 * Reduces noise like `affiliatesHighlightedLabel: {}` / `pinnedTweetIds: []` /
 * `verifiedType: null` / `coverPicture: ""` that LLMs don't need.
 * Returns undefined for fully-empty inputs; caller decides fallback.
 */
function dropEmpty(x: unknown): unknown {
  if (x === null || x === undefined || x === "") return undefined;
  if (Array.isArray(x)) {
    if (x.length === 0) return undefined;
    const cleaned = x.map(dropEmpty).filter((v) => v !== undefined);
    return cleaned.length === 0 ? undefined : cleaned;
  }
  if (typeof x === "object") {
    const out: Record<string, unknown> = {};
    let hasKey = false;
    for (const [k, v] of Object.entries(x)) {
      const cleaned = dropEmpty(v);
      if (cleaned !== undefined) {
        out[k] = cleaned;
        hasKey = true;
      }
    }
    return hasKey ? out : undefined;
  }
  return x;
}

function num(x: unknown): number | undefined {
  if (typeof x === "number") return x;
  if (typeof x === "string" && /^\d+$/.test(x)) return Number(x);
  return undefined;
}

function str(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

/**
 * Compact a single tweet object. Drops ~95% of bytes while keeping everything
 * LLMs typically need (text, engagement signals, author handle, reply context).
 */
export function compactTweet(t: unknown): CompactTweet | null {
  if (!isObj(t)) return null;

  const author = isObj(t.author) ? t.author : {};
  const entities = isObj(t.entities) ? t.entities : {};
  const extEntities = isObj(t.extendedEntities) ? t.extendedEntities : {};

  // media count (lightweight signal — no URLs)
  const media = Array.isArray(extEntities.media)
    ? extEntities.media
    : Array.isArray((entities as { media?: unknown }).media)
      ? ((entities as { media?: unknown[] }).media as unknown[])
      : [];

  const out: CompactTweet = {
    id: str(t.id) ?? "",
    text: str(t.text) ?? "",
  };

  const createdAt = str(t.createdAt);
  if (createdAt) out.createdAt = createdAt;
  const url = str(t.url) ?? str(t.twitterUrl);
  if (url) out.url = url;

  // author (5 fields, not full profile)
  const userName = str(author.userName) ?? str(author.screen_name);
  if (userName) out.authorUserName = userName;
  const displayName = str(author.name) ?? str(author.displayName);
  if (displayName) out.authorDisplayName = displayName;
  if (typeof author.isBlueVerified === "boolean") out.authorIsBlueVerified = author.isBlueVerified;
  const followers = num(author.followers) ?? num(author.followersCount);
  if (followers !== undefined) out.authorFollowers = followers;

  // engagement
  const like = num(t.likeCount);
  if (like !== undefined) out.likeCount = like;
  const rt = num(t.retweetCount);
  if (rt !== undefined) out.retweetCount = rt;
  const reply = num(t.replyCount);
  if (reply !== undefined) out.replyCount = reply;
  const quote = num(t.quoteCount);
  if (quote !== undefined) out.quoteCount = quote;
  const view = num(t.viewCount);
  if (view !== undefined) out.viewCount = view;

  // reply context
  if (typeof t.isReply === "boolean") out.isReply = t.isReply;
  if (t.inReplyToId !== undefined) out.inReplyToId = str(t.inReplyToId) ?? null;
  const conv = str(t.conversationId);
  if (conv) out.conversationId = conv;

  // nested tweet refs — store ID only, not full nested object
  if (isObj(t.retweeted_tweet)) {
    const rid = str(t.retweeted_tweet.id);
    if (rid) out.retweetedTweetId = rid;
  }
  if (isObj(t.quoted_tweet)) {
    const qid = str(t.quoted_tweet.id);
    if (qid) out.quotedTweetId = qid;
  }

  // media: just count, not URLs/dimensions
  if (media.length > 0) {
    out.hasMedia = true;
    out.mediaCount = media.length;
  }

  const lang = str(t.lang);
  if (lang && lang !== "und") out.lang = lang;

  return out;
}

/**
 * Compact a user/profile object. Drops banner image, entities, verifiedType,
 * affiliations etc — keeps only what LLMs need to identify and reason about
 * the account.
 */
export function compactUser(u: unknown): CompactUser | null {
  if (!isObj(u)) return null;
  const out: CompactUser = {};
  const id = str(u.id) ?? str(u.userId);
  if (id) out.id = id;
  const userName = str(u.userName) ?? str(u.screen_name);
  if (userName) out.userName = userName;
  const displayName = str(u.name) ?? str(u.displayName);
  if (displayName) out.displayName = displayName;
  const desc = str(u.description);
  if (desc) out.description = desc.length > 280 ? desc.slice(0, 280) + "…" : desc;
  if (typeof u.isVerified === "boolean") out.isVerified = u.isVerified;
  if (typeof u.isBlueVerified === "boolean") out.isBlueVerified = u.isBlueVerified;
  const followers = num(u.followers) ?? num(u.followersCount);
  if (followers !== undefined) out.followers = followers;
  const following = num(u.following) ?? num(u.followingCount) ?? num(u.friendsCount);
  if (following !== undefined) out.following = following;
  const statuses = num(u.statusesCount);
  if (statuses !== undefined) out.statusesCount = statuses;
  const createdAt = str(u.createdAt);
  if (createdAt) out.createdAt = createdAt;
  const loc = str(u.location);
  if (loc) out.location = loc;
  const pfp = str(u.profilePicture) ?? str(u.profileImageUrl);
  if (pfp) out.profileImageUrl = pfp;
  return out;
}

function compactTrend(t: unknown): CompactTrend | null {
  if (!isObj(t)) return null;
  const out: CompactTrend = {};
  const name = str(t.name) ?? str(t.trend);
  if (name) out.name = name;
  const url = str(t.url);
  if (url) out.url = url;
  const vol = num(t.tweet_volume) ?? num(t.tweetVolume);
  if (vol !== undefined) out.tweetVolume = vol;
  return out;
}

function compactArray<T>(
  arr: unknown,
  fn: (x: unknown) => T | null,
): T[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const out: T[] = [];
  for (const item of arr) {
    const c = fn(item);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Top-level transformer. Auto-detects response shape and applies compact fns
 * to known collections. Falls back to raw response if structure is unknown
 * (e.g. error response, new endpoint shape).
 *
 * Flattens common nesting:
 *   {status, code, msg, data: {tweets, pin_tweet}, has_next_page, next_cursor}
 *     → {tweets, pin_tweet, has_next_page, next_cursor}
 */
export function compactResponse(raw: unknown): unknown {
  if (!isObj(raw)) return raw;

  // unwrap {data: {...}} nesting if present
  const payload: Record<string, unknown> = isObj(raw.data)
    ? { ...(raw.data as Record<string, unknown>) }
    : { ...raw };

  // preserve top-level pagination signals (they live on raw, not data)
  const pagination: Record<string, unknown> = {};
  if (typeof raw.has_next_page === "boolean") pagination.has_next_page = raw.has_next_page;
  if (raw.next_cursor !== undefined && raw.next_cursor !== "") pagination.next_cursor = raw.next_cursor;
  if (raw.cursor !== undefined && raw.cursor !== "") pagination.cursor = raw.cursor;

  const out: Record<string, unknown> = {};

  // tweet collections
  const tweets = compactArray(payload.tweets, compactTweet);
  if (tweets) out.tweets = tweets;
  if (isObj(payload.pin_tweet)) {
    const pt = compactTweet(payload.pin_tweet);
    if (pt) out.pin_tweet = pt;
  }
  // single tweet (e.g. wrapped in {tweet: {...}})
  if (isObj(payload.tweet) && !out.tweets) {
    const t = compactTweet(payload.tweet);
    if (t) out.tweet = t;
  }

  // user collections
  const users = compactArray(payload.users, compactUser);
  if (users) out.users = users;
  const followers = compactArray(payload.followers, compactUser);
  if (followers) out.followers = followers;
  const followings = compactArray(payload.followings, compactUser);
  if (followings) out.followings = followings;
  const retweeters = compactArray(payload.retweeters, compactUser);
  if (retweeters) out.retweeters = retweeters;
  // single user
  if (isObj(payload.user) && !out.users) {
    const u = compactUser(payload.user);
    if (u) out.user = u;
  }
  if (isObj(payload.userInfo) && !out.user) {
    const u = compactUser(payload.userInfo);
    if (u) out.user = u;
  }
  // Polish (2026-05-31): `data` field itself is the user object (no `data.user` wrapper)
  // — backend /twitter/user/info returns {status, code, msg, data: {id, userName, ...}}.
  // Detect: payload has userName/screen_name + no recognized collection → treat as user.
  if (
    !out.user &&
    !out.tweets &&
    !out.users &&
    !out.trends &&
    (isObj(raw.data) && (str((raw.data as Record<string, unknown>).userName) || str((raw.data as Record<string, unknown>).screen_name)))
  ) {
    const u = compactUser(raw.data);
    if (u) out.user = u;
  }

  // trends
  const trends = compactArray(payload.trends, compactTrend);
  if (trends) out.trends = trends;

  // merge pagination signals
  Object.assign(out, pagination);

  // unknown structure → fallback to raw, but dropEmpty first to remove
  // null / "" / [] / {} noise so LLM still sees a cleaner version
  if (Object.keys(out).length === 0) {
    const cleaned = dropEmpty(raw);
    return cleaned ?? raw;
  }

  return out;
}
