import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Container,
  Snackbar,
  Typography,
} from "@mui/material";
import NavBar from "./components/NavBar.jsx";
import Hero from "./components/Hero.jsx";
import LoadingState from "./components/LoadingState.jsx";
import ErrorState from "./components/ErrorState.jsx";
import ResultCard from "./components/ResultCard.jsx";
import { HowItWorks, Features, SupportedSources, LegalNotice, Footer } from "./components/Sections.jsx";
import {
  fetchConfig,
  extractVideo,
  createConversionJob,
  getConversionJob,
  mediaHref,
  triggerDownload,
  copyText,
  normalizeError,
} from "./lib/api.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const mountedRef = useRef(true);

  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | loading | success | error
  const [loadStep, setLoadStep] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [lastUrl, setLastUrl] = useState("");
  const [jobs, setJobs] = useState({});
  const [snack, setSnack] = useState({ open: false, message: "", severity: "success" });

  const notify = useCallback((message, severity = "success") => {
    setSnack({ open: true, message, severity });
  }, []);

  // ---- config -------------------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    const ac = new AbortController();
    fetchConfig(ac.signal)
      .then((data) => setConfig(data))
      .catch((err) => {
        if (err.name !== "AbortError") {
          setConfigError(normalizeError(err));
        }
      });
    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, []);

  // ---- loading step animation --------------------------------------------
  useEffect(() => {
    if (phase !== "loading") {
      setLoadStep(0);
      return undefined;
    }
    const t = setInterval(() => setLoadStep((s) => Math.min(s + 1, 3)), 1700);
    return () => clearInterval(t);
  }, [phase]);

  const scrollToResults = () => {
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleSubmit = useCallback(
    async (url) => {
      setLastUrl(url);
      setPhase("loading");
      setError(null);
      setResult(null);
      scrollToResults();
      try {
        const data = await extractVideo(url);
        if (!mountedRef.current) return;
        setResult(data);
        setPhase("success");
        scrollToResults();
      } catch (err) {
        if (!mountedRef.current || err.name === "AbortError") return;
        setError(normalizeError(err));
        setPhase("error");
        scrollToResults();
      }
    },
    [],
  );

  const handleCopy = useCallback(
    async (text) => {
      const ok = await copyText(text);
      notify(ok ? "Direct media URL copied to clipboard." : "Could not access the clipboard — copy manually.", ok ? "success" : "error");
    },
    [notify],
  );

  const handleDownload = useCallback(
    async (source) => {
      const href = mediaHref(source, { download: true });
      try {
        const head = await fetch(href, { method: "HEAD" });
        if (!head.ok) {
          let message = `Download failed (HTTP ${head.status}).`;
          try {
            const body = await head.json();
            if (body?.error?.message) message = body.error.message;
          } catch {
            /* keep generic */
          }
          notify(message, "error");
          return;
        }
        const length = Number(head.headers.get("content-length"));
        const large = Number.isFinite(length) && length > 150 * 1024 * 1024;
        triggerDownload(mediaHref(source, { download: true }), undefined);
        if (large) {
          notify("Large file — if the browser opens it in a tab instead, use Save video as…", "info");
        }
      } catch {
        // HEAD not tolerated for some reason — attempt the download anyway.
        triggerDownload(href, undefined);
      }
    },
    [notify],
  );

  const handleConvert = useCallback(
    async (source, onActive) => {
      const jobKey = source.id;
      setJobs((j) => ({ ...j, [jobKey]: { status: "queued", progress: 0 } }));
      onActive?.(source.id);
      try {
        const { id } = await createConversionJob({
          url: source.url,
          name: (result?.title || "video").replace(/\.(mp4|m3u8|webm)$/i, "") + ".mp4",
          referer: result?.sourcePage || "",
        });
        for (let i = 0; i < 300 && mountedRef.current; i++) {
          await sleep(2000);
          const status = await getConversionJob(id);
          if (!mountedRef.current) return;
          setJobs((j) => ({
            ...j,
            [jobKey]: { status: status.status, progress: status.progress ?? 0, downloadUrl: status.downloadUrl, error: status.error },
          }));
          if (status.status === "done") {
            notify("Conversion finished — your MP4 is ready.", "success");
            return;
          }
          if (status.status === "error") {
            notify(status.error || "Conversion failed.", "error");
            return;
          }
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setJobs((j) => ({ ...j, [jobKey]: { status: "error", error: err.message } }));
        notify(normalizeError(err).message, "error");
      }
    },
    [result, notify],
  );

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      <Box
        component="a"
        href="#main"
        sx={{
          position: "absolute",
          left: -9999,
          "&:focus": { left: 8, top: 8, position: "fixed", bgcolor: "primary.main", color: "#fff", p: 1.5, zIndex: 2000, borderRadius: 1 },
        }}
      >
        Skip to content
      </Box>

      <NavBar />

      <Box component="main" id="main" sx={{ flex: 1 }}>
        <Hero onSubmit={handleSubmit} loading={phase === "loading"} sites={config?.sites} inputRef={inputRef} />

        {configError ? (
          <Container maxWidth="md" sx={{ mb: 2 }}>
            <Alert severity="warning">
              Configuration endpoint unavailable ({configError.code}) — extraction still works, but supported-host and
              conversion-service information may be missing.
            </Alert>
          </Container>
        ) : null}

        <Container maxWidth="lg" sx={{ pb: { xs: 4, md: 6 } }}>
          <Box
            ref={resultsRef}
            sx={{
              minHeight: phase === "idle" ? 0 : undefined,
              scrollMarginTop: 90,
              "&:empty": { display: "none" },
            }}
            aria-live="polite"
            aria-busy={phase === "loading" || undefined}
          >
            {phase === "loading" ? <LoadingState step={loadStep} /> : null}
            {phase === "error" ? <ErrorState error={error} onRetry={() => lastUrl && handleSubmit(lastUrl)} /> : null}
            {phase === "success" && result ? (
              <>
                <Typography variant="overline" color="secondary" sx={{ fontWeight: 700, letterSpacing: 1.5, display: "block", maxWidth: 980, mx: "auto", mb: 1 }}>
                  EXTRACTION RESULT
                </Typography>
                <ResultCard
                  result={result}
                  workerHealthy={Boolean(result.worker?.healthy ?? config?.worker?.healthy)}
                  onCopy={handleCopy}
                  onDownload={handleDownload}
                  onConvert={handleConvert}
                  jobs={jobs}
                />
              </>
            ) : null}
          </Box>
        </Container>

        <HowItWorks />
        <SupportedSources config={config} />
        <Features />
        <LegalNotice />
      </Box>

      <Footer config={config} />

      <Snackbar
        open={snack.open}
        autoHideDuration={4200}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        aria-haspopup="alertdialog"
      >
        <Alert onClose={() => setSnack((s) => ({ ...s, open: false }))} severity={snack.severity} variant="filled" sx={{ width: "100%" }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
