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
  CircularProgress,
  Stack,
} from "@mui/material";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import { brandFont } from "../theme.js";

const EXAMPLE = "https://streamtape.com/v/74AwoLa6xQCAAQ4/1792525423448.mp4";

export default function Hero({ onSubmit, loading, inputRef }) {
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
      setLocalError("That is not a valid URL.");
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
      setLocalError("Clipboard blocked — paste with Ctrl/Cmd+V.");
    }
  };

  return (
    <Box id="top" sx={{ pt: { xs: 5, md: 8 }, pb: { xs: 4, md: 6 }, bgcolor: "#ffffff" }}>
      <Container maxWidth="md" sx={{ textAlign: "center" }}>
        <Typography
          variant="h1"
          component="h1"
          sx={{
            fontFamily: brandFont,
            fontWeight: 700,
            mb: 1,
            fontSize: { xs: "2.2rem", sm: "2.7rem", md: "3.2rem" },
          }}
        >
          Download <Box component="span" sx={{ color: "primary.main" }}>videos</Box>
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 3, fontWeight: 400 }}>
          Paste a link — get every quality.
        </Typography>

        <Paper
          component="form"
          onSubmit={handleSubmit}
          elevation={0}
          sx={{ p: { xs: 1.5, md: 2 }, border: "1px solid rgba(0,0,0,0.13)", textAlign: "left" }}
          aria-label="Video URL form"
        >
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              id="video-url"
              inputRef={inputRef}
              label="Video URL"
              placeholder="https://example.com/video.mp4"
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

          <Box id="video-url-support" sx={{ mt: 1 }}>
            <Chip
              label="Try: streamtape.com/v/74AwoLa6xQCAAQ4"
              size="small"
              variant="outlined"
              clickable
              onClick={() => {
                setValue(EXAMPLE);
                setLocalError(null);
              }}
              sx={{ fontFamily: "monospace", fontSize: "0.72rem" }}
            />
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
