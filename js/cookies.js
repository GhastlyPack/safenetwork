/* ── Cookie Consent Banner ── */
(function(){
  var CONSENT_KEY = 'sn_cookie_consent';

  // If already consented, do nothing
  if(localStorage.getItem(CONSENT_KEY)) return;

  // Build banner
  var banner = document.createElement('div');
  banner.id = 'cookieBanner';
  banner.innerHTML =
    '<div class="cookie-inner">' +
      '<p>We use cookies and similar technologies to improve your experience, analyze site traffic, and deliver personalized content. By continuing to use this site you agree to our <a href="/privacy.html">Privacy Policy</a> and <a href="/terms.html">Terms of Service</a>.</p>' +
      '<div class="cookie-btns">' +
        '<button class="cookie-accept" onclick="acceptCookies()">Accept All</button>' +
        '<button class="cookie-decline" onclick="declineCookies()">Essential Only</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(banner);

  // Accept all cookies
  window.acceptCookies = function(){
    localStorage.setItem(CONSENT_KEY, 'all');
    closeBanner();
  };

  // Essential only (no analytics/marketing)
  window.declineCookies = function(){
    localStorage.setItem(CONSENT_KEY, 'essential');
    closeBanner();
    // Disable CIO tracking for this visitor
    if(window.cioanalytics && window.cioanalytics.reset){
      try { cioanalytics.reset(); } catch(e){}
    }
  };

  function closeBanner(){
    var b = document.getElementById('cookieBanner');
    if(b){
      b.classList.add('closing');
      setTimeout(function(){ b.remove(); }, 300);
    }
  }
})();
