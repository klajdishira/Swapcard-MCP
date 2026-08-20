# Swapcard MCP Server

A Model Context Protocol (MCP) server covering the full Swapcard API surface — Content, Leads, Analytics export, and Webhooks.

## Tools

| Category | Tool | Description |
|---|---|---|
| **Events** | `swapcard_get_event` | Get a single event by ID |
| | `swapcard_get_events` | Get multiple events by IDs |
| **People** | `swapcard_list_event_people` | List/search attendees with filters |
| | `swapcard_import_event_people` | Bulk create/update people (groups, barcodes, speaker roles, exhibitor membership) |
| | `swapcard_delete_event_people` | Delete people from an event |
| **Sessions** | `swapcard_list_sessions` | List/search sessions with format/speaker/event filters |
| | `swapcard_import_sessions` | Bulk create/update sessions |
| | `swapcard_delete_sessions` | Delete sessions |
| **Exhibitors** | `swapcard_list_exhibitors` | List/search exhibitors |
| | `swapcard_upsert_exhibitors` | Bulk create/update exhibitors |
| | `swapcard_update_exhibitor` | Update a single exhibitor |
| | `swapcard_delete_exhibitors` | Delete exhibitors |
| **Documents** | `swapcard_list_event_documents` | List event documents |
| | `swapcard_create_event_document` | Attach a document to an event |
| | `swapcard_update_event_document` | Update a document |
| | `swapcard_delete_event_documents` | Delete documents |
| | `swapcard_create_document` | Create a community-level document (v2) |
| | `swapcard_update_document` | Update a community-level document (v2) |
| **Custom Fields** | `swapcard_get_custom_fields` | Get field definitions by target |
| | `swapcard_get_select_field_options` | Get Select/MultiSelect option values |
| | `swapcard_create_custom_field` | Create a custom field definition |
| | `swapcard_update_custom_field` | Update a custom field definition |
| | `swapcard_delete_custom_fields` | Delete custom field definitions |
| **Meetings** | `swapcard_list_meetings` | List meetings with status/date filters |
| **Webhooks** | `swapcard_list_webhooks` | List webhook subscriptions |
| | `swapcard_create_webhook` | Register a new webhook |
| | `swapcard_update_webhook` | Update a webhook |
| | `swapcard_delete_webhook` | Delete a webhook |
| **Leads** | `swapcard_get_my_exhibitors` | Exhibitors accessible to the Leads API token |
| | `swapcard_get_my_leads` | Get scanned leads for an exhibitor |
| | `swapcard_scan_badges` | Scan attendee badges with optional rating and note |
| **Analytics** | `swapcard_export_analytics` | Export raw analytics records (REST, ~10 min delay) |

## Setup

### 1. Get API tokens

| Token | Where to create |
|---|---|
| `SWAPCARD_CONTENT_TOKEN` | https://studio.swapcard.com/api-keys (Organizer role) |
| `SWAPCARD_LEADS_TOKEN` | Event Studio → Integrations → API Keys |
| `SWAPCARD_ANALYTICS_TOKEN` | Same as Content token (defaults to it if unset) |

### 2. Build

```bash
npm install
npm run build
```

### 3. Add to Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "swapcard": {
      "command": "node",
      "args": ["/Users/klajdishira/Documents/Swapcard-MCP/dist/index.js"],
      "env": {
        "SWAPCARD_CONTENT_TOKEN": "your-content-api-token",
        "SWAPCARD_LEADS_TOKEN": "your-leads-api-token",
        "SWAPCARD_ANALYTICS_TOKEN": "your-analytics-token"
      }
    }
  }
}
```

### 4. Add to Claude Code (CLI)

In your project's `.claude/settings.json` or `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "swapcard": {
      "command": "node",
      "args": ["/Users/klajdishira/Documents/Swapcard-MCP/dist/index.js"],
      "env": {
        "SWAPCARD_CONTENT_TOKEN": "your-content-api-token",
        "SWAPCARD_LEADS_TOKEN": "your-leads-api-token"
      }
    }
  }
}
```

## Rate Limits (Content API)

- 60,000 points/minute
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Mutations = 1,000 pts; objects = 2 pts; scalars = 1 pt; 1.5× depth multiplier

## Analytics delay

- Analytics Export REST API: ~10 minutes
- Analytics GraphQL API: ~15 minutes
