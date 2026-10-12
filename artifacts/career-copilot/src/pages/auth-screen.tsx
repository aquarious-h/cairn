import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Compass, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import "./auth-screen.css";
import "./auth-screen-dark.css";

type AuthScreenProps = {
  onSignIn: (email: string, password: string) => void;
  onSignUp: (email: string, password: string) => void;
  busy: boolean;
  error: string;
};

export default function AuthScreen({ onSignIn, onSignUp, busy, error }: AuthScreenProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const isSignUp = mode === "signup";
  const iconSrc = `${import.meta.env.BASE_URL}cairn-icon.png`;
  const validGmail = /^[^\s@]+@gmail\.com$/i.test(email.trim());
  const canSubmit = validGmail && password.length >= 6 && !busy;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    if (isSignUp) onSignUp(email.trim(), password);
    else onSignIn(email.trim(), password);
  }

  return (
    <div className="cairn-dark-frame">
    <main className="cairn-auth" data-testid="page-auth">
      <section className="auth-story" aria-label="About Cairn Career Copilot">
        <div className="auth-story-texture" aria-hidden="true" />
        <header className="auth-brand">
          <img src={iconSrc} alt="" className="auth-brand-icon" data-testid="img-brand-icon" />
          <span className="auth-brand-name">cairn<span>.</span></span>
          <span className="auth-brand-divider" />
          <span className="auth-brand-descriptor">CAREER COPILOT</span>
        </header>

        <div className="story-content">
          <div className="story-kicker"><span /> A place to find your bearings</div>
          <h1>There’s more than<br />one way <em>forward.</em></h1>
          <p className="story-intro">
            Make room to wonder what’s next. Explore possibilities, try small things, and learn as you go.
          </p>

          <div className="trail-card" aria-label="A gentle process: notice, explore, reflect">
            <div className="trail-heading"><Compass size={15} /><span>A path, at your pace</span></div>
            <div className="trail">
              <div className="trail-stop">
                <span className="trail-marker trail-marker-first">01</span>
                <span className="trail-label">Notice what matters</span>
              </div>
              <span className="trail-line" aria-hidden="true" />
              <div className="trail-stop">
                <span className="trail-marker">02</span>
                <span className="trail-label">Explore a possibility</span>
              </div>
              <span className="trail-line" aria-hidden="true" />
              <div className="trail-stop">
                <span className="trail-marker">03</span>
                <span className="trail-label">Reflect, then choose</span>
              </div>
            </div>
            <div className="trail-footnote">No perfect answers required.</div>
          </div>
        </div>

        <footer className="story-footer">
          <span>CAREER EXPLORATION, WITHOUT THE PRESSURE</span>
          <span className="story-footer-mark">A companion for the in-between</span>
        </footer>
        <div className="story-orbit story-orbit-one" aria-hidden="true" />
        <div className="story-orbit story-orbit-two" aria-hidden="true" />
      </section>

      <section className="auth-panel">
        <div className="auth-panel-inner">
          <div className="mobile-brand">
            <img src={iconSrc} alt="" className="auth-brand-icon" />
            <span className="auth-brand-name">cairn<span>.</span></span>
          </div>
          <div className="auth-welcome">
            <div className="auth-eyebrow">{isSignUp ? "A GOOD PLACE TO BEGIN" : "WELCOME BACK"}</div>
            <h2>{isSignUp ? "Start where you are." : "Find your footing."}</h2>
            <p>{isSignUp ? "Create a space to explore what could come next." : "Your next small step is waiting when you are."}</p>
          </div>

          <div className="auth-mode" role="tablist" aria-label="Account access">
            <button
              type="button"
              role="tab"
              aria-selected={!isSignUp}
              className={!isSignUp ? "active" : ""}
              onClick={() => setMode("signin")}
              data-testid="button-mode-signin"
            >Sign in</button>
            <button
              type="button"
              role="tab"
              aria-selected={isSignUp}
              className={isSignUp ? "active" : ""}
              onClick={() => setMode("signup")}
              data-testid="button-mode-signup"
            >Create account</button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <label className="auth-field">
              <span>Email address</span>
              <span className="auth-input-wrap">
                <Mail size={17} aria-hidden="true" />
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@gmail.com"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  required
                  aria-label="Email address"
                  data-testid="input-email"
                />
              </span>
            </label>
            <label className="auth-field">
              <span>Password</span>
              <span className="auth-input-wrap">
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  required
                  minLength={6}
                  aria-label="Password"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(value => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  data-testid="button-toggle-password"
                >{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </span>
            </label>

            {email.trim().length > 0 && !validGmail && (
              <div className="auth-error" role="alert" data-testid="status-invalid-gmail">
                <span className="auth-error-mark" aria-hidden="true">!</span>
                <span>Use a Gmail address ending in @gmail.com.</span>
              </div>
            )}
            {error && (
              <div className="auth-error" role="alert" data-testid="status-auth-error">
                <span className="auth-error-mark" aria-hidden="true">!</span>
                <span>{error}</span>
              </div>
            )}

            <button className="auth-submit" type="submit" disabled={!canSubmit} data-testid="button-submit-auth">
              <span>{busy ? "One moment…" : isSignUp ? "Create my account" : "Sign in"}</span>
              {busy ? <span className="auth-submit-dots" aria-hidden="true"><i /><i /><i /></span> : <ArrowRight size={17} />}
            </button>
            <p className="auth-privacy"><ShieldCheck size={15} /> No email verification code or link is sent. A Gmail address format is required.</p>
          </form>

          <div className="auth-bottom-note">
            <span className="bottom-note-rule" />
            <p>Careers aren’t ladders. They’re landscapes.</p>
            <span className="bottom-note-caption">Take the time to look around.</span>
          </div>
        </div>
      </section>
    </main>
    </div>
  );
}
