import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Chip,
  Stack,
  Alert,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from "@mui/material";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import HighQualityIcon from "@mui/icons-material/HighQuality";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import SecurityIcon from "@mui/icons-material/Security";
import CodeIcon from "@mui/icons-material/Code";
import GavelIcon from "@mui/icons-material/Gavel";
import SubtitlesIcon from "@mui/icons-material/Subtitles";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import { brandFont } from "../theme.js";

function SectionHeading({ id, eyebrow, title, subtitle }) {
  return (
    <Box sx={{ textAlign: "center", maxWidth: 720, mx: "auto", mb: 4 }} id={id}>
      <Typography
        variant="overline"
        color="secondary"
        sx={{ fontWeight: 700, letterSpacing: 1.5, display: "block" }}
      >
        {eyebrow}
      </Typography>
      <Typography variant="h2" component="h2" sx={{ fontFamily: brandFont, mt: 0.5, mb: 1 }}>
        {title}
      </Typography>
      {subtitle ? (
        <Typography color="text.secondary" sx={{ fontSize: { xs: "1rem", md: "1.1rem" } }}>
          {subtitle}
        </Typography>
      ) : null}
    </Box>
  );
}

const STEPS = [
  {
    icon: <ContentPasteIcon fontSize="inherit" />,
    title: "1 · Paste the link",
    text: "Drop in a direct MP4, an M3U8 playlist, or a page URL from one of the supported hosts.",
  },
  {
    icon: <HighQualityIcon fontSize="inherit" />,
    title: "2 · Detect sources",
    text: "Domain-specific extractors resolve the real media URL and enumerate every quality the source exposes.",
  },
  {
    icon: <CloudDownloadIcon fontSize="inherit" />,
    title: "3 · Preview, copy or download",
    text: "Play the stream in the browser, copy the direct URL, or download the file — HLS can be converted to MP4 when the conversion service is enabled.",
  },
];

const FEATURES = [
  {
    icon: <PlayCircleOutlineIcon fontSize="inherit" />,
    title: "In-browser preview",
    text: "MP4 plays natively; HLS plays through hls.js with an automatic CORS-safe proxy fallback.",
  },
  {
    icon: <HighQualityIcon fontSize="inherit" />,
    title: "Real quality ladders",
    text: "Variant playlists are parsed server-side — resolutions, bandwidth and host-reported sizes are shown as-is.",
  },
  {
    icon: <SubtitlesIcon fontSize="inherit" />,
    title: "Subtitles when available",
    text: "Side-loaded subtitle tracks (Vidara, Playmate, LuluStream) are detected and listed with the sources.",
  },
  {
    icon: <CodeIcon fontSize="inherit" />,
    title: "Serverless, no secrets in the client",
    text: "Extraction runs in Netlify Functions. Signing keys, rate limits and SSRF guards stay server-side.",
  },
  {
    icon: <SecurityIcon fontSize="inherit" />,
    title: "Hardened fetches",
    text: "Scheme/port allow-lists, private-IP and DNS rebinding checks, redirect re-validation, response size caps.",
  },
  {
    icon: <CloudDownloadIcon fontSize="inherit" />,
    title: "Streaming media proxy",
    text: "Range-request passthrough and playlist rewriting keep previews and IP-bound downloads working cross-origin.",
  },
];

export function HowItWorks() {
  return (
    <Box component="section" aria-labelledby="how-title" sx={{ py: { xs: 6, md: 9 } }}>
      <Container maxWidth="lg">
        <Box id="how-it-works" sx={{ scrollMarginTop: 90 }} />
        <SectionHeading
          eyebrow="HOW IT WORKS"
          title="Three steps from link to file"
          subtitle="No browser extensions, no account, no hidden queue."
        />
        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
          }}
        >
          {STEPS.map((s) => (
            <Card key={s.title} elevation={0} sx={{ height: 1 }}>
              <CardContent sx={{ p: 3 }}>
                <Box
                  sx={{
                    width: 52,
                    height: 52,
                    borderRadius: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "rgba(179,41,78,0.08)",
                    color: "primary.main",
                    fontSize: 28,
                    mb: 2,
                  }}
                  aria-hidden
                >
                  {s.icon}
                </Box>
                <Typography variant="h5" component="h3" sx={{ mb: 1 }}>
                  {s.title}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  {s.text}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

export function Features() {
  return (
    <Box component="section" aria-labelledby="features-title" sx={{ py: { xs: 6, md: 9 }, bgcolor: "#ffffff", borderBlock: "1px solid rgba(0,0,0,0.07)" }}>
      <Container maxWidth="lg">
        <Box id="features" sx={{ scrollMarginTop: 90 }} />
        <SectionHeading
          eyebrow="CAPABILITIES"
          title="Built like a product, not a mockup"
          subtitle="Every control is wired to a real extraction, proxy or conversion path."
        />
        <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" } }}>
          {FEATURES.map((f) => (
            <Box key={f.title} sx={{ display: "flex", gap: 2 }}>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  borderRadius: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  bgcolor: "rgba(72,41,178,0.08)",
                  color: "secondary.main",
                  fontSize: 24,
                }}
                aria-hidden
              >
                {f.icon}
              </Box>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {f.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {f.text}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

export function SupportedSources({ config }) {
  const sites = config?.sites || [];
  const formats = config?.formats || [];
  return (
    <Box component="section" aria-labelledby="supported-title" sx={{ py: { xs: 6, md: 9 } }}>
      <Container maxWidth="lg">
        <Box id="supported" sx={{ scrollMarginTop: 90 }} />
        <SectionHeading
          eyebrow="SUPPORTED SOURCES"
          title="Domains and formats"
          subtitle="Each host is inspected individually — extraction logic is domain-specific, not a single generic scraper."
        />
        <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
          <Card elevation={0}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" component="h3" sx={{ mb: 1.5 }}>
                Host families
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {sites.length ? (
                  sites.map((s) => (
                    <Tooltip key={s.id} title={s.hosts.slice(0, 12).join(", ") + (s.hosts.length > 12 ? "…" : "")}>
                      <Chip label={s.label} color="primary" variant="outlined" />
                    </Tooltip>
                  ))
                ) : (
                  <Chip label="Loading…" variant="outlined" />
                )}
                <Chip label="Any direct .mp4 / .m3u8 URL" color="secondary" variant="outlined" />
              </Stack>
              <List dense sx={{ mt: 1.5 }}>
                {sites.slice(0, 6).map((s) => (
                  <ListItem key={s.id} sx={{ px: 0 }}>
                    <ListItemIcon sx={{ minWidth: 30 }}>
                      <CheckCircleOutlineIcon color="success" fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={s.label}
                      secondary={s.hosts.slice(0, 4).join(" · ") + (s.hosts.length > 4 ? ` · +${s.hosts.length - 4} more` : "")}
                      primaryTypographyProps={{ fontWeight: 600, variant: "body2" }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>

          <Card elevation={0}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h5" component="h3" sx={{ mb: 1.5 }}>
                Media formats
              </Typography>
              <List dense>
                {formats.map((f) => (
                  <ListItem key={f.id} sx={{ px: 0, alignItems: "flex-start" }}>
                    <ListItemIcon sx={{ minWidth: 30, mt: 0.25 }}>
                      {f.downloadable === true ? (
                        <CheckCircleOutlineIcon color="success" fontSize="small" />
                      ) : (
                        <CodeIcon color="action" fontSize="small" />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {f.label}
                          </Typography>
                          <Chip
                            size="small"
                            label={
                              f.downloadable === true
                                ? "direct download"
                                : f.downloadable === "worker"
                                  ? "conversion required"
                                  : "detection only"
                            }
                            color={f.downloadable === true ? "success" : "default"}
                            variant="outlined"
                            sx={{ height: 20 }}
                          />
                        </Stack>
                      }
                      secondary={f.note}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Box>
      </Container>
    </Box>
  );
}

export function LegalNotice() {
  return (
    <Box component="section" aria-labelledby="legal-title" sx={{ py: { xs: 6, md: 9 }, bgcolor: "#ffffff", borderBlock: "1px solid rgba(0,0,0,0.07)" }}>
      <Container maxWidth="md">
        <Box id="legal" sx={{ scrollMarginTop: 90 }} />
        <SectionHeading eyebrow="RESPONSIBLE USE" title="Download only what you’re allowed to" />
        <Alert severity="warning" icon={<GavelIcon />} sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Copyright, terms of service and access controls still apply.
          </Typography>
          <Typography variant="body2">
            Use MediaFetch only for content you own, content in the public domain, or content whose rights-holder permits
            downloading. The service refuses DRM-protected streams, does not bypass authentication or CAPTCHAs, and does
            not attempt to defeat technical protection measures.
          </Typography>
        </Alert>
        <List dense>
          <ListItem sx={{ px: 0 }}>
            <ListItemIcon sx={{ minWidth: 30 }}>
              <SecurityIcon color="primary" fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="DRM (SAMPLE-AES / Widevine / FairPlay) streams are detected and refused with an explicit error." />
          </ListItem>
          <ListItem sx={{ px: 0 }}>
            <ListItemIcon sx={{ minWidth: 30 }}>
              <SecurityIcon color="primary" fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Signed media links expire after 15 minutes and are pinned to one destination — the proxy can never be used as an open relay." />
          </ListItem>
          <ListItem sx={{ px: 0 }}>
            <ListItemIcon sx={{ minWidth: 30 }}>
              <SecurityIcon color="primary" fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Some hosts restrict downloads by their own terms (e.g. StreamFile’s direct link is premium-only) — limitations are reported honestly instead of hidden." />
          </ListItem>
        </List>
      </Container>
    </Box>
  );
}

export function Footer({ config }) {
  return (
    <Box component="footer" sx={{ bgcolor: "background.default", py: 5, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
      <Container maxWidth="lg">
        <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "2fr 1fr 1fr" } }}>
          <Box>
            <Typography variant="h6" sx={{ fontFamily: brandFont, color: "primary.main" }}>
              Media<span sx={{ color: "secondary.main" }}>Fetch</span>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 420 }}>
              A serverless video URL inspector: direct MP4 and HLS detection, quality ladders, in-browser preview, signed
              downloads and an optional ffmpeg conversion worker. Built with React + Material UI on Netlify.
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              On this site
            </Typography>
            <Stack spacing={0.5}>
              {[
                ["How it works", "how-it-works"],
                ["Supported sources", "supported"],
                ["Responsible use", "legal"],
              ].map(([label, id]) => (
                <Typography
                  key={id}
                  component="button"
                  variant="body2"
                  onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })}
                  sx={{ background: "none", border: "none", p: 0, textAlign: "left", cursor: "pointer", color: "text.secondary", "&:hover": { color: "primary.main" } }}
                >
                  {label}
                </Typography>
              ))}
            </Stack>
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Status
            </Typography>
            <Stack spacing={0.75}>
              <Typography variant="body2" color="text.secondary">
                {config?.sites?.length ?? "—"} host families loaded
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Conversion worker:{" "}
                {config?.worker?.healthy ? "online" : config?.worker?.available ? "configured, offline" : "not configured"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                API v{config?.version || "1.0.0"}
              </Typography>
            </Stack>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 4 }}>
          © {new Date().getFullYear()} MediaFetch · For lawful, authorised use only · Not affiliated with any video host.
        </Typography>
      </Container>
    </Box>
  );
}
