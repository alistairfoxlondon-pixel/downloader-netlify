import { useState } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  Container,
  IconButton,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  useTheme,
  useMediaQuery,
  Divider,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import OndemandVideoIcon from "@mui/icons-material/OndemandVideo";
import { brandFont } from "../theme.js";

const SECTIONS = [
  { id: "how-it-works", label: "How it works" },
  { id: "supported", label: "Supported sources" },
  { id: "legal", label: "Responsible use" },
];

export default function NavBar() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [drawerOpen, setDrawerOpen] = useState(false);

  const scrollTo = (id) => {
    setDrawerOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <AppBar position="sticky" component="header">
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ display: "flex", justifyContent: "space-between", minHeight: { xs: 60, md: 70 } }}>
            <Box
              component="a"
              href="#top"
              onClick={(e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              sx={{ display: "flex", alignItems: "center", gap: 1, textDecoration: "none", color: "inherit" }}
              aria-label="MediaFetch home"
            >
              <OndemandVideoIcon color="primary" fontSize="large" />
              <Typography
                variant="h5"
                component="span"
                sx={{ fontFamily: brandFont, color: "primary.main", fontWeight: 400, letterSpacing: 0.2 }}
              >
                Media<span sx={{ color: "secondary.main" }}>Fetch</span>
              </Typography>
            </Box>

            {isMobile ? (
              <IconButton
                edge="end"
                aria-label="Open navigation menu"
                onClick={() => setDrawerOpen(true)}
                color="inherit"
              >
                <MenuIcon />
              </IconButton>
            ) : (
              <Box component="nav" aria-label="Main navigation" sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                {SECTIONS.map((s) => (
                  <Button
                    key={s.id}
                    color="inherit"
                    onClick={() => scrollTo(s.id)}
                    sx={{ fontWeight: 500, color: "text.primary" }}
                  >
                    {s.label}
                  </Button>
                ))}
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    document.getElementById("video-url")?.focus();
                  }}
                  sx={{ ml: 1.5 }}
                >
                  Paste a link
                </Button>
              </Box>
            )}
          </Toolbar>
        </Container>
      </AppBar>

      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{ sx: { width: 280, p: 1 } }}
      >
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", px: 1, py: 0.5 }}>
          <Typography variant="h6" sx={{ fontFamily: brandFont, color: "primary.main" }}>
            Menu
          </Typography>
          <IconButton aria-label="Close navigation menu" onClick={() => setDrawerOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider />
        <List>
          {SECTIONS.map((s) => (
            <ListItemButton
              key={s.id}
              onClick={() => scrollTo(s.id)}
              component="button"
              sx={{ textAlign: "left", width: 1, border: "none", background: "none", cursor: "pointer" }}
            >
              <ListItemText primary={s.label} />
            </ListItemButton>
          ))}
        </List>
        <Divider />
        <List>
          <ListItemButton
            component="button"
            onClick={() => {
              setDrawerOpen(false);
              window.scrollTo({ top: 0, behavior: "smooth" });
              setTimeout(() => document.getElementById("video-url")?.focus(), 350);
            }}
            sx={{ textAlign: "left", width: 1, border: "none", background: "none", cursor: "pointer" }}
          >
            <ListItemText primary="Paste a link" primaryTypographyProps={{ color: "primary", fontWeight: 600 }} />
          </ListItemButton>
        </List>
      </Drawer>
    </>
  );
}
