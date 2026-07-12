/**
 * Minimal hash-based router: no build step, no dependency. Routes are
 * registered as `pattern -> render(container, params)`, where `pattern`
 * uses `:name` for a single path segment, e.g. "/cellars/:id".
 */
const routes = [];
let notFoundHandler = (container) => {
  container.textContent = "Page not found.";
};

export function registerRoute(pattern, render) {
  const paramNames = [];
  const regex = new RegExp(
    "^" +
      pattern
        .split("/")
        .map((segment) => {
          if (segment.startsWith(":")) {
            paramNames.push(segment.slice(1));
            return "([^/]+)";
          }
          return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/") +
      "$"
  );
  routes.push({ regex, paramNames, render });
}

export function setNotFound(render) {
  notFoundHandler = render;
}

function currentPath() {
  const hash = window.location.hash.slice(1);
  return hash.startsWith("/") ? hash : "/" + hash;
}

export async function resolve(container) {
  const path = currentPath().split("?")[0] || "/";
  for (const route of routes) {
    const match = path.match(route.regex);
    if (match) {
      const params = {};
      route.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
      container.innerHTML = "";
      await route.render(container, params);
      return;
    }
  }
  container.innerHTML = "";
  await notFoundHandler(container);
}

export function navigate(path) {
  window.location.hash = path;
}

export function startRouter(container) {
  window.addEventListener("hashchange", () => resolve(container));
  return resolve(container);
}
