"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitive.Provider;

function useToastBottom() {
  const [bottom, setBottom] = React.useState(0);
  React.useLayoutEffect(() => {
    const bars = new Set<Element>();
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Use the rendered top so wrapped bars, mobile navigation and transforms count.
      setBottom(Math.max(0, ...[...bars].filter((bar) => bar.getClientRects().length).map((bar) => window.innerHeight - bar.getBoundingClientRect().top)));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const sync = () => {
      const current = new Set(document.querySelectorAll(".bank-ledger-savebar, .selection-action-bar, .record-savebar"));
      for (const bar of bars) if (!current.has(bar)) { resize.unobserve(bar); bars.delete(bar); }
      for (const bar of current) if (!bars.has(bar)) { bars.add(bar); resize.observe(bar); }
      schedule();
    };
    const mutations = new MutationObserver(sync);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    sync();
    cancelAnimationFrame(frame);
    measure();
    window.addEventListener("resize", schedule);
    return () => { mutations.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); };
  }, []);
  return bottom;
}

const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, style, ...props }, ref) => {
  const bottom = useToastBottom();
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      className={cn(
        "pointer-events-none fixed right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:max-w-[380px]",
        className
      )}
      style={{ ...style, bottom }}
      {...props}
    />
  );
});
ToastViewport.displayName = ToastPrimitive.Viewport.displayName;

const Toast = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> & {
    variant?: "default" | "success" | "destructive";
  }
>(({ className, variant = "default", ...props }, ref) => {
  return (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(
        "group pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-xl border px-4 py-3 shadow-lg transition-all data-open:animate-in data-open:slide-in-from-bottom-5 data-open:fade-in-0 data-closed:animate-out data-closed:slide-out-to-right-full data-closed:fade-out-0",
        variant === "destructive" && "border-destructive/30 bg-destructive text-destructive-foreground",
        variant === "success" && "border-green-200 bg-green-50 text-green-900",
        variant === "default" && "border bg-background text-foreground",
        className
      )}
      {...props}
    />
  );
});
Toast.displayName = ToastPrimitive.Root.displayName;

const ToastAction = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring disabled:pointer-events-none disabled:opacity-50",
      className
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitive.Action.displayName;

const ToastClose = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      "rounded-md p-0.5 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none group-hover:opacity-100",
      className
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitive.Close>
));
ToastClose.displayName = ToastPrimitive.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitive.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitive.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;
type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
