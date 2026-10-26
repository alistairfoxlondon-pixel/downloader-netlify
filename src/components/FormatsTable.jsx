import {
  Box,
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  Card,
  CardContent,
  Stack,
  LinearProgress,
  useTheme,
} from "@mui/material";

import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import LinkIcon from "@mui/icons-material/Link";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import SyncIcon from "@mui/icons-material/Sync";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { formatBytes } from "../lib/api.js";

function qualityText(s) {
  if (s.quality?.label) return s.quality.label;
  if (s.quality?.height) return `${s.quality.height}p`;
  if (s.protocol === "hls") return "Auto / adaptive";
  return "Default";
}

function statusChip(s) {
  if (s.verified) {
    return (
      <Chip
        size="small"
        icon={<CheckCircleOutlineIcon />}
        label="Verified"
        color="success"
        variant="outlined"
        sx={{ height: 24 }}
      />
    );
  }
  return (
    <Chip size="small" icon={<WarningAmberIcon />} label="Unverified" color="warning" variant="outlined" sx={{ height: 24 }} />
  );
}

function actions(s, props) {
  const { onPreview, onCopy, onDownload, onConvert, workerHealthy, job, active } = props;
  const previewable = s.container !== "mpd";
  const isBusy = job && (job.status === "queued" || job.status === "processing");
  const done = job && job.status === "done";

  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
      {previewable ? (
        <Button
          size="small"
          variant={active ? "contained" : "outlined"}
          color={active ? "primary" : "primary"}
          startIcon={<PlayCircleOutlineIcon fontSize="small" />}
          onClick={() => onPreview(s)}
          aria-label={`Preview ${qualityText(s)} source`}
        >
          {active ? "Playing" : "Preview"}
        </Button>
      ) : null}

      <Tooltip title="Copy the direct media URL to the clipboard">
        <Button
          size="small"
          variant="outlined"
          startIcon={<LinkIcon fontSize="small" />}
          onClick={() => onCopy(s.url)}
          aria-label={`Copy direct URL of ${qualityText(s)} source`}
        >
          Copy URL
        </Button>
      </Tooltip>

      {s.downloadable === "direct" ? (
        <Button
          size="small"
          variant="contained"
          color="secondary"
          startIcon={<CloudDownloadIcon fontSize="small" />}
          onClick={() => onDownload(s)}
          aria-label={`Download ${qualityText(s)} source as file`}
        >
          Download
        </Button>
      ) : s.protocol === "hls" || s.container === "mpd" ? (
        workerHealthy ? (
          <Button
            size="small"
            variant="contained"
            color="secondary"
            disabled={Boolean(isBusy)}
            startIcon={done ? <CloudDownloadIcon fontSize="small" /> : <SyncIcon fontSize="small" />}
            onClick={() => (done ? onConvert.download(job) : onConvert.start(s))}
            aria-label={`Convert ${qualityText(s)} to MP4${isBusy ? " (in progress)" : ""}`}
          >
            {isBusy ? `Converting… ${job.progress ?? 0}%` : done ? "Download MP4" : "Get MP4"}
          </Button>
        ) : (
          <Tooltip title="HLS source — enable the conversion service (MEDIA_WORKER_URL) to produce MP4 files. Until then you can copy the stream URL or preview it.">
            <span>
              <Button size="small" variant="contained" color="secondary" disabled startIcon={<SyncIcon fontSize="small" />}>
                Get MP4
              </Button>
            </span>
          </Tooltip>
        )
      ) : (
        <Tooltip title="This container is not MP4 — enable the conversion service to transcode it.">
          <span>
            <Button size="small" variant="contained" color="secondary" disabled startIcon={<SyncIcon fontSize="small" />}>
              Convert
            </Button>
          </span>
        </Tooltip>
      )}
    </Stack>
  );
}

/**
 * Quality/format table (desktop) + stacked cards (mobile).
 * Rows always show honest container + size + verification state.
 */
export default function FormatsTable({ sources, activeSourceId, jobs, ...handlers }) {
  const theme = useTheme();
  const isMobile = theme.breakpoints.down("md");

  if (!sources?.length) return null;

  if (isMobile) {
    return (
      <Stack spacing={1.5} sx={{ mt: 2.5 }} aria-label="Available formats">
        {sources.map((s) => (
          <Card key={s.id} variant="outlined" elevation={0}>
            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {qualityText(s)}
                </Typography>
                {statusChip(s)}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }} useFlexGap flexWrap="wrap">
                <Chip size="small" label={s.container?.toUpperCase() || "?"} color="primary" variant="outlined" />
                <Chip size="small" label={formatBytes(s.sizeBytes)} variant="outlined" />
                {s.ipBound ? <Chip size="small" label="IP-bound · proxied" variant="outlined" color="warning" /> : null}
              </Stack>
              {s.note ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.25 }}>
                  {s.note}
                </Typography>
              ) : null}
              {jobs?.[s.id] && (jobs[s.id].status === "queued" || jobs[s.id].status === "processing") ? (
                <LinearProgress variant="determinate" value={jobs[s.id].progress ?? 0} sx={{ mb: 1 }} />
              ) : null}
              {actions(s, { ...handlers, job: jobs?.[s.id], active: activeSourceId === s.id })}
            </CardContent>
          </Card>
        ))}
      </Stack>
    );
  }

  return (
    <Box sx={{ mt: 2.5, width: 1, overflowX: "auto" }} aria-label="Available formats">
      <Table size="small" sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, width: "18%" }}>Quality</TableCell>
            <TableCell sx={{ fontWeight: 700, width: 100 }}>Format</TableCell>
            <TableCell sx={{ fontWeight: 700, width: 110 }}>Size</TableCell>
            <TableCell sx={{ fontWeight: 700, width: 130 }}>Status</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sources.map((s) => {
            const job = jobs?.[s.id];
            const busy = job && (job.status === "queued" || job.status === "processing");
            return (
              <TableRow
                key={s.id}
                hover
                selected={activeSourceId === s.id}
                sx={{ "&.Mui-selected": { backgroundColor: "rgba(72,41,178,0.06)" } }}
              >
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {qualityText(s)}
                  </Typography>
                  {s.quality?.bandwidth ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {Math.round(s.quality.bandwidth / 1000)} kbps
                    </Typography>
                  ) : null}
                  {s.ipBound ? (
                    <Typography variant="caption" color="warning.dark" sx={{ display: "block" }}>
                      IP-bound · proxied
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Chip size="small" label={s.container?.toUpperCase() || "?"} color="primary" variant="outlined" />
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{formatBytes(s.sizeBytes)}</Typography>
                </TableCell>
                <TableCell>
                  {statusChip(s)}
                  {busy ? (
                    <Typography variant="caption" color="secondary" sx={{ display: "block", mt: 0.5, fontWeight: 700 }}>
                      Converting {job.progress ?? 0}%
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>
                  {s.note && !busy ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75, maxWidth: 340 }}>
                      {s.note}
                    </Typography>
                  ) : null}
                  {actions(s, { ...handlers, job, active: activeSourceId === s.id })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
