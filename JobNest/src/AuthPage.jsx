import { useEffect, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, Sparkles } from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

function AuthPage({ mode }) {
  const isSignUp = mode === "signup";
  const isReset = mode === "reset";
  const isUpdate = mode === "update";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    document.title = isSignUp
      ? "Create your account — JobNest"
      : isReset
        ? "Reset password — JobNest"
        : isUpdate
          ? "Choose a new password — JobNest"
          : "Sign in — JobNest";
    if (!supabase || isReset || isUpdate) return undefined;

    let isMounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error("Unable to check the current session:", error.message);
        return;
      }
      if (isMounted && data.session) window.location.replace("/");
    });

    return () => {
      isMounted = false;
    };
  }, [isSignUp, isReset, isUpdate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!supabase) {
      setErrorMessage("Authentication is not configured yet. Add your Supabase URL and anon key to the environment.");
      return;
    }

    if (isUpdate && password !== confirmPassword) {
      setErrorMessage("The passwords don't match.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isReset) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/update-password`,
        });
        if (error) throw error;
        setSuccessMessage("If an account exists for that email, you'll receive a password reset link shortly.");
      } else if (isUpdate) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setSuccessMessage("Your password has been updated. You can now continue to JobNest.");
      } else if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;

        if (data.session) {
          window.location.assign("/");
          return;
        }
        setSuccessMessage("Account created. Check your email for a confirmation link, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        window.location.assign("/");
        return;
      }
    } catch (error) {
      console.error(`Unable to ${isSignUp ? "create account" : "sign in"}:`, error.message);
      setErrorMessage(error.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="JobNest">
        <a className="brand auth-brand" href="/" aria-label="JobNest home">
          <span className="brand-mark"><Sparkles size={19} /></span>
          <span>job<span className="brand-accent">nest</span></span>
        </a>
        <div className="auth-story-copy">
          <div className="eyebrow"><span className="live-dot" /> YOUR NEXT OPPORTUNITY STARTS HERE</div>
          <h1>A little closer to the work you love.</h1>
          <p>Find fresh opportunities, keep your search organized, and take the next step with confidence.</p>
          <div className="auth-feature"><BriefcaseBusiness size={18} /><span>Thoughtful tools for your next career move.</span></div>
        </div>
        <span className="auth-story-footer">Find it fresh. Apply with confidence.</span>
      </section>

      <section className="auth-form-side">
        <a className="auth-back" href="/"><ArrowLeft size={16} /> Back to jobs</a>
        <div className="auth-card">
          <div className="auth-card-mark"><Sparkles size={18} /></div>
          <p className="section-kicker">{isSignUp ? "START YOUR SEARCH" : isReset ? "ACCOUNT RECOVERY" : isUpdate ? "SECURE YOUR ACCOUNT" : "WELCOME BACK"}</p>
          <h2>{isSignUp ? "Create your account" : isReset ? "Reset your password" : isUpdate ? "Choose a new password" : "Sign in to JobNest"}</h2>
          <p className="auth-subtitle">
            {isSignUp
              ? "Save the roles you love and keep your search in one place."
              : isReset
                ? "Enter your account email and we'll send you a secure reset link."
                : isUpdate
                  ? "Choose a new password for your JobNest account."
                  : "Pick up where you left off in your job search."}
          </p>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isSignUp && (
              <label className="auth-field">
                <span>Full name</span>
                <input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" required />
              </label>
            )}
            {!isUpdate && !isReset && (
              <label className="auth-field">
                <span>Email address</span>
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
              </label>
            )}
            {isReset && (
              <label className="auth-field">
                <span>Email address</span>
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
              </label>
            )}
            {!isReset && (
              <>
                <label className="auth-field">
                  <span>{isUpdate ? "New password" : "Password"}</span>
                  <input type="password" autoComplete={isSignUp || isUpdate ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isSignUp || isUpdate ? "At least 8 characters" : "Enter your password"} minLength={8} required />
                </label>
                {(isSignUp || isUpdate) && (
                  <label className="auth-field">
                    <span>Confirm password</span>
                    <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter your password again" minLength={8} required />
                  </label>
                )}
              </>
            )}
            {errorMessage && <p className="auth-message auth-error" role="alert">{errorMessage}</p>}
            {successMessage && <p className="auth-message auth-success" role="status">{successMessage}</p>}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Please wait…" : isSignUp ? "Create account" : isReset ? "Send reset link" : isUpdate ? "Update password" : "Sign in"}
            </button>
          </form>
          {mode === "signin" && <p className="auth-forgot"><a href="/reset-password">Forgot your password?</a></p>}
          {isUpdate && successMessage ? (
            <p className="auth-switch"><a href="/">Continue to JobNest</a></p>
          ) : !isReset && !isUpdate ? (
            <p className="auth-switch">
              {isSignUp ? "Already have an account?" : "New to JobNest?"}{" "}
              <a href={isSignUp ? "/signin" : "/signup"}>{isSignUp ? "Sign in" : "Create an account"}</a>
            </p>
          ) : (
            <p className="auth-switch"><a href="/signin">Back to sign in</a></p>
          )}
          <p className="auth-terms">By continuing, you agree to use JobNest responsibly and keep your account details secure.</p>
        </div>
      </section>
    </main>
  );
}

export default AuthPage;
