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
