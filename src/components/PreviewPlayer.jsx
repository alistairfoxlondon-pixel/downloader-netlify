import { useEffect, useRef, useState, useMemo } from "react";
import { Box, Button, Stack, Typography, Chip, useTheme } from "@mui/material";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Hls from "hls.js";
import { mediaHref } from "../lib/api.js";

/**
 * Video preview: native <video> for MP4 and (where available) native HLS;
 * hls.js otherwise. When a CDN blocks cross-origin playlist reads (CORS),
 * the player automatically retries through the tokenised media proxy.
 */
export default function PreviewPlayer({ source, poster, title, onCopy }) {
  const theme = useTheme();
  const videoRef = useRef(null);
  const [strategy, setStrategy] = useState("direct"); // direct | proxy
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [errMsg, setErrMsg] = useState(null);
  const [hlsFatal, setHlsFatal] = useState(false);

  const isHls = source?.protocol === "hls" || source?.container === "m3u8";
  const nativeHls = useMemo(() => {
    if (typeof document === "undefined") return false;
    const v = document.createElement("video");
    return Boolean(v.canPlayType("application/vnd.apple.mpegurl"));
  }, []);

  const src = useMemo(() => {
    if (!source) return null;
    return mediaHref(source, strategy === "proxy" ? { mode: "proxy" } : {});
  }, [source, strategy]);

  // ---- HLS (hls.js) lifecycle --------------------------------------------
  useEffect(() => {
    if (!source || !isHls || nativeHls || !src) return undefined;
    setStatus("loading");
    setErrMsg(null);
    setHlsFatal(false);

    if (!Hls.isSupported()) {
      setStatus("error");
      setErrMsg("This browser cannot play HLS streams (Media Source Extensions unavailable).");
      return undefined;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 3,
      manifestLoadingTimeOut: 12000,
      manifestLoadingRetryDelay: 800,
    });
    hls.loadSource(src);
    hls.attachMedia(videoRef.current);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setStatus("ready");
      videoRef.current?.play?.().catch(() => {
        /* autoplay blocked — user can press play */
      });
    });
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && strategy === "direct") {
        // Likely CORS on the CDN — fall back to the proxy (playlist gets rewritten).
        setStrategy("proxy");
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      setHlsFatal(true);
      setStatus("error");
      setErrMsg(
        data.type === Hls.ErrorTypes.NETWORK_ERROR
          ? "The stream could not be loaded (network blocked or link expired)."
          : "Playback failed for this stream.",
      );
    });

    return () => {
      hls.destroy();
    };
  }, [src, isHls, nativeHls, strategy, source]);

  // ---- Direct MP4 lifecycle ----------------------------------------------
  useEffect(() => {
    if (!source || isHls) return undefined;
    setStatus("loading");
    setErrMsg(null);
    return undefined;
  }, [source, isHls]);

  const handleVideoError = () => {
    if (strategy === "direct") {
      setStrategy("proxy"); // retry through the proxy (fixes IP-bound/CORS links)
      return;
    }
    setStatus("error");
    setErrMsg(
      "The video could not be loaded for preview. The link may have expired, be restricted to the source site, or the format may be unsupported by this browser.",
    );
  };

  if (!source) return null;
  const notPreviewable = source.container === "mpd";

  return (
    <Box sx={{ width: 1 }}>
      <Box
        sx={{
          position: "relative",
          width: 1,
          aspectRatio: "16 / 9",
          bgcolor: "#000",
          borderRadius: 1,
          overflow: "hidden",
          border: "1px solid rgba(0,0,0,0.2)",
        }}
      >
        {notPreviewable ? (
          <Box sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, color: "#fff", p: 3, textAlign: "center" }}>
            <WarningAmberIcon />
            <Typography variant="body2">Convert to MP4 to preview.</Typography>
          </Box>
        ) : (
          <Box
            key={`${source.id}-${strategy}-${isHls ? "hls" : "file"}`}
            component="video"
            ref={videoRef}
            className="preview-video"
            sx={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              bgcolor: "#000",
              ...(isHls && !nativeHls ? { visibility: strategy === "proxy" && status === "error" ? "hidden" : "visible" } : {}),
            }}
            controls
            playsInline
            preload="metadata"
            poster={poster || undefined}
            aria-label={`Video preview: ${title || "selected source"}`}
            src={isHls && !nativeHls ? undefined : src}
            onLoadedMetadata={() => setStatus("ready")}
            onCanPlay={() => setStatus("ready")}
            onError={handleVideoError}
          />
        )}

        {status === "loading" && !notPreviewable ? (
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              bgcolor: "rgba(0,0,0,0.35)",
              pointerEvents: "none",
            }}
          >
            <PlayCircleOutlineIcon sx={{ fontSize: 54, animation: "pulse 1.2s ease-in-out infinite" }} />
          </Box>
        ) : null}
      </Box>

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.25, alignItems: "center" }}>
        <Chip
          size="small"
          label={isHls ? (strategy === "proxy" ? "HLS (via proxy)" : "HLS stream") : `${(source.container || "mp4").toUpperCase()} preview`}
          color={isHls ? "secondary" : "primary"}
          variant="outlined"
        />
        {status === "ready" ? (
          <Chip size="small" label="Preview ready" color="success" variant="outlined" />
        ) : null}
        {status === "error" ? (
          <Chip size="small" label="Preview failed" color="error" variant="outlined" />
        ) : null}
        {hlsFatal && strategy === "direct" ? (
          <Button size="small" onClick={() => setStrategy("proxy")} color="secondary">
            Retry via proxy
          </Button>
        ) : null}
        <Button size="small" onClick={() => onCopy(source.url)} color="inherit" sx={{ textDecoration: "underline" }}>
          Copy media URL
        </Button>
      </Stack>

      {status === "error" && errMsg ? (
        <Box sx={{ mt: 1, p: 1.5, bgcolor: "rgba(179,41,78,0.06)", border: "1px solid rgba(179,41,78,0.25)", borderRadius: 1 }}>
          <Typography variant="body2" color="error" role="note">
            {errMsg}
          </Typography>
        </Box>
      ) : null}

      <style>{`@keyframes pulse { 0%,100% { opacity: .55; transform: scale(.96);} 50% { opacity: 1; transform: scale(1);} }`}</style>
    </Box>
  );
}
