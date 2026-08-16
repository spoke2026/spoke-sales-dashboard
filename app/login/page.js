'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import styles from './login.module.css'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // Already signed in → go straight to the dashboard.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) window.location.assign('/')
    })
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError('Email or password is wrong. Try again.')
      setLoading(false)
    } else {
      window.location.assign('/')
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="login-title">
        <img src="/spoke-logo-white.png" alt="Spoke" className={styles.logo} />

        <div className={styles.intro}>
          <p className={styles.eyebrow}>Sales dashboard</p>
          <h1 id="login-title" className={styles.title}>How are we tracking?</h1>
          <p className={styles.lede}>Sign in to view the team&rsquo;s live sales performance.</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form} noValidate={false}>
          <label htmlFor="email" className={styles.label}>Email</label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            className={styles.input}
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
          />

          <label htmlFor="password" className={styles.label}>Password</label>
          <input
            id="password"
            name="password"
            type="password"
            className={styles.input}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />

          {error && (
            <p className={styles.alert} role="alert">{error}</p>
          )}

          <button type="submit" className={styles.button} disabled={loading}>
            {loading ? 'Signing in' : 'Sign in'}
          </button>
        </form>

        <p className={styles.footnote}>Authorised users only.</p>
      </section>
    </main>
  )
}
