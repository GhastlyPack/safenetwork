// Supabase Edge Function: profile-sync
// Handles profile init, update, and admin operations
// Validates Auth0 tokens via /userinfo endpoint

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AUTH0_DOMAIN = 'dev-108l0dja21yjpvlf.us.auth0.com'

// ── Admin Email Rules ──
// Only @safenetwork.shop emails can be admins
// admin@safenetwork.shop is the super admin / owner
const ADMIN_EMAIL_DOMAIN = 'safenetwork.shop'
const SUPER_ADMIN_EMAIL = 'admin@safenetwork.shop'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Service role client (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE)

/* ── Validate Auth0 Token ── */
async function validateToken(authHeader: string): Promise<{ sub: string; email: string; email_verified: boolean } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null

  const token = authHeader.replace('Bearer ', '')

  try {
    const res = await fetch(`https://${AUTH0_DOMAIN}/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const user = await res.json()
    if (!user.sub || !user.email) return null
    return {
      sub: user.sub,
      email: user.email,
      email_verified: user.email_verified === true,
    }
  } catch {
    return null
  }
}

/* ── Determine Role Based on Email ── */
function determineRole(email: string, emailVerified: boolean): string {
  // Only verified @safenetwork.shop emails get admin role
  // This prevents email injection attacks
  if (!emailVerified) return 'shopper'

  const emailLower = email.toLowerCase().trim()
  if (emailLower.endsWith('@' + ADMIN_EMAIL_DOMAIN)) {
    return 'admin'
  }

  return 'shopper'
}

/* ── Check if User is Super Admin ── */
function isSuperAdmin(email: string): boolean {
  return email.toLowerCase().trim() === SUPER_ADMIN_EMAIL
}

/* ── Get Profile by Auth0 ID ── */
async function getProfileByAuth0Id(auth0Id: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth0_id', auth0Id)
    .maybeSingle()

  if (error) throw error
  return data
}

/* ── Action: Init Profile ── */
async function handleInit(auth0User: { sub: string; email: string; email_verified: boolean }, data: any) {
  // Check if profile already exists
  const existing = await getProfileByAuth0Id(auth0User.sub)
  if (existing) {
    // On each login, re-verify admin status from the VERIFIED Auth0 email
    // This ensures if someone loses @safenetwork.shop email, they lose admin
    const correctRole = determineRole(auth0User.email, auth0User.email_verified)
    if (existing.role !== correctRole) {
      // Only auto-downgrade non-super-admins, or auto-upgrade @safenetwork.shop
      // This prevents manually-promoted admins from being demoted
      const isCurrentlySNEmail = auth0User.email.toLowerCase().endsWith('@' + ADMIN_EMAIL_DOMAIN)
      if (isCurrentlySNEmail || existing.role === 'admin') {
        await supabase
          .from('profiles')
          .update({ role: correctRole, email: auth0User.email })
          .eq('auth0_id', auth0User.sub)
        existing.role = correctRole
        existing.email = auth0User.email
      }
    }
    return { profile: existing }
  }

  // Determine role from verified email - ONLY trust Auth0's verified email
  // data.email from the browser is IGNORED for role determination
  const role = determineRole(auth0User.email, auth0User.email_verified)

  // Create new profile
  const profileData = {
    auth0_id: auth0User.sub,
    email: auth0User.email, // Always use Auth0-verified email, never client-supplied
    display_name: data.display_name || '',
    avatar_url: data.avatar_url || '',
    username: data.username || ('Collector_' + generateRandomSuffix()),
    role: role,
  }

  const { data: newProfile, error } = await supabase
    .from('profiles')
    .insert(profileData)
    .select()
    .single()

  if (error) {
    // If username conflict, retry with new random username
    if (error.code === '23505' && error.message.includes('username')) {
      profileData.username = 'Collector_' + generateRandomSuffix()
      const { data: retryProfile, error: retryError } = await supabase
        .from('profiles')
        .insert(profileData)
        .select()
        .single()

      if (retryError) throw retryError
      return { profile: retryProfile }
    }
    throw error
  }

  return { profile: newProfile }
}

/* ── Action: Update Profile ── */
async function handleUpdate(auth0User: { sub: string; email: string; email_verified: boolean }, data: any) {
  // Whitelist allowed fields - NOTE: 'role' and 'email' are NOT here
  // Users CANNOT change their own role or email through this endpoint
  const allowedFields = [
    'display_name', 'username', 'whatnot_username', 'bio',
    'interests', 'profile_public', 'email_visible', 'avatar_url',
  ]

  const updates: Record<string, any> = {}
  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      updates[key] = data[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No valid fields to update')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('auth0_id', auth0User.sub)
    .select()
    .single()

  if (error) throw error
  return { profile }
}

/* ── Action: Admin List Users ── */
async function handleAdminList(auth0User: { sub: string; email: string }, data: any) {
  // Verify caller is admin
  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile || callerProfile.role !== 'admin') {
    throw new Error('Unauthorized: admin access required')
  }

  let query = supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  // Apply search filter
  if (data.search) {
    query = query.or(
      `username.ilike.%${data.search}%,email.ilike.%${data.search}%,display_name.ilike.%${data.search}%`
    )
  }

  // Apply role filter
  if (data.role_filter) {
    query = query.eq('role', data.role_filter)
  }

  const { data: users, error } = await query.limit(200)
  if (error) throw error

  return { users: users || [] }
}

/* ── Action: Admin Update User ── */
async function handleAdminUpdate(auth0User: { sub: string; email: string; email_verified: boolean }, data: any) {
  // Verify caller is admin
  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile || callerProfile.role !== 'admin') {
    throw new Error('Unauthorized: admin access required')
  }

  if (!data.target_auth0_id || !data.updates) {
    throw new Error('Missing target_auth0_id or updates')
  }

  // Get the target user's profile
  const targetProfile = await getProfileByAuth0Id(data.target_auth0_id)
  if (!targetProfile) {
    throw new Error('Target user not found')
  }

  // SECURITY: Nobody can demote the super admin
  if (targetProfile.email.toLowerCase() === SUPER_ADMIN_EMAIL && data.updates.role && data.updates.role !== 'admin') {
    throw new Error('Cannot change the super admin role')
  }

  // SECURITY: Only super admin can promote someone to admin role
  // Other admins can change roles between shopper and host, but NOT to admin
  if (data.updates.role === 'admin' && !isSuperAdmin(auth0User.email)) {
    throw new Error('Only the super admin can promote users to admin')
  }

  // SECURITY: @safenetwork.shop users always remain admin, can't be demoted via admin panel
  if (targetProfile.email.toLowerCase().endsWith('@' + ADMIN_EMAIL_DOMAIN) && data.updates.role && data.updates.role !== 'admin') {
    throw new Error('Cannot demote @safenetwork.shop users - their admin role is automatic')
  }

  // Admin-only fields
  const adminFields = ['role', 'loyalty_tier', 'loyalty_points', 'host_slug']
  const updates: Record<string, any> = {}
  for (const key of adminFields) {
    if (data.updates[key] !== undefined) {
      updates[key] = data.updates[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No valid admin fields to update')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('auth0_id', data.target_auth0_id)
    .select()
    .single()

  if (error) throw error
  return { profile }
}

/* ── Action: Get Wishlist ── */
async function handleWishlistGet(auth0User: { sub: string; email: string }) {
  const { data: items, error } = await supabase
    .from('wishlists')
    .select('*')
    .eq('auth0_id', auth0User.sub)
    .order('created_at', { ascending: false })

  if (error) throw error
  return { items: items || [] }
}

/* ── Action: Add Wish Item ── */
async function handleWishlistAdd(auth0User: { sub: string; email: string }, data: any) {
  if (!data.description || !data.description.trim()) {
    throw new Error('Description is required')
  }

  const validCategories = ['coins', 'pokemon', 'sports_cards', 'shoes']
  if (!data.category || !validCategories.includes(data.category)) {
    throw new Error('Invalid category')
  }

  // Enforce per-user limit
  const { count, error: countError } = await supabase
    .from('wishlists')
    .select('id', { count: 'exact', head: true })
    .eq('auth0_id', auth0User.sub)

  if (countError) throw countError
  if ((count || 0) >= 50) {
    throw new Error('Wishlist limit reached (50 items max)')
  }

  const { data: item, error } = await supabase
    .from('wishlists')
    .insert({
      auth0_id: auth0User.sub,
      category: data.category,
      details: data.details || {},
      description: data.description.trim().slice(0, 500),
    })
    .select()
    .single()

  if (error) throw error

  // Create feed event (non-blocking, don't fail the wishlist add)
  try {
    await createFeedEvent(
      auth0User.sub, 'wishlist', item.id, data.category,
      data.description.trim(), data.description.trim(),
      data.details || {}, []
    )
  } catch (e) { console.warn('Feed event for wishlist error:', e) }

  return { item }
}

/* ── Action: Update Wish Item ── */
async function handleWishlistUpdate(auth0User: { sub: string; email: string }, data: any) {
  if (!data.id) throw new Error('Item ID is required')

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('wishlists')
    .select('auth0_id')
    .eq('id', data.id)
    .single()

  if (fetchError || !existing) throw new Error('Item not found')
  if (existing.auth0_id !== auth0User.sub) throw new Error('Unauthorized')

  const allowedFields = ['category', 'details', 'description']
  const updates: Record<string, any> = {}
  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      updates[key] = data[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No valid fields to update')
  }

  // Validate
  if (updates.category) {
    const valid = ['coins', 'pokemon', 'sports_cards', 'shoes']
    if (!valid.includes(updates.category)) throw new Error('Invalid category')
  }
  if (updates.description !== undefined) {
    if (!updates.description.trim()) throw new Error('Description cannot be empty')
    updates.description = updates.description.trim().slice(0, 500)
  }

  const { data: item, error } = await supabase
    .from('wishlists')
    .update(updates)
    .eq('id', data.id)
    .eq('auth0_id', auth0User.sub)
    .select()
    .single()

  if (error) throw error
  return { item }
}

/* ── Action: Remove Wish Item ── */
async function handleWishlistRemove(auth0User: { sub: string; email: string }, data: any) {
  if (!data.id) throw new Error('Item ID is required')

  const { error } = await supabase
    .from('wishlists')
    .delete()
    .eq('id', data.id)
    .eq('auth0_id', auth0User.sub)

  if (error) throw error
  return { success: true }
}

/* ── Action: Admin List Wishes ── */
async function handleAdminWishlist(auth0User: { sub: string; email: string }, data: any) {
  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile || callerProfile.role !== 'admin') {
    throw new Error('Unauthorized: admin access required')
  }

  let query = supabase
    .from('wishlists')
    .select('*, profiles!inner(username, email, display_name)')
    .order('created_at', { ascending: false })

  if (data.category) {
    query = query.eq('category', data.category)
  }
  if (data.search) {
    query = query.ilike('description', `%${data.search}%`)
  }

  const { data: wishes, error } = await query.limit(500)
  if (error) throw error
  return { wishes: wishes || [] }
}

/* ── Action: List Hosts (no auth required) ── */
async function handleListHosts() {
  const { data: hosts, error } = await supabase
    .from('hosts')
    .select('*')
    .order('name')

  if (error) throw error
  return { hosts: hosts || [] }
}

/* ── Action: List Scheduled Shows (no auth required) ── */
async function handleListScheduledShows(data: any) {
  let query = supabase
    .from('scheduled_shows')
    .select('*, hosts!inner(name, slug, whatnot_handle, avatar_url)')
    .order('scheduled_at', { ascending: true })

  // Optional filter by show_type
  if (data.show_type) {
    query = query.eq('show_type', data.show_type)
  }

  // Optional filter by host
  if (data.host_slug) {
    query = query.eq('host_slug', data.host_slug)
  }

  // Default: show recent past + all future (last 7 days)
  if (!data.include_all) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('scheduled_at', weekAgo)
  }

  const { data: shows, error } = await query.limit(100)
  if (error) throw error

  // Flatten host info into each show
  const formatted = (shows || []).map((s: any) => ({
    id: s.id,
    host_slug: s.host_slug,
    host_name: s.hosts?.name || '',
    host_handle: s.hosts?.whatnot_handle || s.host_slug,
    host_avatar: s.hosts?.avatar_url || '',
    show_type: s.show_type,
    title: s.title,
    description: s.description,
    scheduled_at: s.scheduled_at,
    duration_minutes: s.duration_minutes,
    status: s.status,
    whatnot_url: s.whatnot_url,
    created_at: s.created_at,
  }))

  return { shows: formatted }
}

/* ── Action: Create Scheduled Show (host or admin) ── */
async function handleCreateScheduledShow(auth0User: { sub: string; email: string; email_verified: boolean }, data: any) {
  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile) throw new Error('Profile not found')

  const isAdmin = callerProfile.role === 'admin'
  const isHost = callerProfile.role === 'host' && callerProfile.host_slug

  if (!isAdmin && !isHost) {
    throw new Error('Unauthorized: only hosts and admins can schedule shows')
  }

  // Validate required fields
  if (!data.show_type || !data.title || !data.scheduled_at) {
    throw new Error('show_type, title, and scheduled_at are required')
  }

  const validTypes = ['coins', 'pokemon', 'sports', 'shoes']
  if (!validTypes.includes(data.show_type)) {
    throw new Error('Invalid show_type')
  }

  // Determine host_slug: admins can set any, hosts use their own
  let hostSlug = data.host_slug
  if (!isAdmin) {
    hostSlug = callerProfile.host_slug // Hosts can only schedule their own shows
  }
  if (!hostSlug) throw new Error('host_slug is required')

  const showData = {
    host_slug: hostSlug,
    show_type: data.show_type,
    title: data.title.trim().slice(0, 200),
    description: data.description ? data.description.trim().slice(0, 1000) : null,
    scheduled_at: data.scheduled_at,
    duration_minutes: data.duration_minutes || 60,
    status: 'scheduled',
    whatnot_url: data.whatnot_url || null,
    created_by: auth0User.sub,
  }

  const { data: show, error } = await supabase
    .from('scheduled_shows')
    .insert(showData)
    .select()
    .single()

  if (error) throw error
  return { show }
}

/* ── Action: Update Scheduled Show (host or admin) ── */
async function handleUpdateScheduledShow(auth0User: { sub: string; email: string; email_verified: boolean }, data: any) {
  if (!data.id) throw new Error('Show ID is required')

  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile) throw new Error('Profile not found')

  const isAdmin = callerProfile.role === 'admin'
  const isHost = callerProfile.role === 'host' && callerProfile.host_slug

  if (!isAdmin && !isHost) {
    throw new Error('Unauthorized: only hosts and admins can update shows')
  }

  // Get existing show
  const { data: existing, error: fetchErr } = await supabase
    .from('scheduled_shows')
    .select('*')
    .eq('id', data.id)
    .single()

  if (fetchErr || !existing) throw new Error('Show not found')

  // Hosts can only update their own shows
  if (!isAdmin && existing.host_slug !== callerProfile.host_slug) {
    throw new Error('Unauthorized: you can only update your own shows')
  }

  const allowedFields = ['title', 'description', 'scheduled_at', 'duration_minutes', 'status', 'whatnot_url', 'show_type']
  // Admins can also reassign host
  if (isAdmin) allowedFields.push('host_slug')

  const updates: Record<string, any> = {}
  for (const key of allowedFields) {
    if (data.updates && data.updates[key] !== undefined) {
      updates[key] = data.updates[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No valid fields to update')
  }

  // Validate status
  if (updates.status) {
    const validStatuses = ['scheduled', 'live', 'completed', 'cancelled']
    if (!validStatuses.includes(updates.status)) throw new Error('Invalid status')
  }

  const { data: show, error } = await supabase
    .from('scheduled_shows')
    .update(updates)
    .eq('id', data.id)
    .select()
    .single()

  if (error) throw error
  return { show }
}

/* ── Action: Delete Scheduled Show (host or admin) ── */
async function handleDeleteScheduledShow(auth0User: { sub: string; email: string; email_verified: boolean }, data: any) {
  if (!data.id) throw new Error('Show ID is required')

  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile) throw new Error('Profile not found')

  const isAdmin = callerProfile.role === 'admin'
  const isHost = callerProfile.role === 'host' && callerProfile.host_slug

  if (!isAdmin && !isHost) {
    throw new Error('Unauthorized')
  }

  // Verify ownership for hosts
  if (!isAdmin) {
    const { data: existing } = await supabase
      .from('scheduled_shows')
      .select('host_slug')
      .eq('id', data.id)
      .single()

    if (!existing || existing.host_slug !== callerProfile.host_slug) {
      throw new Error('Unauthorized: you can only delete your own shows')
    }
  }

  const { error } = await supabase
    .from('scheduled_shows')
    .delete()
    .eq('id', data.id)

  if (error) throw error
  return { success: true }
}

/* ── Action: Public Wishlist (no auth required) ── */
async function handlePublicWishlist(data: any) {
  if (!data.username) throw new Error('Username is required')

  // Look up profile by username, only if public
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('auth0_id, profile_public')
    .eq('username', data.username)
    .maybeSingle()

  if (profileError) throw profileError
  if (!profile) throw new Error('Collector not found')
  if (!profile.profile_public) throw new Error('This profile is private')

  // Fetch their wishlist
  const { data: items, error } = await supabase
    .from('wishlists')
    .select('id, category, details, description, created_at')
    .eq('auth0_id', profile.auth0_id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return { items: items || [] }
}

/* ── Action: Get Collection Items ── */
async function handleCollectionGet(auth0User: { sub: string; email: string }) {
  const { data: items, error } = await supabase
    .from('collections')
    .select('*')
    .eq('auth0_id', auth0User.sub)
    .order('created_at', { ascending: false })

  if (error) throw error
  return { items: items || [] }
}

/* ── Action: Add Collection Item ── */
async function handleCollectionAdd(auth0User: { sub: string; email: string }, data: any) {
  const validCategories = ['coins', 'pokemon', 'sports_cards', 'shoes']
  if (!data.category || !validCategories.includes(data.category)) {
    throw new Error('Invalid category')
  }

  // Enforce per-user limit
  const { count, error: countError } = await supabase
    .from('collections')
    .select('id', { count: 'exact', head: true })
    .eq('auth0_id', auth0User.sub)

  if (countError) throw countError
  if ((count || 0) >= 100) {
    throw new Error('Collection limit reached (100 items max)')
  }

  const { data: item, error } = await supabase
    .from('collections')
    .insert({
      auth0_id: auth0User.sub,
      category: data.category,
      details: data.details || {},
      description: data.description ? data.description.trim().slice(0, 500) : '',
      photo_urls: [],
    })
    .select()
    .single()

  if (error) throw error

  // Create feed event (photos empty at creation — uploaded separately)
  try {
    await createFeedEvent(
      auth0User.sub, 'collection', item.id, data.category,
      data.description ? data.description.trim() : '', data.description ? data.description.trim() : '',
      data.details || {}, []
    )
  } catch (e) { console.warn('Feed event for collection error:', e) }

  return { item }
}

/* ── Action: Update Collection Item ── */
async function handleCollectionUpdate(auth0User: { sub: string; email: string }, data: any) {
  if (!data.id) throw new Error('Item ID is required')

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('collections')
    .select('auth0_id')
    .eq('id', data.id)
    .single()

  if (fetchError || !existing) throw new Error('Item not found')
  if (existing.auth0_id !== auth0User.sub) throw new Error('Unauthorized')

  const allowedFields = ['category', 'details', 'description']
  const updates: Record<string, any> = {}
  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      updates[key] = data[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No valid fields to update')
  }

  // Validate
  if (updates.category) {
    const valid = ['coins', 'pokemon', 'sports_cards', 'shoes']
    if (!valid.includes(updates.category)) throw new Error('Invalid category')
  }
  if (updates.description !== undefined) {
    updates.description = updates.description.trim().slice(0, 500)
  }

  const { data: item, error } = await supabase
    .from('collections')
    .update(updates)
    .eq('id', data.id)
    .eq('auth0_id', auth0User.sub)
    .select()
    .single()

  if (error) throw error
  return { item }
}

/* ── Action: Remove Collection Item + Cleanup Photos ── */
async function handleCollectionRemove(auth0User: { sub: string; email: string }, data: any) {
  if (!data.id) throw new Error('Item ID is required')

  // Get item to find photo paths for cleanup
  const { data: existing, error: fetchError } = await supabase
    .from('collections')
    .select('auth0_id, photo_urls')
    .eq('id', data.id)
    .single()

  if (fetchError || !existing) throw new Error('Item not found')
  if (existing.auth0_id !== auth0User.sub) throw new Error('Unauthorized')

  // Delete photos from Storage
  const photos: string[] = existing.photo_urls || []
  for (const url of photos) {
    try {
      const path = extractStoragePath(url)
      if (path) {
        await supabase.storage.from('collection-photos').remove([path])
      }
    } catch (e) {
      console.warn('Photo cleanup error:', e)
    }
  }

  // Delete the item
  const { error } = await supabase
    .from('collections')
    .delete()
    .eq('id', data.id)
    .eq('auth0_id', auth0User.sub)

  if (error) throw error
  return { success: true }
}

/* ── Action: Upload Collection Photo ── */
async function handleUploadCollectionPhoto(auth0User: { sub: string; email: string }, data: any) {
  if (!data.item_id) throw new Error('item_id is required')
  if (!data.base64) throw new Error('base64 image data is required')
  if (!data.content_type) throw new Error('content_type is required')

  // Verify ownership + get current photos
  const { data: item, error: fetchError } = await supabase
    .from('collections')
    .select('auth0_id, photo_urls')
    .eq('id', data.item_id)
    .single()

  if (fetchError || !item) throw new Error('Item not found')
  if (item.auth0_id !== auth0User.sub) throw new Error('Unauthorized')

  const currentPhotos: string[] = item.photo_urls || []
  if (currentPhotos.length >= 3) {
    throw new Error('Maximum 3 photos per item')
  }

  // Decode base64
  const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0))

  // Validate size (~5MB max after decode)
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error('Photo exceeds 5MB limit')
  }

  // Upload to Storage
  const timestamp = Date.now()
  const ext = data.content_type === 'image/png' ? 'png' : 'jpg'
  const storagePath = `${auth0User.sub}/${data.item_id}/${timestamp}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('collection-photos')
    .upload(storagePath, bytes, {
      contentType: data.content_type,
      upsert: false,
    })

  if (uploadError) throw new Error('Upload failed: ' + uploadError.message)

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('collection-photos')
    .getPublicUrl(storagePath)

  const publicUrl = urlData.publicUrl

  // Append URL to item's photo_urls
  currentPhotos.push(publicUrl)
  const { error: updateError } = await supabase
    .from('collections')
    .update({ photo_urls: currentPhotos })
    .eq('id', data.item_id)
    .eq('auth0_id', auth0User.sub)

  if (updateError) throw updateError
  return { url: publicUrl }
}

/* ── Action: Delete Collection Photo ── */
async function handleDeleteCollectionPhoto(auth0User: { sub: string; email: string }, data: any) {
  if (!data.item_id) throw new Error('item_id is required')
  if (!data.photo_url) throw new Error('photo_url is required')

  // Verify ownership
  const { data: item, error: fetchError } = await supabase
    .from('collections')
    .select('auth0_id, photo_urls')
    .eq('id', data.item_id)
    .single()

  if (fetchError || !item) throw new Error('Item not found')
  if (item.auth0_id !== auth0User.sub) throw new Error('Unauthorized')

  // Remove URL from array
  const currentPhotos: string[] = item.photo_urls || []
  const filtered = currentPhotos.filter((u: string) => u !== data.photo_url)

  // Update item
  const { error: updateError } = await supabase
    .from('collections')
    .update({ photo_urls: filtered })
    .eq('id', data.item_id)
    .eq('auth0_id', auth0User.sub)

  if (updateError) throw updateError

  // Remove file from Storage
  try {
    const path = extractStoragePath(data.photo_url)
    if (path) {
      await supabase.storage.from('collection-photos').remove([path])
    }
  } catch (e) {
    console.warn('Storage cleanup error:', e)
  }

  return { success: true }
}

/* ── Action: Public Collection (no auth required) ── */
async function handlePublicCollection(data: any) {
  if (!data.username) throw new Error('Username is required')

  // Look up profile by username, only if public
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('auth0_id, profile_public')
    .eq('username', data.username)
    .maybeSingle()

  if (profileError) throw profileError
  if (!profile) throw new Error('Collector not found')
  if (!profile.profile_public) throw new Error('This profile is private')

  // Fetch their collection
  const { data: items, error } = await supabase
    .from('collections')
    .select('id, category, details, description, photo_urls, created_at')
    .eq('auth0_id', profile.auth0_id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error
  return { items: items || [] }
}

/* ── Action: Admin List Collections ── */
async function handleAdminCollections(auth0User: { sub: string; email: string }, data: any) {
  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile || callerProfile.role !== 'admin') {
    throw new Error('Unauthorized: admin access required')
  }

  let query = supabase
    .from('collections')
    .select('*, profiles!inner(username, email, display_name)')
    .order('created_at', { ascending: false })

  if (data.category) {
    query = query.eq('category', data.category)
  }
  if (data.search) {
    query = query.ilike('description', `%${data.search}%`)
  }

  const { data: collections, error } = await query.limit(500)
  if (error) throw error
  return { collections: collections || [] }
}

/* ── Helper: Extract Storage Path from Public URL ── */
function extractStoragePath(publicUrl: string, bucket: string = 'collection-photos'): string | null {
  const marker = `/${bucket}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  return publicUrl.slice(idx + marker.length)
}

/* ══════════════════════════════════════════════
   FEED EVENT CREATION HELPER
   ══════════════════════════════════════════════ */

async function createFeedEvent(
  auth0Id: string,
  eventType: string,
  sourceId: string,
  category: string,
  title: string,
  description: string,
  details: any,
  photoUrls: string[],
  hostSlug?: string,
  hostName?: string
) {
  // Fetch profile for denormalized author info
  const profile = await getProfileByAuth0Id(auth0Id)
  if (!profile) return null
  // Skip feed event if user profile is private
  if (profile.profile_public === false) return null

  const eventData: any = {
    event_type: eventType,
    source_id: sourceId,
    auth0_id: auth0Id,
    category: category,
    title: (title || '').slice(0, 80),
    description: (description || '').slice(0, 500),
    details: details || {},
    photo_urls: photoUrls || [],
    author_username: profile.username || '',
    author_display_name: profile.display_name || '',
    author_avatar_url: profile.avatar_url || '',
    author_role: profile.role || 'shopper',
  }

  if (hostSlug) eventData.host_slug = hostSlug
  if (hostName) eventData.host_name = hostName

  const { data: feedEvent, error } = await supabase
    .from('feed_events')
    .insert(eventData)
    .select()
    .single()

  if (error) {
    console.warn('Feed event creation error:', error)
    return null
  }
  return feedEvent
}

/* ══════════════════════════════════════════════
   INVENTORY HANDLERS
   ══════════════════════════════════════════════ */

/* ── Action: Get Host Inventory ── */
async function handleInventoryGet(auth0User: { sub: string; email: string }) {
  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile) throw new Error('Profile not found')

  const isAdmin = callerProfile.role === 'admin'
  const isHost = callerProfile.role === 'host' && callerProfile.host_slug

  if (!isAdmin && !isHost) {
    throw new Error('Unauthorized: only hosts and admins can view inventory')
  }

  let query = supabase
    .from('host_inventory')
    .select('*')
    .order('created_at', { ascending: false })

  // Hosts see only their own, admins see all
  if (!isAdmin) {
    query = query.eq('host_slug', callerProfile.host_slug)
  }

  const { data: items, error } = await query
  if (error) throw error
  return { items: items || [] }
}

/* ── Action: Add Inventory Item ── */
async function handleInventoryAdd(auth0User: { sub: string; email: string }, data: any) {
  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile) throw new Error('Profile not found')

  const isAdmin = callerProfile.role === 'admin'
  const isHost = callerProfile.role === 'host' && callerProfile.host_slug

  if (!isAdmin && !isHost) {
    throw new Error('Unauthorized: only hosts and admins can add inventory')
  }

  if (!data.title || !data.title.trim()) {
    throw new Error('Title is required')
  }

  const validCategories = ['coins', 'pokemon', 'sports_cards', 'shoes']
  if (!data.category || !validCategories.includes(data.category)) {
    throw new Error('Invalid category')
  }

  // Determine host_slug
  let hostSlug = data.host_slug
  if (!isAdmin) {
    hostSlug = callerProfile.host_slug
  }
  if (!hostSlug) throw new Error('host_slug is required')

  // Get host name for feed event
  const { data: hostRecord } = await supabase
    .from('hosts')
    .select('name')
    .eq('slug', hostSlug)
    .maybeSingle()

  const { data: item, error } = await supabase
    .from('host_inventory')
    .insert({
      host_slug: hostSlug,
      auth0_id: auth0User.sub,
      category: data.category,
      title: data.title.trim().slice(0, 200),
      description: data.description ? data.description.trim().slice(0, 500) : '',
      details: data.details || {},
      photo_urls: [],
      price_range: data.price_range || '',
      quantity: data.quantity || 1,
      status: 'available',
    })
    .select()
    .single()

  if (error) throw error

  // Create feed event
  await createFeedEvent(
    auth0User.sub,
    'inventory',
    item.id,
    data.category,
    data.title.trim(),
    data.description ? data.description.trim() : '',
    data.details || {},
    [],
    hostSlug,
    hostRecord?.name || hostSlug
  )

  return { item }
}

/* ── Action: Update Inventory Item ── */
async function handleInventoryUpdate(auth0User: { sub: string; email: string }, data: any) {
  if (!data.id) throw new Error('Item ID is required')

  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile) throw new Error('Profile not found')

  const isAdmin = callerProfile.role === 'admin'

  // Get existing item
  const { data: existing, error: fetchError } = await supabase
    .from('host_inventory')
    .select('*')
    .eq('id', data.id)
    .single()

  if (fetchError || !existing) throw new Error('Item not found')

  // Ownership check: host can only update own inventory
  if (!isAdmin && existing.auth0_id !== auth0User.sub) {
    throw new Error('Unauthorized')
  }

  const allowedFields = ['title', 'description', 'details', 'category', 'price_range', 'quantity', 'status']
  const updates: Record<string, any> = {}
  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      updates[key] = data[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No valid fields to update')
  }

  // Validate
  if (updates.category) {
    const valid = ['coins', 'pokemon', 'sports_cards', 'shoes']
    if (!valid.includes(updates.category)) throw new Error('Invalid category')
  }
  if (updates.status) {
    const validStatuses = ['available', 'sold', 'reserved']
    if (!validStatuses.includes(updates.status)) throw new Error('Invalid status')
  }
  if (updates.title !== undefined) {
    if (!updates.title.trim()) throw new Error('Title cannot be empty')
    updates.title = updates.title.trim().slice(0, 200)
  }
  if (updates.description !== undefined) {
    updates.description = updates.description.trim().slice(0, 500)
  }

  const { data: item, error } = await supabase
    .from('host_inventory')
    .update(updates)
    .eq('id', data.id)
    .select()
    .single()

  if (error) throw error
  return { item }
}

/* ── Action: Remove Inventory Item + Cleanup Photos ── */
async function handleInventoryRemove(auth0User: { sub: string; email: string }, data: any) {
  if (!data.id) throw new Error('Item ID is required')

  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile) throw new Error('Profile not found')

  const isAdmin = callerProfile.role === 'admin'

  const { data: existing, error: fetchError } = await supabase
    .from('host_inventory')
    .select('auth0_id, photo_urls')
    .eq('id', data.id)
    .single()

  if (fetchError || !existing) throw new Error('Item not found')
  if (!isAdmin && existing.auth0_id !== auth0User.sub) throw new Error('Unauthorized')

  // Delete photos from Storage
  const photos: string[] = existing.photo_urls || []
  for (const url of photos) {
    try {
      const path = extractStoragePath(url, 'inventory-photos')
      if (path) {
        await supabase.storage.from('inventory-photos').remove([path])
      }
    } catch (e) {
      console.warn('Inventory photo cleanup error:', e)
    }
  }

  const { error } = await supabase
    .from('host_inventory')
    .delete()
    .eq('id', data.id)

  if (error) throw error
  return { success: true }
}

/* ── Action: Upload Inventory Photo ── */
async function handleUploadInventoryPhoto(auth0User: { sub: string; email: string }, data: any) {
  if (!data.item_id) throw new Error('item_id is required')
  if (!data.base64) throw new Error('base64 image data is required')
  if (!data.content_type) throw new Error('content_type is required')

  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile) throw new Error('Profile not found')

  const isAdmin = callerProfile.role === 'admin'

  const { data: item, error: fetchError } = await supabase
    .from('host_inventory')
    .select('auth0_id, photo_urls')
    .eq('id', data.item_id)
    .single()

  if (fetchError || !item) throw new Error('Item not found')
  if (!isAdmin && item.auth0_id !== auth0User.sub) throw new Error('Unauthorized')

  const currentPhotos: string[] = item.photo_urls || []
  if (currentPhotos.length >= 5) {
    throw new Error('Maximum 5 photos per inventory item')
  }

  const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0))
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error('Photo exceeds 5MB limit')
  }

  const timestamp = Date.now()
  const ext = data.content_type === 'image/png' ? 'png' : 'jpg'
  const storagePath = `${auth0User.sub}/${data.item_id}/${timestamp}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('inventory-photos')
    .upload(storagePath, bytes, {
      contentType: data.content_type,
      upsert: false,
    })

  if (uploadError) throw new Error('Upload failed: ' + uploadError.message)

  const { data: urlData } = supabase.storage
    .from('inventory-photos')
    .getPublicUrl(storagePath)

  const publicUrl = urlData.publicUrl

  currentPhotos.push(publicUrl)
  const { error: updateError } = await supabase
    .from('host_inventory')
    .update({ photo_urls: currentPhotos })
    .eq('id', data.item_id)

  if (updateError) throw updateError
  return { url: publicUrl }
}

/* ── Action: Delete Inventory Photo ── */
async function handleDeleteInventoryPhoto(auth0User: { sub: string; email: string }, data: any) {
  if (!data.item_id) throw new Error('item_id is required')
  if (!data.photo_url) throw new Error('photo_url is required')

  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile) throw new Error('Profile not found')

  const isAdmin = callerProfile.role === 'admin'

  const { data: item, error: fetchError } = await supabase
    .from('host_inventory')
    .select('auth0_id, photo_urls')
    .eq('id', data.item_id)
    .single()

  if (fetchError || !item) throw new Error('Item not found')
  if (!isAdmin && item.auth0_id !== auth0User.sub) throw new Error('Unauthorized')

  const currentPhotos: string[] = item.photo_urls || []
  const filtered = currentPhotos.filter((u: string) => u !== data.photo_url)

  const { error: updateError } = await supabase
    .from('host_inventory')
    .update({ photo_urls: filtered })
    .eq('id', data.item_id)

  if (updateError) throw updateError

  try {
    const path = extractStoragePath(data.photo_url, 'inventory-photos')
    if (path) {
      await supabase.storage.from('inventory-photos').remove([path])
    }
  } catch (e) {
    console.warn('Inventory storage cleanup error:', e)
  }

  return { success: true }
}

/* ══════════════════════════════════════════════
   FEED HANDLERS
   ══════════════════════════════════════════════ */

/* ── Action: Get Feed (public, optional auth) ── */
async function handleFeedGet(data: any, auth0User: any) {
  const PAGE_SIZE = 20

  // If following_only, get the list of auth0_ids the user follows
  let followingAuth0Ids: string[] = []
  if (data.following_only && auth0User) {
    const { data: follows } = await supabase
      .from('follows')
      .select('following_auth0_id')
      .eq('follower_auth0_id', auth0User.sub)

    followingAuth0Ids = (follows || []).map((f: any) => f.following_auth0_id)

    // If user follows nobody, return empty
    if (followingAuth0Ids.length === 0) {
      return { events: [], next_cursor: null, following_ids: [] }
    }
  }

  let query = supabase
    .from('feed_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE + 1)

  if (data.cursor) {
    query = query.lt('created_at', data.cursor)
  }
  if (data.category) {
    query = query.eq('category', data.category)
  }
  if (data.event_type) {
    query = query.eq('event_type', data.event_type)
  }

  // Filter to only followed users' posts
  if (data.following_only && followingAuth0Ids.length > 0) {
    query = query.in('auth0_id', followingAuth0Ids)
  }

  const { data: events, error } = await query
  if (error) throw error

  const items = (events || []).slice(0, PAGE_SIZE)
  const hasMore = (events || []).length > PAGE_SIZE
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].created_at : null

  // If authenticated, fetch user's reactions for these events
  let userReactions: Record<string, string> = {}
  if (auth0User && items.length > 0) {
    const eventIds = items.map((e: any) => e.id)
    const { data: reactions } = await supabase
      .from('feed_reactions')
      .select('feed_event_id, emoji')
      .eq('auth0_id', auth0User.sub)
      .in('feed_event_id', eventIds)

    for (const r of (reactions || [])) {
      userReactions[r.feed_event_id] = r.emoji
    }
  }

  // Also return the set of auth0_ids the current user follows (among feed result authors)
  // so the client can render Follow/Following buttons without extra API calls
  let followingIds: string[] = []
  if (auth0User && items.length > 0) {
    // If we already fetched following list for filter, reuse it
    if (followingAuth0Ids.length > 0) {
      followingIds = followingAuth0Ids
    } else {
      const authorIds = [...new Set(items.map((e: any) => e.auth0_id).filter(Boolean))]
      if (authorIds.length > 0) {
        const { data: followRows } = await supabase
          .from('follows')
          .select('following_auth0_id')
          .eq('follower_auth0_id', auth0User.sub)
          .in('following_auth0_id', authorIds)

        followingIds = (followRows || []).map((f: any) => f.following_auth0_id)
      }
    }
  }

  const formatted = items.map((e: any) => ({
    ...e,
    user_reaction: userReactions[e.id] || null,
  }))

  return { events: formatted, next_cursor: nextCursor, following_ids: followingIds }
}

/* ── Action: Feed Event Detail (public, optional auth) ── */
async function handleFeedEventDetail(data: any, auth0User: any) {
  if (!data.feed_event_id) throw new Error('feed_event_id is required')

  const { data: event, error: eventError } = await supabase
    .from('feed_events')
    .select('*')
    .eq('id', data.feed_event_id)
    .single()

  if (eventError || !event) throw new Error('Feed event not found')

  // Get comments
  const { data: comments, error: commentsError } = await supabase
    .from('feed_comments')
    .select('*')
    .eq('feed_event_id', data.feed_event_id)
    .order('created_at', { ascending: true })
    .limit(100)

  if (commentsError) throw commentsError

  // User's reaction
  let userReaction = null
  if (auth0User) {
    const { data: reaction } = await supabase
      .from('feed_reactions')
      .select('emoji')
      .eq('feed_event_id', data.feed_event_id)
      .eq('auth0_id', auth0User.sub)
      .maybeSingle()

    if (reaction) userReaction = reaction.emoji
  }

  return {
    event: { ...event, user_reaction: userReaction },
    comments: comments || [],
  }
}

/* ── Action: React to Feed Event ── */
async function handleFeedReact(auth0User: { sub: string; email: string }, data: any) {
  if (!data.feed_event_id || !data.emoji) throw new Error('feed_event_id and emoji required')

  const validEmojis = ['fire', 'heart', 'eyes', 'raised_hands', 'money', 'dart']
  if (!validEmojis.includes(data.emoji)) throw new Error('Invalid emoji')

  // Verify event exists
  const { data: event, error: eventErr } = await supabase
    .from('feed_events')
    .select('id, reaction_counts')
    .eq('id', data.feed_event_id)
    .single()

  if (eventErr || !event) throw new Error('Feed event not found')

  // Check if user already has a reaction
  const { data: existing } = await supabase
    .from('feed_reactions')
    .select('id, emoji')
    .eq('feed_event_id', data.feed_event_id)
    .eq('auth0_id', auth0User.sub)
    .maybeSingle()

  const counts = event.reaction_counts || { fire: 0, heart: 0, eyes: 0, raised_hands: 0, money: 0, dart: 0 }

  if (existing) {
    if (existing.emoji === data.emoji) {
      // Toggle off: remove reaction
      await supabase.from('feed_reactions').delete().eq('id', existing.id)
      counts[existing.emoji] = Math.max(0, (counts[existing.emoji] || 0) - 1)
      await supabase.from('feed_events').update({ reaction_counts: counts }).eq('id', data.feed_event_id)
      return { reaction_counts: counts, user_reaction: null }
    } else {
      // Switch emoji
      await supabase.from('feed_reactions').update({ emoji: data.emoji }).eq('id', existing.id)
      counts[existing.emoji] = Math.max(0, (counts[existing.emoji] || 0) - 1)
      counts[data.emoji] = (counts[data.emoji] || 0) + 1
      await supabase.from('feed_events').update({ reaction_counts: counts }).eq('id', data.feed_event_id)
      return { reaction_counts: counts, user_reaction: data.emoji }
    }
  } else {
    // New reaction
    await supabase.from('feed_reactions').insert({
      feed_event_id: data.feed_event_id,
      auth0_id: auth0User.sub,
      emoji: data.emoji,
    })
    counts[data.emoji] = (counts[data.emoji] || 0) + 1
    await supabase.from('feed_events').update({ reaction_counts: counts }).eq('id', data.feed_event_id)
    return { reaction_counts: counts, user_reaction: data.emoji }
  }
}

/* ── Action: Add Comment to Feed Event ── */
async function handleFeedCommentAdd(auth0User: { sub: string; email: string }, data: any) {
  if (!data.feed_event_id) throw new Error('feed_event_id is required')
  if (!data.body || !data.body.trim()) throw new Error('Comment body is required')

  // Verify event exists
  const { data: event, error: eventErr } = await supabase
    .from('feed_events')
    .select('id, comment_count')
    .eq('id', data.feed_event_id)
    .single()

  if (eventErr || !event) throw new Error('Feed event not found')

  // Limit comments per event
  if ((event.comment_count || 0) >= 100) {
    throw new Error('Comment limit reached (100 per item)')
  }

  // Get commenter profile for denormalized info
  const profile = await getProfileByAuth0Id(auth0User.sub)

  const { data: comment, error } = await supabase
    .from('feed_comments')
    .insert({
      feed_event_id: data.feed_event_id,
      auth0_id: auth0User.sub,
      body: data.body.trim().slice(0, 500),
      author_username: profile?.username || '',
      author_display_name: profile?.display_name || '',
      author_avatar_url: profile?.avatar_url || '',
    })
    .select()
    .single()

  if (error) throw error

  // Increment comment count
  await supabase
    .from('feed_events')
    .update({ comment_count: (event.comment_count || 0) + 1 })
    .eq('id', data.feed_event_id)

  return { comment }
}

/* ── Action: Delete Comment ── */
async function handleFeedCommentDelete(auth0User: { sub: string; email: string }, data: any) {
  if (!data.comment_id) throw new Error('comment_id is required')

  // Get comment
  const { data: comment, error: fetchError } = await supabase
    .from('feed_comments')
    .select('id, feed_event_id, auth0_id')
    .eq('id', data.comment_id)
    .single()

  if (fetchError || !comment) throw new Error('Comment not found')

  // Check permission: own comment or admin
  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  const isAdmin = callerProfile?.role === 'admin'

  if (comment.auth0_id !== auth0User.sub && !isAdmin) {
    throw new Error('Unauthorized: you can only delete your own comments')
  }

  // Delete comment
  const { error } = await supabase
    .from('feed_comments')
    .delete()
    .eq('id', data.comment_id)

  if (error) throw error

  // Decrement comment count
  const { data: event } = await supabase
    .from('feed_events')
    .select('comment_count')
    .eq('id', comment.feed_event_id)
    .single()

  if (event) {
    await supabase
      .from('feed_events')
      .update({ comment_count: Math.max(0, (event.comment_count || 0) - 1) })
      .eq('id', comment.feed_event_id)
  }

  return { success: true }
}

/* ── Action: Admin Delete Feed Event ── */
async function handleAdminFeedDelete(auth0User: { sub: string; email: string }, data: any) {
  if (!data.feed_event_id) throw new Error('feed_event_id is required')

  const callerProfile = await getProfileByAuth0Id(auth0User.sub)
  if (!callerProfile || callerProfile.role !== 'admin') {
    throw new Error('Unauthorized: admin access required')
  }

  // CASCADE will auto-delete reactions and comments
  const { error } = await supabase
    .from('feed_events')
    .delete()
    .eq('id', data.feed_event_id)

  if (error) throw error
  return { success: true }
}

/* ══════════════════════════════════════════════
   FOLLOW / UNFOLLOW HANDLERS
   ══════════════════════════════════════════════ */

/* ── Action: Follow a User ── */
async function handleFollow(auth0User: { sub: string; email: string }, data: any) {
  if (!data.target_auth0_id) throw new Error('target_auth0_id is required')
  if (data.target_auth0_id === auth0User.sub) throw new Error('You cannot follow yourself')

  // Check target exists
  const target = await getProfileByAuth0Id(data.target_auth0_id)
  if (!target) throw new Error('Target user not found')

  // Insert follow (ignore conflict = already following)
  const { error } = await supabase
    .from('follows')
    .upsert({
      follower_auth0_id: auth0User.sub,
      following_auth0_id: data.target_auth0_id,
    }, { onConflict: 'follower_auth0_id,following_auth0_id' })

  if (error) throw error

  // Increment counts (use RPC-style atomic update)
  await supabase
    .from('profiles')
    .update({ following_count: (await getProfileByAuth0Id(auth0User.sub))?.following_count + 1 || 1 })
    .eq('auth0_id', auth0User.sub)

  await supabase
    .from('profiles')
    .update({ follower_count: (target.follower_count || 0) + 1 })
    .eq('auth0_id', data.target_auth0_id)

  return { success: true }
}

/* ── Action: Unfollow a User ── */
async function handleUnfollow(auth0User: { sub: string; email: string }, data: any) {
  if (!data.target_auth0_id) throw new Error('target_auth0_id is required')

  // Check the follow exists
  const { data: existing } = await supabase
    .from('follows')
    .select('id')
    .eq('follower_auth0_id', auth0User.sub)
    .eq('following_auth0_id', data.target_auth0_id)
    .maybeSingle()

  if (!existing) return { success: true } // not following, no-op

  // Delete follow
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_auth0_id', auth0User.sub)
    .eq('following_auth0_id', data.target_auth0_id)

  if (error) throw error

  // Decrement counts
  const caller = await getProfileByAuth0Id(auth0User.sub)
  const target = await getProfileByAuth0Id(data.target_auth0_id)

  if (caller) {
    await supabase
      .from('profiles')
      .update({ following_count: Math.max(0, (caller.following_count || 0) - 1) })
      .eq('auth0_id', auth0User.sub)
  }

  if (target) {
    await supabase
      .from('profiles')
      .update({ follower_count: Math.max(0, (target.follower_count || 0) - 1) })
      .eq('auth0_id', data.target_auth0_id)
  }

  return { success: true }
}

/* ── Action: Check if Following ── */
async function handleIsFollowing(auth0User: { sub: string; email: string }, data: any) {
  if (!data.target_auth0_id) throw new Error('target_auth0_id is required')

  const { data: existing } = await supabase
    .from('follows')
    .select('id')
    .eq('follower_auth0_id', auth0User.sub)
    .eq('following_auth0_id', data.target_auth0_id)
    .maybeSingle()

  return { following: !!existing }
}

/* ── Action: Get Followers (public) ── */
async function handleGetFollowers(data: any) {
  if (!data.username) throw new Error('username is required')

  // Look up auth0_id by username
  const { data: profile } = await supabase
    .from('profiles')
    .select('auth0_id, follower_count')
    .eq('username', data.username)
    .maybeSingle()

  if (!profile) throw new Error('User not found')

  const { data: follows, error } = await supabase
    .from('follows')
    .select('follower_auth0_id, created_at')
    .eq('following_auth0_id', profile.auth0_id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw error

  // Get follower profiles
  const followerIds = (follows || []).map((f: any) => f.follower_auth0_id)
  let followers: any[] = []

  if (followerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('auth0_id, username, display_name, avatar_url, role')
      .in('auth0_id', followerIds)
      .eq('profile_public', true)

    followers = profiles || []
  }

  return { followers, count: profile.follower_count || 0, auth0_id: profile.auth0_id }
}

/* ── Action: Get Following (public) ── */
async function handleGetFollowing(data: any) {
  if (!data.username) throw new Error('username is required')

  // Look up auth0_id by username
  const { data: profile } = await supabase
    .from('profiles')
    .select('auth0_id, following_count')
    .eq('username', data.username)
    .maybeSingle()

  if (!profile) throw new Error('User not found')

  const { data: follows, error } = await supabase
    .from('follows')
    .select('following_auth0_id, created_at')
    .eq('follower_auth0_id', profile.auth0_id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw error

  // Get following profiles
  const followingIds = (follows || []).map((f: any) => f.following_auth0_id)
  let following: any[] = []

  if (followingIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('auth0_id, username, display_name, avatar_url, role')
      .in('auth0_id', followingIds)
      .eq('profile_public', true)

    following = profiles || []
  }

  return { following, count: profile.following_count || 0, auth0_id: profile.auth0_id }
}

/* ── Helper: Random Suffix ── */
function generateRandomSuffix(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/* ── Main Handler ── */
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request body
    const body = await req.json()
    const { action, data } = body

    let result: any

    // ── Public actions (no auth required) ──
    if (action === 'public-wishlist') {
      result = await handlePublicWishlist(data || {})
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'list-hosts') {
      result = await handleListHosts()
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'list-scheduled-shows') {
      result = await handleListScheduledShows(data || {})
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'public-collection') {
      result = await handlePublicCollection(data || {})
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'get-followers') {
      result = await handleGetFollowers(data || {})
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'get-following') {
      result = await handleGetFollowing(data || {})
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Feed: public with optional auth ──
    if (action === 'feed-get' || action === 'feed-event-detail') {
      let auth0User = null
      const feedAuthHeader = req.headers.get('Authorization') || ''
      if (feedAuthHeader.startsWith('Bearer ')) {
        auth0User = await validateToken(feedAuthHeader)
      }
      if (action === 'feed-get') {
        result = await handleFeedGet(data || {}, auth0User)
      } else {
        result = await handleFeedEventDetail(data || {}, auth0User)
      }
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── Authenticated actions ──
    const authHeader = req.headers.get('Authorization') || ''
    const auth0User = await validateToken(authHeader)
    if (!auth0User) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    switch (action) {
      case 'init':
        result = await handleInit(auth0User, data || {})
        break
      case 'update':
        result = await handleUpdate(auth0User, data || {})
        break
      case 'admin-list':
        result = await handleAdminList(auth0User, data || {})
        break
      case 'admin-update':
        result = await handleAdminUpdate(auth0User, data || {})
        break
      case 'wishlist-get':
        result = await handleWishlistGet(auth0User)
        break
      case 'wishlist-add':
        result = await handleWishlistAdd(auth0User, data || {})
        break
      case 'wishlist-update':
        result = await handleWishlistUpdate(auth0User, data || {})
        break
      case 'wishlist-remove':
        result = await handleWishlistRemove(auth0User, data || {})
        break
      case 'admin-wishlist':
        result = await handleAdminWishlist(auth0User, data || {})
        break
      case 'create-scheduled-show':
        result = await handleCreateScheduledShow(auth0User, data || {})
        break
      case 'update-scheduled-show':
        result = await handleUpdateScheduledShow(auth0User, data || {})
        break
      case 'delete-scheduled-show':
        result = await handleDeleteScheduledShow(auth0User, data || {})
        break
      case 'collection-get':
        result = await handleCollectionGet(auth0User)
        break
      case 'collection-add':
        result = await handleCollectionAdd(auth0User, data || {})
        break
      case 'collection-update':
        result = await handleCollectionUpdate(auth0User, data || {})
        break
      case 'collection-remove':
        result = await handleCollectionRemove(auth0User, data || {})
        break
      case 'upload-collection-photo':
        result = await handleUploadCollectionPhoto(auth0User, data || {})
        break
      case 'delete-collection-photo':
        result = await handleDeleteCollectionPhoto(auth0User, data || {})
        break
      case 'admin-collections':
        result = await handleAdminCollections(auth0User, data || {})
        break
      case 'feed-react':
        result = await handleFeedReact(auth0User, data || {})
        break
      case 'feed-comment-add':
        result = await handleFeedCommentAdd(auth0User, data || {})
        break
      case 'feed-comment-delete':
        result = await handleFeedCommentDelete(auth0User, data || {})
        break
      case 'inventory-get':
        result = await handleInventoryGet(auth0User)
        break
      case 'inventory-add':
        result = await handleInventoryAdd(auth0User, data || {})
        break
      case 'inventory-update':
        result = await handleInventoryUpdate(auth0User, data || {})
        break
      case 'inventory-remove':
        result = await handleInventoryRemove(auth0User, data || {})
        break
      case 'upload-inventory-photo':
        result = await handleUploadInventoryPhoto(auth0User, data || {})
        break
      case 'delete-inventory-photo':
        result = await handleDeleteInventoryPhoto(auth0User, data || {})
        break
      case 'admin-feed-delete':
        result = await handleAdminFeedDelete(auth0User, data || {})
        break
      case 'follow':
        result = await handleFollow(auth0User, data || {})
        break
      case 'unfollow':
        result = await handleUnfollow(auth0User, data || {})
        break
      case 'is-following':
        result = await handleIsFollowing(auth0User, data || {})
        break
      default:
        throw new Error('Unknown action: ' + action)
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('Edge function error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
