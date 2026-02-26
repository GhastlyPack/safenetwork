/* ── Supabase Profile System ── */
(function(){
  // ══════════════════════════════════════════════
  //  REPLACE THESE WITH YOUR SUPABASE CREDENTIALS
  // ══════════════════════════════════════════════
  var SUPABASE_URL  = 'https://qsoaransrvpabqpwnjdg.supabase.co';
  var SUPABASE_ANON = 'sb_publishable_lcfgoZNnjgSYup6jA_iUFg_hxj1sU8a'; // from Settings > API
  var EDGE_FN_URL   = SUPABASE_URL + '/functions/v1/profile-sync';
  var PROFILE_CACHE  = 'sn_profile_cache';

  var supabaseClient = null;
  var currentProfile = null;

  function init(){
    if(window.supabase && window.supabase.createClient){
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    }
    // Restore cached profile
    try {
      var cached = sessionStorage.getItem(PROFILE_CACHE);
      if(cached) currentProfile = JSON.parse(cached);
    } catch(e){}
  }

  /* ── Generate Random Username ── */
  function generateUsername(){
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var suffix = '';
    for(var i = 0; i < 4; i++){
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'Collector_' + suffix;
  }

  /* ── Call Edge Function ── */
  async function callEdge(action, data, accessToken){
    var res = await fetch(EDGE_FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify({ action: action, data: data })
    });
    var json = await res.json();
    if(!res.ok || json.error) throw new Error(json.error || 'Edge function error');
    return json;
  }

  /* ── Init Profile (on login) ── */
  async function initProfile(auth0User, accessToken){
    try {
      var result = await callEdge('init', {
        email: auth0User.email,
        display_name: auth0User.given_name || auth0User.name || '',
        avatar_url: auth0User.picture || '',
        username: generateUsername()
      }, accessToken);
      currentProfile = result.profile;
      cacheProfile();
      return currentProfile;
    } catch(err){
      console.warn('Profile init error:', err);
      return null;
    }
  }

  /* ── Update Profile ── */
  async function updateProfile(updates, accessToken){
    try {
      var result = await callEdge('update', updates, accessToken);
      currentProfile = result.profile;
      cacheProfile();
      return currentProfile;
    } catch(err){
      console.warn('Profile update error:', err);
      throw err;
    }
  }

  /* ── Admin: List Users ── */
  async function adminListUsers(accessToken, search, roleFilter){
    try {
      var result = await callEdge('admin-list', {
        search: search || '',
        role_filter: roleFilter || ''
      }, accessToken);
      return result.users || [];
    } catch(err){
      console.warn('Admin list error:', err);
      throw err;
    }
  }

  /* ── Admin: Update User ── */
  async function adminUpdateUser(targetAuth0Id, updates, accessToken){
    try {
      var result = await callEdge('admin-update', {
        target_auth0_id: targetAuth0Id,
        updates: updates
      }, accessToken);
      return result.profile;
    } catch(err){
      console.warn('Admin update error:', err);
      throw err;
    }
  }

  /* ── Check Username Availability ── */
  async function checkUsernameAvailable(username){
    if(!supabaseClient) return false;
    try {
      var result = await supabaseClient
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle();
      return !result.data;
    } catch(err){
      return false;
    }
  }

  /* ── Get Public Profile by Username ── */
  async function getPublicProfile(username){
    if(!supabaseClient) return null;
    try {
      var result = await supabaseClient
        .from('public_profiles')
        .select('*')
        .eq('username', username)
        .single();
      return result.data;
    } catch(err){
      return null;
    }
  }

  /* ── Cache Helpers ── */
  function cacheProfile(){
    try {
      if(currentProfile){
        sessionStorage.setItem(PROFILE_CACHE, JSON.stringify(currentProfile));
      }
    } catch(e){}
  }

  function getCachedProfile(){
    return currentProfile;
  }

  function clearCache(){
    currentProfile = null;
    try { sessionStorage.removeItem(PROFILE_CACHE); } catch(e){}
  }

  /* ── Public API ── */
  window.snProfile = {
    initProfile: initProfile,
    updateProfile: updateProfile,
    adminListUsers: adminListUsers,
    adminUpdateUser: adminUpdateUser,
    checkUsernameAvailable: checkUsernameAvailable,
    getPublicProfile: getPublicProfile,
    getCachedProfile: getCachedProfile,
    clearCache: clearCache
  };

  init();
})();
