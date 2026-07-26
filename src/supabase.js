import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://mpzchhjegcuxbgejsnab.supabase.co'
const SUPABASE_KEY = 'sb_publishable_hZVN5-uS2LVY40DY9nNSnQ_NxPd7oyx'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
