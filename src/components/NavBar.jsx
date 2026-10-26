import { AppBar, Toolbar, Typography, Button, Box, Container } from "@mui/material";
import OndemandVideoIcon from "@mui/icons-material/OndemandVideo";
import { brandFont } from "../theme.js";

export default function NavBar() {
  return (
    <AppBar position="sticky" component="header">
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ display: "flex", justifyContent: "space-between", minHeight: { xs: 56, md: 64 } }}>
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

          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              document.getElementById("video-url")?.focus();
            }}
          >
            Paste a link
          </Button>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
