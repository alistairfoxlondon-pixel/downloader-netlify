import { useState, useRef } from "react";
import {
  Box,
  Container,
  Typography,
  Paper,
  TextField,
  Button,
  InputAdornment,
  Chip,
  Stack,
  Fade,
  CircularProgress,
} from "@mui/material";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import { brandFont } from "../theme.js";

const EXAMPLES = [
  "https://streamtape.com/v/74AwoLa6xQCAAQ4/1792525423448.mp4",
  "https://streamfile.net/2xdgz3t2bphw",
];

export default function Hero({ onSubmit, loading, sites, inputRef }) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState(null);
  const pasteIdleTimer = useRef(null);
  const [pasteOk, setPasteOk] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setLocalError("Paste a video URL first.");
      inputRef?.current?.focus();
      return;
    }
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      setLocalError("That does not look like a valid URL.");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setLocalError("Only http:// and https:// links are supported.");
      return;
    }
    setLocalError(null);
    onSubmit(trimmed);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setValue(text.trim());
        setLocalError(null);
        setPasteOk(true);
        clearTimeout(pasteIdleTimer.current);
        pasteIdleTimer.current = setTimeout(() => setPasteOk(false), 1600);
      } else {
        setLocalError("Clipboard is empty.");
      }
    } catch {
      setLocalError("Clipboard access was denied — paste with Ctrl/Cmd+V instead.");
    }
  };

  return (
    <Box
      id="top"
      sx={{
        position: "relative",
        overflow: "hidden",
        pt: { xs: 6, md: 10 },
        pb: { xs: 5, md: 8 },
        background:
          "linear-gradient(180deg, #ffffff 0%, #faf7f8 55%, rgba(72,41,178,0.04) 100%)",
      }}
    >
      {/* Decorative blobs — pure CSS, no image assets needed */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          width: 340,
          height: 340,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(179,41,78,0.10), transparent 70%)",
          top: -80,
          right: { xs: -120, md: 40 },
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(72,41,178,0.10), transparent 70%)",
          bottom: -140,
          left: -80,
        }}
      />

      <Container maxWidth="md" sx={{ position: "relative", textAlign: "center" }}>
        <Chip
          label="MP4 · HLS · quality detection · in-browser preview"
          size="small"
          color="secondary"
          variant="outlined"
          sx={{ mb: 2.5, fontWeight: 600 }}
        />
        <Typography
          variant="h1"
          component="h1"
          sx={{ fontFamily: brandFont, fontWeight: 700, mb: 2, color: "text.primary", fontSize: { xs: "2.4rem", sm: "3rem", md: "3.6rem" } }}
        >
          Download videos from any{" "}
          <Box component="span" sx={{ color: "primary.main" }}>
            supported
          </Box>{" "}
          link
        </Typography>
        <Typography variant="h5" color="text.secondary" sx={{ mb: 4, mx: "auto", maxWidth: 640, fontWeight: 400, fontSize: { xs: "1.05rem", md: "1.25rem" } }}>
          Paste a URL — MediaFetch detects direct MP4 and HLS streams, lists every
          available quality, and lets you preview, copy or download the media.
        </Typography>

        <Paper
          component="form"
          onSubmit={handleSubmit}
          elevation={0}
          sx={{
            p: { xs: 2, md: 2.5 },
            border: "1px solid rgba(0,0,0,0.13)",
            boxShadow: "0 10px 30px rgba(52,58,64,0.10)",
            textAlign: "left",
          }}
          aria-label="Video URL form"
        >
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              id="video-url"
              inputRef={inputRef}
              label="Video URL"
              placeholder="https://example.com/video.mp4 or an m3u8 playlist…"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (localError) setLocalError(null);
              }}
              error={Boolean(localError)}
              helperText={localError || " "}
              fullWidth
              type="url"
              inputProps={{
                autoComplete: "off",
                spellCheck: false,
                "aria-describedby": "video-url-support",
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LinkOutlinedIcon color="action" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <Button
                      size="small"
                      onClick={handlePaste}
                      startIcon={pasteOk ? null : <ContentPasteIcon fontSize="small" />}
                      color={pasteOk ? "success" : "primary"}
                      aria-label="Paste URL from clipboard"
                      sx={{ minWidth: 0 }}
                    >
                      {pasteOk ? "Pasted!" : "Paste"}
                    </Button>
                  </InputAdornment>
                ),
              }}
            />
            <Button
              type="submit"
              variant="contained"
              color="primary"
              size="large"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <CloudDownloadIcon />}
              sx={{
                height: 56,
                px: 3.5,
                whiteSpace: "nowrap",
                alignSelf: { xs: "stretch", sm: "auto" },
              }}
              aria-label="Fetch video sources"
              aria-busy={loading || undefined}
            >
              {loading ? "Fetching…" : "Fetch video"}
            </Button>
          </Stack>

          <Box id="video-url-support" sx={{ mt: 0.5 }}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                Try:
              </Typography>
              {EXAMPLES.map((ex) => (
                <Chip
                  key={ex}
                  label={ex.replace(/^https?:\/\//, "").slice(0, 40) + (ex.length > 48 ? "…" : "")}
                  size="small"
                  variant="outlined"
                  clickable
                  onClick={() => {
                    setValue(ex);
                    setLocalError(null);
                  }}
                  title={ex}
                  sx={{ fontFamily: "monospace", fontSize: "0.72rem" }}
                />
              ))}
              {sites?.length ? (
                <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: "auto" } }}>
                  {sites.length} host families supported · direct .mp4/.m3u8 links always work
                </Typography>
              ) : null}
            </Stack>
          </Box>
        </Paper>

        <Fade in timeout={600}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }} id="hero-caption">
            Only download content you own or are authorised to access. No DRM bypass.
          </Typography>
        </Fade>
      </Container>
    </Box>
  );
}
