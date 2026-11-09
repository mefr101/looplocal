// Applies the saved light/dark choice BEFORE the page paints, so there is no flash.
// Loaded as a normal (non-module) script in the <head> of every page.
// layout.js adds the toggle button and saves the visitor's choice under "looplocal-theme".
(function () {
  try {
    var saved = localStorage.getItem('looplocal-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (error) {
    // Storage can be blocked (private windows). The device setting is used instead.
  }
})();
