export interface WebpageContent {
  url: string;
  title: string;
  content: string;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    );
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function openWebpage(
  rawUrl: string,
  maxCharacters: number = 12000
): Promise<WebpageContent> {
  const input = rawUrl.trim();

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(input);
  } catch {
    throw new Error("Invalid URL. Provide a complete HTTP(S) URL.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("URLs containing credentials are not allowed.");
  }

  // Avoid obvious local-network and local-machine targets.
  const hostname = parsedUrl.hostname.toLowerCase();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(parsedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AskGPT/1.0 (+https://github.com/nanopowered08/terrible-harness)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const finalUrl = new URL(response.url);

    if (
      finalUrl.protocol !== "http:" &&
      finalUrl.protocol !== "https:"
    ) {
      throw new Error("Redirected to an unsupported URL scheme.");
    }

    const contentType = response.headers.get("content-type") || "";

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const contentLength = Number(
      response.headers.get("content-length") || 0
    );

    if (contentLength > 2_000_000) {
      throw new Error("Webpage is too large (over 2 MB).");
    }

    const html = await response.text();

    if (html.length > 2_000_000) {
      throw new Error("Webpage is too large (over 2 MB).");
    }

    const titleMatch = html.match(
      /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i
    );

    const title = titleMatch
      ? stripHtml(titleMatch[1]).slice(0, 300)
      : finalUrl.hostname;

    const content = (
      contentType.includes("text/plain")
        ? decodeHtmlEntities(html)
        : stripHtml(html)
    ).slice(0, Math.max(1, Math.min(maxCharacters, 20000)));

    return {
      url: finalUrl.href,
      title,
      content
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);

    throw new Error(`Failed to open webpage: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

