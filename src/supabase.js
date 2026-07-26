import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://mpzchhjegcuxbgejsnab.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wemNoaGplZ2N1eGJnZWpzbmFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTQ1MzIsImV4cCI6MjEwMDYzMDUzMn0.zBkMgYVcpJp9jbJgBaWLylmOsU_JK05INAaxzTW3zsw'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
