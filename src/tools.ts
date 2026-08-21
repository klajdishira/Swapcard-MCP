// ─── Config ───────────────────────────────────────────────────────────────────

const CONTENT_URL   = "https://developer.swapcard.com/event-admin/graphql";
const LEADS_URL     = "https://developer.swapcard.com/exhibitor/graphql";
const ANALYTICS_URL = "https://developer.swapcard.com/event-admin/export/analytics";

function tok(key: string): string {
  return process.env[key] ?? "";
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 20_000;

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

export async function gql(
  url: string,
  authToken: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<unknown> {
  if (!authToken) throw new Error("Missing API token. Set the required environment variable in Netlify.");
  const bearerToken = authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: bearerToken },
      body: JSON.stringify({ query, variables }),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    const name = (e instanceof Error) ? e.name : "";
    throw new Error(name === "TimeoutError" ? `Swapcard API timed out after ${FETCH_TIMEOUT_MS / 1000}s` : `Network error: ${String(e)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text) as { data?: unknown; errors?: unknown[] };
  if (json.errors?.length) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function restPost(body: Record<string, unknown>): Promise<unknown> {
  const token = tok("SWAPCARD_ANALYTICS_TOKEN") || tok("SWAPCARD_CONTENT_TOKEN");
  if (!token) throw new Error("Missing API token. Set SWAPCARD_ANALYTICS_TOKEN or SWAPCARD_CONTENT_TOKEN in Netlify.");
  let res: Response;
  try {
    res = await fetch(ANALYTICS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    const name = (e instanceof Error) ? e.name : "";
    throw new Error(name === "TimeoutError" ? `Analytics API timed out after ${FETCH_TIMEOUT_MS / 1000}s` : `Network error: ${String(e)}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

// ─── Tool registry ────────────────────────────────────────────────────────────

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
export const handlers = new Map<string, ToolHandler>();

function reg(name: string, handler: ToolHandler) {
  handlers.set(name, handler);
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const tools: ToolDef[] = [
  // ── Events ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_get_event",
    description: "Get a single Swapcard event by ID, including title, dates, description, address, groups, community, and stats.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string", description: "The event ID" } },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_get_events",
    description: "Get multiple Swapcard events by their IDs in one request.",
    inputSchema: {
      type: "object",
      properties: { eventIds: { type: "array", items: { type: "string" }, description: "List of event IDs" } },
      required: ["eventIds"],
    },
  },

  // ── People ────────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_event_people",
    description: "List or search attendees/people in an event with optional email filter and cursor-based pagination.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        search: { type: "string" },
        emails: { type: "array", items: { type: "string" } },
        first: { type: "number" },
        after: { type: "string" },
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
        eventId: { type: "string" },
        validateOnly: { type: "boolean" },
        force: { type: "boolean" },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              clientId: { type: "string" },
              create: {
                type: "object",
                properties: {
                  email: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" },
                  jobTitle: { type: "string" }, organization: { type: "string" }, biography: { type: "string" },
                  websiteUrl: { type: "string" }, photoUrl: { type: "string" },
                  mobilePhone: { type: "string", description: "E.164 e.g. +14155550101" },
                  isVisible: { type: "boolean" }, isUser: { type: "boolean" },
                },
              },
              update: { type: "object" },
              actions: {
                type: "object",
                properties: {
                  updateGroups: { type: "object", properties: { action: { type: "string", enum: ["ADD","REMOVE","REPLACE"] }, groupIds: { type: "array", items: { type: "string" } } } },
                  updateBarcodes: { type: "object", properties: { action: { type: "string", enum: ["ADD","REMOVE","REPLACE"] }, barcodes: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["QR_CODE","FILE"] }, value: { type: "string" } } } } } },
                  isSpeakerOnPlannings: { type: "object", properties: { action: { type: "string", enum: ["ADD","REMOVE","REPLACE"] }, planningIds: { type: "array", items: { type: "string" } } } },
                  isAttendeeOnPlannings: { type: "object", properties: { action: { type: "string", enum: ["ADD","REMOVE","REPLACE"] }, planningIds: { type: "array", items: { type: "string" } } } },
                  isMemberOnExhibitors: { type: "object", properties: { action: { type: "string", enum: ["ADD","REMOVE","REPLACE"] }, exhibitorIds: { type: "array", items: { type: "string" } } } },
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
      properties: { eventId: { type: "string" }, eventPeopleIds: { type: "array", items: { type: "string" } } },
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
        communityId: { type: "string" }, search: { type: "string" }, first: { type: "number" }, after: { type: "string" },
        filter: {
          type: "object",
          properties: {
            eventIds: { type: "array", items: { type: "string" } }, ids: { type: "array", items: { type: "string" } },
            clientIds: { type: "array", items: { type: "string" } }, speakerIds: { type: "array", items: { type: "string" } },
            placeIds: { type: "array", items: { type: "string" } },
            formats: { type: "array", items: { type: "string", enum: ["PHYSICAL","LIVE_STREAM","ON_DEMAND","PRE_RECORDED","ROUNDTABLE"] } },
          },
        },
        sort: { type: "array", items: { type: "string", enum: ["BEGINS_AT","BOOKMARKED_SINCE","CREATED_AT","DESCRIPTION","ENDS_AT","PLACE","TITLE","TOTAL_ATTENDEES","TOTAL_CATEGORIES","TOTAL_DOCUMENTS","TOTAL_EXHIBITORS","TOTAL_SPEAKERS","TOTAL_SCAN_IN","TOTAL_SCAN_OUT","TYPE"] } },
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
              titleTranslations: { type: "array", items: { type: "object", properties: { language: { type: "string" }, value: { type: "string" } } } },
              descriptionTranslations: { type: "array", items: { type: "object", properties: { language: { type: "string" }, value: { type: "string" } } } },
              beginsAt: { type: "string" }, endsAt: { type: "string" }, isRatable: { type: "boolean" },
              bannerUrl: { type: "string" }, canRegister: { type: "boolean" }, isPrivate: { type: "boolean" },
              maxSeats: { type: "number" }, hashtag: { type: "string" },
              format: { type: "string", enum: ["PHYSICAL","LIVE_STREAM","ON_DEMAND","PRE_RECORDED","ROUNDTABLE"] },
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
      properties: { eventId: { type: "string" }, planningsIds: { type: "array", items: { type: "string" } } },
      required: ["eventId", "planningsIds"],
    },
  },

  // ── Exhibitors ────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_exhibitors",
    description: "List or search exhibitors in a community.",
    inputSchema: {
      type: "object",
      properties: {
        communityId: { type: "string" }, search: { type: "string" }, first: { type: "number" }, after: { type: "string" },
        filter: { type: "object", properties: { eventIds: { type: "array", items: { type: "string" } }, clientIds: { type: "array", items: { type: "string" } }, ids: { type: "array", items: { type: "string" } }, lastUpdatedSince: { type: "string" } } },
        sort: { type: "object", properties: { field: { type: "string", enum: ["NAME","DESCRIPTION","TOTAL_BOOKMARKS","CREATED_AT","UPDATED_AT"] }, order: { type: "string", enum: ["ASC","DESC"] } } },
      },
      required: ["communityId"],
    },
  },
  {
    name: "swapcard_upsert_exhibitors",
    description: "Create or update exhibitors in an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        exhibitors: { type: "array", items: { type: "object", properties: { name: { type: "string" }, clientId: { type: "string" }, description: { type: "string" }, logoUrl: { type: "string" }, websiteUrl: { type: "string" }, email: { type: "string" }, address: { type: "string" }, type: { type: "string" }, membersIds: { type: "array", items: { type: "string" } }, categories: { type: "array", items: { type: "string" } }, socialNetworks: { type: "array", items: { type: "object", properties: { type: { type: "string" }, profile: { type: "string" } } } } }, required: ["name"] } },
      },
      required: ["eventId", "exhibitors"],
    },
  },
  {
    name: "swapcard_update_exhibitor",
    description: "Update a single exhibitor's details including features and background image.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" }, exhibitorId: { type: "string" }, name: { type: "string" },
        description: { type: "string" }, logoUrl: { type: "string" }, backgroundImageUrl: { type: "string" },
        websiteUrl: { type: "string" },
        features: { type: "object", properties: { canExportAdvertisements: { type: "boolean" }, canExportChats: { type: "boolean" }, canExportContacts: { type: "boolean" } } },
      },
      required: ["eventId", "exhibitorId"],
    },
  },
  {
    name: "swapcard_delete_exhibitors",
    description: "Delete exhibitors from an event by their IDs.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string" }, exhibitorIds: { type: "array", items: { type: "string" } } },
      required: ["eventId", "exhibitorIds"],
    },
  },

  // ── Documents ─────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_event_documents",
    description: "List all documents attached to an event.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" }, page: { type: "number" } }, required: ["eventId"] },
  },
  {
    name: "swapcard_create_event_document",
    description: "Attach a new document (URL-based) to an event.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" }, name: { type: "string" }, url: { type: "string" }, description: { type: "string" } }, required: ["eventId", "name", "url"] },
  },
  {
    name: "swapcard_update_event_document",
    description: "Update an existing event document.",
    inputSchema: { type: "object", properties: { documentId: { type: "string" }, name: { type: "string" }, url: { type: "string" }, description: { type: "string" } }, required: ["documentId"] },
  },
  {
    name: "swapcard_delete_event_documents",
    description: "Delete one or more event documents by their IDs.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" }, documentIds: { type: "array", items: { type: "string" } } }, required: ["eventId", "documentIds"] },
  },
  {
    name: "swapcard_create_document",
    description: "Create a community-level document (v2), optionally scoped to an event.",
    inputSchema: { type: "object", properties: { communityId: { type: "string" }, eventId: { type: "string" }, name: { type: "string" }, url: { type: "string" }, description: { type: "string" }, actionType: { type: "string", enum: ["EMBED_URL","UPLOAD_URL"] } }, required: ["communityId", "name", "url"] },
  },
  {
    name: "swapcard_update_document",
    description: "Update a community-level document (v2) by its ID.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, url: { type: "string" }, description: { type: "string" } }, required: ["id"] },
  },

  // ── Custom Fields ──────────────────────────────────────────────────────────────
  {
    name: "swapcard_get_custom_fields",
    description: "Get all custom field definitions for an event, optionally filtered by target entity type.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" }, target: { type: "string", enum: ["PEOPLE","EXHIBITORS","PLANNING","PRODUCT"] } }, required: ["eventId"] },
  },
  {
    name: "swapcard_get_select_field_options",
    description: "Get all Select and MultipleSelect custom field definitions with their option values.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"] },
  },
  {
    name: "swapcard_create_custom_field",
    description: "Create a new custom field definition on an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" }, name: { type: "string" },
        target: { type: "string", enum: ["PEOPLE","EXHIBITOR","SESSION","ITEM"] },
        type: { type: "string", enum: ["DATE","LONG_TEXT","MEDIA","MULTIPLE_SELECT","MULTIPLE_TEXT","NUMBER","SELECT","TEXT","TREE","URL"] },
        isEditable: { type: "boolean" }, isVisible: { type: "boolean" },
        translations: { type: "array", items: { type: "object", properties: { language: { type: "string" }, name: { type: "string" }, placeholder: { type: "string" } } } },
      },
      required: ["eventId", "name", "target", "type"],
    },
  },
  {
    name: "swapcard_update_custom_field",
    description: "Update an existing custom field definition.",
    inputSchema: { type: "object", properties: { fieldDefinitionId: { type: "string" }, isEditable: { type: "boolean" }, isVisible: { type: "boolean" }, maxCharacters: { type: "number" } }, required: ["fieldDefinitionId"] },
  },
  {
    name: "swapcard_delete_custom_fields",
    description: "Delete custom field definitions from an event.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" }, fieldDefinitionIds: { type: "array", items: { type: "string" } } }, required: ["eventId", "fieldDefinitionIds"] },
  },

  // ── Meetings ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_meetings",
    description: "List meetings in an event with optional ID/date filters and cursor pagination.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" }, first: { type: "number" }, after: { type: "string" }, ids: { type: "array", items: { type: "string" } }, lastUpdatedSince: { type: "string" } }, required: ["eventId"] },
  },

  // ── Webhooks ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_webhooks",
    description: "List all webhook subscriptions configured for an event.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"] },
  },
  {
    name: "swapcard_create_webhook",
    description: "Register a new webhook subscription for an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" }, endpoint: { type: "string" }, secret: { type: "string" },
        hooks: { type: "array", items: { type: "string", enum: ["PROFILE_CREATE","PROFILE_UPDATE","EXHIBITOR_CREATE","EXHIBITOR_UPDATE","PLANNING_CREATE","PLANNING_UPDATE"] } },
      },
      required: ["eventId", "endpoint", "secret", "hooks"],
    },
  },
  {
    name: "swapcard_update_webhook",
    description: "Update an existing webhook subscription's endpoint or event types.",
    inputSchema: {
      type: "object",
      properties: {
        webhookId: { type: "string" }, endpoint: { type: "string" },
        hooks: { type: "array", items: { type: "string", enum: ["PROFILE_CREATE","PROFILE_UPDATE","EXHIBITOR_CREATE","EXHIBITOR_UPDATE","PLANNING_CREATE","PLANNING_UPDATE"] } },
      },
      required: ["webhookId"],
    },
  },
  {
    name: "swapcard_delete_webhook",
    description: "Delete a webhook subscription by its ID.",
    inputSchema: { type: "object", properties: { webhookId: { type: "string" } }, required: ["webhookId"] },
  },

  // ── Leads API ─────────────────────────────────────────────────────────────────
  {
    name: "swapcard_get_my_exhibitors",
    description: "Get the list of exhibitors accessible to the authenticated Leads API token.",
    inputSchema: { type: "object", properties: { first: { type: "number" }, after: { type: "string" } } },
  },
  {
    name: "swapcard_get_my_leads",
    description: "Get all leads (scanned contacts) for a specific exhibitor at a specific event.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" }, exhibitorId: { type: "string" } }, required: ["eventId", "exhibitorId"] },
  },
  {
    name: "swapcard_scan_badges",
    description: "Scan attendee badges on behalf of an exhibitor. Optionally set rating (1-5) and note per badge.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" }, exhibitorId: { type: "string" },
        badges: { type: "array", items: { type: "object", properties: { code: { type: "string" }, rating: { type: "number" }, note: { type: "string" } }, required: ["code"] } },
      },
      required: ["eventId", "exhibitorId", "badges"],
    },
  },

  // ── Analytics Export ──────────────────────────────────────────────────────────
  {
    name: "swapcard_export_analytics",
    description: "Export raw analytics event records for one or more events. Data has ~10-minute delay. Cursor-paginated.",
    inputSchema: {
      type: "object",
      properties: {
        event_ids: { type: "array", items: { type: "string" } },
        cursor: { type: "string" },
        events: { type: "array", items: { type: "string" } },
        group_ids: { type: "array", items: { type: "string" } },
        user_ids: { type: "array", items: { type: "string" } },
        exhibitor_ids: { type: "array", items: { type: "string" } },
        time_gt: { type: "string" }, time_lt: { type: "string" }, limit: { type: "number" },
      },
      required: ["event_ids"],
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

reg("swapcard_get_event", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query GetEvent($eventId: ID!) {
      event(id: $eventId) {
        id slug title beginsAt endsAt createdAt updatedAt language timezone
        htmlDescription isLive totalPlannings totalExhibitors totalSpeakers
        banner { imageUrl }
        address { place street city zipCode state country }
        groups { id name peopleCount }
        community { id }
      }
    }
  `, { eventId: a.eventId }));

reg("swapcard_get_events", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query GetEvents($eventIds: [String!]) {
      events(ids: $eventIds) {
        id slug title beginsAt endsAt language timezone isLive
        totalPlannings totalExhibitors totalSpeakers
        address { place street city zipCode state country }
      }
    }
  `, { eventIds: a.eventIds }));

reg("swapcard_list_event_people", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
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
    eventId: a.eventId, search: a.search,
    filters: a.emails ? [{ emails: a.emails }] : undefined,
    cursor: { first: a.first ?? 20, ...(a.after ? { after: a.after } : {}) },
  }));

reg("swapcard_import_event_people", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation ImportEventPeople($eventId: ID!, $data: [ImportEventPersonInput!]!, $validateOnly: Boolean, $force: Boolean) {
      importEventPeople(eventId: $eventId, data: $data, validateOnly: $validateOnly, force: $force) {
        eventPeopleCreated eventPeopleUpdated
        errors { inputId errorCode message }
        results { inputId eventPerson { id email firstName lastName jobTitle organization } }
      }
    }
  `, { eventId: a.eventId, data: a.data, validateOnly: a.validateOnly, force: a.force }));

reg("swapcard_delete_event_people", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteEventPeople($eventId: ID!, $eventPeopleIds: [ID!]!) {
      deleteEventPeople(eventId: $eventId, eventPeopleIds: $eventPeopleIds) { eventPeopleDeleted }
    }
  `, { eventId: a.eventId, eventPeopleIds: a.eventPeopleIds }));

reg("swapcard_list_sessions", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query ListSessions($communityId: ID!, $search: String, $cursor: CursorPaginationInput, $filter: EventPlanningFilterInput, $sort: [PlanningSortType!]) {
      planningsV2(communityId: $communityId, search: $search, cursor: $cursor, filter: $filter, sort: $sort) {
        pageInfo { endCursor hasNextPage totalItems }
        nodes { id place title totalAttendees type format clientIds description isPrivate isRatable events { nodes { id title } } speakers { id } exhibitors { id } }
      }
    }
  `, { communityId: a.communityId, search: a.search, cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined, filter: a.filter, sort: a.sort }));

reg("swapcard_import_sessions", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation ImportSessions($eventId: ID!, $plannings: [ImportEventPlanningInput!]!) {
      importEventPlannings(eventId: $eventId, plannings: $plannings) {
        errors { inputId message errorCode }
        results { inputId planning { id title description } }
      }
    }
  `, { eventId: a.eventId, plannings: a.plannings }));

reg("swapcard_delete_sessions", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteSessions($eventId: ID!, $planningsIds: [ID!]!) {
      deleteEventPlannings(eventId: $eventId, planningsIds: $planningsIds)
    }
  `, { eventId: a.eventId, planningsIds: a.planningsIds }));

reg("swapcard_list_exhibitors", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query ListExhibitors($communityId: ID!, $search: String, $cursor: CursorPaginationInput, $filter: CommunityExhibitorsFilterInput, $sort: EventExhibitorsSortInput) {
      exhibitorsV2(communityId: $communityId, search: $search, cursor: $cursor, filter: $filter, sort: $sort) {
        pageInfo { endCursor hasNextPage totalItems }
        nodes { id name logoUrl websiteUrl description email clientIds createdAt updatedAt address { place street city zipCode state country } }
      }
    }
  `, { communityId: a.communityId, search: a.search, cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined, filter: a.filter, sort: a.sort }));

reg("swapcard_upsert_exhibitors", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpsertExhibitors($eventId: ID!, $exhibitors: [UpsertEventExhibitorInput!]!) {
      upsertEventExhibitors(eventId: $eventId, exhibitors: $exhibitors) {
        errors { inputId message errorCode }
        results { inputId exhibitor { id name logoUrl websiteUrl } }
      }
    }
  `, { eventId: a.eventId, exhibitors: a.exhibitors }));

reg("swapcard_update_exhibitor", async (a) => {
  const { eventId, exhibitorId, ...rest } = a;
  return gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateExhibitor($eventId: ID!, $exhibitorId: ID!, $name: String, $description: String, $logoUrl: String, $backgroundImageUrl: String, $websiteUrl: String, $features: ExhibitorFeaturesInput) {
      updateExhibitor(eventId: $eventId, exhibitorId: $exhibitorId, name: $name, description: $description, logoUrl: $logoUrl, backgroundImageUrl: $backgroundImageUrl, websiteUrl: $websiteUrl, features: $features) {
        id name description logoUrl websiteUrl
      }
    }
  `, { eventId, exhibitorId, ...rest });
});

reg("swapcard_delete_exhibitors", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteExhibitors($eventId: ID!, $exhibitorIds: [ID!]!) {
      deleteEventExhibitors(eventId: $eventId, exhibitorIds: $exhibitorIds)
    }
  `, { eventId: a.eventId, exhibitorIds: a.exhibitorIds }));

reg("swapcard_list_event_documents", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query ListEventDocuments($eventId: ID!, $page: Int!) {
      event(id: $eventId) {
        documents(page: $page, pageSize: 100) {
          pageInfo { endCursor totalItems }
          results { id name description type url }
        }
      }
    }
  `, { eventId: a.eventId, page: a.page ?? 1 }));

reg("swapcard_create_event_document", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateEventDocument($eventId: ID!, $document: CreateDocumentInput!) {
      createEventDocument(eventId: $eventId, document: $document) { id name description type url }
    }
  `, { eventId: a.eventId, document: { name: a.name, url: a.url, description: a.description } }));

reg("swapcard_update_event_document", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateEventDocument($documentId: ID!, $document: UpdateDocumentInput!) {
      updateEventDocument(id: $documentId, document: $document) { id name description type url }
    }
  `, { documentId: a.documentId, document: { name: a.name, url: a.url, description: a.description } }));

reg("swapcard_delete_event_documents", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteEventDocuments($eventId: ID!, $documentIds: [ID!]!) {
      deleteEventDocument(eventId: $eventId, ids: $documentIds)
    }
  `, { eventId: a.eventId, documentIds: a.documentIds }));

reg("swapcard_create_document", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateDocument($communityId: ID!, $eventId: ID, $document: CreateDocumentInput!) {
      CreateDocument(communityId: $communityId, eventId: $eventId, document: $document) { document { id name description type url } errors }
    }
  `, { communityId: a.communityId, eventId: a.eventId, document: { name: a.name, url: a.url, description: a.description, actionType: a.actionType } }));

reg("swapcard_update_document", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateDocument($id: ID!, $document: UpdateDocumentInput!) {
      UpdateDocument(id: $id, document: $document) { document { id name description type url } errors }
    }
  `, { id: a.id, document: { name: a.name, url: a.url, description: a.description } }));

reg("swapcard_get_custom_fields", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query GetCustomFields($eventId: ID!, $target: FieldDefinitionTargetEnum) {
      event(id: $eventId) {
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
  `, { eventId: a.eventId, target: a.target ?? null }));

reg("swapcard_get_select_field_options", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query GetSelectFieldOptions($eventId: ID!) {
      event(id: $eventId) {
        fieldDefinitions {
          ... on SelectFieldDefinition { id name optionsValues { id value } }
          ... on MultipleSelectFieldDefinition { id name optionsValues { id value } }
        }
      }
    }
  `, { eventId: a.eventId }));

reg("swapcard_create_custom_field", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateCustomField($input: CreateFieldDefinitionV2Input!) {
      createFieldDefinition(input: $input) {
        event { id }
      }
    }
  `, { input: { eventId: a.eventId, name: a.name, target: a.target, type: a.type, isEditable: a.isEditable ?? true, isVisible: a.isVisible ?? true, translations: a.translations } }));

reg("swapcard_update_custom_field", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateCustomField($input: UpdateFieldDefinitionV2Input!) {
      updateFieldDefinition(input: $input) {
        event { id }
        errors { code }
      }
    }
  `, { input: { fieldDefinitionId: a.fieldDefinitionId, isEditable: a.isEditable, isVisible: a.isVisible, maxCharacters: a.maxCharacters } }));

reg("swapcard_delete_custom_fields", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteCustomFields($input: DeleteFieldDefinitionsInput!) {
      deleteFieldDefinitions(input: $input) {
        errors { code }
        event { id }
      }
    }
  `, { input: { eventId: a.eventId, fieldDefinitionIds: a.fieldDefinitionIds } }));

reg("swapcard_list_meetings", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query ListMeetings($eventId: ID!, $cursor: CursorPaginationInput, $filter: MeetingFilterInput) {
      meetingsV2(eventId: $eventId, cursor: $cursor, filter: $filter) {
        pageInfo { endCursor hasNextPage totalItems }
        nodes { id status source }
      }
    }
  `, { eventId: a.eventId, cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined, filter: { ...(a.ids ? { ids: a.ids } : {}), ...(a.lastUpdatedSince ? { lastUpdatedSince: a.lastUpdatedSince } : {}) } }));

reg("swapcard_list_webhooks", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query ListWebhooks($eventId: ID!) { event(id: $eventId) { webhooks { id endpoint hooks } } }
  `, { eventId: a.eventId }));

reg("swapcard_create_webhook", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateWebhook($eventId: ID!, $endpoint: String!, $secret: String!, $hooks: [WebhookEventType!]!) {
      createWebhookSubscription(eventId: $eventId, endpoint: $endpoint, secret: $secret, hooks: $hooks) { id endpoint hooks }
    }
  `, { eventId: a.eventId, endpoint: a.endpoint, secret: a.secret, hooks: a.hooks }));

reg("swapcard_update_webhook", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateWebhook($webhookId: ID!, $endpoint: String, $hooks: [WebhookEventType!]) {
      updateWebhookSubscription(webhookId: $webhookId, endpoint: $endpoint, hooks: $hooks) { id endpoint hooks }
    }
  `, { webhookId: a.webhookId, endpoint: a.endpoint, hooks: a.hooks }));

reg("swapcard_delete_webhook", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteWebhook($webhookId: ID!) { deleteWebhookSubscription(webhookId: $webhookId) }
  `, { webhookId: a.webhookId }));

reg("swapcard_get_my_exhibitors", async (a) =>
  gql(LEADS_URL, tok("SWAPCARD_LEADS_TOKEN"), `
    query GetMyExhibitors($cursor: CursorPaginationInput) {
      myExhibitors(cursor: $cursor) { pageInfo { endCursor hasNextPage } nodes { id name events { nodes { id title } } } }
    }
  `, { cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined }));

reg("swapcard_get_my_leads", async (a) =>
  gql(LEADS_URL, tok("SWAPCARD_LEADS_TOKEN"), `
    query GetMyLeads($eventId: ID!, $exhibitorId: ID!) {
      myLeads(eventId: $eventId, exhibitorId: $exhibitorId) {
        leads { contacts { pageInfo { endCursor hasNextPage } nodes { id connectedAt isScanned rating note connectedAtEvent { id title } owner { id email firstName lastName jobTitle organization } target { ... on EventPerson { id firstName lastName email jobTitle organization photoUrl } } customFields { ... on SelectField { id value definition { id name } } ... on TextField { id value definition { id name } } } } } }
      }
    }
  `, { eventId: a.eventId, exhibitorId: a.exhibitorId }));

reg("swapcard_scan_badges", async (a) =>
  gql(LEADS_URL, tok("SWAPCARD_LEADS_TOKEN"), `
    mutation ScanBadges($input: ScanBadgesInput!) {
      scanBadges(input: $input) { badges { errorCode connection { id rating note target { ... on EventPerson { firstName lastName jobTitle email organization } } } } }
    }
  `, { input: { eventId: a.eventId, exhibitorId: a.exhibitorId, badges: a.badges } }));

reg("swapcard_export_analytics", async (a) => {
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
