/**
 * What a browser session may block (plan 08 Task 3). The single source of the CDP
 * blocklist: browser-policy.ts turns these into URLPattern strings for
 * Network.setBlockedURLs. Sources: evidence/findings-notes.md "safe-block" lines.
 *
 * Never listed, on purpose:
 * - stylesheets of any kind (betcris and pzbuk return 0 matches without CSS, findings line 76),
 *   so no extension list holds css and fonts.googleapis.com (serves stylesheets) is not a tracker;
 * - www.recaptcha.net, www.google.com, www.gstatic.com (captcha);
 * - cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, code.jquery.com (carry app code);
 * - *.cloudfront.net (opaque CDNs, incl. bookmaker assets);
 * - openfpcdn.io, fpjs.dev (blocking fingerprinting may raise bot scores);
 * - js.pusher.com, *.firebasedatabase.app (may carry live data);
 * - bookmaker infrastructure (begmedia.com, efortuna.pl, feg.eu);
 * - the STS ad-sync hosts of profiling/block-hosts-sts.txt (unverified: that run also blocked
 *   CSS and lost 7.8 % of markets).
 */

/** Blocked by URL pathname extension. Never css. */
export const BLOCKED_EXTENSIONS: { readonly image: readonly string[]; readonly font: readonly string[]; readonly media: readonly string[] } =
  Object.freeze({
    // findings lines 26, 76: images are safe to drop on every measured site (pzbuk aside, which stays "none")
    image: Object.freeze(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico"]),
    // findings line 139 (route what-if: image/font/media only kept every STS market)
    font: Object.freeze(["woff", "woff2", "ttf", "otf", "eot"]),
    media: Object.freeze(["mp4", "webm", "mp3", "m3u8", "ogg"]),
  });

/** Third-party hosts; each pattern covers the host and its subdomains. */
export const TRACKER_HOSTS: readonly string[] = Object.freeze([
  // analytics and tags (findings lines 14, 26, 73, 84)
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "doubleclick.net",
  "googlesyndication.com",
  "cloudflareinsights.com",
  "clarity.ms",
  "plausible.io",
  "exponea.com",
  "emarsys.net",
  "tagcommander.com",
  "sentry.io",
  "sentry-cdn.com",
  "growthbook.io",
  "smart.idmnet.pl",
  "pollster.pl",
  "capi-automation.s3.us-east-2.amazonaws.com",
  "server-side-tagging-kp74km7qlq-uc.a.run.app",
  // ads and social (findings lines 26, 73, 84)
  "connect.facebook.net",
  "facebook.com",
  "adform.net",
  "snapchat.com",
  "sc-static.net",
  "bat.bing.com",
  "bat.bing.net",
  "c.bing.com",
  "prdredir.com",
  "iconvert.network",
  "pushpushgo.com",
  // consent (findings lines 26, 73, 83, 84)
  "cookiebot.com",
  "usercentrics.eu",
  "onetrust.com",
  "cookie-script.com",
  "trustcommander.net",
  // chat and widgets (findings lines 14, 26, 84)
  "livechatinc.com",
  "zdassets.com",
  "zendesk.com",
  "ladesk.com",
  "ada.support",
  "userway.org",
  "statscore.com",
  "widgets.sir.sportradar.com",
  "static.app.delivery",
  "seal.certcga.com",
  // push (findings line 14)
  "firebaseinstallations.googleapis.com",
  "fcmregistrations.googleapis.com",
]);

/** Bookmaker and data hosts no tracker pattern may cover (findings lines 73, 84). */
export const NEVER_BLOCK_HOSTS: readonly string[] = Object.freeze([
  "betcris.pl",
  "betsport.pl",
  "trexname.com",
  "springbuilder.site",
  "bcapps.net",
  "d3j4vz29nirhst.cloudfront.net",
  "begmedia.com",
  "efortuna.pl",
  "feg.eu",
]);
