export const navigationIntentEvent = "triangle:navigate";
export type NavigationIntent = CustomEvent<{ href: string }>;

// Programmatic navigation must give unsaved editors the same veto as links.
export function requestAppNavigation(href: string, target: EventTarget = document) {
  return target.dispatchEvent(new CustomEvent(navigationIntentEvent, { cancelable: true, detail: { href } }));
}
