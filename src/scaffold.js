import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NepxError } from "./errors/index.js";

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

export function createProject(cwd, name, { mode = "fullstack" } = {}) {
  validateName(name);
  if (!["frontend", "backend", "fullstack"].includes(mode)) throw new NepxError(`Unknown mode "${mode}" (fullstack | frontend | backend)`);
  const dir = path.resolve(cwd, name);
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new NepxError(`Directory "${name}" already exists and is not empty.`);
  const withUi = mode !== "backend";
  const deps = { nepx: `file:${PKG_DIR}`, ...(withUi ? { react: "^19.0.0", "react-dom": "^19.0.0" } : {}) };
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
    ".gitignore": "node_modules\n.nepx\n.env.local\n.env.*.local\n",
    "jsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, jsx: "react-jsx" } }, null, 2) + "\n",
    "README.md": `# ${name}\n\n\`\`\`\nnpm install\nnpm run dev      # http://localhost:3000\nnpm run routes\nnpm run build && npm start\n\`\`\`\n`,
  };
  if (mode !== "frontend") Object.assign(files, API_FILES);
  if (withUi) Object.assign(files, UI_FILES);
  if (mode === "backend") files[".env"] = "# Environment variables (server-only unless prefixed with NEPX_PUBLIC_)\n";
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}
