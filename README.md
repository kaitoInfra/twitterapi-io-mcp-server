# twitterapi.io MCP Server

[![npm version](https://img.shields.io/npm/v/@twitterapi-io/mcp-server.svg)](https://www.npmjs.com/package/@twitterapi-io/mcp-server)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP Spec 2025-11-25](https://img.shields.io/badge/MCP-2025--11--25-green)](https://modelcontextprotocol.io/specification)

Official [Model Context Protocol](https://modelcontextprotocol.io) server for **[twitterapi.io](https://twitterapi.io)** — Twitter / X data API for AI agents and applications.

Connect Claude Desktop, Cursor, VS Code Copilot, or any MCP client to twitterapi.io and search tweets, fetch user profiles, get followers, replies, trends, and more — all from natural language.

## Features

12 read-only tools mapped 1:1 to twitterapi.io's verified production endpoints:

| Tool | What it does |
|---|---|
| `search_tweets` | Advanced search with Twitter operators (`from:`, `since:`, `lang:`, `has:`, …) |
| `get_user_info` | User profile basics by screen name |
| `get_user_about` | Extended profile / about page |
| `get_user_followers` | Followers with full profile metadata (paginated) |
| `get_user_followings` | Following list with profile metadata (paginated) |
| `get_user_last_tweets` | A user's recent tweets (timeline) |
| `get_user_mentions` | Tweets that mention a user |
| `get_tweets_by_ids` | Batch fetch tweets by ID (up to 100) |
| `get_tweet_replies` | Replies to a tweet |
| `get_tweet_quotes` | Quote-tweets of a tweet |
| `get_tweet_retweeters` | Users who retweeted a tweet |
| `get_trends` | Trending topics by location (WOEID) |

## Quick Start

### 1. Get an API key

Sign up at [twitterapi.io](https://twitterapi.io) — free tier available.

### 2. Configure your MCP client

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "twitterapi-io": {
      "command": "npx",
      "args": ["-y", "@twitterapi-io/mcp-server"],
      "env": {
        "TWITTERAPI_IO_API_KEY": "your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. The 12 tools will be available in any chat — Claude will pick the right one based on your prompt.

#### Cursor

Open Settings → MCP → Add new MCP Server:

```json
{
  "mcpServers": {
    "twitterapi-io": {
      "command": "npx",
      "args": ["-y", "@twitterapi-io/mcp-server"],
      "env": {
        "TWITTERAPI_IO_API_KEY": "your_key_here"
      }
    }
  }
}
```

#### VS Code (Copilot Chat with MCP)

Add to your MCP servers config — same shape as Claude Desktop / Cursor.

#### Claude Code

```bash
claude mcp add twitterapi-io npx -- -y @twitterapi-io/mcp-server -e TWITTERAPI_IO_API_KEY=your_key_here
```

### 3. Use it

In any MCP-enabled chat:

> "Find recent tweets from @elonmusk about AI in the last week"

> "Get the follower list of @sama and show me the top 20 by follower count"

> "What are the current trending topics in Japan?"

Claude (or your client) will automatically pick `search_tweets` / `get_user_followers` / `get_trends` and call them with the right parameters.

## Authentication

Authentication is via the `TWITTERAPI_IO_API_KEY` environment variable, injected by your MCP client. The server **never** stores or logs the key. Each tool call sends the key in the `X-API-Key` header to `https://api.twitterapi.io`.

## Pagination

Tools that return lists (followers, replies, search results, etc.) return a `next_cursor` field. Pass it back as the `cursor` argument on the next call to page through. Each page is typically ~20 items.

## Error handling

- 429 / 5xx responses are automatically retried with exponential backoff (3 attempts, 1s/2s/4s)
- Network timeouts: 30s per request
- 4xx errors (other than 429) surface immediately to the LLM with the original message

## Tools — full spec

Each tool's input schema is exposed via MCP's `tools/list` and follows JSON Schema. Run `npx @twitterapi-io/mcp-server` with `mcp-inspector` to browse interactively:

```bash
npx @modelcontextprotocol/inspector npx -y @twitterapi-io/mcp-server
```

## What's NOT included

By design, this server exposes **read-only** endpoints. The following are **intentionally excluded** to keep the server safe for autonomous agent use:

- ❌ Posting tweets, likes, retweets, follows, DMs
- ❌ Account login / 2FA
- ❌ Profile / banner / avatar editing
- ❌ Media upload
- ❌ Account deletion
- ❌ Realtime stream / webhook setup (does not fit the MCP request/response model)

These features are available in the full [twitterapi.io REST API](https://docs.twitterapi.io) — use it directly if you need write access.

## Spec compliance

- Built on `@modelcontextprotocol/sdk` v1
- Targets MCP spec **2025-11-25** (latest)
- Transport: **stdio** (Streamable HTTP planned for v0.2+ for remote/hosted use)
- Tested with: `mcp-inspector`, Claude Desktop, Cursor, Claude Code

## Development

```bash
git clone https://github.com/kaitoInfra/twitterapi-io-mcp-server.git
cd twitterapi-io-mcp-server
npm install
npm run build
TWITTERAPI_IO_API_KEY=xxx npm run inspect  # opens mcp-inspector
```

## Links

- 🔗 [twitterapi.io](https://twitterapi.io) — REST API homepage + signup
- 📖 [twitterapi.io docs](https://docs.twitterapi.io) — full API reference
- 🧰 [Model Context Protocol](https://modelcontextprotocol.io) — protocol homepage
- 🐛 [Report issues](https://github.com/kaitoInfra/twitterapi-io-mcp-server/issues)

## License

MIT © twitterapi.io
