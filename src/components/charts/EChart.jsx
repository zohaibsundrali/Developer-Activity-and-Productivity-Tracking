"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";

// Load echarts-for-react client-only (echarts touches the DOM/canvas, so it must
// never run during SSR/prerender).
const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => null,
});

/**
 * Reusable, responsive Apache ECharts wrapper used across the analytics
 * dashboards. Pass an echarts `option`; the chart auto-resizes to its container
 * (ResizeObserver) in addition to echarts-for-react's built-in window resize.
 */
export default function EChart({
  option,
  height = 300,
  className = "",
  style = {},
  onEvents,
  notMerge = true,
}) {
  const instRef = useRef(null);
  const roRef = useRef(null);

  const handleReady = (inst) => {
    instRef.current = inst;
    try {
      const dom = inst.getDom?.();
      const target = dom?.parentElement || dom;
      if (target && typeof ResizeObserver !== "undefined") {
        roRef.current?.disconnect();
        roRef.current = new ResizeObserver(() => {
          try {
            inst.resize();
          } catch {
            /* instance may be disposed */
          }
        });
        roRef.current.observe(target);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    return () => {
      roRef.current?.disconnect();
      roRef.current = null;
    };
  }, []);

  return (
    <ReactECharts
      option={option}
      notMerge={notMerge}
      lazyUpdate
      onChartReady={handleReady}
      onEvents={onEvents}
      className={className}
      style={{ height, width: "100%", ...style }}
      opts={{ renderer: "canvas" }}
    />
  );
}
