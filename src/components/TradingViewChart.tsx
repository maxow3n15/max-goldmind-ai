import { useEffect, useRef } from "react";

interface Props {
  interval: string; // 1,5,15,30,60,240,D
  height?: number;
}

export function TradingViewChart({ interval, height = 520 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`tv_${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = `<div id="${idRef.current}" style="height:100%;width:100%"></div>`;

    const create = () => {
      // @ts-ignore
      if (!window.TradingView) return;
      // @ts-ignore
      new window.TradingView.widget({
        autosize: true,
        symbol: "OANDA:XAUUSD",
        interval,
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        toolbar_bg: "#1a1a1f",
        enable_publishing: false,
        withdateranges: true,
        hide_side_toolbar: false,
        allow_symbol_change: false,
        details: false,
        studies: ["MASimple@tv-basicstudies", "RSI@tv-basicstudies"],
        container_id: idRef.current,
        overrides: {
          "paneProperties.background": "#141418",
          "paneProperties.backgroundType": "solid",
          "paneProperties.vertGridProperties.color": "#22222a",
          "paneProperties.horzGridProperties.color": "#22222a",
          "scalesProperties.textColor": "#a1a1aa",
        },
      });
    };

    // @ts-ignore
    if (window.TradingView) { create(); return; }
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/tv.js";
    s.async = true;
    s.onload = create;
    document.head.appendChild(s);
    return () => { container.innerHTML = ""; };
  }, [interval]);

  return <div ref={containerRef} style={{ height }} className="w-full rounded-xl overflow-hidden border border-border/60" />;
}
