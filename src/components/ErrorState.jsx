import { Alert, AlertTitle, Box, Button, Typography } from "@mui/material";
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
        <Typography variant="body2">{error.message}</Typography>
      </Alert>
    </Box>
  );
}
