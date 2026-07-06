import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../utils";

export interface HorizontalScrollRowProps {
  children: ReactNode;
  /** Gap between items, mirrors the flex gap so the arrow step stays proportional. */
  gap?: number;
  className?: string;
}

/**
 * Horizontal, single-line row that reveals overflow via floating arrow buttons
 * and edge fade masks. When content fits, arrows and masks are hidden and it
 * behaves like a plain flex row — so callers degrade gracefully on wide layouts.
 */
export function HorizontalScrollRow({ children, gap = 6, className }: HorizontalScrollRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 1px tolerance absorbs sub-pixel rounding from fractional zoom / DPR.
    setCanLeft(el.scrollLeft > 1);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  // Re-measure on mount and whenever children change size.
  useLayoutEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => update();
    el.addEventListener("scroll", onScroll, { passive: true });

    // Observe the viewport (container) and the content so resizing the window
    // or an item changing size re-evaluates arrow visibility.
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    if (el.firstElementChild instanceof Element) ro.observe(el.firstElementChild);

    // ResizeObserver only fires on border-box changes — it misses the case
    // where children are added/removed without resizing the container (e.g. a
    // preset becoming non-empty and entering the row). A childList MutationObserver
    // catches that and re-measures scrollWidth.
    const mo = new MutationObserver(() => update());
    mo.observe(el, { childList: true });

    update();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, [update]);

  const scrollByPage = useCallback((direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }, []);

  const showArrows = canLeft || canRight;

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <div
        ref={scrollRef}
        className={cn(
          "flex items-center overflow-x-auto scrollbar-hide px-1 transition-[mask-image]",
          // Fade only the edge that still has content beyond it, so the last
          // visible item is never needlessly dimmed when fully scrolled.
          canLeft && canRight && "[mask-image:linear-gradient(to_right,transparent,#000_24px,#000_calc(100%-24px),transparent)]",
          canLeft && !canRight && "[mask-image:linear-gradient(to_right,transparent,#000_24px,#000)]",
          !canLeft && canRight && "[mask-image:linear-gradient(to_right,#000,#000_calc(100%-24px),transparent)]",
        )}
        style={{ gap }}
      >
        {children}
      </div>

      {showArrows && (
        <>
          <button
            type="button"
            aria-label="scroll left"
            onClick={() => scrollByPage(-1)}
            disabled={!canLeft}
            className={cn(
              "absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border-subtle bg-surface/90 p-0.5 text-muted shadow-sm backdrop-blur-sm transition-opacity hover:text-secondary hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-0",
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="scroll right"
            onClick={() => scrollByPage(1)}
            disabled={!canRight}
            className={cn(
              "absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border-subtle bg-surface/90 p-0.5 text-muted shadow-sm backdrop-blur-sm transition-opacity hover:text-secondary hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-0",
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
