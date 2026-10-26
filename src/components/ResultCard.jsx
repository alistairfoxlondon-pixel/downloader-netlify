import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Card,
  Chip,
  Divider,
  Stack,
  Typography,
  Button,
  Tooltip,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import MovieIcon from "@mui/icons-material/Movie";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SubtitlesIcon from "@mui/icons-material/Subtitles";
import ScheduleIcon from "@mui/icons-material/Schedule";
import PreviewPlayer from "./PreviewPlayer.jsx";
import FormatsTable from "./FormatsTable.jsx";

function firstPreviewable(sources) {
  return sources.find((s) => s.container !== "mpd") || sources[0] || null;
}

export default function ResultCard({ result, workerHealthy, onCopy, onDownload, onConvert, jobs }) {
  const sources = result.sources || [];
  const [activeId, setActiveId] = useState(() => firstPreviewable(sources)?.id ?? null);
  const activeSource = useMemo(() => sources.find((s) => s.id === activeId) || firstPreviewable(sources), [sources, activeId]);

  // Reset selection when a new result arrives.
  useEffect(() => {
    setActiveId(firstPreviewable(result.sources || [])?.id ?? null);
  }, [result.fetchedAt]);

  const handlePreview = (s) => setActiveId(s.id);
  const handleConvert = {
    start: (s) => onConvert(s, (id) => setActiveId(id)),
    download: (job) => window.open(job.downloadUrl, "_blank", "noopener"),
  };

  return (
    <Card elevation={0} sx={{ maxWidth: 980, mx: "auto", width: 1, overflow: "visible" }}>
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        {/* ---- header ---- */}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2.5} alignItems={{ sm: "flex-start" }}>
          <Box
            sx={{
              width: { xs: 1, sm: 240 },
              aspectRatio: "16 / 9",
              flexShrink: 0,
              borderRadius: 1,
              overflow: "hidden",
              bgcolor: "rgba(72,41,178,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            {result.thumbnail ? (
              <Box
                component="img"
                src={result.thumbnail}
                alt=""
                sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <MovieIcon sx={{ fontSize: 46, color: "secondary.main", opacity: 0.55 }} />
            )}
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 0.75 }}>
              <Chip size="small" color="primary" label={result.siteLabel || result.site} />
              <Chip size="small" variant="outlined" label={`${sources.length} source${sources.length === 1 ? "" : "s"}`} />
              {result.subtitles?.length ? (
                <Chip
                  size="small"
                  variant="outlined"
                  icon={<SubtitlesIcon />}
                  label={`${result.subtitles.length} subtitle${result.subtitles.length === 1 ? "" : "s"}`}
                />
              ) : null}
            </Stack>
            <Typography variant="h4" component="h2" sx={{ wordBreak: "break-word", mb: 0.5 }}>
              {result.title || "Video"}
            </Typography>
            {result.sourcePage ? (
              <Button
                size="small"
                href={result.sourcePage}
                target="_blank"
                rel="noopener noreferrer"
                endIcon={<OpenInNewIcon fontSize="small" />}
                sx={{ px: 0, textDecoration: "underline", color: "text.secondary" }}
              >
                Source page
              </Button>
            ) : null}
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
              <Chip size="small" variant="outlined" icon={<ScheduleIcon />} label="Links valid 15 min" />
            </Stack>
          </Box>
        </Stack>

        {/* ---- warnings ---- */}
        {result.warnings?.length
          ? result.warnings.map((w, i) => (
              <Alert key={i} severity="warning" icon={<WarningAmberIcon />} sx={{ mt: 2 }}>
                {w.message}
              </Alert>
            ))
          : null}

        {/* ---- preview ---- */}
        <Divider sx={{ my: 2.5 }} />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
          <Typography variant="h6" component="h3">
            Preview
          </Typography>
          {activeSource ? (
            <Tooltip title="Playback uses the same stream the source site serves. Nothing is re-encoded in your browser.">
              <Chip size="small" variant="outlined" label={activeSource.protocol === "hls" ? "HLS" : activeSource.container?.toUpperCase()} />
            </Tooltip>
          ) : null}
        </Stack>
        <PreviewPlayer source={activeSource} poster={result.thumbnail} title={result.title} onCopy={onCopy} />

        {/* ---- formats / actions ---- */}
        <Divider sx={{ my: 2.5 }} />
        <Typography variant="h6" component="h3" sx={{ mb: 0.5 }}>
          Download options
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          Quality options are listed exactly as the source provides them. MP4 is only offered when the source is a real
          MP4 file or when the conversion service produces one.
        </Typography>
        <FormatsTable
          sources={sources}
          activeSourceId={activeId}
          jobs={jobs}
          workerHealthy={workerHealthy}
          onPreview={handlePreview}
          onCopy={onCopy}
          onDownload={onDownload}
          onConvert={handleConvert}
        />

        {sources.length === 0 ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            The page was reachable, but no downloadable source was exposed by the player.
          </Alert>
        ) : null}
      </Box>
    </Card>
  );
}
