/* Worker entry point: dispatch to the per-domain route handlers in
 * src/routes/, in the original evaluation order (the path spaces are
 * disjoint, so grouping by domain changes nothing), then the
 * fallthroughs (API 404, sitemap/robots, page aliases, assets). */
import { json } from "./lib/core.js";
import { handleAdmin } from "./routes/admin.js";
import { handleAuth } from "./routes/auth.js";
import { handlePackages } from "./routes/packages.js";
import { handlePublic } from "./routes/public.js";
import { handleBookings } from "./routes/bookings.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const defer = (p) => { if (ctx && ctx.waitUntil) ctx.waitUntil(p); else return p; };
    const c = { request, env, ctx, url, path, defer };

    for (const h of [handleAdmin, handleAuth, handlePackages, handlePublic, handleBookings]) {
      const res = await h(c);
      if (res) return res;
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);

    // SEO: sitemap.xml + robots.txt are served by the worker so they
    // always match the canonical origin. (There is no static
    // robots.txt asset; without this route Cloudflare answered the
    // path with a content-signals boilerplate carrying no crawl
    // rules at all.)
    if (path === "/sitemap.xml") {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url>",
        "    <loc>https://yumi.ki-toko.com/</loc>",
        "    <changefreq>weekly</changefreq>",
        "    <priority>1.0</priority>",
        "  </url>",
        "</urlset>",
        "",
      ].join("\n");
      return new Response(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=3600" },
      });
    }
    if (path === "/robots.txt") {
      const txt = [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin",
        "Disallow: /api/",
        "",
        "Sitemap: https://yumi.ki-toko.com/sitemap.xml",
        "",
      ].join("\n");
      return new Response(txt, {
        headers: { "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600" },
      });
    }

    // The admin page lives at /admin (the asset itself stays admin.html).
    if (path === "/admin" || path === "/admin/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/admin.html";
      assetUrl.search = "";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    // The student account page lives at /account (asset: account.html).
    if (path === "/account" || path === "/account/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/account.html";
      assetUrl.search = "";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    return env.ASSETS.fetch(request);
  },
};
