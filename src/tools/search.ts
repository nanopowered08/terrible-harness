export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

function decodeHtmlEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function cleanSearchQuery(q: string): string {
  let cleaned = q.trim();
  // Strip conversational prefixes and instructions
  cleaned = cleaned.replace(/^(can\s+you\s+)?(please\s+)?(search\s+(the\s+web\s+for|google\s+for|for)?|look\s+up|find(\s+out)?)\s+/i, "");
  cleaned = cleaned.replace(/\s*(search\s+the\s+web\s+first|and\s+cite\s+sources|cite\s+your\s+sources|tell\s+me\s+what\s+you\s+found).*/i, "");
  cleaned = cleaned.replace(/[?.,!]+$/, "").trim();
  return cleaned || q;
}

export async function searchWeb(rawQuery: string, maxResults: number = 5): Promise<SearchResult[]> {
  const query = cleanSearchQuery(rawQuery);
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
    }

    const html = await res.text();
    const results: SearchResult[] = [];

    const resultBlocks = html.split('<div class="result results_links results_links_deep');

    for (const block of resultBlocks.slice(1)) {
      if (results.length >= maxResults) break;

      // Extract title
      const titleMatch = block.match(/<a[^>]+class="result__snippet[^>]*>([\s\S]*?)<\/a>/) ||
                         block.match(/<a[^>]+class="result__url[^>]*>([\s\S]*?)<\/a>/);
      const title = block.match(/<a[^>]+class="result__a[^>]*>([\s\S]*?)<\/a>/);
      const rawTitle = title ? title[1].replace(/<[^>]+>/g, "").trim() : "Result";
      const cleanTitle = decodeHtmlEntities(rawTitle);

      // Extract url
      const urlMatch = block.match(/<a[^>]+class="result__url"[^>]+href="([^"]+)"/) ||
                       block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/);
      let link = urlMatch ? urlMatch[1] : "";
      if (link.startsWith("//")) {
        link = "https:" + link;
      } else if (link.includes("uddg=")) {
        const rawTarget = link.split("uddg=")[1].split("&")[0];
        try {
          link = decodeURIComponent(rawTarget);
        } catch {
          link = rawTarget;
        }
      }

      // Extract snippet
      const snippetMatch = block.match(/<a[^>]+class="result__snippet[^>]*>([\s\S]*?)<\/a>/);
      const rawSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";
      const cleanSnippet = decodeHtmlEntities(rawSnippet);

      if (cleanTitle && (link || cleanSnippet)) {
        results.push({
          title: cleanTitle,
          snippet: cleanSnippet,
          url: link
        });
      }
    }

    if (results.length === 0) {
      // Fallback: try DuckDuckGo instant answer JSON
      const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const apiRes = await fetch(apiUrl);
      if (apiRes.ok) {
        const data = await apiRes.json() as any;
        if (data.AbstractText) {
          results.push({
            title: decodeHtmlEntities(data.Heading || query),
            snippet: decodeHtmlEntities(data.AbstractText),
            url: data.AbstractURL || ""
          });
        }
        if (Array.isArray(data.RelatedTopics)) {
          for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
            if (topic.Text && topic.FirstURL) {
              results.push({
                title: decodeHtmlEntities(topic.Text.slice(0, 50)),
                snippet: decodeHtmlEntities(topic.Text),
                url: topic.FirstURL
              });
            }
          }
        }
      }
    }

    return results;
  } catch (err: any) {
    return [
      {
        title: "Search Error",
        snippet: `Failed to fetch search results: ${err.message}`,
        url: ""
      }
    ];
  }
}
