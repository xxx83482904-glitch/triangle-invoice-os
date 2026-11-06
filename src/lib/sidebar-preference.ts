export type SidebarPreference = "auto" | "expanded" | "collapsed";

export const sidebarStorageKey = "triangle-invoice-os-sidebar";
export const sidebarMediaQuery = "(min-width: 1536px)";

// Keep validation self-contained so the pre-paint script can share it.
export function sidebarAttribute(stored: string | null): Exclude<SidebarPreference, "auto"> | null {
  return stored === "expanded" || stored === "collapsed" ? stored : null;
}

export const sidebarInitScript = `
(() => {
  try {
    const value = (${sidebarAttribute.toString()})(window.localStorage.getItem("${sidebarStorageKey}"));
    if (value) document.documentElement.setAttribute("data-sidebar", value);
    else document.documentElement.removeAttribute("data-sidebar");
  } catch (_) {}
})();
`;
