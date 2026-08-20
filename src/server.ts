import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const CONTENT_URL   = "https://developer.swapcard.com/event-admin/graphql";
const LEADS_URL     = "https://developer.swapcard.com/exhibitor/graphql";
const ANALYTICS_URL = "https://developer.swapcard.com/event-admin/export/analytics";

function token(key: string): string {
  return process.env[key] ?? "";
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

export async function gql(
  url: string,
  authToken: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authToken },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  const json = JSON.parse(text) as { data?: unknown; errors?: unknown[] };
  if (json.errors?.length) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

async function restPost(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(ANALYTICS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token("SWAPCARD_ANALYTICS_TOKEN") || token("SWAPCARD_CONTENT_TOKEN")}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ─── Tool registry ────────────────────────────────────────────────────────────

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
export const handlers = new Map<string, Handler>();

function register(name: string, handler: Handler) {
  handlers.set(name, handler);
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const tools: Tool[] = [
  // ── Events ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_get_event",
    description: "Get a single Swapcard event by ID, including title, dates, description, address, groups, community, and stats.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "The event ID" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_get_events",
    description: "Get multiple Swapcard events by their IDs in one request.",
    inputSchema: {
      type: "object",
      properties: {
        eventIds: { type: "array", items: { type: "string" }, description: "List of event IDs" },
      },
      required: ["eventIds"],
    },
  },

  // ── People ───────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_event_people",
    description: "List or search attendees/people in an event with optional email filter and cursor-based pagination.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "The event ID" },
        search: { type: "string", description: "Free-text search" },
        emails: { type: "array", items: { type: "string" }, description: "Filter by specific emails" },
        first: { type: "number", description: "Page size (default 20)" },
        after: { type: "string", description: "Pagination cursor" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_import_event_people",
    description: "Create or update attendees/people in bulk. Supports groups, barcodes, speaker roles, exhibitor memberships, and custom fields.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "The event ID" },
        validateOnly: { type: "boolean", description: "Dry-run without persisting changes" },
        force: { type: "boolean", description: "Bypass email/clientId binding checks" },
        data: {
          type: "array",
          description: "Array of person import records",
          items: {
            type: "object",
            properties: {
              clientId: { type: "string" },
              create: {
                type: "object",
                properties: {
                  email: { type: "string" },
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  jobTitle: { type: "string" },
                  organization: { type: "string" },
                  biography: { type: "string" },
                  websiteUrl: { type: "string" },
                  photoUrl: { type: "string" },
                  mobilePhone: { type: "string", description: "E.164 format e.g. +14155550101" },
                  isVisible: { type: "boolean" },
                  isUser: { type: "boolean" },
                },
              },
              update: { type: "object", description: "Same shape as create" },
              actions: {
                type: "object",
                properties: {
                  updateGroups: {
                    type: "object",
                    properties: {
                      action: { type: "string", enum: ["ADD", "REMOVE", "REPLACE"] },
                      groupIds: { type: "array", items: { type: "string" } },
                    },
                  },
                  updateBarcodes: {
                    type: "object",
                    properties: {
                      action: { type: "string", enum: ["ADD", "REMOVE", "REPLACE"] },
                      barcodes: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            type: { type: "string", enum: ["QR_CODE", "FILE"] },
                            value: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                  isSpeakerOnPlannings: {
                    type: "object",
                    properties: {
                      action: { type: "string", enum: ["ADD", "REMOVE", "REPLACE"] },
                      planningIds: { type: "array", items: { type: "string" } },
                    },
                  },
                  isAttendeeOnPlannings: {
                    type: "object",
                    properties: {
                      action: { type: "string", enum: ["ADD", "REMOVE", "REPLACE"] },
                      planningIds: { type: "array", items: { type: "string" } },
                    },
                  },
                  isMemberOnExhibitors: {
                    type: "object",
                    properties: {
                      action: { type: "string", enum: ["ADD", "REMOVE", "REPLACE"] },
                      exhibitorIds: { type: "array", items: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      required: ["eventId", "data"],
    },
  },
  {
    name: "swapcard_delete_event_people",
    description: "Permanently delete people from an event by their Swapcard person IDs.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        eventPeopleIds: { type: "array", items: { type: "string" } },
      },
      required: ["eventId", "eventPeopleIds"],
    },
  },

  // ── Sessions ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_sessions",
    description: "List or search sessions/plannings in a community. Filter by event, format, speaker; sort by various fields.",
    inputSchema: {
      type: "object",
      properties: {
        communityId: { type: "string", description: "Community (organization) ID" },
        search: { type: "string" },
        first: { type: "number" },
        after: { type: "string" },
        filter: {
          type: "object",
          properties: {
            eventIds: { type: "array", items: { type: "string" } },
            ids: { type: "array", items: { type: "string" } },
            clientIds: { type: "array", items: { type: "string" } },
            speakerIds: { type: "array", items: { type: "string" } },
            placeIds: { type: "array", items: { type: "string" } },
            formats: {
              type: "array",
              items: { type: "string", enum: ["PHYSICAL", "LIVE_STREAM", "ON_DEMAND", "PRE_RECORDED", "ROUNDTABLE"] },
            },
          },
        },
        sort: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "BEGINS_AT", "BOOKMARKED_SINCE", "CREATED_AT", "DESCRIPTION", "ENDS_AT",
              "PLACE", "TITLE", "TOTAL_ATTENDEES", "TOTAL_CATEGORIES", "TOTAL_DOCUMENTS",
              "TOTAL_EXHIBITORS", "TOTAL_SPEAKERS", "TOTAL_SCAN_IN", "TOTAL_SCAN_OUT", "TYPE",
            ],
          },
        },
      },
      required: ["communityId"],
    },
  },
  {
    name: "swapcard_import_sessions",
    description: "Create or update sessions/plannings in bulk. Supports all formats, video types, access control, and custom fields.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        plannings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              clientId: { type: "string" },
              titleTranslations: {
                type: "array",
                items: { type: "object", properties: { language: { type: "string" }, value: { type: "string" } } },
              },
              descriptionTranslations: {
                type: "array",
                items: { type: "object", properties: { language: { type: "string" }, value: { type: "string" } } },
              },
              beginsAt: { type: "string", description: "ISO 8601" },
              endsAt: { type: "string", description: "ISO 8601" },
              isRatable: { type: "boolean" },
              bannerUrl: { type: "string" },
              canRegister: { type: "boolean" },
              isPrivate: { type: "boolean" },
              maxSeats: { type: "number" },
              hashtag: { type: "string" },
              format: { type: "string", enum: ["PHYSICAL", "LIVE_STREAM", "ON_DEMAND", "PRE_RECORDED", "ROUNDTABLE"] },
              exhibitors: { type: "array", items: { type: "string" } },
            },
            required: ["clientId", "titleTranslations", "descriptionTranslations", "beginsAt", "endsAt"],
          },
        },
      },
      required: ["eventId", "plannings"],
    },
  },
  {
    name: "swapcard_delete_sessions",
    description: "Delete sessions/plannings from an event by their IDs.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        planningsIds: { type: "array", items: { type: "string" } },
      },
      required: ["eventId", "planningsIds"],
    },
  },

  // ── Exhibitors ────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_exhibitors",
    description: "List or search exhibitors in a community. Filter by event, clientIds, IDs, last updated; sort by various fields.",
    inputSchema: {
      type: "object",
      properties: {
        communityId: { type: "string" },
        search: { type: "string" },
        first: { type: "number" },
        after: { type: "string" },
        filter: {
          type: "object",
          properties: {
            eventIds: { type: "array", items: { type: "string" } },
            clientIds: { type: "array", items: { type: "string" } },
            ids: { type: "array", items: { type: "string" } },
            lastUpdatedSince: { type: "string", description: "ISO 8601" },
          },
        },
        sort: {
          type: "object",
          properties: {
            field: { type: "string", enum: ["NAME", "DESCRIPTION", "TOTAL_BOOKMARKS", "CREATED_AT", "UPDATED_AT"] },
            order: { type: "string", enum: ["ASC", "DESC"] },
          },
        },
      },
      required: ["communityId"],
    },
  },
  {
    name: "swapcard_upsert_exhibitors",
    description: "Create or update exhibitors in an event. Supports name, logo, description, website, address, documents, members, categories, booths, and social networks.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        exhibitors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              clientId: { type: "string" },
              description: { type: "string" },
              logoUrl: { type: "string" },
              websiteUrl: { type: "string" },
              email: { type: "string" },
              address: { type: "string" },
              type: { type: "string" },
              membersIds: { type: "array", items: { type: "string" } },
              categories: { type: "array", items: { type: "string" } },
              socialNetworks: {
                type: "array",
                items: { type: "object", properties: { type: { type: "string" }, profile: { type: "string" } } },
              },
            },
            required: ["name"],
          },
        },
      },
      required: ["eventId", "exhibitors"],
    },
  },
  {
    name: "swapcard_update_exhibitor",
    description: "Update a single exhibitor's details including features (export capabilities) and background image.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        exhibitorId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        logoUrl: { type: "string" },
        backgroundImageUrl: { type: "string" },
        websiteUrl: { type: "string" },
        features: {
          type: "object",
          properties: {
            canExportAdvertisements: { type: "boolean" },
            canExportChats: { type: "boolean" },
            canExportContacts: { type: "boolean" },
          },
        },
      },
      required: ["eventId", "exhibitorId"],
    },
  },
  {
    name: "swapcard_delete_exhibitors",
    description: "Delete exhibitors from an event by their IDs.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        exhibitorIds: { type: "array", items: { type: "string" } },
      },
      required: ["eventId", "exhibitorIds"],
    },
  },

  // ── Documents ─────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_event_documents",
    description: "List all documents attached to an event with page-based pagination.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        page: { type: "number", description: "Page number (1-based)" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_create_event_document",
    description: "Attach a new document (URL-based) to an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        name: { type: "string" },
        url: { type: "string" },
        description: { type: "string" },
      },
      required: ["eventId", "name", "url"],
    },
  },
  {
    name: "swapcard_update_event_document",
    description: "Update an existing event document's name, URL, or description.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        name: { type: "string" },
        url: { type: "string" },
        description: { type: "string" },
      },
      required: ["documentId"],
    },
  },
  {
    name: "swapcard_delete_event_documents",
    description: "Delete one or more event documents by their IDs.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        documentIds: { type: "array", items: { type: "string" } },
      },
      required: ["eventId", "documentIds"],
    },
  },
  {
    name: "swapcard_create_document",
    description: "Create a community-level document (v2), optionally scoped to an event. Supports EMBED_URL or UPLOAD_URL.",
    inputSchema: {
      type: "object",
      properties: {
        communityId: { type: "string" },
        eventId: { type: "string" },
        name: { type: "string" },
        url: { type: "string" },
        description: { type: "string" },
        actionType: { type: "string", enum: ["EMBED_URL", "UPLOAD_URL"] },
      },
      required: ["communityId", "name", "url"],
    },
  },
  {
    name: "swapcard_update_document",
    description: "Update a community-level document (v2) by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        url: { type: "string" },
        description: { type: "string" },
      },
      required: ["id"],
    },
  },

  // ── Custom Fields ──────────────────────────────────────────────────────────────
  {
    name: "swapcard_get_custom_fields",
    description: "Get all custom field definitions for an event, optionally filtered by target entity type.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        target: { type: "string", enum: ["PEOPLE", "EXHIBITORS", "PLANNING", "PRODUCT"] },
      },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_get_select_field_options",
    description: "Get all Select and MultipleSelect custom field definitions with their option values.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_create_custom_field",
    description: "Create a new custom field definition on an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        name: { type: "string" },
        target: { type: "string", enum: ["PEOPLE", "EXHIBITOR", "SESSION", "ITEM"] },
        type: { type: "string", enum: ["DATE", "LONG_TEXT", "MEDIA", "MULTIPLE_SELECT", "MULTIPLE_TEXT", "NUMBER", "SELECT", "TEXT", "TREE", "URL"] },
        isEditable: { type: "boolean" },
        isVisible: { type: "boolean" },
        translations: {
          type: "array",
          items: { type: "object", properties: { language: { type: "string" }, name: { type: "string" }, placeholder: { type: "string" } } },
        },
      },
      required: ["eventId", "name", "target", "type"],
    },
  },
  {
    name: "swapcard_update_custom_field",
    description: "Update an existing custom field definition's visibility, editability, or max characters.",
    inputSchema: {
      type: "object",
      properties: {
        fieldDefinitionId: { type: "string" },
        isEditable: { type: "boolean" },
        isVisible: { type: "boolean" },
        maxCharacters: { type: "number" },
      },
      required: ["fieldDefinitionId"],
    },
  },
  {
    name: "swapcard_delete_custom_fields",
    description: "Delete custom field definitions from an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        fieldDefinitionIds: { type: "array", items: { type: "string" } },
      },
      required: ["eventId", "fieldDefinitionIds"],
    },
  },

  // ── Meetings ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_meetings",
    description: "List meetings in an event with optional ID/date filters and cursor pagination.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        first: { type: "number" },
        after: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        lastUpdatedSince: { type: "string", description: "ISO 8601" },
      },
      required: ["eventId"],
    },
  },

  // ── Webhooks ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_webhooks",
    description: "List all webhook subscriptions configured for an event.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string" } },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_create_webhook",
    description: "Register a new webhook subscription. Fires on profile/exhibitor/planning create and update events.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        endpoint: { type: "string", description: "HTTPS URL to receive webhook payloads" },
        secret: { type: "string", description: "HMAC secret for X-Signature-256 verification" },
        hooks: {
          type: "array",
          items: {
            type: "string",
            enum: ["PROFILE_CREATE", "PROFILE_UPDATE", "EXHIBITOR_CREATE", "EXHIBITOR_UPDATE", "PLANNING_CREATE", "PLANNING_UPDATE"],
          },
        },
      },
      required: ["eventId", "endpoint", "secret", "hooks"],
    },
  },
  {
    name: "swapcard_update_webhook",
    description: "Update an existing webhook subscription's endpoint URL or subscribed event types.",
    inputSchema: {
      type: "object",
      properties: {
        webhookId: { type: "string" },
        endpoint: { type: "string" },
        hooks: {
          type: "array",
          items: {
            type: "string",
            enum: ["PROFILE_CREATE", "PROFILE_UPDATE", "EXHIBITOR_CREATE", "EXHIBITOR_UPDATE", "PLANNING_CREATE", "PLANNING_UPDATE"],
          },
        },
      },
      required: ["webhookId"],
    },
  },
  {
    name: "swapcard_delete_webhook",
    description: "Delete a webhook subscription by its ID.",
    inputSchema: {
      type: "object",
      properties: { webhookId: { type: "string" } },
      required: ["webhookId"],
    },
  },

  // ── Leads API ─────────────────────────────────────────────────────────────────
  {
    name: "swapcard_get_my_exhibitors",
    description: "Get the list of exhibitors accessible to the authenticated Leads API token.",
    inputSchema: {
      type: "object",
      properties: {
        first: { type: "number" },
        after: { type: "string" },
      },
    },
  },
  {
    name: "swapcard_get_my_leads",
    description: "Get all leads (scanned contacts) for a specific exhibitor at a specific event, including contact info, rating, note, owner, and custom fields.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        exhibitorId: { type: "string" },
      },
      required: ["eventId", "exhibitorId"],
    },
  },
  {
    name: "swapcard_scan_badges",
    description: "Scan attendee badges on behalf of an exhibitor. Optionally set a rating (1–5) and note per badge.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        exhibitorId: { type: "string" },
        badges: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "Badge barcode value" },
              rating: { type: "number", description: "1–5" },
              note: { type: "string" },
            },
            required: ["code"],
          },
        },
      },
      required: ["eventId", "exhibitorId", "badges"],
    },
  },

  // ── Analytics Export ──────────────────────────────────────────────────────────
  {
    name: "swapcard_export_analytics",
    description: "Export raw analytics event records (page views, meetings, scans, etc.) for one or more events. Data has a ~10-minute delay. Cursor-paginated.",
    inputSchema: {
      type: "object",
      properties: {
        event_ids: { type: "array", items: { type: "string" }, description: "Event IDs to export (required)" },
        cursor: { type: "string" },
        events: { type: "array", items: { type: "string" }, description: "Filter by action type e.g. event_show, meeting_create" },
        group_ids: { type: "array", items: { type: "string" } },
        user_ids: { type: "array", items: { type: "string" } },
        exhibitor_ids: { type: "array", items: { type: "string" } },
        time_gt: { type: "string", description: "RFC 3339 — return records after this time" },
        time_lt: { type: "string", description: "RFC 3339 — return records before this time" },
        limit: { type: "number" },
      },
      required: ["event_ids"],
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

// Events
register("swapcard_get_event", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query GetEvent($eventId: ID!) {
      eventById(eventId: $eventId) {
        id slug title beginsAt endsAt createdAt updatedAt language timezone
        htmlDescription isLive totalPlannings totalExhibitors totalSpeakers
        banner { imageUrl }
        address { place street city zipCode state country }
        groups { id name peopleCount }
        community { id }
      }
    }
  `, { eventId: a.eventId }));

register("swapcard_get_events", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query GetEvents($eventIds: [ID!]!) {
      events(eventIds: $eventIds) {
        id slug title beginsAt endsAt language timezone isLive
        totalPlannings totalExhibitors totalSpeakers
        address { place street city zipCode state country }
      }
    }
  `, { eventIds: a.eventIds }));

// People
register("swapcard_list_event_people", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query ListEventPeople($eventId: ID!, $filters: [EventPersonFilter!], $search: String, $cursor: CursorPaginationInput) {
      eventPerson(eventId: $eventId, filters: $filters, search: $search, cursor: $cursor) {
        pageInfo { endCursor hasNextPage totalItems }
        nodes {
          id clientIds email firstName lastName jobTitle organization
          photoUrl websiteUrl biography source updatedAt createdAt userId
          phoneNumbers { formattedNumber type number }
          socialNetworks { profile type }
          groups { id name }
        }
      }
    }
  `, {
    eventId: a.eventId,
    search: a.search,
    filters: a.emails ? [{ emails: a.emails }] : undefined,
    cursor: { first: a.first ?? 20, ...(a.after ? { after: a.after } : {}) },
  }));

register("swapcard_import_event_people", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation ImportEventPeople($eventId: ID!, $data: [ImportEventPersonInput!]!, $validateOnly: Boolean, $force: Boolean) {
      importEventPeople(eventId: $eventId, data: $data, validateOnly: $validateOnly, force: $force) {
        eventPeopleCreated eventPeopleUpdated
        errors { inputId errorCode message }
        results { inputId eventPerson { id email firstName lastName jobTitle organization } }
      }
    }
  `, { eventId: a.eventId, data: a.data, validateOnly: a.validateOnly, force: a.force }));

register("swapcard_delete_event_people", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteEventPeople($eventId: ID!, $eventPeopleIds: [ID!]!) {
      deleteEventPeople(eventId: $eventId, eventPeopleIds: $eventPeopleIds) { eventPeopleDeleted }
    }
  `, { eventId: a.eventId, eventPeopleIds: a.eventPeopleIds }));

// Sessions
register("swapcard_list_sessions", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query ListSessions($communityId: ID!, $search: String, $cursor: CursorPaginationInput, $filter: EventPlanningFilterInput, $sort: [PlanningSortType!]) {
      planningsV2(communityId: $communityId, search: $search, cursor: $cursor, filter: $filter, sort: $sort) {
        pageInfo { endCursor hasNextPage totalItems }
        nodes {
          id place title totalAttendees type format clientIds description isPrivate isRatable
          events { nodes { id title } }
          speakers { id }
          exhibitors { id }
        }
      }
    }
  `, {
    communityId: a.communityId,
    search: a.search,
    cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined,
    filter: a.filter,
    sort: a.sort,
  }));

register("swapcard_import_sessions", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation ImportSessions($eventId: ID!, $plannings: [ImportEventPlanningInput!]!) {
      importEventPlannings(eventId: $eventId, plannings: $plannings) {
        errors { inputId message errorCode }
        results { inputId planning { id title description } }
      }
    }
  `, { eventId: a.eventId, plannings: a.plannings }));

register("swapcard_delete_sessions", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteSessions($eventId: ID!, $planningsIds: [ID!]!) {
      deleteEventPlannings(eventId: $eventId, planningsIds: $planningsIds)
    }
  `, { eventId: a.eventId, planningsIds: a.planningsIds }));

// Exhibitors
register("swapcard_list_exhibitors", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query ListExhibitors($communityId: ID!, $search: String, $cursor: CursorPaginationInput, $filter: CommunityExhibitorsFilterInput, $sort: EventExhibitorsSortInput) {
      exhibitorsV2(communityId: $communityId, search: $search, cursor: $cursor, filter: $filter, sort: $sort) {
        pageInfo { endCursor hasNextPage totalItems }
        nodes { id name logoUrl websiteUrl description email clientIds createdAt updatedAt address }
      }
    }
  `, {
    communityId: a.communityId,
    search: a.search,
    cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined,
    filter: a.filter,
    sort: a.sort,
  }));

register("swapcard_upsert_exhibitors", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpsertExhibitors($eventId: ID!, $exhibitors: [UpsertEventExhibitorInput!]!) {
      upsertEventExhibitors(eventId: $eventId, exhibitors: $exhibitors) {
        errors { inputId message errorCode }
        results { inputId exhibitor { id name logoUrl websiteUrl } }
      }
    }
  `, { eventId: a.eventId, exhibitors: a.exhibitors }));

register("swapcard_update_exhibitor", async (a) => {
  const { eventId, exhibitorId, ...rest } = a;
  return gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateExhibitor($eventId: ID!, $exhibitorId: ID!, $name: String, $description: String, $logoUrl: String, $backgroundImageUrl: String, $websiteUrl: String, $features: ExhibitorFeaturesInput) {
      updateExhibitor(eventId: $eventId, exhibitorId: $exhibitorId, name: $name, description: $description, logoUrl: $logoUrl, backgroundImageUrl: $backgroundImageUrl, websiteUrl: $websiteUrl, features: $features) {
        id name description logoUrl websiteUrl
      }
    }
  `, { eventId, exhibitorId, ...rest });
});

register("swapcard_delete_exhibitors", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteExhibitors($eventId: ID!, $exhibitorIds: [ID!]!) {
      deleteEventExhibitors(eventId: $eventId, exhibitorIds: $exhibitorIds)
    }
  `, { eventId: a.eventId, exhibitorIds: a.exhibitorIds }));

// Documents
register("swapcard_list_event_documents", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query ListEventDocuments($eventId: ID!, $page: Int!) {
      EventDocuments(eventId: $eventId, page: $page) {
        pageInfo { endCursor totalItems }
        results { id name description type url }
      }
    }
  `, { eventId: a.eventId, page: a.page ?? 1 }));

register("swapcard_create_event_document", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateEventDocument($eventId: ID!, $document: CreateDocumentInput!) {
      CreateEventDocument(eventId: $eventId, document: $document) { id name description type url }
    }
  `, { eventId: a.eventId, document: { name: a.name, url: a.url, description: a.description } }));

register("swapcard_update_event_document", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateEventDocument($documentId: ID!, $document: UpdateDocumentInput!) {
      UpdateEventDocument(documentId: $documentId, document: $document) { id name description type url }
    }
  `, { documentId: a.documentId, document: { name: a.name, url: a.url, description: a.description } }));

register("swapcard_delete_event_documents", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteEventDocuments($eventId: ID!, $documentIds: [ID!]!) {
      DeleteEventDocument(eventId: $eventId, documentIds: $documentIds)
    }
  `, { eventId: a.eventId, documentIds: a.documentIds }));

register("swapcard_create_document", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateDocument($communityId: ID!, $eventId: ID, $document: CreateDocumentInput!) {
      CreateDocument(communityId: $communityId, eventId: $eventId, document: $document) {
        document { id name description type url }
        errors
      }
    }
  `, { communityId: a.communityId, eventId: a.eventId, document: { name: a.name, url: a.url, description: a.description, actionType: a.actionType } }));

register("swapcard_update_document", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateDocument($id: ID!, $document: UpdateDocumentInput!) {
      UpdateDocument(id: $id, document: $document) {
        document { id name description type url }
        errors
      }
    }
  `, { id: a.id, document: { name: a.name, url: a.url, description: a.description } }));

// Custom Fields
register("swapcard_get_custom_fields", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query GetCustomFields($eventId: ID!, $target: CustomFieldTarget) {
      eventById(eventId: $eventId) {
        fieldDefinitions(target: $target) {
          ... on TextFieldDefinition { id name type isEditable isVisible }
          ... on LongTextFieldDefinition { id name type isEditable isVisible maxCharacters }
          ... on NumberFieldDefinition { id name type isEditable isVisible }
          ... on DateFieldDefinition { id name type isEditable isVisible }
          ... on UrlFieldDefinition { id name type isEditable isVisible }
          ... on SelectFieldDefinition { id name type isEditable isVisible optionsValues { id value } }
          ... on MultipleSelectFieldDefinition { id name type isEditable isVisible optionsValues { id value } }
          ... on MediaFieldDefinition { id name type isEditable isVisible }
          ... on MultipleTextFieldDefinition { id name type isEditable isVisible }
          ... on TreeFieldDefinition { id name type isEditable isVisible }
        }
      }
    }
  `, { eventId: a.eventId, target: a.target }));

register("swapcard_get_select_field_options", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query GetSelectFieldOptions($eventId: ID!) {
      eventById(eventId: $eventId) {
        fieldDefinitions {
          ... on SelectFieldDefinition { id name optionsValues { id value } }
          ... on MultipleSelectFieldDefinition { id name optionsValues { id value } }
        }
      }
    }
  `, { eventId: a.eventId }));

register("swapcard_create_custom_field", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateCustomField($eventId: ID!, $name: String!, $target: FieldDefinitionTarget!, $type: FieldDefinitionType!, $isEditable: Boolean, $isVisible: Boolean, $translations: [FieldDefinitionTranslationInput!]) {
      createFieldDefinition(eventId: $eventId, name: $name, target: $target, type: $type, isEditable: $isEditable, isVisible: $isVisible, translations: $translations)
    }
  `, { eventId: a.eventId, name: a.name, target: a.target, type: a.type, isEditable: a.isEditable, isVisible: a.isVisible, translations: a.translations }));

register("swapcard_update_custom_field", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateCustomField($fieldDefinitionId: ID!, $isEditable: Boolean, $isVisible: Boolean, $maxCharacters: Int) {
      updateFieldDefinition(fieldDefinitionId: $fieldDefinitionId, isEditable: $isEditable, isVisible: $isVisible, maxCharacters: $maxCharacters) {
        eventId errors
      }
    }
  `, { fieldDefinitionId: a.fieldDefinitionId, isEditable: a.isEditable, isVisible: a.isVisible, maxCharacters: a.maxCharacters }));

register("swapcard_delete_custom_fields", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteCustomFields($eventId: ID!, $fieldDefinitionIds: [ID!]!) {
      deleteFieldDefinitions(eventId: $eventId, fieldDefinitionIds: $fieldDefinitionIds)
    }
  `, { eventId: a.eventId, fieldDefinitionIds: a.fieldDefinitionIds }));

// Meetings
register("swapcard_list_meetings", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query ListMeetings($eventId: ID!, $cursor: CursorPaginationInput, $filter: MeetingFilterInput) {
      meetingsV2(eventId: $eventId, cursor: $cursor, filter: $filter) {
        pageInfo { endCursor hasNextPage totalItems }
        nodes { id status source }
      }
    }
  `, {
    eventId: a.eventId,
    cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined,
    filter: {
      ...(a.ids ? { ids: a.ids } : {}),
      ...(a.lastUpdatedSince ? { lastUpdatedSince: a.lastUpdatedSince } : {}),
    },
  }));

// Webhooks
register("swapcard_list_webhooks", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    query ListWebhooks($eventId: ID!) {
      eventById(eventId: $eventId) { webhooks { id endpoint hooks } }
    }
  `, { eventId: a.eventId }));

register("swapcard_create_webhook", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateWebhook($eventId: ID!, $endpoint: String!, $secret: String!, $hooks: [WebhookEventType!]!) {
      createWebhookSubscription(eventId: $eventId, endpoint: $endpoint, secret: $secret, hooks: $hooks) {
        id endpoint hooks
      }
    }
  `, { eventId: a.eventId, endpoint: a.endpoint, secret: a.secret, hooks: a.hooks }));

register("swapcard_update_webhook", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateWebhook($webhookId: ID!, $endpoint: String, $hooks: [WebhookEventType!]) {
      updateWebhookSubscription(webhookId: $webhookId, endpoint: $endpoint, hooks: $hooks) {
        id endpoint hooks
      }
    }
  `, { webhookId: a.webhookId, endpoint: a.endpoint, hooks: a.hooks }));

register("swapcard_delete_webhook", async (a) =>
  gql(CONTENT_URL, token("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteWebhook($webhookId: ID!) {
      deleteWebhookSubscription(webhookId: $webhookId)
    }
  `, { webhookId: a.webhookId }));

// Leads API
register("swapcard_get_my_exhibitors", async (a) =>
  gql(LEADS_URL, token("SWAPCARD_LEADS_TOKEN"), `
    query GetMyExhibitors($cursor: CursorPaginationInput) {
      myExhibitors(cursor: $cursor) {
        pageInfo { endCursor hasNextPage }
        nodes { id name events { nodes { id title } } }
      }
    }
  `, { cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined }));

register("swapcard_get_my_leads", async (a) =>
  gql(LEADS_URL, token("SWAPCARD_LEADS_TOKEN"), `
    query GetMyLeads($eventId: ID!, $exhibitorId: ID!) {
      myLeads(eventId: $eventId, exhibitorId: $exhibitorId) {
        leads {
          contacts {
            pageInfo { endCursor hasNextPage }
            nodes {
              id connectedAt isScanned rating note
              connectedAtEvent { id title }
              owner { id email firstName lastName jobTitle organization }
              target {
                ... on EventPerson { id firstName lastName email jobTitle organization photoUrl }
              }
              customFields {
                ... on SelectField { id value definition { id name } }
                ... on TextField { id value definition { id name } }
              }
            }
          }
        }
      }
    }
  `, { eventId: a.eventId, exhibitorId: a.exhibitorId }));

register("swapcard_scan_badges", async (a) =>
  gql(LEADS_URL, token("SWAPCARD_LEADS_TOKEN"), `
    mutation ScanBadges($input: ScanBadgesInput!) {
      scanBadges(input: $input) {
        badges {
          errorCode
          connection {
            id rating note
            target {
              ... on EventPerson { firstName lastName jobTitle email organization }
            }
          }
        }
      }
    }
  `, { input: { eventId: a.eventId, exhibitorId: a.exhibitorId, badges: a.badges } }));

// Analytics Export
register("swapcard_export_analytics", async (a) => {
  const body: Record<string, unknown> = { event_ids: a.event_ids };
  if (a.cursor)        body.cursor        = a.cursor;
  if (a.events)        body.events        = a.events;
  if (a.group_ids)     body.group_ids     = a.group_ids;
  if (a.user_ids)      body.user_ids      = a.user_ids;
  if (a.exhibitor_ids) body.exhibitor_ids = a.exhibitor_ids;
  if (a.time_gt)       body.time_gt       = a.time_gt;
  if (a.time_lt)       body.time_lt       = a.time_lt;
  if (a.limit)         body.limit         = a.limit;
  return restPost(body);
});

// ─── Server factory ───────────────────────────────────────────────────────────

export function createServer(): Server {
  const server = new Server(
    { name: "swapcard-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const handler = handlers.get(name);
    if (!handler) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    try {
      const result = await handler(args as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  return server;
}
