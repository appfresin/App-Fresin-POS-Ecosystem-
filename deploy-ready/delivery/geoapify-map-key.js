// This is the public browser key already used by the interactive map.
(function () {
  "use strict";
  const key = "f35d1b3902ef4de083175cdcb5e761ad";
  if (typeof module === "object" && module.exports) module.exports = key;
  if (typeof window !== "undefined") window.GEOAPIFY_API_KEY = window.GEOAPIFY_API_KEY || key;
})();
