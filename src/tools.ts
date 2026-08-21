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
  // Swapcard expects the raw token as Authorization value — no Bearer/Basic prefix
  const bearerToken = authToken.replace(/^(Bearer|Basic)\s+/i, "");
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

// ─── Semantic layer ────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

// Resolve custom field value regardless of aliased type
function resolveFieldValue(f: Rec): unknown {
  return f.value ?? f.numberValue ?? f.msValue ?? (f.treeNode as Rec | null)?.value ?? f.mediaValue ?? null;
}

// Flatten EventPerson.fields[] into clean [{name, value}] pairs, omit nulls
function normalizeCustomFields(fields: Rec[]): { name: string; value: unknown }[] {
  return fields
    .map((f) => ({ name: String((f.definition as Rec)?.name ?? ""), value: resolveFieldValue(f) }))
    .filter((f) => f.name && f.value != null && f.value !== "");
}

// Convert SCREAMING_SNAKE or en_US locale codes to readable labels
function humanEnum(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Strip keys whose value is null/undefined/empty-array, recursively
function compact<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map(compact) as unknown as T;
  if (obj && typeof obj === "object") {
    const out: Rec = {};
    for (const [k, v] of Object.entries(obj as Rec)) {
      if (v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      const cv = compact(v);
      out[k] = cv;
    }
    return out as T;
  }
  return obj;
}

// Normalize a single EventPerson node
function normalizePerson(n: Rec): Rec {
  const fields = Array.isArray(n.fields) ? normalizeCustomFields(n.fields as Rec[]) : [];
  const phones = Array.isArray(n.phoneNumbers)
    ? (n.phoneNumbers as Rec[]).map((p) => p.formattedNumber ?? p.number).filter(Boolean)
    : [];
  const social = Array.isArray(n.socialNetworks)
    ? (n.socialNetworks as Rec[]).map((s) => `${s.type}: ${s.profile}`).filter((s) => !s.startsWith("undefined"))
    : [];
  const groups = Array.isArray(n.groups)
    ? (n.groups as Rec[]).map((g) => g.name).filter(Boolean)
    : [];
  return compact({
    id: n.id,
    email: n.email,
    firstName: n.firstName,
    lastName: n.lastName,
    jobTitle: n.jobTitle,
    organization: n.organization,
    biography: n.biography,
    photoUrl: n.photoUrl,
    websiteUrl: n.websiteUrl,
    isVisible: n.isVisible,
    source: n.source,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    userId: n.userId,
    clientIds: n.clientIds,
    phones: phones.length ? phones : undefined,
    socialNetworks: social.length ? social : undefined,
    groups: groups.length ? groups : undefined,
    customFields: fields.length ? fields : undefined,
  });
}

// Normalize a planning/session node
function normalizePlanning(n: Rec): Rec {
  return compact({
    id: n.id,
    title: n.title,
    description: n.description,
    place: n.place,
    beginsAt: n.beginsAt,
    endsAt: n.endsAt,
    format: n.format ? humanEnum(String(n.format)) : undefined,
    type: n.type ? humanEnum(String(n.type)) : undefined,
    isPrivate: n.isPrivate,
    isRatable: n.isRatable,
    totalAttendees: n.totalAttendees,
    clientIds: n.clientIds,
    speakerCount: Array.isArray(n.speakers) ? n.speakers.length : undefined,
    exhibitorCount: Array.isArray(n.exhibitors) ? n.exhibitors.length : undefined,
    events: Array.isArray((n.events as Rec | undefined)?.nodes) ? ((n.events as Rec).nodes as Rec[]).map((e) => e.title) : undefined,
  });
}

// Normalize an exhibitor node
function normalizeExhibitor(n: Rec): Rec {
  const addr = n.address as Rec | null;
  const addressStr = addr
    ? [addr.street, addr.city, addr.state, addr.country].filter(Boolean).join(", ")
    : undefined;
  return compact({
    id: n.id,
    name: n.name,
    description: n.description,
    email: n.email,
    websiteUrl: n.websiteUrl,
    logoUrl: n.logoUrl,
    address: addressStr,
    clientIds: n.clientIds,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  });
}

// Top-level response normalizer — walks well-known keys
function semanticize(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const d = data as Rec;

  // eventPerson query
  if (d.eventPerson && typeof d.eventPerson === "object") {
    const ep = d.eventPerson as Rec;
    const nodes = Array.isArray(ep.nodes) ? ep.nodes.map((n) => normalizePerson(n as Rec)) : [];
    const pi = ep.pageInfo as Rec | undefined;
    return {
      people: nodes,
      total: pi?.totalItems,
      hasNextPage: pi?.hasNextPage,
      nextCursor: pi?.endCursor,
    };
  }

  // planningsV2 query
  if (d.planningsV2 && typeof d.planningsV2 === "object") {
    const pv = d.planningsV2 as Rec;
    const nodes = Array.isArray(pv.nodes) ? pv.nodes.map((n) => normalizePlanning(n as Rec)) : [];
    const pi = pv.pageInfo as Rec | undefined;
    return { sessions: nodes, total: pi?.totalItems, hasNextPage: pi?.hasNextPage, nextCursor: pi?.endCursor };
  }

  // exhibitorsV2 query
  if (d.exhibitorsV2 && typeof d.exhibitorsV2 === "object") {
    const ev = d.exhibitorsV2 as Rec;
    const nodes = Array.isArray(ev.nodes) ? ev.nodes.map((n) => normalizeExhibitor(n as Rec)) : [];
    const pi = ev.pageInfo as Rec | undefined;
    return { exhibitors: nodes, total: pi?.totalItems, hasNextPage: pi?.hasNextPage, nextCursor: pi?.endCursor };
  }

  // event query — custom fields
  if (d.event && (d.event as Rec).fieldDefinitions !== undefined) {
    const ev = d.event as Rec;
    const defs = Array.isArray(ev.fieldDefinitions)
      ? (ev.fieldDefinitions as Rec[]).map((f) => compact({
          id: f.id,
          name: f.name,
          type: humanEnum(String(f.type ?? "")),
          target: f.target ? humanEnum(String(f.target)) : undefined,
          isEditable: f.isEditable,
          isVisible: f.isVisible,
          maxCharacters: f.maxCharacters,
          options: Array.isArray(f.optionsValues)
            ? (f.optionsValues as Rec[]).map((o) => ({ id: o.id, label: o.value }))
            : undefined,
        }))
      : [];
    return { eventId: ev.id, customFieldDefinitions: defs, count: defs.length };
  }

  // meetingsV2 query
  if (d.meetingsV2 && typeof d.meetingsV2 === "object") {
    const mv = d.meetingsV2 as Rec;
    const nodes = Array.isArray(mv.nodes)
      ? (mv.nodes as Rec[]).map((n) => compact({
          id: n.id,
          status: humanEnum(String(n.status ?? "")),
          source: humanEnum(String(n.source ?? "")),
          description: n.description,
          slot: n.slot,
          location: n.location,
          organizer: n.organizer,
        }))
      : [];
    const pi = mv.pageInfo as Rec | undefined;
    return { meetings: nodes, total: pi?.totalItems, hasNextPage: pi?.hasNextPage, nextCursor: pi?.endCursor };
  }

  // sponsors query
  if (Array.isArray(d.sponsors)) {
    return {
      sponsors: (d.sponsors as Rec[]).map((s) => compact({
        id: s.id,
        name: s.name,
        logoUrl: s.logoUrl,
        mode: s.mode ? humanEnum(String(s.mode)) : undefined,
        type: s.type ? humanEnum(String(s.type)) : undefined,
        externalUrl: s.externalUrl,
      })),
      count: (d.sponsors as Rec[]).length,
    };
  }

  // communities query
  if (d.communities && typeof d.communities === "object") {
    const cv = d.communities as Rec;
    const nodes = Array.isArray(cv.nodes) ? cv.nodes : [];
    const pi = cv.pageInfo as Rec | undefined;
    return { communities: nodes, total: pi?.totalItems, hasNextPage: pi?.hasNextPage, nextCursor: pi?.endCursor };
  }

  // event query — general (webhooks, documents, groups, etc.)
  if (d.event && typeof d.event === "object") {
    return compact(d.event as Rec);
  }

  // events query (array)
  if (Array.isArray(d.events)) {
    return { events: compact(d.events) };
  }

  // leads query
  if (d.leads && typeof d.leads === "object") {
    const leads = d.leads as Rec;
    const contacts = (leads.contacts as Rec | undefined);
    const nodes = Array.isArray(contacts?.nodes)
      ? (contacts!.nodes as Rec[]).map((c) => compact({
          id: c.id,
          connectedAt: c.connectedAt,
          rating: c.rating,
          note: c.note,
          isScanned: c.isScanned,
          event: (c.connectedAtEvent as Rec | undefined)?.title,
          owner: c.owner,
          target: c.target,
          customFields: Array.isArray(c.customFields)
            ? (c.customFields as Rec[]).map((f) => ({
                name: (f.definition as Rec | undefined)?.name,
                value: f.value,
              })).filter((f) => f.value != null)
            : undefined,
        }))
      : [];
    return { leads: nodes, total: (contacts?.pageInfo as Rec | undefined)?.totalItems };
  }

  // Fallback — compact nulls and return
  return compact(d);
}

// ─── Tool registry ────────────────────────────────────────────────────────────

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
export const handlers = new Map<string, ToolHandler>();

function reg(name: string, handler: ToolHandler) {
  handlers.set(name, async (args) => semanticize(await handler(args)));
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const tools: ToolDef[] = [
  // ── Communities ──────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_communities",
    description: "List communities accessible to the token, with optional cursor pagination and filters.",
    inputSchema: {
      type: "object",
      properties: {
        first: { type: "number" },
        after: { type: "string" },
        filter: { type: "object", description: "CommunitiesFilterInput fields" },
      },
    },
  },

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
    description: "Get multiple Swapcard events by their IDs or slugs in one request.",
    inputSchema: {
      type: "object",
      properties: {
        eventIds: { type: "array", items: { type: "string" }, description: "List of event IDs" },
        slugs: { type: "array", items: { type: "string" }, description: "List of event slugs" },
        page: { type: "number" },
        pageSize: { type: "number" },
      },
    },
  },

  // ── People ────────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_event_people",
    description: "List or search attendees/people in an event with optional email filter, sort, and cursor-based pagination. Returns custom field values.",
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
    name: "swapcard_update_event_person",
    description: "Update a single event person's profile fields including custom fields, barcodes, social networks, and bookmarks.",
    inputSchema: {
      type: "object",
      properties: {
        eventPersonId: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        email: { type: "string" },
        jobTitle: { type: "string" },
        secondJobTitle: { type: "string" },
        photoUrl: { type: "string" },
        organization: { type: "string" },
        websiteUrl: { type: "string" },
        biography: { type: "string" },
        isVisible: { type: "boolean" },
        mobilePhone: { type: "string" },
        landlinePhone: { type: "string" },
        address: { type: "object", description: "AddressInput fields" },
        phoneNumbers: { type: "array", items: { type: "object" } },
        socialNetworks: { type: "array", items: { type: "object", properties: { type: { type: "string" }, profile: { type: "string" } } } },
        customFields: { type: "array", items: { type: "object" }, description: "Array of CustomFieldUnionInput" },
        bookmarkedExhibitorIds: { type: "array", items: { type: "string" } },
        bookmarkedProductIds: { type: "array", items: { type: "string" } },
        updateBarcodes: { type: "object", description: "EventPersonUpdateBarcodesActionInput" },
      },
      required: ["eventPersonId"],
    },
  },
  {
    name: "swapcard_import_event_people",
    description: "Create or update attendees/people in bulk. In the 'create' object, 'isUser' (boolean) and 'firstName'/'lastName' are required. Supports groups, barcodes, speaker roles, exhibitor memberships, and custom fields.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        validateOnly: { type: "boolean" },
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
              actions: { type: "object" },
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
  {
    name: "swapcard_delete_client_ids",
    description: "Delete client IDs from event people.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "DeleteClientIdsInput fields" } },
      required: ["input"],
    },
  },

  // ── Sessions / Plannings ──────────────────────────────────────────────────────
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
        sort: { type: "array", items: { type: "string" } },
      },
      required: ["communityId"],
    },
  },
  {
    name: "swapcard_import_sessions",
    description: "Create or update sessions/plannings in bulk. Each item needs clientId and a 'create' object containing titleTranslations (required) and other fields.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        validateOnly: { type: "boolean" },
        plannings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              clientId: { type: "string" },
              id: { type: "string", description: "Provide to update an existing session" },
              create: {
                type: "object",
                description: "Fields for creating the session",
                properties: {
                  titleTranslations: { type: "array", items: { type: "object", properties: { language: { type: "string" }, value: { type: "string" } } } },
                  descriptionTranslations: { type: "array", items: { type: "object", properties: { language: { type: "string" }, value: { type: "string" } } } },
                  beginsAt: { type: "string" }, endsAt: { type: "string" },
                  isRatable: { type: "boolean" }, isPrivate: { type: "boolean" },
                  maxSeats: { type: "number" }, hashtag: { type: "string" },
                  bannerUrl: { type: "string" },
                },
                required: ["titleTranslations"],
              },
              update: { type: "object", description: "Fields to update on an existing session" },
            },
            required: ["clientId"],
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
  {
    name: "swapcard_create_planning_link",
    description: "Create a link between two plannings (sessions).",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        data: { type: "object", description: "CreatePlanningLinkInput fields" },
      },
      required: ["eventId", "data"],
    },
  },
  {
    name: "swapcard_delete_planning_views",
    description: "Delete planning views by input.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "DeletePlanningViewsInput fields" } },
      required: ["input"],
    },
  },
  {
    name: "swapcard_upsert_planning_redirect_url_view",
    description: "Upsert a planning redirect URL view.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "UpsertPlanningRedirectUrlViewInput fields" } },
      required: ["input"],
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
    description: "Create or update exhibitors in an event (V2). Each exhibitor must have inputId (your unique client reference ID used for idempotency).",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        validateOnly: { type: "boolean" },
        exhibitors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              inputId: { type: "string", description: "Required unique client reference ID for idempotency" },
              name: { type: "string" },
              description: { type: "string" },
              logoUrl: { type: "string" },
              websiteUrl: { type: "string" },
              email: { type: "string" },
            },
            required: ["inputId", "name"],
          },
        },
      },
      required: ["eventId", "exhibitors"],
    },
  },
  {
    name: "swapcard_import_exhibitor",
    description: "Import (create or update) exhibitors into an event using ImportEventExhibitorInput format.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        validateOnly: { type: "boolean" },
        exhibitors: { type: "array", items: { type: "object", description: "ImportEventExhibitorInput fields" } },
      },
      required: ["eventId", "exhibitors"],
    },
  },
  {
    name: "swapcard_update_exhibitor",
    description: "Update a single exhibitor's details including features, custom fields, and nested properties.",
    inputSchema: {
      type: "object",
      properties: {
        exhibitorId: { type: "string" },
        eventId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        htmlDescription: { type: "string" },
        logoUrl: { type: "string" },
        email: { type: "string" },
        websiteUrl: { type: "string" },
        backgroundImageUrl: { type: "string" },
        groupId: { type: "string" },
        productIds: { type: "array", items: { type: "string" } },
        documentLimit: { type: "number" },
        features: { type: "object", description: "ExhibitorFeatureInput fields" },
        customFields: { type: "array", items: { type: "object" }, description: "Array of CustomFieldUnionInput" },
        banner: { type: "object", description: "BannerInput fields" },
        withEvent: { type: "array", items: { type: "object" }, description: "Array of ExhibitorWithEventInput" },
      },
      required: ["exhibitorId"],
    },
  },
  {
    name: "swapcard_update_exhibitors_bulk",
    description: "Bulk update multiple exhibitors at once.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "UpdateExhibitorsInput fields" } },
      required: ["input"],
    },
  },
  {
    name: "swapcard_delete_event_exhibitors",
    description: "Delete exhibitors from an event by their IDs.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string" }, exhibitorsIds: { type: "array", items: { type: "string" } } },
      required: ["eventId", "exhibitorsIds"],
    },
  },
  {
    name: "swapcard_delete_exhibitors",
    description: "Delete exhibitors using the V2 DeleteExhibitorsInput (community-level).",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "DeleteExhibitorsInput fields" } },
      required: ["input"],
    },
  },
  {
    name: "swapcard_update_exhibitor_member_roles",
    description: "Update roles for an exhibitor member.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The exhibitor member ID" } },
      required: ["id"],
    },
  },

  // ── Exhibitor Links ───────────────────────────────────────────────────────────
  {
    name: "swapcard_create_exhibitor_link",
    description: "Create a named link relationship type between exhibitors (parent/child hierarchy).",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        childName: { type: "string" },
        parentName: { type: "string" },
        translations: { type: "array", items: { type: "object" } },
      },
      required: ["eventId", "childName", "parentName"],
    },
  },
  {
    name: "swapcard_update_exhibitor_link",
    description: "Update an exhibitor link relationship type.",
    inputSchema: {
      type: "object",
      properties: {
        exhibitorLinkId: { type: "string" },
        childName: { type: "string" },
        parentName: { type: "string" },
        translations: { type: "array", items: { type: "object" } },
      },
      required: ["exhibitorLinkId"],
    },
  },
  {
    name: "swapcard_delete_exhibitor_link",
    description: "Delete an exhibitor link relationship type by ID.",
    inputSchema: {
      type: "object",
      properties: { exhibitorLinkId: { type: "string" } },
      required: ["exhibitorLinkId"],
    },
  },
  {
    name: "swapcard_create_exhibitor_link_relation",
    description: "Create a parent-child relationship between two exhibitors using an existing link type.",
    inputSchema: {
      type: "object",
      properties: {
        exhibitorLinkId: { type: "string" },
        parentExhibitorId: { type: "string" },
        childExhibitorId: { type: "string" },
        eventId: { type: "string" },
      },
      required: ["exhibitorLinkId", "parentExhibitorId", "childExhibitorId"],
    },
  },
  {
    name: "swapcard_delete_exhibitor_link_relation",
    description: "Delete a parent-child relationship between two exhibitors.",
    inputSchema: {
      type: "object",
      properties: {
        exhibitorLinkId: { type: "string" },
        parentExhibitorId: { type: "string" },
        childExhibitorId: { type: "string" },
        eventId: { type: "string" },
      },
      required: ["exhibitorLinkId", "parentExhibitorId", "childExhibitorId"],
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
    inputSchema: { type: "object", properties: { documentId: { type: "string" }, eventId: { type: "string" }, name: { type: "string" }, url: { type: "string" }, description: { type: "string" } }, required: ["documentId"] },
  },
  {
    name: "swapcard_delete_event_documents",
    description: "Delete one or more event documents by their IDs.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" }, documentIds: { type: "array", items: { type: "string" } } }, required: ["eventId", "documentIds"] },
  },
  {
    name: "swapcard_create_document",
    description: "Create a community-level document, optionally scoped to an event.",
    inputSchema: { type: "object", properties: { communityId: { type: "string" }, eventId: { type: "string" }, name: { type: "string" }, url: { type: "string" }, description: { type: "string" } }, required: ["communityId", "name", "url"] },
  },
  {
    name: "swapcard_update_document",
    description: "Update a community-level document by its ID.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, communityId: { type: "string" }, eventId: { type: "string" }, name: { type: "string" }, url: { type: "string" }, description: { type: "string" } }, required: ["id"] },
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
  {
    name: "swapcard_set_select_field_value",
    description: "Set (create or update) a select field option value on a custom field definition.",
    inputSchema: {
      type: "object",
      properties: {
        fieldDefinitionId: { type: "string" },
        key: { type: "string" },
        fieldValueId: { type: "string" },
        translations: { type: "array", items: { type: "object" } },
      },
      required: ["fieldDefinitionId", "key"],
    },
  },
  {
    name: "swapcard_delete_select_field_values",
    description: "Delete all select field values for a given custom field definition.",
    inputSchema: {
      type: "object",
      properties: { fieldDefinitionId: { type: "string" } },
      required: ["fieldDefinitionId"],
    },
  },

  // ── Tree Field Nodes ──────────────────────────────────────────────────────────
  {
    name: "swapcard_create_tree_field_node",
    description: "Create a node in a tree-type custom field.",
    inputSchema: {
      type: "object",
      properties: {
        fieldDefinitionId: { type: "string" },
        targetNode: { type: "string" },
        position: { type: "string" },
        nodeId: { type: "string" },
      },
      required: ["fieldDefinitionId", "targetNode", "position", "nodeId"],
    },
  },
  {
    name: "swapcard_update_tree_field_node",
    description: "Update a node in a tree-type custom field.",
    inputSchema: {
      type: "object",
      properties: {
        fieldDefinitionId: { type: "string" },
        currentNodePath: { type: "string" },
        newNodePath: { type: "string" },
        isSelectable: { type: "boolean" },
        translations: { type: "array", items: { type: "object" } },
      },
      required: ["fieldDefinitionId", "currentNodePath"],
    },
  },
  {
    name: "swapcard_delete_tree_field_node",
    description: "Delete a node from a tree-type custom field.",
    inputSchema: {
      type: "object",
      properties: {
        fieldDefinitionId: { type: "string" },
        currentNodePath: { type: "string" },
      },
      required: ["fieldDefinitionId", "currentNodePath"],
    },
  },
  {
    name: "swapcard_move_tree_field_node",
    description: "Move a node within a tree-type custom field.",
    inputSchema: {
      type: "object",
      properties: {
        fieldDefinitionId: { type: "string" },
        currentNodePath: { type: "string" },
        targetNode: { type: "string" },
        position: { type: "string" },
      },
      required: ["fieldDefinitionId", "currentNodePath", "targetNode", "position"],
    },
  },

  // ── Groups ────────────────────────────────────────────────────────────────────
  {
    name: "swapcard_create_event_group",
    description: "Create a new group within an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        name: { type: "string" },
        fromEventGroupId: { type: "string" },
        parentCommunityGroupId: { type: "string" },
      },
      required: ["eventId", "name"],
    },
  },

  // ── Sponsors ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_sponsors",
    description: "List sponsors for an event with optional ID list and search.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        search: { type: "string" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_create_sponsor",
    description: "Create a new sponsor for an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        categoryId: { type: "string" },
        name: { type: "string" },
        logoUrl: { type: "string" },
        mode: { type: "string" },
        redirectUrl: { type: "string" },
        exhibitorId: { type: "string" },
      },
      required: ["eventId", "categoryId", "name"],
    },
  },
  {
    name: "swapcard_update_sponsor",
    description: "Update an existing event sponsor.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        id: { type: "string" },
        name: { type: "string" },
        categoryId: { type: "string" },
        logoUrl: { type: "string" },
        mode: { type: "string" },
        redirectUrl: { type: "string" },
        exhibitorId: { type: "string" },
      },
      required: ["eventId", "id", "name"],
    },
  },
  {
    name: "swapcard_delete_sponsors",
    description: "Delete one or more event sponsors by their IDs.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        sponsorIds: { type: "array", items: { type: "string" } },
      },
      required: ["eventId", "sponsorIds"],
    },
  },

  // ── Roles ─────────────────────────────────────────────────────────────────────
  {
    name: "swapcard_create_role",
    description: "Create a new role in a community with permissions.",
    inputSchema: {
      type: "object",
      properties: {
        communityId: { type: "string" },
        eventId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        permissionIds: { type: "array", items: { type: "string" } },
        isDefault: { type: "boolean" },
        type: { type: "string", enum: ["EXHIBITOR"], description: "Role permission type — only EXHIBITOR is valid" },
        translations: { type: "array", items: { type: "object" } },
      },
      required: ["communityId", "name", "type"],
    },
  },
  {
    name: "swapcard_update_role",
    description: "Update an existing role.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "object", description: "UpdateRoleInput fields" },
      },
      required: ["input"],
    },
  },
  {
    name: "swapcard_delete_roles",
    description: "Delete roles by IDs.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "DeleteRolesInput fields" } },
      required: ["input"],
    },
  },

  // ── Ticket Types ──────────────────────────────────────────────────────────────
  {
    name: "swapcard_create_ticket_type",
    description: "Create a new ticket type for an event. Requires eventGroupId (the event group this ticket belongs to), startsAt/endsAt (ISO8601 datetimes), and isVisible.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        eventGroupId: { type: "string", description: "Required: ID of the event group for this ticket type" },
        startsAt: { type: "string", description: "Required: ISO8601 datetime when ticket sales start" },
        endsAt: { type: "string", description: "Required: ISO8601 datetime when ticket sales end" },
        isVisible: { type: "boolean", description: "Required: whether ticket is publicly visible" },
        description: { type: "string" },
        htmlDescription: { type: "string" },
        freeLabel: { type: "string" },
        showFreeLabel: { type: "boolean" },
        quantity: { type: "number" },
        priceCents: { type: "number" },
        isModerated: { type: "boolean" },
        translations: { type: "array", items: { type: "object" }, description: "Required: translations array (can be empty [])" },
      },
      required: ["name", "eventGroupId", "startsAt", "endsAt", "isVisible"],
    },
  },
  {
    name: "swapcard_update_ticket_type",
    description: "Update a ticket type.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "UpdateTicketTypeInput fields" } },
      required: ["input"],
    },
  },
  {
    name: "swapcard_delete_ticket_types",
    description: "Delete ticket types by IDs.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "DeleteTicketTypesInput fields" } },
      required: ["input"],
    },
  },

  // ── Products ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_create_product",
    description: "Create a new product in an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        categoryId: { type: "string" },
        name: { type: "string" },
        clientId: { type: "string" },
        description: { type: "string" },
        imageUrl: { type: "string" },
        assetsUrls: { type: "array", items: { type: "string" } },
        exhibitorIds: { type: "array", items: { type: "string" } },
        customFields: { type: "array", items: { type: "object" } },
        translations: { type: "array", items: { type: "object" } },
        withEvent: { type: "object", description: "ProductWithEventInput" },
      },
      required: ["eventId", "categoryId", "name"],
    },
  },
  {
    name: "swapcard_update_product",
    description: "Update a product.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string" },
        eventId: { type: "string" },
        categoryId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        imageUrl: { type: "string" },
        assetsUrls: { type: "array", items: { type: "string" } },
        exhibitorIds: { type: "array", items: { type: "string" } },
        customFields: { type: "array", items: { type: "object" } },
        translations: { type: "array", items: { type: "object" } },
        inputId: { type: "string" },
        withEvent: { type: "object" },
      },
      required: ["productId"],
    },
  },
  {
    name: "swapcard_update_products_bulk",
    description: "Bulk update multiple products.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "UpdateProductsInput fields" } },
      required: ["input"],
    },
  },
  {
    name: "swapcard_delete_products",
    description: "Delete products.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "DeleteProductsInput fields" } },
      required: ["input"],
    },
  },
  {
    name: "swapcard_create_product_category",
    description: "Create a new product category in an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        name: { type: "string" },
        parentId: { type: "string" },
        imageUrl: { type: "string" },
        color: { type: "string" },
        limit: { type: "number" },
        fieldDefinitionIds: { type: "array", items: { type: "string" } },
        translations: { type: "array", items: { type: "object" } },
        withEvent: { type: "array", items: { type: "object" } },
      },
      required: ["eventId", "name"],
    },
  },
  {
    name: "swapcard_update_product_category",
    description: "Update a product category.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "UpdateProductCategoryInput fields" } },
      required: ["input"],
    },
  },
  {
    name: "swapcard_delete_product_categories",
    description: "Delete product categories.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "DeleteProductCategoriesInput fields" } },
      required: ["input"],
    },
  },

  // ── Locations ─────────────────────────────────────────────────────────────────
  {
    name: "swapcard_create_locations",
    description: "Create locations for an event.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string" } },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_update_locations",
    description: "Update locations for an event.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string" } },
      required: ["eventId"],
    },
  },

  // ── Meetings ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_meetings",
    description: "List meetings in an event with optional search and cursor pagination.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        first: { type: "number" },
        after: { type: "string" },
        search: { type: "string" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "swapcard_create_meeting",
    description: "Create a meeting for an event at a specific slot and place.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        slotId: { type: "string" },
        placeId: { type: "string" },
      },
      required: ["eventId", "slotId", "placeId"],
    },
  },
  {
    name: "swapcard_update_meeting",
    description: "Update an existing meeting's details, participants, and availability.",
    inputSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        description: { type: "string" },
        canReschedule: { type: "boolean" },
        canCancel: { type: "boolean" },
        maxParticipants: { type: "number" },
        placeId: { type: "string" },
        slotId: { type: "string" },
        participants: { type: "array", items: { type: "object" } },
      },
      required: ["meetingId"],
    },
  },
  {
    name: "swapcard_update_person_meeting_slots",
    description: "Enable or disable meeting slots for a specific person.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        personId: { type: "string" },
        meetingSlotIds: { type: "array", items: { type: "string" } },
        meetingSlotRange: { type: "object", description: "DateRangeInput with from/to" },
        isDisabled: { type: "boolean" },
      },
      required: ["eventId", "personId"],
    },
  },

  // ── Webhooks ──────────────────────────────────────────────────────────────────
  {
    name: "swapcard_list_webhooks",
    description: "List all webhook subscriptions configured for an event.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"] },
  },
  {
    name: "swapcard_create_webhook",
    description: "Register a new webhook subscription for an event. hooks is required. Valid hook types: PROFILE_CREATE, PROFILE_UPDATE, PROFILE_DELETE, EXHIBITOR_CREATE, EXHIBITOR_UPDATE, EXHIBITOR_DELETE, PLANNING_CREATE, PLANNING_UPDATE, PLANNING_DELETE, PLANNING_ATTENDEE_CREATE, PLANNING_ATTENDEE_DELETE, MEETING_CREATE, MEETING_UPDATE.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        endpoint: { type: "string" },
        secret: { type: "string" },
        hooks: { type: "array", items: { type: "string", enum: ["PROFILE_CREATE","PROFILE_UPDATE","PROFILE_DELETE","EXHIBITOR_CREATE","EXHIBITOR_UPDATE","EXHIBITOR_DELETE","PLANNING_CREATE","PLANNING_UPDATE","PLANNING_DELETE","PLANNING_ATTENDEE_CREATE","PLANNING_ATTENDEE_DELETE","MEETING_CREATE","MEETING_UPDATE"] }, description: "Required: list of event types to subscribe to" },
      },
      required: ["eventId", "endpoint", "hooks"],
    },
  },
  {
    name: "swapcard_update_webhook",
    description: "Update an existing webhook subscription's endpoint, hooks, enabled state, or name.",
    inputSchema: {
      type: "object",
      properties: {
        webhookId: { type: "string" },
        endpoint: { type: "string" },
        hooks: { type: "array", items: { type: "string" } },
        enabled: { type: "boolean" },
        name: { type: "string" },
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

  // ── Push Notifications ────────────────────────────────────────────────────────
  {
    name: "swapcard_create_push_notification",
    description: "Create and send a push notification to attendees of an event.",
    inputSchema: {
      type: "object",
      properties: {
        communityId: { type: "string" },
        withEvent: { type: "object", description: "PushNotificationWithEventInput fields (eventId, title, message, etc.)" },
      },
      required: ["communityId", "withEvent"],
    },
  },

  // ── Codes / Access Codes ──────────────────────────────────────────────────────
  {
    name: "swapcard_create_code",
    description: "Create a discount or access code for an event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        description: { type: "string" },
        availableFrom: { type: "string", description: "ISO 8601 DateTime" },
        availableUntil: { type: "string", description: "ISO 8601 DateTime" },
        code: { type: "string" },
        type: { type: "string" },
        revealHiddenTickets: { type: "boolean" },
        exhibitorId: { type: "string" },
        quantity: { type: "number" },
        rule: { type: "object", description: "CodeApplicationRuleInput" },
        discount: { type: "object", description: "UpsertCodeDiscountInput" },
      },
      required: ["eventId", "description", "availableFrom", "availableUntil"],
    },
  },
  {
    name: "swapcard_update_code",
    description: "Update an existing access/discount code.",
    inputSchema: {
      type: "object",
      properties: {
        codeId: { type: "string" },
        code: { type: "string" },
        type: { type: "string" },
        revealHiddenTickets: { type: "boolean" },
        description: { type: "string" },
        availableFrom: { type: "string" },
        availableUntil: { type: "string" },
        quantity: { type: "number" },
        rule: { type: "object" },
        discount: { type: "object" },
      },
      required: ["codeId"],
    },
  },
  {
    name: "swapcard_delete_codes",
    description: "Delete access/discount codes.",
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", description: "DeleteCodesInput fields" } },
      required: ["input"],
    },
  },
  {
    name: "swapcard_access_codes_scan",
    description: "Scan access codes for event check-in.",
    inputSchema: {
      type: "object",
      properties: {
        immediate: { type: "boolean" },
        deviceName: { type: "string" },
      },
    },
  },

  // ── User Terms ────────────────────────────────────────────────────────────────
  {
    name: "swapcard_update_user_term",
    description: "Update a user term (consent agreement) definition.",
    inputSchema: {
      type: "object",
      properties: {
        userTermId: { type: "string" },
        label: { type: "string" },
        description: { type: "string" },
        translations: { type: "array", items: { type: "object" } },
        eventId: { type: "string" },
        isRequired: { type: "boolean" },
        promptLocations: { type: "object" },
      },
      required: ["userTermId"],
    },
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

// Communities
reg("swapcard_list_communities", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query ListCommunities($cursor: CursorPaginationInput, $filter: CommunitiesFilterInput) {
      communities(cursor: $cursor, filter: $filter) {
        pageInfo { endCursor hasNextPage totalItems }
        nodes { id slug name title description }
      }
    }
  `, { cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined, filter: a.filter }));

// Events
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
    query GetEvents($eventIds: [String!], $slugs: [String!], $page: Int, $pageSize: Int) {
      events(ids: $eventIds, slugs: $slugs, page: $page, pageSize: $pageSize) {
        id slug title beginsAt endsAt language timezone isLive
        totalPlannings totalExhibitors totalSpeakers
        address { place street city zipCode state country }
      }
    }
  `, { eventIds: a.eventIds, slugs: a.slugs, page: a.page, pageSize: a.pageSize }));

// People
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
          fields {
            __typename
            ... on TextField { id value definition { id name } }
            ... on LongTextField { id value definition { id name } }
            ... on UrlField { id value definition { id name } }
            ... on DateField { id value definition { id name } }
            ... on SelectField { id value definition { id name } }
            ... on MultipleTextField { id value definition { id name } }
            ... on MediaField { id mediaValue: value fileName mimeType definition { id name } }
            ... on TreeField { id treeNode: value { value } definition { id name } }
            ... on NumberField { id numberValue: value definition { id name } }
            ... on MultipleSelectField { id msValue: value definition { id name } }
          }
        }
      }
    }
  `, {
    eventId: a.eventId, search: a.search,
    filters: a.emails ? [{ emails: a.emails }] : undefined,
    cursor: { first: a.first ?? 20, ...(a.after ? { after: a.after } : {}) },
  }));

reg("swapcard_update_event_person", async (a) => {
  const { eventPersonId, ...rest } = a;
  return gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateEventPerson($input: UpdateEventPersonV2Input!) {
      updateEventPerson(input: $input) { eventPerson { id email firstName lastName jobTitle organization } }
    }
  `, { input: { eventPersonId, ...rest } });
});

reg("swapcard_import_event_people", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation ImportEventPeople($eventId: ID!, $data: [ImportEventPersonInput!]!, $validateOnly: Boolean) {
      importEventPeople(eventId: $eventId, data: $data, validateOnly: $validateOnly) {
        eventPeopleCreated eventPeopleUpdated
        errors { inputId errorCode message }
        results { inputId eventPerson { id email firstName lastName jobTitle organization } }
      }
    }
  `, { eventId: a.eventId, data: a.data, validateOnly: a.validateOnly }));

reg("swapcard_delete_event_people", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteEventPeople($eventId: ID!, $eventPeopleIds: [ID!]!) {
      deleteEventPeople(eventId: $eventId, eventPeopleIds: $eventPeopleIds) { eventPeopleDeleted }
    }
  `, { eventId: a.eventId, eventPeopleIds: a.eventPeopleIds }));

reg("swapcard_delete_client_ids", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteClientIds($input: DeleteClientIdsInput!) {
      deleteClientIds(input: $input)
    }
  `, { input: a.input }));

// Sessions
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
    mutation ImportSessions($eventId: ID!, $plannings: [ImportEventPlanningInput!]!, $validateOnly: Boolean) {
      importEventPlannings(eventId: $eventId, plannings: $plannings, validateOnly: $validateOnly) {
        errors { inputId message errorCode }
        results { inputId planning { id title description } }
      }
    }
  `, { eventId: a.eventId, plannings: a.plannings, validateOnly: a.validateOnly }));

reg("swapcard_delete_sessions", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteSessions($eventId: ID!, $planningsIds: [ID!]!) {
      deleteEventPlannings(eventId: $eventId, planningsIds: $planningsIds)
    }
  `, { eventId: a.eventId, planningsIds: a.planningsIds }));

reg("swapcard_create_planning_link", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreatePlanningLink($data: CreatePlanningLinkInput!, $eventId: String!) {
      createEventPlanningLink(data: $data, eventId: $eventId) { id }
    }
  `, { data: a.data, eventId: a.eventId }));

reg("swapcard_delete_planning_views", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeletePlanningViews($input: DeletePlanningViewsInput!) {
      deletePlanningViews(input: $input) { deletedPlanningViewsIds }
    }
  `, { input: a.input }));

reg("swapcard_upsert_planning_redirect_url_view", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpsertPlanningRedirectUrlView($input: UpsertPlanningRedirectUrlViewInput!) {
      upsertPlanningRedirectUrlView(input: $input) { planning { id } }
    }
  `, { input: a.input }));

// Exhibitors
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
    mutation UpsertExhibitorsV2($eventId: String!, $exhibitors: [ExhibitorInput!]!, $validateOnly: Boolean) {
      upsertEventExhibitorsV2(eventId: $eventId, exhibitors: $exhibitors, validateOnly: $validateOnly) {
        errors { inputId message errorCode }
        results { inputId exhibitor { id name logoUrl websiteUrl } }
      }
    }
  `, { eventId: a.eventId, exhibitors: a.exhibitors, validateOnly: a.validateOnly }));

reg("swapcard_import_exhibitor", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation ImportEventExhibitor($eventId: ID!, $exhibitors: [ImportEventExhibitorInput!]!, $validateOnly: Boolean) {
      importEventExhibitor(eventId: $eventId, exhibitors: $exhibitors, validateOnly: $validateOnly) {
        errors { inputId message errorCode }
        results { inputId exhibitor { id name } }
      }
    }
  `, { eventId: a.eventId, exhibitors: a.exhibitors, validateOnly: a.validateOnly }));

reg("swapcard_update_exhibitor", async (a) => {
  const { exhibitorId, ...rest } = a;
  return gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateExhibitor($input: UpdateExhibitorInput!) {
      updateExhibitor(input: $input) { exhibitor { id name description logoUrl websiteUrl email } }
    }
  `, { input: { exhibitorId, ...rest } });
});

reg("swapcard_update_exhibitors_bulk", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateExhibitorsBulk($input: UpdateExhibitorsInput!) {
      updateExhibitors(input: $input) { exhibitors { id name } }
    }
  `, { input: a.input }));

reg("swapcard_delete_event_exhibitors", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteEventExhibitors($eventId: String!, $exhibitorsIds: [String!]!) {
      deleteEventExhibitors(eventId: $eventId, exhibitorsIds: $exhibitorsIds)
    }
  `, { eventId: a.eventId, exhibitorsIds: a.exhibitorsIds }));

reg("swapcard_delete_exhibitors", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteExhibitors($input: DeleteExhibitorsInput!) {
      deleteExhibitors(input: $input) { deletedExhibitorsIds }
    }
  `, { input: a.input }));

reg("swapcard_update_exhibitor_member_roles", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateExhibitorMemberRoles($input: UpdateExhibitorMemberRolesInput!) {
      updateExhibitorMemberRoles(input: $input) { exhibitorMember { id } }
    }
  `, { input: { id: a.id } }));

// Exhibitor Links
reg("swapcard_create_exhibitor_link", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateExhibitorLink($input: CreateExhibitorLinkInput!) {
      createExhibitorLink(input: $input) { exhibitorLink { id childName parentName } }
    }
  `, { input: { eventId: a.eventId, childName: a.childName, parentName: a.parentName, translations: a.translations } }));

reg("swapcard_update_exhibitor_link", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateExhibitorLink($input: UpdateExhibitorLinkInput!) {
      updateExhibitorLink(input: $input) { exhibitorLink { id childName parentName } }
    }
  `, { input: { exhibitorLinkId: a.exhibitorLinkId, childName: a.childName, parentName: a.parentName, translations: a.translations } }));

reg("swapcard_delete_exhibitor_link", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteExhibitorLink($input: DeleteExhibitorLinkInput!) {
      deleteExhibitorLink(input: $input) { deletedExhibitorLinkId }
    }
  `, { input: { exhibitorLinkId: a.exhibitorLinkId } }));

reg("swapcard_create_exhibitor_link_relation", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateExhibitorLinkRelation($input: CreateExhibitorLinkRelationInput!) {
      createExhibitorLinkRelation(input: $input) { exhibitorLink { id } }
    }
  `, { input: { exhibitorLinkId: a.exhibitorLinkId, parentExhibitorId: a.parentExhibitorId, childExhibitorId: a.childExhibitorId, eventId: a.eventId } }));

reg("swapcard_delete_exhibitor_link_relation", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteExhibitorLinkRelation($input: DeleteExhibitorLinkRelationInput!) {
      deleteExhibitorLinkRelation(input: $input) { exhibitorLink { id } }
    }
  `, { input: { exhibitorLinkId: a.exhibitorLinkId, parentExhibitorId: a.parentExhibitorId, childExhibitorId: a.childExhibitorId, eventId: a.eventId } }));

// Documents
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
    mutation UpdateEventDocument($documentId: ID!, $eventId: ID, $document: UpdateDocumentInput!) {
      updateEventDocument(id: $documentId, eventId: $eventId, document: $document) { id name description type url }
    }
  `, { documentId: a.documentId, eventId: a.eventId, document: { name: a.name, url: a.url, description: a.description } }));

reg("swapcard_delete_event_documents", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteEventDocuments($eventId: ID!, $documentIds: [ID!]!) {
      deleteEventDocument(eventId: $eventId, ids: $documentIds)
    }
  `, { eventId: a.eventId, documentIds: a.documentIds }));

reg("swapcard_create_document", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateDocument($communityId: ID!, $eventId: ID, $document: CreateDocumentInput!) {
      createDocument(communityId: $communityId, eventId: $eventId, document: $document) { document { id name description type url } }
    }
  `, { communityId: a.communityId, eventId: a.eventId, document: { name: a.name, url: a.url, description: a.description } }));

reg("swapcard_update_document", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateDocument($id: ID!, $communityId: ID, $eventId: ID, $document: UpdateDocumentInput!) {
      updateDocument(id: $id, communityId: $communityId, eventId: $eventId, document: $document) { document { id name description type url } }
    }
  `, { id: a.id, communityId: a.communityId, eventId: a.eventId, document: { name: a.name, url: a.url, description: a.description } }));

// Custom Fields
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
      createFieldDefinition(input: $input) { fieldDefinition {
        ... on TextFieldDefinition { id name type }
        ... on NumberFieldDefinition { id name type }
        ... on SelectFieldDefinition { id name type }
        ... on MultipleSelectFieldDefinition { id name type }
        ... on DateFieldDefinition { id name type }
        ... on UrlFieldDefinition { id name type }
        ... on LongTextFieldDefinition { id name type }
        ... on MultipleTextFieldDefinition { id name type }
        ... on MediaFieldDefinition { id name type }
        ... on TreeFieldDefinition { id name type }
      } }
    }
  `, { input: { eventId: a.eventId, name: a.name, target: a.target, type: a.type, isEditable: a.isEditable ?? true, isVisible: a.isVisible ?? true, translations: a.translations } }));

reg("swapcard_update_custom_field", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateCustomField($input: UpdateFieldDefinitionV2Input!) {
      updateFieldDefinition(input: $input) { fieldDefinition { id name } }
    }
  `, { input: { fieldDefinitionId: a.fieldDefinitionId, isEditable: a.isEditable, isVisible: a.isVisible, maxCharacters: a.maxCharacters } }));

reg("swapcard_delete_custom_fields", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteCustomFields($input: DeleteFieldDefinitionsInput!) {
      deleteFieldDefinitions(input: $input) { deletedFieldDefinitionIds }
    }
  `, { input: { eventId: a.eventId, fieldDefinitionIds: a.fieldDefinitionIds } }));

reg("swapcard_set_select_field_value", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation SetSelectFieldValue($input: SetSelectFieldValueInput!) {
      setSelectFieldValue(input: $input) { selectField {
        ... on SelectField { id value }
        ... on MultipleSelectField { id value }
        ... on TreeField { id }
      } }
    }
  `, { input: { fieldDefinitionId: a.fieldDefinitionId, key: a.key, fieldValueId: a.fieldValueId, translations: a.translations } }));

reg("swapcard_delete_select_field_values", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteSelectFieldValues($input: DeleteSelectFieldValuesInput!) {
      deleteSelectFieldValues(input: $input) { deletedSelectFieldsIds }
    }
  `, { input: { fieldDefinitionId: a.fieldDefinitionId } }));

// Tree Field Nodes
reg("swapcard_create_tree_field_node", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateTreeFieldNode($input: CreateTreeFieldNodeInput!) {
      createTreeFieldNode(input: $input) { fieldDefinition { id } }
    }
  `, { input: { fieldDefinitionId: a.fieldDefinitionId, targetNode: a.targetNode, position: a.position, nodeId: a.nodeId } }));

reg("swapcard_update_tree_field_node", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateTreeFieldNode($input: UpdateTreeFieldNodeInput!) {
      updateTreeFieldNode(input: $input) { fieldDefinition { id } }
    }
  `, { input: { fieldDefinitionId: a.fieldDefinitionId, currentNodePath: a.currentNodePath, newNodePath: a.newNodePath, isSelectable: a.isSelectable, translations: a.translations } }));

reg("swapcard_delete_tree_field_node", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteTreeFieldNode($input: DeleteTreeFieldNodeInput!) {
      deleteTreeFieldNode(input: $input) { deletedFieldValueIds }
    }
  `, { input: { fieldDefinitionId: a.fieldDefinitionId, currentNodePath: a.currentNodePath } }));

reg("swapcard_move_tree_field_node", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation MoveTreeFieldNode($input: MoveTreeFieldNodeInput!) {
      moveTreeFieldNode(input: $input) { fieldDefinition { id } }
    }
  `, { input: { fieldDefinitionId: a.fieldDefinitionId, currentNodePath: a.currentNodePath, targetNode: a.targetNode, position: a.position } }));

// Groups
reg("swapcard_create_event_group", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateEventGroup($data: CreateEventGroupInput!, $eventId: ID!) {
      createEventGroup(data: $data, eventId: $eventId) { id name isDefault peopleCount exhibitorCount priority }
    }
  `, { data: { name: a.name, fromEventGroupId: a.fromEventGroupId, parentCommunityGroupId: a.parentCommunityGroupId }, eventId: a.eventId }));

// Sponsors
reg("swapcard_list_sponsors", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query ListSponsors($eventId: String!, $ids: [String!], $search: String) {
      sponsors(eventId: $eventId, ids: $ids, search: $search) {
        ... on Sponsor { id name logoUrl mode type externalUrl }
        ... on SponsorExhibitor { id name logoUrl mode type }
      }
    }
  `, { eventId: a.eventId, ids: a.ids, search: a.search }));

reg("swapcard_create_sponsor", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateEventSponsor($eventId: String!, $sponsor: CreateSponsorInput!) {
      createEventSponsor(eventId: $eventId, sponsor: $sponsor) { id name logoUrl mode }
    }
  `, { eventId: a.eventId, sponsor: { categoryId: a.categoryId, name: a.name, logoUrl: a.logoUrl, mode: a.mode, redirectUrl: a.redirectUrl, exhibitorId: a.exhibitorId } }));

reg("swapcard_update_sponsor", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateEventSponsor($eventId: String!, $sponsor: UpdateSponsorInput!) {
      updateEventSponsor(eventId: $eventId, sponsor: $sponsor) { id name logoUrl mode }
    }
  `, { eventId: a.eventId, sponsor: { id: a.id, name: a.name, categoryId: a.categoryId, logoUrl: a.logoUrl, mode: a.mode, redirectUrl: a.redirectUrl, exhibitorId: a.exhibitorId } }));

reg("swapcard_delete_sponsors", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteEventSponsors($eventId: String!, $sponsorIds: [String!]!) {
      deleteEventSponsors(eventId: $eventId, sponsorIds: $sponsorIds)
    }
  `, { eventId: a.eventId, sponsorIds: a.sponsorIds }));

// Roles
reg("swapcard_create_role", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateRole($input: CreateRoleInput!) {
      createRole(input: $input) { role { id name description } }
    }
  `, { input: { communityId: a.communityId, eventId: a.eventId, name: a.name, description: a.description, permissionIds: a.permissionIds, isDefault: a.isDefault, type: a.type, translations: a.translations } }));

reg("swapcard_update_role", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateRole($input: UpdateRoleInput!) {
      updateRole(input: $input) { role { id name description } }
    }
  `, { input: a.input }));

reg("swapcard_delete_roles", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteRoles($input: DeleteRolesInput!) {
      deleteRoles(input: $input) { deletedRoleIds }
    }
  `, { input: a.input }));

// Ticket Types
reg("swapcard_create_ticket_type", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateTicketType($input: CreateTicketTypeInput!) {
      createTicketType(input: $input) { ticketType { id name quantity htmlDescription } }
    }
  `, { input: { name: a.name, eventGroupId: a.eventGroupId, startsAt: a.startsAt, endsAt: a.endsAt, isVisible: a.isVisible ?? true, translations: a.translations ?? [], description: a.description, htmlDescription: a.htmlDescription, freeLabel: a.freeLabel, showFreeLabel: a.showFreeLabel, quantity: a.quantity, priceCents: a.priceCents, isModerated: a.isModerated } }));

reg("swapcard_update_ticket_type", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateTicketType($input: UpdateTicketTypeInput!) {
      updateTicketType(input: $input) { ticketType { id name } }
    }
  `, { input: a.input }));

reg("swapcard_delete_ticket_types", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteTicketTypes($input: DeleteTicketTypesInput!) {
      deleteTicketTypes(input: $input) { deletedTicketTypeIds }
    }
  `, { input: a.input }));

// Products
reg("swapcard_create_product", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateProduct($input: CreateProductInput!) {
      createProduct(input: $input) { product { id name description inputId } }
    }
  `, { input: { eventId: a.eventId, categoryId: a.categoryId, name: a.name, clientId: a.clientId, description: a.description, imageUrl: a.imageUrl, assetsUrls: a.assetsUrls, exhibitorIds: a.exhibitorIds, customFields: a.customFields, translations: a.translations, withEvent: a.withEvent } }));

reg("swapcard_update_product", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateProduct($input: UpdateProductInput!) {
      updateProduct(input: $input) { product { id name description } }
    }
  `, { input: { productId: a.productId, eventId: a.eventId, categoryId: a.categoryId, name: a.name, description: a.description, imageUrl: a.imageUrl, assetsUrls: a.assetsUrls, exhibitorIds: a.exhibitorIds, customFields: a.customFields, translations: a.translations, inputId: a.inputId, withEvent: a.withEvent } }));

reg("swapcard_update_products_bulk", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateProductsBulk($input: UpdateProductsInput!) {
      updateProducts(input: $input) { products { id name } }
    }
  `, { input: a.input }));

reg("swapcard_delete_products", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteProducts($input: DeleteProductsInput!) {
      deleteProducts(input: $input) { deletedProductIds }
    }
  `, { input: a.input }));

reg("swapcard_create_product_category", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateProductCategory($input: CreateProductCategoryInput!) {
      createProductCategory(input: $input) { productCategory { id name } }
    }
  `, { input: { eventId: a.eventId, name: a.name, parentId: a.parentId, imageUrl: a.imageUrl, color: a.color, limit: a.limit, fieldDefinitionIds: a.fieldDefinitionIds, translations: a.translations, withEvent: a.withEvent } }));

reg("swapcard_update_product_category", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateProductCategory($input: UpdateProductCategoryInput!) {
      updateProductCategory(input: $input) { productCategory { id name } }
    }
  `, { input: a.input }));

reg("swapcard_delete_product_categories", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteProductCategories($input: DeleteProductCategoriesInput!) {
      deleteProductCategories(input: $input) { deletedProductCategoriesIds }
    }
  `, { input: a.input }));

// Locations
reg("swapcard_create_locations", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateLocations($input: CreateLocationsInput!) {
      createLocations(input: $input) { locations { id } }
    }
  `, { input: { eventId: a.eventId } }));

reg("swapcard_update_locations", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateLocations($input: UpdateLocationsInput!) {
      updateLocations(input: $input) { locations { id } }
    }
  `, { input: { eventId: a.eventId } }));

// Meetings
reg("swapcard_list_meetings", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query ListMeetings($eventId: ID!, $cursor: CursorPaginationInput, $search: String) {
      meetingsV2(eventId: $eventId, cursor: $cursor, search: $search) {
        pageInfo { endCursor hasNextPage totalItems }
        nodes { id status description source }
      }
    }
  `, { eventId: a.eventId, search: a.search, cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined }));

reg("swapcard_create_meeting", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateMeeting($input: CreateMeetingInput!) {
      createMeeting(input: $input) { meeting { id status } }
    }
  `, { input: { eventId: a.eventId, slotId: a.slotId, placeId: a.placeId } }));

reg("swapcard_update_meeting", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateMeeting($input: UpdateMeetingInput!) {
      updateMeeting(input: $input) { meeting { id status description } }
    }
  `, { input: { meetingId: a.meetingId, description: a.description, canReschedule: a.canReschedule, canCancel: a.canCancel, maxParticipants: a.maxParticipants, placeId: a.placeId, slotId: a.slotId, participants: a.participants } }));

reg("swapcard_update_person_meeting_slots", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdatePersonMeetingSlots($input: UpdatePersonMeetingSlotsDisabledInput!) {
      updatePersonMeetingSlotsDisabled(input: $input) { person { id } }
    }
  `, { input: { eventId: a.eventId, personId: a.personId, meetingSlotIds: a.meetingSlotIds, meetingSlotRange: a.meetingSlotRange, isDisabled: a.isDisabled } }));

// Webhooks
reg("swapcard_list_webhooks", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    query ListWebhooks($eventId: ID!) { event(id: $eventId) { webhooks { id eventId endpoint } } }
  `, { eventId: a.eventId }));

reg("swapcard_create_webhook", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateWebhook($input: CreateWebhookInput!) {
      createWebhook(input: $input) { webhook { id eventId endpoint } }
    }
  `, { input: { eventId: a.eventId, endpoint: a.endpoint, secret: a.secret, hooks: a.hooks } }));

reg("swapcard_update_webhook", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateWebhook($input: UpdateWebhookInput!) {
      updateWebhook(input: $input) { webhook { id endpoint } }
    }
  `, { input: { webhookId: a.webhookId, endpoint: a.endpoint, hooks: a.hooks, enabled: a.enabled, name: a.name } }));

reg("swapcard_delete_webhook", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteWebhook($input: DeleteWebhookInput!) {
      deleteWebhook(input: $input) { webhook { id } }
    }
  `, { input: { webhookId: a.webhookId } }));

// Push Notifications
reg("swapcard_create_push_notification", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreatePushNotification($input: CreatePushNotificationInput!) {
      createPushNotification(input: $input) { pushNotification { id } }
    }
  `, { input: { communityId: a.communityId, withEvent: a.withEvent } }));

// Codes
reg("swapcard_create_code", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation CreateCode($input: CreateCodeInput!) {
      createCode(input: $input) { code { id code description quantity redeemed } }
    }
  `, { input: { eventId: a.eventId, description: a.description, availableFrom: a.availableFrom, availableUntil: a.availableUntil, code: a.code, type: a.type, revealHiddenTickets: a.revealHiddenTickets, exhibitorId: a.exhibitorId, quantity: a.quantity, rule: a.rule, discount: a.discount } }));

reg("swapcard_update_code", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateCode($input: UpdateCodeInput!) {
      updateCode(input: $input) { code { id code description } }
    }
  `, { input: { codeId: a.codeId, code: a.code, type: a.type, revealHiddenTickets: a.revealHiddenTickets, description: a.description, availableFrom: a.availableFrom, availableUntil: a.availableUntil, quantity: a.quantity, rule: a.rule, discount: a.discount } }));

reg("swapcard_delete_codes", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation DeleteCodes($input: DeleteCodesInput!) {
      deleteCodes(input: $input) { deletedCodeIds }
    }
  `, { input: a.input }));

reg("swapcard_access_codes_scan", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation AccessCodesScan($input: ScanCodesInput!) {
      accessCodesScan(input: $input) { scans }
    }
  `, { input: { immediate: a.immediate, deviceName: a.deviceName } }));

// User Terms
reg("swapcard_update_user_term", async (a) =>
  gql(CONTENT_URL, tok("SWAPCARD_CONTENT_TOKEN"), `
    mutation UpdateUserTerm($input: UpdateUserTermInput!) {
      updateUserTerm(input: $input) { userTerm { id } }
    }
  `, { input: { userTermId: a.userTermId, label: a.label, description: a.description, translations: a.translations, eventId: a.eventId, isRequired: a.isRequired, promptLocations: a.promptLocations } }));

// Leads API
reg("swapcard_get_my_exhibitors", async (a) =>
  gql(LEADS_URL, tok("SWAPCARD_LEADS_TOKEN"), `
    query GetMyExhibitors($cursor: CursorPaginationInput) {
      myExhibitors(cursor: $cursor) { pageInfo { endCursor hasNextPage } nodes { id name events { nodes { id title } } } }
    }
  `, { cursor: a.first ? { first: a.first, ...(a.after ? { after: a.after } : {}) } : undefined }));

reg("swapcard_get_my_leads", async (a) =>
  gql(LEADS_URL, tok("SWAPCARD_LEADS_TOKEN"), `
    query GetLeads($eventId: ID!, $exhibitorId: ID!) {
      leads(eventId: $eventId, exhibitorId: $exhibitorId) {
        contacts { pageInfo { endCursor hasNextPage } nodes { id connectedAt isScanned rating note connectedAtEvent { id title } owner { id email firstName lastName jobTitle organization } target { ... on EventPerson { id firstName lastName email jobTitle organization photoUrl } } customFields { ... on SelectField { id value definition { id name } } ... on TextField { id value definition { id name } } } } }
      }
    }
  `, { eventId: a.eventId, exhibitorId: a.exhibitorId }));

reg("swapcard_scan_badges", async (a) =>
  gql(LEADS_URL, tok("SWAPCARD_LEADS_TOKEN"), `
    mutation ScanBadges($input: ScanBadgesInput!) {
      scanBadges(input: $input) { badges { errorCode connection { id rating note target { ... on EventPerson { firstName lastName jobTitle email organization } } } } }
    }
  `, { input: { eventId: a.eventId, exhibitorId: a.exhibitorId, badges: a.badges } }));

// Analytics
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
