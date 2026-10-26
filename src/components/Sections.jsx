import { Box, Container, Typography } from "@mui/material";
import { brandFont } from "../theme.js";

export function Footer() {
  return (
    <Box component="footer" sx={{ bgcolor: "#ffffff", py: 3, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
      <Container maxWidth="lg" sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "baseline", justifyContent: "space-between" }}>
        <Typography variant="body2" sx={{ fontFamily: brandFont, color: "primary.main", fontSize: "1rem" }}>
          Media<span sx={{ color: "secondary.main" }}>Fetch</span>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Authorised use only · No DRM bypass · {new Date().getFullYear()}
        </Typography>
      </Container>
    </Box>
  );
}
