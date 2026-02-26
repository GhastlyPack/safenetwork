/* ── Email Signup Modal + Customer.io Integration ── */
(function(){
  var COOKIE_NAME = 'sn_signup_shown';
  var COOKIE_DAYS = 365; // don't auto-popup again for 1 year

  /* ── Signup Funnel Tracking ── */
  function trackSignupEvent(eventName, extra){
    if(!window.cioanalytics) return;
    try {
      var params = new URLSearchParams(window.location.search);
      cioanalytics.track(eventName, Object.assign({
        page: window.location.pathname,
        referrer: document.referrer || 'direct',
        utm_source: params.get('utm_source') || '',
        utm_medium: params.get('utm_medium') || '',
        utm_campaign: params.get('utm_campaign') || ''
      }, extra || {}));
    } catch(e){}
  }

  function getCookie(name){
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }

  function setCookie(name, value, days){
    var d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = name + '=' + value + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }

  /* ── Open / Close ── */
  window.openSignupModal = function(){
    var overlay = document.getElementById('signupOverlay');
    if(!overlay) return;

    // If logged in via Auth0, show "already enrolled" instead of form
    if(window.snAuth && typeof window.snAuth.isLoggedIn === 'function'){
      window.snAuth.isLoggedIn().then(function(loggedIn){
        if(loggedIn){
          var form = overlay.querySelector('.signup-modal form');
          var successEl = document.getElementById('signupSuccess');
          if(form) form.style.display = 'none';
          if(successEl){
            successEl.style.display = 'block';
            var h3 = successEl.querySelector('h3');
            var p = successEl.querySelector('p');
            if(h3) h3.textContent = "You're Already Enrolled!";
            if(p) p.textContent = "You're signed in and already on the list. Watch for exclusive deals in your inbox!";
          }
        }
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
      }).catch(function(){
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
      });
      return;
    }

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    trackSignupEvent('signup_modal_shown', { trigger: 'manual' });
  };

  window.closeSignupModal = function(){
    var overlay = document.getElementById('signupOverlay');
    if(!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  };

  /* ── Click outside to close ── */
  document.addEventListener('click', function(e){
    var overlay = document.getElementById('signupOverlay');
    if(e.target === overlay) closeSignupModal();
  });

  /* ── Escape key to close ── */
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeSignupModal();
  });

  /* ── Auto-popup: scroll-depth (50%) + exit-intent triggers ── */
  var autoTriggerSource = '';

  function triggerAutoPopup(source){
    if(getCookie(COOKIE_NAME)) return;
    autoTriggerSource = source || 'unknown';
    if(window.snAuth && typeof window.snAuth.isLoggedIn === 'function'){
      window.snAuth.isLoggedIn().then(function(loggedIn){
        if(!loggedIn){
          openSignupModal();
          trackSignupEvent('signup_modal_shown', { trigger: 'auto', auto_source: autoTriggerSource });
          setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
        }
      }).catch(function(){
        openSignupModal();
        trackSignupEvent('signup_modal_shown', { trigger: 'auto', auto_source: autoTriggerSource });
        setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
      });
    } else {
      openSignupModal();
      trackSignupEvent('signup_modal_shown', { trigger: 'auto', auto_source: autoTriggerSource });
      setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
    }
  }

  var autoTriggered = false;

  // Scroll trigger: fire at ~50% page depth
  if(!getCookie(COOKIE_NAME)){
    window.addEventListener('scroll', function onScroll(){
      if(autoTriggered) return;
      var scrollPct = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
      if(scrollPct >= 0.5){
        autoTriggered = true;
        window.removeEventListener('scroll', onScroll);
        triggerAutoPopup('scroll_50');
      }
    });

    // Exit-intent trigger: mouse leaves viewport at top (desktop only)
    document.addEventListener('mouseout', function onExit(e){
      if(autoTriggered) return;
      if(e.clientY <= 0 && e.relatedTarget === null){
        autoTriggered = true;
        document.removeEventListener('mouseout', onExit);
        triggerAutoPopup('exit_intent');
      }
    });

    // Fallback: 30s timer in case user doesn't scroll or mouse-out
    setTimeout(function(){
      if(!autoTriggered && !getCookie(COOKIE_NAME)){
        autoTriggered = true;
        triggerAutoPopup('timer_30s');
      }
    }, 30000);
  }

  /* ── Track first interaction with form fields ── */
  var formStarted = false;
  document.addEventListener('focusin', function(e){
    if(formStarted) return;
    var modal = document.querySelector('.signup-modal');
    if(modal && modal.contains(e.target) && (e.target.tagName === 'INPUT')){
      formStarted = true;
      trackSignupEvent('signup_form_started');
    }
  });

  /* ── Form Submit via Customer.io JS Snippet ── */
  window.handleSignup = function(e){
    e.preventDefault();
    var form = document.querySelector('.signup-modal form');
    var errorEl = document.getElementById('signupError');
    var successEl = document.getElementById('signupSuccess');

    // Gather values
    var firstName = form.querySelector('input[name="first_name"]').value.trim();
    var email = form.querySelector('input[name="email"]').value.trim();
    var checks = form.querySelectorAll('input[name="interests"]:checked');
    var interests = [];
    for(var i = 0; i < checks.length; i++) interests.push(checks[i].value);

    // Validate (interests are optional)
    if(!firstName || !email){
      showError(errorEl, 'Please enter your name and email.');
      return;
    }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      showError(errorEl, 'Please enter a valid email address.');
      return;
    }

    // Hide error, disable button
    hideError(errorEl);
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    // Identify user in Customer.io
    try {
      if(window.cioanalytics){
        // Identify creates/updates the person in Customer.io
        cioanalytics.identify(email, {
          email: email,
          first_name: firstName,
          interests: interests,
          source: 'website_signup',
          signup_page: window.location.pathname,
          coupon_eligible: true,
          signed_up_at: new Date().toISOString()
        });

        // Track the signup event
        cioanalytics.track('email_list_signup', {
          first_name: firstName,
          interests: interests,
          source: 'website_signup',
          signup_page: window.location.pathname
        });
      }
    } catch(err) {
      console.warn('Customer.io tracking error:', err);
    }

    // Track completed signup
    trackSignupEvent('signup_completed', {
      has_interests: interests.length > 0,
      interest_count: interests.length
    });

    // Show success (CIO calls are fire-and-forget, no need to wait)
    showSuccess(form, successEl);
  };

  function showError(el, msg){
    if(!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function hideError(el){
    if(!el) return;
    el.style.display = 'none';
  }

  function showSuccess(form, successEl){
    form.style.display = 'none';
    successEl.style.display = 'block';
    setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
  }
})();
