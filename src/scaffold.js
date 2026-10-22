import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NepxError } from "./errors/index.js";

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(readFileSync(path.join(PKG_DIR, "package.json"), "utf8"));
// Installed from npm (inside node_modules): depend on the published version. Running from a source checkout: link the checkout.
const SELF_DEP = PKG_DIR.split(path.sep).includes("node_modules") || process.env.NEPX_NPM_SPEC ? (process.env.NEPX_NPM_SPEC || `^${PKG.version}`) : `file:${PKG_DIR.split(path.sep).join("/")}`;

export function validateName(name) {
  if (!name) throw new NepxError("Project name is required: nepx create <name>");
  if (name.length > 214 || !/^[a-z0-9][a-z0-9-_]*$/.test(name)) {
    throw new NepxError(`Invalid project name "${name}". Use lowercase letters, digits, "-" or "_", starting with a letter or digit.`);
  }
}

const API_FILES = {
  "app/api/hello/route.js": `export async function GET() {
  return Response.json({ message: "Hello from Nepx!" });
}
`,
  "app/api/users/route.js": `export async function GET(request, { url }) {
  const search = url.searchParams.get("search");
  return Response.json({ users: [], search });
}

export async function POST(request) {
  const data = await request.json();
  return Response.json({ message: "Data received", data }, { status: 201 });
}
`,
  "app/api/users/[id]/route.js": `export async function GET(request, { params }) {
  return Response.json({ id: params.id });
}
`,
};

const UI_FILES = {
  "app/layout.jsx": `import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata = {
  title: "Nepx App",
  description: "Built with Nepx.js",
};

export default function RootLayout({ children }) {
  return (
    <div className="container">
      <Navbar />
      {children}
    </div>
  );
}
`,
  "app/page.jsx": `"use client";
import { useState } from "react";

export default function Home() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>Welcome to {process.env.NEPX_PUBLIC_APP_NAME}</h1>
      <p>Edit app/page.jsx and refresh.</p>
      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
    </main>
  );
}
`,
  "app/about/page.jsx": `export const metadata = { title: "About | Nepx App" };

export default function About() {
  return <main><h1>About</h1></main>;
}
`,
  "app/users/[id]/page.jsx": `import { redirect } from "nepx";

export async function getServerSideProps({ params }) {
  if (!/^\\d+$/.test(params.id)) return { notFound: true };
  return { props: { user: { id: params.id, name: "User " + params.id } } };
}

export default function UserPage({ user }) {
  return <main><h1>{user.name}</h1><p>ID: {user.id}</p></main>;
}
`,
  "app/users/[id]/loading.jsx": `export default function Loading() {
  return <main><p>Loading user...</p></main>;
}
`,
  "app/error.jsx": `export default function ErrorPage({ error }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>{error.message}</p>
    </main>
  );
}
`,
  "app/not-found.jsx": `export default function NotFound() {
  return <main><h1>404 - Page not found</h1></main>;
}
`,
  "app/globals.css": `body { font-family: system-ui, sans-serif; margin: 0; }
.container { max-width: 48rem; margin: 0 auto; padding: 2rem; }
nav a { margin-right: 1rem; }
`,
  "components/Navbar.jsx": `import { Link } from "nepx";

export default function Navbar() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/about">About</Link>
      <Link href="/users/1">User 1</Link>
    </nav>
  );
}
`,
  "middleware.js": `import { redirect } from "nepx";

export const config = { matcher: ["/old-about"] };

export default function middleware() {
  return redirect("/about", 308);
}
`,
  "public/robots.txt": "User-agent: *\nAllow: /\n",
  ".env": "NEPX_PUBLIC_APP_NAME=Nepx.js\n# Variables without the NEPX_PUBLIC_ prefix are server-only.\n",
};

// Files whose body needs type annotations in a TypeScript project (everything else is only renamed .jsx -> .tsx, .js -> .ts).
const TS_OVERRIDES = {
  "app/layout.jsx": `import type { ReactNode } from "react";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata = {
  title: "Nepx App",
  description: "Built with Nepx.js",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container">
      <Navbar />
      {children}
    </div>
  );
}
`,
  "app/error.jsx": `export default function ErrorPage({ error }: { error: Error }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>{error.message}</p>
    </main>
  );
}
`,
  "app/users/[id]/page.jsx": `interface User { id: string; name: string }

export async function getServerSideProps({ params }: { params: { id: string } }) {
  if (!/^\\d+$/.test(params.id)) return { notFound: true };
  const user: User = { id: params.id, name: "User " + params.id };
  return { props: { user } };
}

export default function UserPage({ user }: { user: User }) {
  return <main><h1>{user.name}</h1><p>ID: {user.id}</p></main>;
}
`,
  "app/api/users/route.js": `export async function GET(_request: Request, { url }: { url: URL }) {
  const search = url.searchParams.get("search");
  return Response.json({ users: [], search });
}

export async function POST(request: Request) {
  const data = await request.json();
  return Response.json({ message: "Data received", data }, { status: 201 });
}
`,
  "app/api/users/[id]/route.js": `export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return Response.json({ id: params.id });
}
`,
};

function toTypeScript(files, name) {
  const out = {};
  for (const [rel, content] of Object.entries(files)) {
    if (rel === "jsconfig.json") continue;
    const body = TS_OVERRIDES[rel] ?? content;
    out[/\.jsx$/.test(rel) ? rel.replace(/\.jsx$/, ".tsx") : /\.js$/.test(rel) && !/^nepx\.config\.js$/.test(rel) ? rel.replace(/\.js$/, ".ts") : rel] = body;
  }
  out["tsconfig.json"] = JSON.stringify({
    compilerOptions: {
      target: "ES2022", lib: ["dom", "dom.iterable", "esnext"], module: "esnext", moduleResolution: "bundler", jsx: "react-jsx",
      strict: true, noEmit: true, skipLibCheck: true, isolatedModules: true, esModuleInterop: true, resolveJsonModule: true,
      paths: { "@/*": ["./*"], nepx: [`./node_modules/${PKG.name}/index.d.ts`] },
    },
    include: ["**/*.ts", "**/*.tsx"], exclude: ["node_modules", ".nepx"],
  }, null, 2) + "\n";
  return out;
}

export function createProject(cwd, name, { mode = "fullstack", typescript = false } = {}) {
  validateName(name);
  if (!["frontend", "backend", "fullstack"].includes(mode)) throw new NepxError(`Unknown mode "${mode}" (fullstack | frontend | backend)`);
  const dir = path.resolve(cwd, name);
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new NepxError(`Directory "${name}" already exists and is not empty.`);
  const withUi = mode !== "backend";
  const deps = { [PKG.name]: SELF_DEP, ...(withUi ? { react: "^19.0.0", "react-dom": "^19.0.0" } : {}) };
  const files = {
    "package.json": JSON.stringify({
      name, version: "0.1.0", private: true, type: "module",
      scripts: { dev: "nepx dev", build: "nepx build", start: "nepx start", routes: "nepx routes" },
      dependencies: deps,
    }, null, 2) + "\n",
    "nepx.config.js": `// Optional - every setting has a default.
export default {
  // port: 3000,
  // compress: true,
  // redirects: [{ source: "/old/:slug", destination: "/new/:slug", permanent: true }],
  // headers: [{ source: "/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }] }],
};
`,
    ".gitignore": "node_modules\n.nepx\n.nepx-pages\nout\n.env.local\n.env.*.local\n",
    "jsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"], nepx: [`./node_modules/${PKG.name}/index.d.ts`] }, jsx: "react-jsx" } }, null, 2) + "\n",
    "README.md": `# ${name}\n\n\`\`\`\nnpm install\nnpm run dev      # http://localhost:3000\nnpm run routes\nnpm run build && npm start\n\`\`\`\n`,
  };
  if (mode !== "frontend") Object.assign(files, API_FILES);
  if (withUi) Object.assign(files, UI_FILES);
  if (mode === "backend") files[".env"] = "# Environment variables (server-only unless prefixed with NEPX_PUBLIC_)\n";
  let finalFiles = files;
  if (typescript) {
    finalFiles = toTypeScript(files, name);
    const pkg = JSON.parse(finalFiles["package.json"]);
    pkg.scripts.typecheck = "tsc --noEmit";
    pkg.devDependencies = { typescript: "^5.6.0", "@types/node": "^22.0.0", ...(withUi ? { "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0" } : {}) };
    finalFiles["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
  }
  for (const [rel, content] of Object.entries(finalFiles)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
