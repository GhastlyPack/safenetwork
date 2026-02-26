/* ── Auth0 OAuth + Customer.io Integration ── */
(function(){
  // ══════════════════════════════════════════════
  //  REPLACE THESE WITH YOUR AUTH0 CREDENTIALS
  // ══════════════════════════════════════════════
  var AUTH0_DOMAIN    = 'dev-108l0dja21yjpvlf.us.auth0.com';
  var AUTH0_CLIENT_ID = 'RkxofirZba7k9tXD28jmKGNloH9PnEvD';

  var CIO_IDENTIFIED_KEY = 'sn_cio_auth_identified';
  var auth0Client = null;

  /* ── Initialize Auth0 Client ── */
  async function initAuth(){
    try {
      auth0Client = await auth0.createAuth0Client({
        domain: AUTH0_DOMAIN,
        clientId: AUTH0_CLIENT_ID,
        cacheLocation: 'localstorage',
        authorizationParams: {
          redirect_uri: window.location.origin + window.location.pathname
        }
      });
    } catch(err){
      console.warn('Auth0 init failed:', err);
      handleLoggedOutState();
      return;
    }

    // Handle redirect callback (URL contains code= and state=)
    var params = new URLSearchParams(window.location.search);
    if(params.has('code') && params.has('state')){
      try {
        await auth0Client.handleRedirectCallback();
      } catch(err){
        console.warn('Auth0 callback error:', err);
      }
      // Clean URL without reload
      window.history.replaceState({}, document.title,
        window.location.pathname + window.location.hash);
    }

    // Check auth state and update UI
    var isAuthenticated = await auth0Client.isAuthenticated();
    if(isAuthenticated){
      var user = await auth0Client.getUser();
      handleLoggedInState(user);
      identifyWithCIO(user);
    } else {
      handleLoggedOutState();
    }
  }

  /* ── Nav UI: Logged-In State ── */
  function handleLoggedInState(user){
    // Desktop: hide login button, show avatar dropdown
    var loginBtn = document.getElementById('authLoginBtn');
    var profileWrap = document.getElementById('authProfileWrap');
    if(loginBtn) loginBtn.style.display = 'none';
    if(profileWrap){
      profileWrap.style.display = 'flex';
      // Avatar: picture or initials fallback
      var avatarImg = document.getElementById('authAvatarImg');
      var avatarInitials = document.getElementById('authAvatarInitials');
      if(user.picture){
        avatarImg.src = user.picture;
        avatarImg.style.display = 'block';
        avatarInitials.style.display = 'none';
      } else {
        avatarImg.style.display = 'none';
        avatarInitials.style.display = 'flex';
        avatarInitials.textContent = getInitials(user);
      }
      // Dropdown email
      var emailEl = document.getElementById('authDropdownEmail');
      if(emailEl) emailEl.textContent = user.email;
    }

    // Mobile menu: hide login, show signed-in info + logout
    var mobileLogin = document.getElementById('authMobileLogin');
    var mobileProfile = document.getElementById('authMobileProfile');
    if(mobileLogin) mobileLogin.style.display = 'none';
    if(mobileProfile){
      mobileProfile.style.display = 'block';
      var mobileEmail = document.getElementById('authMobileEmail');
      if(mobileEmail) mobileEmail.textContent = user.email;
    }

    // Homepage: hide gold email bar for logged-in users
    var emailBar = document.querySelector('.email-bar');
    if(emailBar) emailBar.style.display = 'none';

    // Homepage mobile menu: hide "Join the Collector's List"
    var joinLink = document.getElementById('joinCollectorsList');
    if(joinLink) joinLink.style.display = 'none';
  }

  /* ── Nav UI: Logged-Out State ── */
  function handleLoggedOutState(){
    var loginBtn = document.getElementById('authLoginBtn');
    var profileWrap = document.getElementById('authProfileWrap');
    if(loginBtn) loginBtn.style.display = '';
    if(profileWrap) profileWrap.style.display = 'none';

    var mobileLogin = document.getElementById('authMobileLogin');
    var mobileProfile = document.getElementById('authMobileProfile');
    if(mobileLogin) mobileLogin.style.display = '';
    if(mobileProfile) mobileProfile.style.display = 'none';
  }

  /* ── Login ── */
  async function login(){
    if(!auth0Client) return;
    await auth0Client.loginWithRedirect({
      authorizationParams: {
        redirect_uri: window.location.origin + window.location.pathname
      }
    });
  }

  /* ── Logout ── */
  async function logout(){
    if(!auth0Client) return;
    localStorage.removeItem(CIO_IDENTIFIED_KEY);
    auth0Client.logout({
      logoutParams: {
        returnTo: window.location.origin
      }
    });
  }

  /* ── CIO Auto-Enroll on Login ── */
  function identifyWithCIO(user){
    // Only identify once per email to avoid duplicate calls on every page load
    if(localStorage.getItem(CIO_IDENTIFIED_KEY) === user.email) return;

    // Detect auth method from user.sub prefix
    var authMethod = 'email';
    if(user.sub){
      if(user.sub.indexOf('google-oauth2|') === 0) authMethod = 'google';
      else if(user.sub.indexOf('apple|') === 0) authMethod = 'apple';
    }

    try {
      if(window.cioanalytics){
        cioanalytics.identify(user.email, {
          email: user.email,
          first_name: user.given_name || user.name || '',
          source: 'auth0_login',
          auth_method: authMethod,
          auth0_id: user.sub,
          coupon_eligible: true,
          signed_up_at: new Date().toISOString()
        });
        cioanalytics.track('user_login', {
          auth_method: authMethod,
          login_page: window.location.pathname,
          email: user.email
        });
      }
    } catch(err){
      console.warn('CIO auth tracking error:', err);
    }

    localStorage.setItem(CIO_IDENTIFIED_KEY, user.email);
  }

  /* ── Desktop Dropdown Toggle ── */
  function toggleProfileDropdown(){
    var dd = document.getElementById('authDropdown');
    if(dd) dd.classList.toggle('open');
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', function(e){
    var dd = document.getElementById('authDropdown');
    var profileWrap = document.getElementById('authProfileWrap');
    if(dd && profileWrap && !profileWrap.contains(e.target)){
      dd.classList.remove('open');
    }
  });

  /* ── Helpers ── */
  function getInitials(user){
    if(user.given_name) return user.given_name.charAt(0).toUpperCase();
    if(user.name) return user.name.charAt(0).toUpperCase();
    if(user.email) return user.email.charAt(0).toUpperCase();
    return '?';
  }

  function escapeHtml(str){
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ── Public API ── */
  window.snAuth = {
    login: login,
    logout: logout,
    isLoggedIn: async function(){
      if(!auth0Client) return false;
      return await auth0Client.isAuthenticated();
    },
    getUser: async function(){
      if(!auth0Client) return null;
      return await auth0Client.getUser();
    },
    toggleProfileDropdown: toggleProfileDropdown
  };

  /* ── Boot ── */
  initAuth().catch(function(err){
    console.error('Auth0 init error:', err);
    handleLoggedOutState();
  });
})();
