import { Alert, AlertTitle, Box, Button, Chip, Stack, Typography } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import AutorenewIcon from "@mui/icons-material/Autorenew";

export default function ErrorState({ error, onRetry }) {
  if (!error) return null;
  return (
    <Box role="alert" sx={{ maxWidth: 760, mx: "auto", width: 1 }}>
      <Alert
        severity="error"
        icon={<ErrorOutlineIcon fontSize="inherit" />}
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry} startIcon={<AutorenewIcon />}>
              Retry
            </Button>
          ) : null
        }
        sx={{ alignItems: "flex-start" }}
      >
        <AlertTitle sx={{ fontWeight: 700 }}>Could not fetch this video</AlertTitle>
        <Typography variant="body2" sx={{ mb: error.hint ? 0.5 : 0 }}>
          {error.message}
        </Typography>
        {error.hint ? (
          <Typography variant="body2" color="text.secondary">
            {error.hint}
          </Typography>
        ) : null}
        {error.code ? (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Chip size="small" label={error.code} variant="outlined" color="error" sx={{ fontFamily: "monospace" }} />
          </Stack>
        ) : null}
      </Alert>
    </Box>
  );
}
