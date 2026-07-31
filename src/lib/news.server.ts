// Server-only. Collects live financial headlines from public RSS feeds.
// No API key required; every source is a public feed.

import type { NewsItem } from "./services/macro.types";

interface Feed {
  url: string;
  source: string;
  category: NewsItem["category"];
}

const FEEDS: Feed[] = [
  { url: "https://www.federalreserve.gov/feeds/press_all.xml", source: "Federal Reserve", category: "central-bank" },
  { url: "https://news.google.com/rss/search?q=(FOMC+OR+%22Federal+Reserve%22+OR+ECB+OR+%22Bank+of+England%22+OR+%22Bank+of+Japan%22)+when:2d&hl=en-US&gl=US&ceid=US:en", source: "Google News", category: "central-bank" },
  { url: "https://news.google.com/rss/search?q=(CPI+OR+inflation+OR+%22non-farm+payrolls%22+OR+GDP+OR+PMI+OR+%22retail+sales%22)+when:2d&hl=en-US&gl=US&ceid=US:en", source: "Google News", category: "economic-data" },
  { url: "https://news.google.com/rss/search?q=(gold+price+OR+XAUUSD+OR+%22dollar+index%22+OR+%22treasury+yields%22+OR+VIX)+when:1d&hl=en-US&gl=US&ceid=US:en", source: "Google News", category: "market" },
  { url: "https://news.google.com/rss/search?q=(war+OR+conflict+OR+sanctions+OR+%22trade+war%22+OR+geopolitical)+when:1d&hl=en-US&gl=US&ceid=US:en", source: "Google News", category: "geopolitical" },
];

const strip = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();

function parseRss(xml: string, feed: Feed, limit: number): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks.slice(0, limit)) {
    const title = strip(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    if (!title) continue;
    const link = strip(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    const pub = strip(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
    const src = strip(block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "") || feed.source;
    const when = pub ? new Date(pub) : new Date();
    items.push({
      id: `${feed.category}:${title.slice(0, 80)}`,
      title,
      source: src,
      url: link,
      published_at: Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString(),
      category: feed.category,
    });
  }
  return items;
}

/** Fetch the latest headlines across all feeds (best-effort, never throws). */
export async function fetchHeadlines(perFeed = 8): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "GoldMindAI/1.0 (+news-intelligence)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${feed.source} ${res.status}`);
      return parseRss(await res.text(), feed, perFeed);
    }),
  );

  const seen = new Set<string>();
  const all: NewsItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const key = item.title.toLowerCase().slice(0, 70);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(item);
    }
  }
  return all.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
}
