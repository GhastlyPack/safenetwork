/* ── Auth0 OAuth + Customer.io + Profile Integration ── */
(function(){
  // ══════════════════════════════════════════════
  //  AUTH0 CREDENTIALS
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
          redirect_uri: window.location.origin + window.location.pathname,
          audience: 'https://safenetwork.shop/api'
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
        window._snJustLoggedIn = true;
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
      // Initialize profile (async, non-blocking for nav)
      initProfileAfterLogin(user);
    } else {
      handleLoggedOutState();
    }
  }

  /* ── Initialize Profile After Login ── */
  async function initProfileAfterLogin(user){
    if(!window.snProfile) return;

    // Check for cached profile first (instant UI)
    var cached = snProfile.getCachedProfile();
    if(cached){
      handleProfileReady(cached);
      return;
    }

    // Fetch/create profile from Supabase
    try {
      var token = await getAccessToken();
      if(token){
        var profile = await snProfile.initProfile(user, token);
        if(profile){
          handleProfileReady(profile);
        }
      }
    } catch(err){
      console.warn('Profile init after login error:', err);
    }
  }

  /* ── Update Nav with Profile Data ── */
  function handleProfileReady(profile){
    if(!profile) return;

    // Fresh login redirect: send user to their public profile
    if(window._snJustLoggedIn && profile.username){
      window._snJustLoggedIn = false;
      var path = window.location.pathname;
      if(path === '/' || path === '/index.html'){
        window.location.href = '/collector.html?u=' + encodeURIComponent(profile.username);
        return;
      }
    }

    // Desktop dropdown: show @username and management links
    var dd = document.getElementById('authDropdown');
    if(dd){
      // Add username below email if not already added
      var existingUsername = dd.querySelector('.auth-dropdown-username');
      if(!existingUsername){
        var usernameEl = document.createElement('div');
        usernameEl.className = 'auth-dropdown-username';
        usernameEl.textContent = '@' + (profile.username || '');
        var emailEl = dd.querySelector('.auth-dropdown-email');
        if(emailEl) emailEl.after(usernameEl);
      } else {
        existingUsername.textContent = '@' + (profile.username || '');
      }

      // Add dropdown links if not already there (My Profile is in the header bar instead)
      if(!dd.querySelector('.auth-dropdown-link')){
        var logoutBtn = dd.querySelector('.auth-logout-btn');
        if(logoutBtn){
          var divider = document.createElement('div');
          divider.className = 'auth-dropdown-divider';
          logoutBtn.before(divider);

          var wishlistLink = document.createElement('a');
          wishlistLink.href = '/wishlist.html';
          wishlistLink.className = 'auth-dropdown-link';
          wishlistLink.textContent = 'My Wishlist';
          logoutBtn.before(wishlistLink);

          var collectionLink = document.createElement('a');
          collectionLink.href = '/collection.html';
          collectionLink.className = 'auth-dropdown-link';
          collectionLink.textContent = 'My Collection';
          logoutBtn.before(collectionLink);

          // Add admin link if admin
          if(profile.role === 'admin'){
            var adminLink = document.createElement('a');
            adminLink.href = '/admin.html';
            adminLink.className = 'auth-dropdown-link';
            adminLink.textContent = 'Admin Panel';
            adminLink.style.color = '#c084fc';
            logoutBtn.before(adminLink);
          }

          var divider2 = document.createElement('div');
          divider2.className = 'auth-dropdown-divider';
          logoutBtn.before(divider2);
        }
      }
    }

    // Mobile menu: add profile link if not already there
    var mobileProfile = document.getElementById('authMobileProfile');
    if(mobileProfile && !mobileProfile.querySelector('.auth-mobile-profile-link')){
      var mobileSignedIn = mobileProfile.querySelector('.auth-mobile-signed-in');
      if(mobileSignedIn){
        // Update "Signed in as" to show username
        var mobileEmail = document.getElementById('authMobileEmail');
        if(mobileEmail) mobileEmail.textContent = '@' + (profile.username || profile.email || '');

        // Add "My Profile" link
        var mobileProfLink = document.createElement('a');
        mobileProfLink.href = '/profile.html';
        mobileProfLink.className = 'auth-mobile-profile-link';
        mobileProfLink.textContent = 'My Profile';
        mobileSignedIn.after(mobileProfLink);

        var mobileWishLink = document.createElement('a');
        mobileWishLink.href = '/wishlist.html';
        mobileWishLink.className = 'auth-mobile-profile-link';
        mobileWishLink.style.display = 'block';
        mobileWishLink.style.marginBottom = '8px';
        mobileWishLink.textContent = 'My Wishlist';
        mobileProfLink.after(mobileWishLink);

        var mobileCollLink = document.createElement('a');
        mobileCollLink.href = '/collection.html';
        mobileCollLink.className = 'auth-mobile-profile-link';
        mobileCollLink.style.display = 'block';
        mobileCollLink.style.marginBottom = '8px';
        mobileCollLink.textContent = 'My Collection';
        mobileWishLink.after(mobileCollLink);

        // Add admin link if admin
        if(profile.role === 'admin'){
          var mobileAdminLink = document.createElement('a');
          mobileAdminLink.href = '/admin.html';
          mobileAdminLink.className = 'auth-mobile-profile-link';
          mobileAdminLink.style.color = '#c084fc';
          mobileAdminLink.style.display = 'block';
          mobileAdminLink.style.marginBottom = '8px';
          mobileAdminLink.textContent = 'Admin Panel';
          mobileCollLink.after(mobileAdminLink);
        }
      }
    }

    // Sync profile data to Customer.io for segmentation
    syncProfileToCIO(profile);

    // Dispatch event for profile page and admin page to listen to
    window.dispatchEvent(new CustomEvent('snauth:ready', { detail: { profile: profile } }));
  }

  /* ── Sync Profile Data to Customer.io ── */
  function syncProfileToCIO(profile){
    if(!profile || !window.cioanalytics) return;

    // Build a version string to avoid redundant calls on every page load
    var profileVersion = [
      profile.role, profile.loyalty_tier, profile.loyalty_points,
      (profile.interests || []).join(','), profile.username,
      profile.whatnot_username || ''
    ].join('|');

    var CIO_PROFILE_SYNCED = 'sn_cio_profile_version';
    if(localStorage.getItem(CIO_PROFILE_SYNCED) === profileVersion) return;

    try {
      cioanalytics.identify(profile.email, {
        // Profile attributes for segmentation
        role: profile.role || 'shopper',
        loyalty_tier: profile.loyalty_tier || 'bronze',
        loyalty_points: profile.loyalty_points || 0,
        username: profile.username || '',
        whatnot_username: profile.whatnot_username || '',
        interests: (profile.interests || []).join(', '),
        interest_coins: (profile.interests || []).indexOf('coins') !== -1,
        interest_pokemon: (profile.interests || []).indexOf('pokemon') !== -1,
        interest_sports_cards: (profile.interests || []).indexOf('sports_cards') !== -1,
        interest_shoes: (profile.interests || []).indexOf('shoes') !== -1,
        profile_public: profile.profile_public !== false,
        bio: profile.bio || ''
      });

      localStorage.setItem(CIO_PROFILE_SYNCED, profileVersion);
    } catch(err){
      console.warn('CIO profile sync error:', err);
    }
  }

  /* ── Nav UI: Logged-In State ── */
  function handleLoggedInState(user){
    // Desktop: hide login button, show "My Profile" button + avatar dropdown
    var loginBtn = document.getElementById('authLoginBtn');
    var profileWrap = document.getElementById('authProfileWrap');
    if(loginBtn) loginBtn.style.display = 'none';
    if(profileWrap){
      // Insert "My Profile" button inside profile wrap (next to avatar)
      if(!document.getElementById('authNavProfile')){
        var navProfileBtn = document.createElement('a');
        navProfileBtn.id = 'authNavProfile';
        navProfileBtn.href = '/profile.html';
        navProfileBtn.className = 'auth-nav-profile';
        navProfileBtn.textContent = 'My Profile';
        profileWrap.insertBefore(navProfileBtn, profileWrap.firstChild);
        navProfileBtn.style.display = 'inline-block';
      }
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

    // Homepage hero: swap signup CTA for Whatnot CTA
    var heroCTA = document.getElementById('heroCTA');
    if(heroCTA){
      heroCTA.textContent = '🔴 Watch Live on Whatnot';
      heroCTA.href = 'https://www.whatnot.com/user/safenetwork';
      heroCTA.target = '_blank';
      heroCTA.onclick = null;
      heroCTA.removeAttribute('onclick');
    }
    // Hide benefits line for logged-in users
    var heroBenefits = document.querySelector('.hero-benefits');
    if(heroBenefits) heroBenefits.style.display = 'none';

    // Homepage mobile menu: hide "Join the Collector's List"
    var joinLink = document.getElementById('joinCollectorsList');
    if(joinLink) joinLink.style.display = 'none';
  }

  /* ── Nav UI: Logged-Out State ── */
  function handleLoggedOutState(){
    var loginBtn = document.getElementById('authLoginBtn');
    var profileWrap = document.getElementById('authProfileWrap');
    var navProfileBtn = document.getElementById('authNavProfile');
    if(loginBtn) loginBtn.style.display = '';
    if(navProfileBtn) navProfileBtn.style.display = 'none';
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
    localStorage.removeItem('sn_cio_profile_version');
    // Clear profile cache
    if(window.snProfile) snProfile.clearCache();
    auth0Client.logout({
      logoutParams: {
        returnTo: window.location.origin
      }
    });
  }

  /* ── Get Access Token (for Edge Function auth) ── */
  async function getAccessToken(){
    if(!auth0Client) return null;
    try {
      return await auth0Client.getTokenSilently();
    } catch(err){
      console.warn('getAccessToken error:', err);
      return null;
    }
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
    getAccessToken: getAccessToken,
    toggleProfileDropdown: toggleProfileDropdown
  };

  /* ── Boot ── */
  initAuth().catch(function(err){
    console.error('Auth0 init error:', err);
    handleLoggedOutState();
  });
})();
