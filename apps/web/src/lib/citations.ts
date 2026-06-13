import type { Insights } from "./schemas";

export interface SearchSource {
  url: string;
  title?: string;
}

/** Collect every URL returned by web_search tool calls and provider source parts. */
export function collectWebSearchUrls(
  toolResults: ReadonlyArray<{ toolName: string; output: unknown }>,
  sources: ReadonlyArray<Record<string, unknown>>,
): SearchSource[] {
  const byUrl = new Map<string, SearchSource>();

  for (const tr of toolResults) {
    if (tr.toolName !== "web_search") continue;
    const payload = tr.output as
      | { sources?: Array<{ url?: string; title?: string; snippet?: string }> }
      | undefined;
    for (const s of payload?.sources ?? []) {
      if (s.url) byUrl.set(s.url, { url: s.url, title: s.title });
    }
  }

  for (const source of sources) {
    if (typeof source.url === "string") {
      const title = typeof source.title === "string" ? source.title : undefined;
      byUrl.set(source.url, { url: source.url, title });
    }
  }

  return [...byUrl.values()];
}

async function isUrlReachable(url: string): Promise<boolean> {
  const headers = { "User-Agent": "Concord/1.0 (health-reconciliation-demo)" };

  // FDA label PDFs often reject HEAD — probe with a tiny ranged GET first.
  if (url.includes(".pdf") || url.includes("accessdata.fda.gov") || url.includes("spl-doc")) {
    try {
      const pdfRes = await fetch(url, {
        method: "GET",
        headers: { ...headers, Range: "bytes=0-1023" },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      if (pdfRes.ok || pdfRes.status === 206) return true;
    } catch {
      // fall through to HEAD
    }
  }

  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers,
    });
    if (res.ok) return true;
    if (res.status === 405 || res.status === 403 || res.status === 401) {
      const getRes = await fetch(url, {
        method: "GET",
        headers: { ...headers, Range: "bytes=0-512" },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      return getRes.ok || getRes.status === 206;
    }
    return false;
  } catch {
    return false;
  }
}

/** Drop dead links — models and even search indexes surface stale FDA URLs. */
export async function filterReachableSources(sources: SearchSource[]): Promise<SearchSource[]> {
  const checks = await Promise.all(
    sources.map(async (s) => ((await isUrlReachable(s.url)) ? s : null)),
  );
  return checks.filter((s): s is SearchSource => s !== null);
}

function pickBestCitation(
  sources: SearchSource[],
  insight: Insights["insights"][number],
): { citationUrl: string; citationLabel: string } | null {
  if (sources.length === 0) return null;

  const titleHaystack = insight.title.toLowerCase();
  const factsHaystack = insight.relatedFacts.join(" ").toLowerCase();

  if (insight.kind === "interaction") {
    const simvastatinLabel = sources.find(
      (s) =>
        s.url.includes("accessdata.fda.gov") &&
        (s.url.includes("019766") || s.url.toLowerCase().includes("simvastatin") || s.url.includes("zocor")),
    );
    if (simvastatinLabel) {
      return {
        citationUrl: simvastatinLabel.url,
        citationLabel: simvastatinLabel.title?.trim() || "FDA simvastatin prescribing information",
      };
    }

    const labelPdf = sources.find(
      (s) =>
        s.url.includes("accessdata.fda.gov") &&
        (s.url.includes("/label/") || s.url.includes("lbl.pdf") || s.url.includes("spl-doc")),
    );
    if (labelPdf) {
      return {
        citationUrl: labelPdf.url,
        citationLabel: labelPdf.title?.trim() || "FDA prescribing information",
      };
    }

    const fdaTable = sources.find(
      (s) =>
        s.url.includes("fda.gov") &&
        s.url.includes("drug-interactions") &&
        s.url.includes("substrates"),
    );
    if (fdaTable) {
      return {
        citationUrl: fdaTable.url,
        citationLabel: fdaTable.title?.trim() || "FDA CYP450 interaction reference",
      };
    }
  }

  if (insight.kind === "care_gap") {
    if (titleHaystack.includes("colorectal") || titleHaystack.includes("crc")) {
      const uspstf = sources.find(
        (s) => s.url.includes("uspreventiveservicestaskforce.org") || s.url.includes("cdc.gov"),
      );
      if (uspstf) {
        return {
          citationUrl: uspstf.url,
          citationLabel: uspstf.title?.trim() || "USPSTF screening guidance",
        };
      }
    }
    if (titleHaystack.includes("ldl") || titleHaystack.includes("statin") || factsHaystack.includes("simvastatin")) {
      const ldl = sources.find((s) => s.url.includes("fda.gov") || s.url.includes("accessdata.fda.gov"));
      if (ldl) {
        return {
          citationUrl: ldl.url,
          citationLabel: ldl.title?.trim() || "Clinical reference",
        };
      }
    }
  }

  if (insight.kind === "lab_trend" && (titleHaystack.includes("ldl") || titleHaystack.includes("statin"))) {
    const ldl = sources.find((s) => s.url.includes("fda.gov") || s.url.includes("accessdata.fda.gov"));
    if (ldl) {
      return {
        citationUrl: ldl.url,
        citationLabel: ldl.title?.trim() || "Clinical reference",
      };
    }
  }

  const fda = sources.find((s) => s.url.includes("fda.gov") || s.url.includes("accessdata.fda.gov"));
  if (fda && (insight.kind === "interaction" || insight.kind === "care_gap")) {
    return {
      citationUrl: fda.url,
      citationLabel: fda.title?.trim() || "FDA reference",
    };
  }

  return null;
}

const CITATION_KINDS = new Set<Insights["insights"][number]["kind"]>([
  "interaction",
  "care_gap",
  "lab_trend",
]);

/**
 * Attach citations only from verified web_search results that actually resolve.
 * Never trust model-invented URLs.
 */
export async function applyVerifiedCitations(
  insights: Insights,
  searchSources: SearchSource[],
): Promise<{ insights: Insights; webSources: SearchSource[] }> {
  const reachable = await filterReachableSources(searchSources);
  const reachableUrls = new Set(reachable.map((s) => s.url));

  const enriched = insights.insights.map((insight) => {
    if (insight.citationUrl && reachableUrls.has(insight.citationUrl)) {
      return insight;
    }

    if (CITATION_KINDS.has(insight.kind)) {
      const picked = pickBestCitation(reachable, insight);
      if (picked) return { ...insight, ...picked };
    }

    return { ...insight, citationUrl: null, citationLabel: null };
  });

  return {
    insights: { insights: enriched },
    webSources: reachable,
  };
}
