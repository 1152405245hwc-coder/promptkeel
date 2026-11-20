/* Apply the saved theme before the body paints. External and blocking so CSP stays script-src 'self'. */
(() => {
  const key = "promptkeel.theme";
  let theme = "light";
  try {
    const stored = localStorage.getItem(key);
    if (stored === "dark" || stored === "light") theme = stored;
  } catch {
    /* storage unavailable; the default light theme stays */
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
