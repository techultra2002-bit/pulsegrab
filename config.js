/**
 * PulseGrab – Frontend Site Configuration
 *
 * This file is loaded before app.js and main.js.
 * Set window.__PULSEGRAB_SITE_URL__ to your production domain if you ever
 * need to override the automatically detected window.location.origin
 * (e.g. when running inside an iframe or a non-standard hosting environment).
 *
 * For a standard Netlify deployment, this can be left as an empty string
 * because window.location.origin is already correct on the live site.
 *
 * Example override (uncomment and replace with your real domain):
 *   window.__PULSEGRAB_SITE_URL__ = 'https://pulsegrab.netlify.app';
 */

window.__PULSEGRAB_SITE_URL__ = ''; // Leave empty for auto-detection via window.location.origin
