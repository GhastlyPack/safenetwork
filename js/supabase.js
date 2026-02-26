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

  /* ── Wishlist: Get User's Items ── */
  async function getWishlist(accessToken){
    try {
      var result = await callEdge('wishlist-get', {}, accessToken);
      return result.items || [];
    } catch(err){
      console.warn('Wishlist get error:', err);
      throw err;
    }
  }

  /* ── Wishlist: Add Item ── */
  async function addWishItem(data, accessToken){
    try {
      var result = await callEdge('wishlist-add', data, accessToken);
      return result.item;
    } catch(err){
      console.warn('Wishlist add error:', err);
      throw err;
    }
  }

  /* ── Wishlist: Update Item ── */
  async function updateWishItem(data, accessToken){
    try {
      var result = await callEdge('wishlist-update', data, accessToken);
      return result.item;
    } catch(err){
      console.warn('Wishlist update error:', err);
      throw err;
    }
  }

  /* ── Wishlist: Remove Item ── */
  async function removeWishItem(id, accessToken){
    try {
      var result = await callEdge('wishlist-remove', { id: id }, accessToken);
      return result.success;
    } catch(err){
      console.warn('Wishlist remove error:', err);
      throw err;
    }
  }

  /* ── Admin: List All Wishes ── */
  async function adminListWishes(accessToken, category, search){
    try {
      var result = await callEdge('admin-wishlist', {
        category: category || '',
        search: search || ''
      }, accessToken);
      return result.wishes || [];
    } catch(err){
      console.warn('Admin wishlist error:', err);
      throw err;
    }
  }

  /* ── Public Wishlist (no auth needed) ── */
  async function getPublicWishlist(username){
    try {
      var res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'public-wishlist', data: { username: username } })
      });
      var json = await res.json();
      if(!res.ok || json.error) return [];
      return json.items || [];
    } catch(err){
      console.warn('Public wishlist error:', err);
      return [];
    }
  }

  /* ── Scheduled Shows: List (no auth needed) ── */
  async function listScheduledShows(filters){
    try {
      var res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-scheduled-shows', data: filters || {} })
      });
      var json = await res.json();
      if(!res.ok || json.error) return { shows: [] };
      return json;
    } catch(err){
      console.warn('List scheduled shows error:', err);
      return { shows: [] };
    }
  }

  /* ── Scheduled Shows: Create (host/admin) ── */
  async function createScheduledShow(data, accessToken){
    try {
      var result = await callEdge('create-scheduled-show', data, accessToken);
      return result.show;
    } catch(err){
      console.warn('Create scheduled show error:', err);
      throw err;
    }
  }

  /* ── Scheduled Shows: Update (host/admin) ── */
  async function updateScheduledShow(id, updates, accessToken){
    try {
      var result = await callEdge('update-scheduled-show', { id: id, updates: updates }, accessToken);
      return result.show;
    } catch(err){
      console.warn('Update scheduled show error:', err);
      throw err;
    }
  }

  /* ── Scheduled Shows: Delete (host/admin) ── */
  async function deleteScheduledShow(id, accessToken){
    try {
      var result = await callEdge('delete-scheduled-show', { id: id }, accessToken);
      return result.success;
    } catch(err){
      console.warn('Delete scheduled show error:', err);
      throw err;
    }
  }

  /* ── List Hosts (no auth needed) ── */
  async function listHosts(){
    try {
      var res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-hosts', data: {} })
      });
      var json = await res.json();
      if(!res.ok || json.error) return [];
      return json.hosts || [];
    } catch(err){
      console.warn('List hosts error:', err);
      return [];
    }
  }

  /* ── Collection: Get User's Items ── */
  async function getCollection(accessToken){
    try {
      var result = await callEdge('collection-get', {}, accessToken);
      return result.items || [];
    } catch(err){
      console.warn('Collection get error:', err);
      throw err;
    }
  }

  /* ── Collection: Add Item ── */
  async function addCollectionItem(data, accessToken){
    try {
      var result = await callEdge('collection-add', data, accessToken);
      return result.item;
    } catch(err){
      console.warn('Collection add error:', err);
      throw err;
    }
  }

  /* ── Collection: Update Item ── */
  async function updateCollectionItem(data, accessToken){
    try {
      var result = await callEdge('collection-update', data, accessToken);
      return result.item;
    } catch(err){
      console.warn('Collection update error:', err);
      throw err;
    }
  }

  /* ── Collection: Remove Item ── */
  async function removeCollectionItem(id, accessToken){
    try {
      var result = await callEdge('collection-remove', { id: id }, accessToken);
      return result.success;
    } catch(err){
      console.warn('Collection remove error:', err);
      throw err;
    }
  }

  /* ── Collection: Upload Photo ── */
  async function uploadCollectionPhoto(itemId, base64, contentType, accessToken){
    try {
      var result = await callEdge('upload-collection-photo', {
        item_id: itemId,
        base64: base64,
        content_type: contentType
      }, accessToken);
      return result.url;
    } catch(err){
      console.warn('Collection photo upload error:', err);
      throw err;
    }
  }

  /* ── Collection: Delete Photo ── */
  async function deleteCollectionPhoto(itemId, photoUrl, accessToken){
    try {
      var result = await callEdge('delete-collection-photo', {
        item_id: itemId,
        photo_url: photoUrl
      }, accessToken);
      return result.success;
    } catch(err){
      console.warn('Collection photo delete error:', err);
      throw err;
    }
  }

  /* ── Public Collection (no auth needed) ── */
  async function getPublicCollection(username){
    try {
      var res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'public-collection', data: { username: username } })
      });
      var json = await res.json();
      if(!res.ok || json.error) return [];
      return json.items || [];
    } catch(err){
      console.warn('Public collection error:', err);
      return [];
    }
  }

  /* ── Admin: List All Collections ── */
  async function adminListCollections(accessToken, category, search){
    try {
      var result = await callEdge('admin-collections', {
        category: category || '',
        search: search || ''
      }, accessToken);
      return result.collections || [];
    } catch(err){
      console.warn('Admin collections error:', err);
      throw err;
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
    clearCache: clearCache,
    getWishlist: getWishlist,
    addWishItem: addWishItem,
    updateWishItem: updateWishItem,
    removeWishItem: removeWishItem,
    adminListWishes: adminListWishes,
    getPublicWishlist: getPublicWishlist,
    listHosts: listHosts,
    listScheduledShows: listScheduledShows,
    createScheduledShow: createScheduledShow,
    updateScheduledShow: updateScheduledShow,
    deleteScheduledShow: deleteScheduledShow,
    getCollection: getCollection,
    addCollectionItem: addCollectionItem,
    updateCollectionItem: updateCollectionItem,
    removeCollectionItem: removeCollectionItem,
    uploadCollectionPhoto: uploadCollectionPhoto,
    deleteCollectionPhoto: deleteCollectionPhoto,
    getPublicCollection: getPublicCollection,
    adminListCollections: adminListCollections
  };

  init();
})();
