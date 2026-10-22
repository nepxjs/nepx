// userAgent(request | headers | string): a small, dependency-free parser (browser, engine, os, device, cpu, isBot).
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python-requests|go-http-client|node-fetch|axios\/|httpclient/i;

const BROWSERS = [ // order matters: most specific first (Chrome UAs also say Safari, Edge also says Chrome ...)
  ["Edge", /\b(?:Edg|EdgA|EdgiOS|Edge)\/([\d.]+)/], ["Opera", /\b(?:OPR|Opera)\/([\d.]+)/], ["Samsung Internet", /\bSamsungBrowser\/([\d.]+)/],
  ["Firefox", /\b(?:Firefox|FxiOS)\/([\d.]+)/], ["Chrome", /\b(?:Chrome|CriOS)\/([\d.]+)/], ["IE", /\b(?:MSIE |rv:)([\d.]+)\)?.*(?:Trident|MSIE)|Trident\/.*rv:([\d.]+)/],
  ["Safari", /\bVersion\/([\d.]+).*Safari\//],
];
const OSES = [
  ["iOS", /\b(?:iPhone|CPU) OS ([\d_]+)/, true], ["iPadOS", /\biPad.*OS ([\d_]+)/, true], ["Android", /\bAndroid[ /]([\d.]+)/], ["Windows", /\bWindows NT ([\d.]+)/],
  ["macOS", /\bMac OS X ([\d_.]+)/, true], ["Chrome OS", /\bCrOS \S+ ([\d.]+)/], ["Linux", /\bLinux\b()/],
];

const major = (v) => (v ? v.split(".")[0] : undefined);
const clean = (v, underscores) => (v ? (underscores ? v.replace(/_/g, ".") : v) : undefined);

export function userAgent(input) {
  let ua = "";
  if (typeof input === "string") ua = input;
  else if (input && typeof input.get === "function") ua = input.get("user-agent") ?? "";
  else if (input && input.headers && typeof input.headers.get === "function") ua = input.headers.get("user-agent") ?? "";
  else if (input && input.headers && typeof input.headers === "object") ua = String(input.headers["user-agent"] ?? "");

  const out = { ua, isBot: BOT.test(ua), browser: {}, engine: {}, os: {}, device: {}, cpu: {} };
  for (const [name, re] of BROWSERS) {
    const m = re.exec(ua);
    if (m) { const version = m[1] ?? m[2]; out.browser = { name, version, major: major(version) }; break; }
  }
  if (/\bEdg|\bChrome\/|\bCriOS|\bOPR\/|\bSamsungBrowser/.test(ua) && /AppleWebKit/.test(ua)) { const v = /Chrome\/([\d.]+)/.exec(ua)?.[1]; out.engine = { name: /\bEdg\b|\bEdg\//.test(ua) || /Chrome\//.test(ua) ? "Blink" : "WebKit", version: v }; }
  else if (/Gecko\/\d/.test(ua) && /Firefox|FxiOS/.test(ua)) out.engine = { name: "Gecko", version: /rv:([\d.]+)/.exec(ua)?.[1] };
  else if (/AppleWebKit\/([\d.]+)/.test(ua)) out.engine = { name: "WebKit", version: /AppleWebKit\/([\d.]+)/.exec(ua)[1] };
  else if (/Trident\//.test(ua)) out.engine = { name: "Trident", version: /Trident\/([\d.]+)/.exec(ua)[1] };
  for (const [name, re, us] of OSES) {
    if (name === "iOS" && /iPad/.test(ua)) continue;
    const m = re.exec(ua);
    if (m) { out.os = { name, version: clean(m[1], us) || undefined }; break; }
  }
  if (/iPad|Tablet|Android(?!.*Mobile)/.test(ua)) out.device = { type: "tablet", vendor: /iPad/.test(ua) ? "Apple" : undefined, model: /iPad/.test(ua) ? "iPad" : undefined };
  else if (/Mobi|iPhone|Android.*Mobile/.test(ua)) out.device = { type: "mobile", vendor: /iPhone/.test(ua) ? "Apple" : undefined, model: /iPhone/.test(ua) ? "iPhone" : undefined };
  if (/\b(?:x86_64|x64|Win64|amd64|WOW64)\b/i.test(ua)) out.cpu = { architecture: "amd64" };
  else if (/\b(?:aarch64|arm64|armv8)\b/i.test(ua)) out.cpu = { architecture: "arm64" };
  else if (/\barm/i.test(ua)) out.cpu = { architecture: "arm" };
  return out;
}

/** next/server's userAgentFromString(ua): same parser, string input only. */
export const userAgentFromString = (ua) => userAgent(String(ua ?? ""));
