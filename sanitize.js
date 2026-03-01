/**
 * Safe Network - Shared sanitization utilities
 * Prevents XSS by escaping user-generated content before DOM insertion.
 */
(function(){
  'use strict';

  // HTML-escape any string for safe innerHTML insertion
  function escapeHtml(str){
    if(str === null || str === undefined) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // Validate a URL - only allow http/https, strip anything else
  function sanitizeUrl(url){
    if(!url || typeof url !== 'string') return '#';
    var trimmed = url.trim();
    if(/^https?:\/\//i.test(trimmed)) return escapeHtml(trimmed);
    return '#';
  }

  // Escape a string for safe use inside an HTML attribute (single or double quoted)
  function escapeAttr(str){
    if(str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Expose globally
  window.snSanitize = {
    html: escapeHtml,
    url: sanitizeUrl,
    attr: escapeAttr
  };
})();
