/* ── Email Signup Modal + Customer.io Integration ── */
(function(){
  var AUTO_DELAY = 10000; // 10 seconds
  var COOKIE_NAME = 'sn_signup_shown';
  var COOKIE_DAYS = 365; // don't auto-popup again for 1 year

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

  /* ── Auto-popup (once per visitor, cookie-based, skip if logged in) ── */
  if(!getCookie(COOKIE_NAME)){
    setTimeout(function(){
      if(!getCookie(COOKIE_NAME)){
        // Skip popup for authenticated users (auto-enrolled via CIO on login)
        if(window.snAuth && typeof window.snAuth.isLoggedIn === 'function'){
          window.snAuth.isLoggedIn().then(function(loggedIn){
            if(!loggedIn){
              openSignupModal();
              setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
            }
          }).catch(function(){
            openSignupModal();
            setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
          });
        } else {
          openSignupModal();
          setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
        }
      }
    }, AUTO_DELAY);
  }

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

    // Validate
    if(!firstName || !email){
      showError(errorEl, 'Please enter your name and email.');
      return;
    }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      showError(errorEl, 'Please enter a valid email address.');
      return;
    }
    if(interests.length === 0){
      showError(errorEl, 'Please select at least one interest.');
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
