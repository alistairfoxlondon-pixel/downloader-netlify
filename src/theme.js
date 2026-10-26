import { createTheme, responsiveFontSizes } from "@mui/material";

// Palette + geometry inherited from the react-saas-template reference
// (crimson primary, indigo secondary, light grey canvas, hairline borders).
const primary = "#b3294e";
const secondary = "#4829B2";
const black = "#343a40";
const darkBlack = "rgb(36, 40, 44)";
const background = "#f5f5f5";
const warningLight = "rgba(253, 200, 69, .3)";
const warningMain = "rgba(253, 200, 69, .5)";
const warningDark = "rgba(253, 200, 69, .7)";

const borderWidth = 1;
const borderColor = "rgba(0, 0, 0, 0.13)";

const xl = 1920;
const lg = 1280;
const md = 960;
const sm = 600;
const xs = 0;

let theme = createTheme({
  palette: {
    primary: { main: primary, contrastText: "#fff" },
    secondary: { main: secondary, contrastText: "#fff" },
    common: { black, darkBlack },
    warning: { light: warningLight, main: warningMain, dark: warningDark },
    tonalOffset: 0.2,
    background: { default: background, paper: "#ffffff" },
    text: { primary: black },
  },
  breakpoints: {
    values: { xl, lg, md, sm, xs },
  },
  shape: {
    borderRadius: 6,
  },
  spacing: 8,
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 700, fontSize: "2.6rem", lineHeight: 1.15 },
    h2: { fontWeight: 700, fontSize: "2rem", lineHeight: 1.25 },
    h3: { fontWeight: 700, fontSize: "1.6rem" },
    h4: { fontWeight: 600, fontSize: "1.35rem" },
    h5: { fontWeight: 600, fontSize: "1.15rem" },
    h6: { fontWeight: 600, fontSize: "1rem" },
    button: { textTransform: "none", fontWeight: 600 },
    subtitle1: { color: "rgba(52, 58, 64, 0.75)" },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 6, paddingInline: 18 },
        containedPrimary: {
          "&:hover": { backgroundColor: "#9c2143" },
        },
        outlined: { borderColor: borderColor, borderWidth: borderWidth },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { border: `${borderWidth}px solid ${borderColor}`, borderRadius: 8 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: { borderRadius: 8 },
      },
    },
    MuiTextField: {
      defaultProps: { variant: "outlined" },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6, fontWeight: 500 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `${borderWidth}px solid ${borderColor}` },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: {
        tooltip: { backgroundColor: darkBlack, borderRadius: 6 },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundColor: "#ffffff", color: black, boxShadow: "0 2px 10px rgba(0,0,0,0.08)" },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8, alignItems: "flex-start" },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: "#ffffff" },
      },
    },
  },
});

theme = responsiveFontSizes(theme, { breakpoints: ["sm", "md", "lg"] });

/** Brand/display font used for the logotype and hero headline (template uses Baloo Bhaijaan). */
export const brandFont = "'Baloo Bhaijaan', cursive";

export default theme;
