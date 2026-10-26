import { Alert, Box, Card, CardContent, LinearProgress, Stack, Typography, Skeleton } from "@mui/material";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";

const STEPS = ["Fetching the page…", "Finding streams…", "Preparing links…"];

export default function LoadingState({ step = 0 }) {
  const current = Math.min(step, STEPS.length - 1);
  return (
    <Box role="status" aria-live="polite" aria-busy="true" sx={{ maxWidth: 760, mx: "auto", width: 1 }}>
      <Alert severity="info" icon={<HourglassEmptyIcon />} sx={{ mb: 2, alignItems: "center" }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {STEPS[current]}
        </Typography>
      </Alert>
      <LinearProgress sx={{ height: 6, borderRadius: 3, mb: 2.5 }} />
      <Card elevation={0}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Skeleton variant="rectangular" width={{ xs: "100%", sm: 220 }} height={124} sx={{ borderRadius: 1 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Skeleton variant="text" width="70%" height={34} />
              <Skeleton variant="text" width="45%" />
              <Skeleton variant="text" width="85%" />
              <Skeleton variant="rectangular" width="100%" height={40} sx={{ mt: 1, borderRadius: 1 }} />
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
