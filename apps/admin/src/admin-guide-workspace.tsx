import { useQuery } from "@tanstack/react-query";
import { BookOpen, ExternalLink, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { Button, ErrorState, LoadingState, PageHeader, StatusBadge } from "@skima/ui";
import { useSessionState } from "./session";
import "./admin-guide-workspace.css";

const AdminGuideSchema = z.object({
  available: z.boolean().default(false),
  key: z.string().default("guide.admin.operations"),
  title: z.string().default("SKIMA Administration — Operational Handbook"),
  versionLabel: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  sourceDocumentId: z.string().nullable().optional(),
  sourceRevision: z.string().nullable().optional(),
  contentFormat: z.string().nullable().optional(),
  content: z.string().default(""),
  contentHash: z.string().nullable().optional(),
  lastSyncedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
}).passthrough();

type GuideSection = {
  readonly id: string;
  readonly title: string;
  readonly level: number;
  readonly blocks: readonly GuideBlock[];
};

type GuideBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "bullet"; readonly text: string }
  | { readonly kind: "subheading"; readonly text: string };

export function AdminGuideWorkspace() {
  const { api, status } = useSessionState();
  const [search, setSearch] = useState("");
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const guide = useQuery({
    queryKey: ["admin-operational-guide"],
    enabled: status === "authenticated",
    queryFn: () => api.get("/admin/guide", AdminGuideSchema),
    retry: false,
  });

  const sections = useMemo(() => parseGuide(guide.data?.content ?? ""), [guide.data?.content]);
  const normalizedQuery = search.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return sections;
    return sections.filter((section) =>
      section.title.toLowerCase().includes(normalizedQuery) ||
      section.blocks.some((block) => block.text.toLowerCase().includes(normalizedQuery))
    );
  }, [sections, normalizedQuery]);

  const resolvedActiveId =
    activeSectionId && filteredSections.some((section) => section.id === activeSectionId)
      ? activeSectionId
      : filteredSections[0]?.id ?? null;
  const activeSection = filteredSections.find((section) => section.id === resolvedActiveId) ?? null;

  if (guide.isLoading) return <LoadingState label="Loading SKIMA administration guide" />;

  if (guide.error) {
    return (
      <ErrorState
        title="Administration guide unavailable"
        message={readError(guide.error)}
        onRetry={() => void guide.refetch()}
      />
    );
  }

  if (!guide.data?.available) {
    return (
      <ErrorState
        title="Administration guide is not published"
        message="The synchronized SKIMA administration handbook is not available yet."
        onRetry={() => void guide.refetch()}
      />
    );
  }

  return (
    <div className="admin-guide">
      <PageHeader
        eyebrow="Platform · Operations handbook"
        title={guide.data.title}
        description="A synchronized operating handbook for authorised SKIMA administrators. The Google Drive source is mirrored into SKIMA so this screen and Ask SKIMA use the same approved guidance."
        actions={
          guide.data.sourceUrl ? (
            <Button
              icon={ExternalLink}
              variant="outline"
              onClick={() => window.open(guide.data?.sourceUrl ?? "", "_blank", "noopener,noreferrer")}
            >
              Open Drive source
            </Button>
          ) : undefined
        }
      />

      <section className="admin-guide__hero">
        <div className="admin-guide__hero-icon"><BookOpen aria-hidden="true" /></div>
        <div className="admin-guide__hero-copy">
          <span>SKIMA OPERATIONS KNOWLEDGE</span>
          <strong>Guide operators without hardcoded frontend instructions</strong>
          <p>
            This handbook explains day-to-day administration, money boundaries, partner operations,
            internal fulfilment readiness, safety, maps, integrations, AI and troubleshooting.
          </p>
        </div>
        <div className="admin-guide__hero-meta">
          <StatusBadge tone="success">Synced</StatusBadge>
          <small>Version {guide.data.versionLabel ?? "current"}</small>
          <small>{formatTimestamp(guide.data.lastSyncedAt ?? guide.data.updatedAt)}</small>
        </div>
      </section>

      <section className="admin-guide__assurance">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Operational guidance, not hidden authority</strong>
          <p>
            Live SKIMA records, permissions, financial states, provider confirmations and governed
            workflows remain authoritative. The guide helps an operator understand what to inspect
            and which supported action to use.
          </p>
        </div>
      </section>

      <div className="admin-guide__search">
        <Search aria-hidden="true" />
        <input
          aria-label="Search administration guide"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search orders, withdrawals, station stock, maps, access, AI…"
        />
        {search ? (
          <button type="button" onClick={() => setSearch("")}>Clear</button>
        ) : null}
      </div>

      {filteredSections.length ? (
        <div className="admin-guide__layout">
          <nav className="admin-guide__contents" aria-label="Administration handbook chapters">
            <div className="admin-guide__contents-head">
              <strong>Guide sections</strong>
              <span>{filteredSections.length}</span>
            </div>
            {filteredSections.map((section, index) => {
              const selected = section.id === resolvedActiveId;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={selected ? "is-active" : undefined}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{section.title}</strong>
                    <small>{estimateMinutes(section)} min</small>
                  </div>
                </button>
              );
            })}
          </nav>

          {activeSection ? (
            <article className="admin-guide__reader">
              <header>
                <span>OPERATING SECTION</span>
                <h2>{activeSection.title}</h2>
                <p>{estimateMinutes(activeSection)} min read · Synced from the approved Drive handbook</p>
              </header>
              <div className="admin-guide__reader-body">
                {activeSection.blocks.map((block, index) => {
                  if (block.kind === "subheading") {
                    return <h3 key={index}>{block.text}</h3>;
                  }
                  if (block.kind === "bullet") {
                    return <div className="admin-guide__bullet" key={index}><i /> <p>{block.text}</p></div>;
                  }
                  return <p key={index}>{block.text}</p>;
                })}
              </div>
            </article>
          ) : null}
        </div>
      ) : (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <h2>No matching guide section</h2>
              <p className="skima-muted">Try a different word or clear the search.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function parseGuide(content: string): GuideSection[] {
  const sections: Array<{ id: string; title: string; level: number; blocks: GuideBlock[] }> = [];
  let current: { id: string; title: string; level: number; blocks: GuideBlock[] } | null = null;

  const push = () => {
    if (current && (current.blocks.length || current.title)) sections.push(current);
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      push();
      const title = strip(h2[1]);
      current = { id: slug(title, sections.length), title, level: 2, blocks: [] };
      continue;
    }

    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      if (!current) {
        const title = strip(h3[1]);
        current = { id: slug(title, sections.length), title, level: 3, blocks: [] };
      } else {
        current.blocks.push({ kind: "subheading", text: strip(h3[1]) });
      }
      continue;
    }

    if (/^#\s+/.test(line)) continue;
    if (!current) current = { id: "overview", title: "Overview", level: 2, blocks: [] };

    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    if (bullet) {
      current.blocks.push({ kind: "bullet", text: strip(bullet[1]) });
    } else {
      current.blocks.push({ kind: "paragraph", text: strip(line) });
    }
  }

  push();
  return sections;
}

function strip(value: string) {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function slug(title: string, index: number) {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized ? normalized + "-" + index : "section-" + index;
}

function estimateMinutes(section: GuideSection) {
  const words = section.blocks.reduce(
    (count, block) => count + block.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  return Math.max(1, Math.ceil(words / 210));
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Current synchronized copy";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Current synchronized copy";
  return "Synced " + new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "SKIMA could not load the synchronized administration handbook.";
}
