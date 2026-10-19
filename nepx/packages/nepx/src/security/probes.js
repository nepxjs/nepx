// Scanners look for the same few hundred paths. Unmatched requests for them are answered with a cheap plain 404
// (no page render, no React) and reported as a "probe" event, so they show up in logs / ban lists.

const DEFAULT_PATHS = [
  /^\/(wp-(admin|login|content|includes|json)|wordpress|xmlrpc\.php|phpmyadmin|pma|myadmin|cgi-bin|vendor\/phpunit|server-status|actuator|boaform|HNAP1|solr|jenkins)(\/|$)/i,
  /^\/\.(git|svn|hg|env|aws|ssh|docker|npmrc|htaccess|htpasswd|DS_Store)(\/|$|\.)/i,
  /\.(php\d?|asp|aspx|jsp|cgi|bak|old|sql|swp|ini|log)$/i,
];

export function compileProbes(option) {
  if (option === false) return null;
  const extra = option && typeof option === "object" ? option.paths ?? [] : [];
  const list = [...DEFAULT_PATHS, ...extra.map((p) => (p instanceof RegExp ? p : new RegExp(p)))];
  return (pathname) => { let p = pathname; try { p = decodeURIComponent(pathname); } catch { /* keep raw */ } return list.some((r) => r.test(p)); };
}
