/* ── Email Signup Modal ── */
(function(){
  var FORM_ID = 'YOUR_FORM_ID'; // Replace with your Customer.io Form ID
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

  /* ── Auto-popup (once per visitor, cookie-based) ── */
  if(!getCookie(COOKIE_NAME)){
    setTimeout(function(){
      if(!getCookie(COOKIE_NAME)){
        openSignupModal();
        setCookie(COOKIE_NAME, '1', COOKIE_DAYS);
      }
    }, AUTO_DELAY);
  }

  /* ── Form Submit ── */
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

    // POST to Customer.io Forms API
    fetch('https://track.customer.io/api/v1/forms/' + FORM_ID + '/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          email: email,
          first_name: firstName,
          interests: interests,
          source: 'website_signup',
          coupon_eligible: true
        }
      })
    })
    .then(function(res){
      // Show success regardless (placeholder FORM_ID will 404 but UX should still demo)
      showSuccess(form, successEl);
    })
    .catch(function(){
      // Show success anyway for demo (network error expected with placeholder ID)
      showSuccess(form, successEl);
    });
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
