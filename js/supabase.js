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
        'apikey': SUPABASE_ANON,
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify({ action: action, data: data })
    });
    var json = await res.json();
    if(!res.ok || json.error) throw new Error(json.error || json.msg || json.message || 'Edge function error');
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
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
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
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
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
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
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
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
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

  /* ── Feed: Get Public Feed (optional auth for user_reaction) ── */
  async function getFeed(cursor, category, eventType, followingOnly){
    try {
      var headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON };
      if(window.snAuth){
        try {
          var token = await snAuth.getAccessToken();
          if(token) headers['Authorization'] = 'Bearer ' + token;
        } catch(e){}
      }
      var feedData = { cursor: cursor || null, category: category || '', event_type: eventType || '' };
      if(followingOnly) feedData.following_only = true;
      var res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ action: 'feed-get', data: feedData })
      });
      var json = await res.json();
      if(!res.ok || json.error) return { events: [], next_cursor: null, following_ids: [] };
      return json;
    } catch(err){
      console.warn('Feed get error:', err);
      return { events: [], next_cursor: null, following_ids: [] };
    }
  }

  /* ── Feed: Get Event Detail with Comments ── */
  async function getFeedEventDetail(feedEventId){
    try {
      var headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON };
      if(window.snAuth){
        try {
          var token = await snAuth.getAccessToken();
          if(token) headers['Authorization'] = 'Bearer ' + token;
        } catch(e){}
      }
      var res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ action: 'feed-event-detail', data: { feed_event_id: feedEventId } })
      });
      var json = await res.json();
      if(!res.ok || json.error) return { event: null, comments: [] };
      return json;
    } catch(err){
      console.warn('Feed event detail error:', err);
      return { event: null, comments: [] };
    }
  }

  /* ── Feed: React ── */
  async function feedReact(feedEventId, emoji, accessToken){
    try {
      var result = await callEdge('feed-react', { feed_event_id: feedEventId, emoji: emoji }, accessToken);
      return result;
    } catch(err){
      console.warn('Feed react error:', err);
      throw err;
    }
  }

  /* ── Feed: Add Comment ── */
  async function feedCommentAdd(feedEventId, body, accessToken){
    try {
      var result = await callEdge('feed-comment-add', { feed_event_id: feedEventId, body: body }, accessToken);
      return result.comment;
    } catch(err){
      console.warn('Feed comment add error:', err);
      throw err;
    }
  }

  /* ── Feed: Delete Comment ── */
  async function feedCommentDelete(commentId, accessToken){
    try {
      var result = await callEdge('feed-comment-delete', { comment_id: commentId }, accessToken);
      return result.success;
    } catch(err){
      console.warn('Feed comment delete error:', err);
      throw err;
    }
  }

  /* ── Inventory: Get Host's Items ── */
  async function getInventory(accessToken){
    try {
      var result = await callEdge('inventory-get', {}, accessToken);
      return result.items || [];
    } catch(err){
      console.warn('Inventory get error:', err);
      throw err;
    }
  }

  /* ── Inventory: Add Item ── */
  async function addInventoryItem(data, accessToken){
    try {
      var result = await callEdge('inventory-add', data, accessToken);
      return result.item;
    } catch(err){
      console.warn('Inventory add error:', err);
      throw err;
    }
  }

  /* ── Inventory: Update Item ── */
  async function updateInventoryItem(data, accessToken){
    try {
      var result = await callEdge('inventory-update', data, accessToken);
      return result.item;
    } catch(err){
      console.warn('Inventory update error:', err);
      throw err;
    }
  }

  /* ── Inventory: Remove Item ── */
  async function removeInventoryItem(id, accessToken){
    try {
      var result = await callEdge('inventory-remove', { id: id }, accessToken);
      return result.success;
    } catch(err){
      console.warn('Inventory remove error:', err);
      throw err;
    }
  }

  /* ── Inventory: Upload Photo ── */
  async function uploadInventoryPhoto(itemId, base64, contentType, accessToken){
    try {
      var result = await callEdge('upload-inventory-photo', {
        item_id: itemId,
        base64: base64,
        content_type: contentType
      }, accessToken);
      return result.url;
    } catch(err){
      console.warn('Inventory photo upload error:', err);
      throw err;
    }
  }

  /* ── Inventory: Delete Photo ── */
  async function deleteInventoryPhoto(itemId, photoUrl, accessToken){
    try {
      var result = await callEdge('delete-inventory-photo', {
        item_id: itemId,
        photo_url: photoUrl
      }, accessToken);
      return result.success;
    } catch(err){
      console.warn('Inventory photo delete error:', err);
      throw err;
    }
  }

  /* ── Admin: Delete Feed Event ── */
  async function adminDeleteFeedEvent(feedEventId, accessToken){
    try {
      var result = await callEdge('admin-feed-delete', { feed_event_id: feedEventId }, accessToken);
      return result.success;
    } catch(err){
      console.warn('Admin feed delete error:', err);
      throw err;
    }
  }

  /* ── Follow: Follow a User ── */
  async function follow(targetAuth0Id, accessToken){
    try {
      var result = await callEdge('follow', { target_auth0_id: targetAuth0Id }, accessToken);
      return result;
    } catch(err){
      console.warn('Follow error:', err);
      throw err;
    }
  }

  /* ── Follow: Unfollow a User ── */
  async function unfollow(targetAuth0Id, accessToken){
    try {
      var result = await callEdge('unfollow', { target_auth0_id: targetAuth0Id }, accessToken);
      return result;
    } catch(err){
      console.warn('Unfollow error:', err);
      throw err;
    }
  }

  /* ── Follow: Check if Following ── */
  async function isFollowing(targetAuth0Id, accessToken){
    try {
      var result = await callEdge('is-following', { target_auth0_id: targetAuth0Id }, accessToken);
      return result.following;
    } catch(err){
      console.warn('Is-following error:', err);
      return false;
    }
  }

  /* ── Follow: Get Followers (public) ── */
  async function getFollowers(username){
    try {
      var res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ action: 'get-followers', data: { username: username } })
      });
      var json = await res.json();
      if(!res.ok || json.error) return { followers: [], count: 0 };
      return json;
    } catch(err){
      console.warn('Get followers error:', err);
      return { followers: [], count: 0 };
    }
  }

  /* ── Follow: Get Following (public) ── */
  async function getFollowing(username){
    try {
      var res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ action: 'get-following', data: { username: username } })
      });
      var json = await res.json();
      if(!res.ok || json.error) return { following: [], count: 0 };
      return json;
    } catch(err){
      console.warn('Get following error:', err);
      return { following: [], count: 0 };
    }
  }

  /* ── Reactions: Toggle (authenticated) ── */
  async function toggleReaction(itemId, itemType, emoji, accessToken){
    return callEdge('toggle-reaction', {
      item_id: itemId,
      item_type: itemType,
      emoji: emoji
    }, accessToken);
  }

  /* ── Reactions: Get for Items (public with optional auth) ── */
  async function getItemReactions(itemIds, itemType, accessToken){
    try {
      var headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON };
      if(accessToken) headers['Authorization'] = 'Bearer ' + accessToken;
      var res = await fetch(EDGE_FN_URL, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ action: 'get-item-reactions', data: { item_ids: itemIds, item_type: itemType } })
      });
      var json = await res.json();
      if(!res.ok || json.error) return { reactions: {} };
      return json;
    } catch(err){
      console.warn('Get item reactions error:', err);
      return { reactions: {} };
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
    adminListCollections: adminListCollections,
    getFeed: getFeed,
    getFeedEventDetail: getFeedEventDetail,
    feedReact: feedReact,
    feedCommentAdd: feedCommentAdd,
    feedCommentDelete: feedCommentDelete,
    getInventory: getInventory,
    addInventoryItem: addInventoryItem,
    updateInventoryItem: updateInventoryItem,
    removeInventoryItem: removeInventoryItem,
    uploadInventoryPhoto: uploadInventoryPhoto,
    deleteInventoryPhoto: deleteInventoryPhoto,
    adminDeleteFeedEvent: adminDeleteFeedEvent,
    follow: follow,
    unfollow: unfollow,
    isFollowing: isFollowing,
    getFollowers: getFollowers,
    getFollowing: getFollowing,
    toggleReaction: toggleReaction,
    getItemReactions: getItemReactions
  };

  init();
})();
