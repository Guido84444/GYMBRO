import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import GymBro from './app.jsx'
import Auth from './auth.jsx'
import { supabase } from './supabase.js'

function Root() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#0a0a0a",display:"flex",
      alignItems:"center",justifyContent:"center",color:"#e8ff47",
      fontSize:24,fontWeight:900}}>
      GYMBRO
    </div>
  )

  return session ? <GymBro session={session} /> : <Auth />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
