import { useState, type FormEvent } from 'react'
import { AuthError, BackendUnavailableError, login, type DexUser } from '../lib/backend'

/**
 * Full-screen gate shown after the boot splash — the same credentials as
 * the Dirman Dex app. A stored session is validated by App before this
 * form is reachable again.
 */
export function LoginPage({
  onDone,
  checking,
}: {
  onDone: (user: DexUser) => void
  /** a stored token is being validated — show a busy form */
  checking?: boolean
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (working || checking) return
    setError('')
    setWorking(true)
    try {
      const auth = await login(email.trim(), password)
      onDone(auth.user)
    } catch (err) {
      if (err instanceof AuthError) setError(err.message)
      else if (err instanceof BackendUnavailableError)
        setError('Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.')
      else setError(err instanceof Error ? err.message : 'Login failed')
      setWorking(false)
    }
  }

  const busy = working || checking

  return (
    <div className="login-page">
      <div className="login-glow" aria-hidden />
      <form className="login-card glass" onSubmit={submit}>
        <div className="login-mark" aria-hidden>
          ✦
        </div>
        <h1 className="login-title">Dirman Galaxy</h1>
        <p className="login-sub">
          Peta digital Batch P3MD &amp; PFLP Sudirman.
          <br />
          Masuk dengan akun Dirman Dex-mu.
        </p>
        <label className="login-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            autoFocus={!checking}
            disabled={busy}
            placeholder="nama@dirman.id"
          />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={busy}
            placeholder="••••••••"
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary login-submit" disabled={busy}>
          {checking ? 'Checking session…' : working ? 'Signing in…' : 'Enter the galaxy'}
        </button>
      </form>
    </div>
  )
}
